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
  rng: () => number
}

/** Higher score = should get OFF today. Used only for leftover quota (not requested OFF). */
export function scoreForOff(employee: Employee, ctx: OffPickContext): number {
  const st = ctx.states.get(employee.id)
  if (!st) return -Infinity

  const remainingOff = ctx.offTarget - st.offCount
  const urgency = remainingOff / Math.max(1, ctx.daysRemaining)
  let score = remainingOff * 40 + urgency * 80

  // Prefer people approaching the hard consecutive-work limit
  if (st.workStreak >= MAX_CONSECUTIVE_WORKING_DAYS) score += 10_000
  else if (st.workStreak === MAX_CONSECUTIVE_WORKING_DAYS - 1) score += 500
  else if (st.workStreak === MAX_CONSECUTIVE_WORKING_DAYS - 2) score += 80

  if (st.lastStatus === 'A6') score += 80

  if (st.lastStatus === 'OFF' || st.lastStatus === 'AL') score -= 25

  const shift = ctx.assignedShift.get(employee.id)
  if (shift && ctx.availableByShift[shift] - 1 < ctx.quotas[shift]) score -= 200

  if (remainingOff <= 0 && st.workStreak < MAX_CONSECUTIVE_WORKING_DAYS) {
    score -= ctx.offPolicy === 'ENTITLEMENT_FIRST' ? 10_000 : 150
  }

  score += ctx.rng() * 5
  return score
}

/** Greedy fair pick, re-scored after every selection. */
export function pickOffCandidates(
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
      const atLimit = st.workStreak >= MAX_CONSECUTIVE_WORKING_DAYS
      if (ctx.offPolicy === 'ENTITLEMENT_FIRST' && st.offCount >= ctx.offTarget && !atLimit) continue
      const s = scoreForOff(pool[j], ctx)
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
