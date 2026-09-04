// src/services/fairness.ts
import type { Employee, ShiftCode, CellStatus } from '@/types/employee'
import type { OffPolicy } from '@/types/schedule'

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

/** Higher score = should get OFF today. */
export function scoreForOff(employee: Employee, ctx: OffPickContext): number {
  const st = ctx.states.get(employee.id)
  if (!st) return -Infinity

  const remainingOff = ctx.offTarget - st.offCount
  const urgency = remainingOff / Math.max(1, ctx.daysRemaining)
  let score = urgency * 100

  // Priority 6 — must break a long streak
  if (st.workStreak >= 5) score += 60
  else if (st.workStreak === 4) score += 20

  // Rest rule after night shift
  if (st.lastStatus === 'A6') score += 25

  // Avoid clustering OFF blocks
  if (st.lastStatus === 'OFF' || st.lastStatus === 'AL') score -= 25

  // Do not starve a shift group below its daily quota
  const shift = ctx.assignedShift.get(employee.id)
  if (shift && ctx.availableByShift[shift] - 1 < ctx.quotas[shift]) score -= 200

  // Already met the entitlement
  if (remainingOff <= 0) score -= ctx.offPolicy === 'ENTITLEMENT_FIRST' ? 10_000 : 150

  // Priority 8 — randomized tie-breaking
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
      if (ctx.offPolicy === 'ENTITLEMENT_FIRST' && st.offCount >= ctx.offTarget) continue
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