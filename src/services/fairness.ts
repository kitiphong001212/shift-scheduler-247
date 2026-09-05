// src/services/fairness.ts
import type { Employee, ShiftCode, CellStatus } from '@/types/employee'
import type { OffPolicy, ShiftTransitionMatrix } from '@/types/schedule'
import { MAX_CONSECUTIVE_WORKING_DAYS, MAX_CONSECUTIVE_A6_COVER, MAX_TRAPPED_CROSS_COVER, isTransitionAllowed, isShift } from './shiftRules'

export interface EmployeeState {
  offCount: number
  alCount: number
  workStreak: number
  lastStatus: CellStatus | null
  shiftMoveCount: number
  /** Consecutive A6 days while home group is A5 (cover streak). */
  a6CoverStreak: number
  /** Total A6 cover days this month for A5-home staff. */
  a6CoverDays: number
  /**
   * Consecutive days on a shift that cannot transition back to home
   * (e.g. A1 parked on A5). Must rest to return home for quota.
   */
  trappedStreak: number
}

export interface OffPickContext {
  states: Map<string, EmployeeState>
  assignedShift: Map<string, ShiftCode>
  quotas: Record<ShiftCode, number>
  transitionMatrix: ShiftTransitionMatrix
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
  return (
    st.workStreak >= MAX_CONSECUTIVE_WORKING_DAYS ||
    st.a6CoverStreak >= MAX_CONSECUTIVE_A6_COVER ||
    st.trappedStreak >= MAX_TRAPPED_CROSS_COVER
  )
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

  // A5 covering A6 cannot return to A5 without rest — end cover after a few days
  const home = ctx.assignedShift.get(employee.id)
  if (home === 'A5' && st.lastStatus === 'A6') {
    score += 800 + st.a6CoverStreak * 400
    if (st.a6CoverStreak >= MAX_CONSECUTIVE_A6_COVER) score += 5_000
  }

  // Avoid OFF/AL clustering
  if (st.lastStatus === 'OFF' || st.lastStatus === 'AL') score -= 80

  // Protect daily shift quotas — do not OFF someone if their home group would go short
  const shift = ctx.assignedShift.get(employee.id)
  if (shift && ctx.availableByShift[shift] - 1 < ctx.quotas[shift]) score -= 2_500

  // Prefer rest for staff stuck off-home who cannot transition back (e.g. A1 parked on A5)
  if (shift && st.lastStatus && isShift(st.lastStatus) && st.lastStatus !== shift) {
    if (!isTransitionAllowed(st.lastStatus, shift, ctx.transitionMatrix)) {
      score += 1_500 + st.trappedStreak * 800
    }
  }

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
      // Never soft-OFF a home group below daily quota (hard rest / trapped escape still allowed)
      const shift = ctx.assignedShift.get(local[j].id)
      if (
        !hard &&
        shift &&
        ctx.availableByShift[shift] - 1 < ctx.quotas[shift]
      ) continue
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
 * Fill leftover daily OFF slots — only staff still under the weekend OFF target.
 * Staffing extras beyond the target are filled as AL via pickAlCandidates.
 */
export function pickOffCandidates(
  candidates: Employee[],
  need: number,
  ctx: OffPickContext
): Employee[] {
  return pickFromPool(candidates, need, ctx, 'under-target')
}

/** Score for AUTO AL staffing extras (beyond weekend OFF target). */
export function scoreForAl(employee: Employee, ctx: OffPickContext): number {
  const st = ctx.states.get(employee.id)
  if (!st) return -Infinity

  const plannedAl = plannedAlOf(employee.id, ctx)
  const leaveLoad = projectedLeave(st, plannedAl)
  let score = 100 - leaveLoad * 50

  if (needsHardRest(st)) score += 10_000
  if (st.lastStatus === 'OFF' || st.lastStatus === 'AL') score -= 80

  const shift = ctx.assignedShift.get(employee.id)
  if (shift && ctx.availableByShift[shift] - 1 < ctx.quotas[shift]) score -= 2_500

  score += ctx.rng() * 5
  return score
}

/** Fill remaining daily leave capacity with AL after OFF target slots are used. */
export function pickAlCandidates(
  candidates: Employee[],
  need: number,
  ctx: OffPickContext
): Employee[] {
  const pool = [...candidates]
  const chosen: Employee[] = []

  for (let i = 0; i < need && pool.length > 0; i++) {
    let bestIdx = -1
    let bestScore = -Infinity
    for (let j = 0; j < pool.length; j++) {
      const st = ctx.states.get(pool[j].id)
      if (!st) continue
      const hard = needsHardRest(st)
      const shift = ctx.assignedShift.get(pool[j].id)
      if (
        !hard &&
        shift &&
        ctx.availableByShift[shift] - 1 < ctx.quotas[shift]
      ) continue
      // Prefer people already at OFF target for AL extras; still allow others if needed
      const s = scoreForAl(pool[j], ctx) + (st.offCount >= ctx.offTarget ? 200 : 0)
      if (s > bestScore) { bestScore = s; bestIdx = j }
    }
    if (bestIdx < 0) break
    const picked = pool.splice(bestIdx, 1)[0]
    chosen.push(picked)
    const shift = ctx.assignedShift.get(picked.id)
    if (shift) ctx.availableByShift[shift] -= 1
  }
  return chosen
}
