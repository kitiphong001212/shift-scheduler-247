// src/services/fairness.ts
import type { Employee, ShiftCode, CellStatus } from '@/types/employee'
import type { OffPolicy } from '@/types/schedule'
import { MAX_CONSECUTIVE_WORKING_DAYS } from './shiftRules'

export interface EmployeeState {
  offCount: number
  alCount: number
  workStreak: number
  lastStatus: CellStatus | null
  shiftMoveCount: number
}

export interface OffPickContext {
  states: Map<string, EmployeeState>
  assignedShift: Map<string, ShiftCode>
  quotas: Record<ShiftCode, number>
  availableByShift: Record<ShiftCode, number>
  offTarget: number
  daysRemaining: number          // including today
  offPolicy: OffPolicy
  /** Total AL days planned this month (including already taken). */
  plannedAlByEmployee?: Map<string, number>
  /** Remaining AL days still planned later this month (not yet taken). */
  remainingAlByEmployee?: Map<string, number>
  rng: () => number
}

function needsHardRest(st: EmployeeState): boolean {
  return st.workStreak >= MAX_CONSECUTIVE_WORKING_DAYS
}

function plannedAlOf(employeeId: string, ctx: OffPickContext): number {
  if (ctx.plannedAlByEmployee?.has(employeeId)) return ctx.plannedAlByEmployee.get(employeeId)!
  const st = ctx.states.get(employeeId)
  return (st?.alCount ?? 0) + remainingAlOf(employeeId, ctx)
}

function remainingAlOf(employeeId: string, ctx: OffPickContext): number {
  return ctx.remainingAlByEmployee?.get(employeeId) ?? 0
}

/** Projected non-working days if no more AUTO OFF is given: current OFF + all AL this month. */
function projectedLeave(st: EmployeeState, plannedAl: number): number {
  return st.offCount + plannedAl
}

/**
 * Higher score = should get AUTO OFF today.
 *
 * Weekend OFF target is the soft entitlement. AL already covers extra leave
 * capacity, so people with AL must not keep receiving AUTO OFF while others
 * are still short of leave.
 */
export function scoreForOff(employee: Employee, ctx: OffPickContext): number {
  const st = ctx.states.get(employee.id)
  if (!st) return -Infinity

  const remainingOff = ctx.offTarget - st.offCount
  const plannedAl = plannedAlOf(employee.id, ctx)
  const remainingAl = remainingAlOf(employee.id, ctx)
  const leaveLoad = projectedLeave(st, plannedAl)
  const urgency = remainingOff / Math.max(1, ctx.daysRemaining)

  let score = remainingOff * 120 + urgency * 100

  // Prefer whoever has the least projected leave (OFF + month AL)
  score -= leaveLoad * 120

  if (needsHardRest(st)) score += 10_000
  else if (st.workStreak === MAX_CONSECUTIVE_WORKING_DAYS - 1 && remainingOff > 0) score += 400
  else if (st.workStreak === MAX_CONSECUTIVE_WORKING_DAYS - 2 && remainingOff > 0) score += 60

  if (st.lastStatus === 'A6' && remainingOff > 0) score += 50

  // Avoid OFF/AL clustering
  if (st.lastStatus === 'OFF' || st.lastStatus === 'AL') score -= 80

  const shift = ctx.assignedShift.get(employee.id)
  if (shift && ctx.availableByShift[shift] - 1 < ctx.quotas[shift]) score -= 200

  if (remainingOff <= 0 && !needsHardRest(st)) {
    score -= 8_000 + Math.max(0, -remainingOff) * 400
  }
  // AL holders already have extra leave — keep them out of staffing extras
  if (remainingOff <= 0 && plannedAl > 0 && !needsHardRest(st)) {
    score -= 6_000
  }

  score += ctx.rng() * 5
  return score
}

type SoftTier = 'under-target' | 'no-al-extra' | 'any'

function inTier(st: EmployeeState, employeeId: string, ctx: OffPickContext, tier: SoftTier): boolean {
  if (needsHardRest(st)) return true
  const under = st.offCount < ctx.offTarget
  const plannedAl = plannedAlOf(employeeId, ctx)
  if (tier === 'under-target') return under
  // Staffing extras: only people with no AL this month (AL already replaced spare OFF)
  if (tier === 'no-al-extra') return !under && plannedAl === 0
  return true
}

function pickFromPool(
  pool: Employee[],
  need: number,
  ctx: OffPickContext,
  tier: SoftTier
): Employee[] {
  const chosen: Employee[] = []
  const local = [...pool]

  for (let i = 0; i < need && local.length > 0; i++) {
    let bestIdx = -1
    let bestScore = -Infinity

    for (let j = 0; j < local.length; j++) {
      const st = ctx.states.get(local[j].id)
      if (!st) continue
      const hard = needsHardRest(st)
      if (ctx.offPolicy === 'ENTITLEMENT_FIRST' && st.offCount >= ctx.offTarget && !hard) continue
      if (!inTier(st, local[j].id, ctx, tier)) continue
      // Last-resort tier: still prefer not to push AL holders past weekend OFF target
      if (tier === 'any' && plannedAlOf(local[j].id, ctx) > 0 && st.offCount >= ctx.offTarget && !hard) continue
      const s = scoreForOff(local[j], ctx)
      if (s > bestScore) { bestScore = s; bestIdx = j }
    }
    if (bestIdx < 0) break

    const picked = local.splice(bestIdx, 1)[0]
    chosen.push(picked)
    const shift = ctx.assignedShift.get(picked.id)
    if (shift) ctx.availableByShift[shift] -= 1
  }
  return chosen
}

/**
 * Fill leftover daily OFF slots in tiers:
 * 1) still under weekend OFF target
 * 2) at/over target but no remaining AL (staffing extras)
 * 3) everyone else (last resort)
 */
export function pickOffCandidates(
  candidates: Employee[],
  need: number,
  ctx: OffPickContext
): Employee[] {
  const tiers: SoftTier[] =
    ctx.offPolicy === 'ENTITLEMENT_FIRST'
      ? ['under-target']
      : ['under-target', 'no-al-extra', 'any']

  const chosen: Employee[] = []
  let remaining = need
  let pool = [...candidates]

  for (const tier of tiers) {
    if (remaining <= 0) break
    const batch = pickFromPool(pool, remaining, ctx, tier)
    chosen.push(...batch)
    const taken = new Set(batch.map((e) => e.id))
    pool = pool.filter((e) => !taken.has(e.id))
    remaining = need - chosen.length
  }
  return chosen
}
