// src/services/shiftRules.ts
import type { CellStatus, ShiftCode, ShiftDefinition } from '@/types/employee'

export const SHIFT_CODES: ShiftCode[] = ['A1', 'A7', 'A5', 'A6']
export const LEAVE_CODES = ['OFF', 'AL'] as const
export const ALL_STATUSES: CellStatus[] = ['A1', 'A7', 'A5', 'A6', 'OFF', 'AL']

export const SHIFTS: Record<ShiftCode, ShiftDefinition> = {
  A1: { code: 'A1', start: '07:00', end: '16:00', dailyQuota: 3 },
  A7: { code: 'A7', start: '11:00', end: '20:00', dailyQuota: 2 },
  A5: { code: 'A5', start: '14:00', end: '23:00', dailyQuota: 3 },
  A6: { code: 'A6', start: '22:30', end: '07:30', dailyQuota: 2 }
}

export const DEFAULT_QUOTAS: Record<ShiftCode, number> = { A1: 3, A7: 2, A5: 3, A6: 2 }
export const DEFAULT_REQUIRED_WORKING = 10

/** Hard limit: working days in a row must not exceed this. */
export const MAX_CONSECUTIVE_WORKING_DAYS = 5

/** true = allowed on consecutive working days */
export const TRANSITION_MATRIX: Record<ShiftCode, Record<ShiftCode, boolean>> = {
  A1: { A1: true,  A7: true,  A5: true,  A6: false },
  A7: { A1: true,  A7: true,  A5: true,  A6: false },
  A5: { A1: false, A7: false, A5: true,  A6: true  }, // A5 → A6 also used as last-resort cover
  A6: { A1: false, A7: false, A5: true,  A6: true  }
}

/**
 * When A6 is short on working staff (e.g. many A6 leave requests),
 * pull from this home group as a last resort even if it goes under its own quota.
 * Only A5-group staff may cover A6 — A1/A7 never work A6 within the month.
 */
export const LAST_RESORT_COVER_FOR: Partial<Record<ShiftCode, ShiftCode>> = {
  A6: 'A5'
}

/**
 * Max consecutive A6 days for A5-home cover staff.
 * A6→A5 needs a rest day, so once covering they stay on A6 until leave —
 * force rest after this many cover days so A5 is not stuck on A6 for a long block.
 */
export const MAX_CONSECUTIVE_A6_COVER = 2

/**
 * Max consecutive days parked on a shift that cannot transition back to home
 * (e.g. A1 on A5). Force rest so they can return home and protect daily quotas.
 */
export const MAX_TRAPPED_CROSS_COVER = 2

/**
 * Shifts each monthly home group may work (even after OFF resets day-to-day transitions).
 * A5 never works A1/A7; A1/A7 never work A6; A6 stays on overnight family (A6/A5).
 */
export const HOME_ELIGIBLE: Record<ShiftCode, readonly ShiftCode[]> = {
  A1: ['A1', 'A7', 'A5'],
  A7: ['A1', 'A7', 'A5'],
  A5: ['A5', 'A6'],
  A6: ['A6', 'A5']
}

/** Monthly home-group eligibility for a working cell. */
export function canWorkShift(homeShift: ShiftCode, target: ShiftCode): boolean {
  return HOME_ELIGIBLE[homeShift].includes(target)
}

/** True when this home→target pair is last-resort cover (not free rebalance). */
export function isLastResortCover(home: ShiftCode, target: ShiftCode): boolean {
  return LAST_RESORT_COVER_FOR[target] === home
}

/** A6 -> A5 requires at least 1 OFF/AL day in between. */
export function requiresRestBetween(from: ShiftCode, to: ShiftCode): boolean {
  return from === 'A6' && to === 'A5'
}

export function isShift(status: CellStatus | null | undefined): status is ShiftCode {
  return status === 'A1' || status === 'A7' || status === 'A5' || status === 'A6'
}
export function isLeave(status: CellStatus | null | undefined): boolean {
  return status === 'OFF' || status === 'AL'
}

/**
 * Transition legality between two CONSECUTIVE calendar days.
 * Any leave day resets the chain (A6 -> OFF -> A5 is fine).
 */
export function isTransitionAllowed(prev: CellStatus | null, next: CellStatus | null): boolean {
  if (!prev || !next) return true
  if (isLeave(prev) || isLeave(next)) return true
  if (!isShift(prev) || !isShift(next)) return true
  if (requiresRestBetween(prev, next)) return false
  return TRANSITION_MATRIX[prev][next]
}

/** Distinguish "forbidden matrix" vs "A6 needs rest" for conflict typing. */
export function transitionViolation(
  prev: CellStatus | null,
  next: CellStatus | null
): 'NONE' | 'FORBIDDEN' | 'A6_NO_REST' {
  if (!prev || !next) return 'NONE'
  if (!isShift(prev) || !isShift(next)) return 'NONE'
  if (requiresRestBetween(prev, next)) return 'A6_NO_REST'
  return TRANSITION_MATRIX[prev][next] ? 'NONE' : 'FORBIDDEN'
}

export const STATUS_STYLES: Record<CellStatus, string> = {
  A1: 'bg-sky-50 text-sky-700 border-sky-200',
  A7: 'bg-violet-50 text-violet-700 border-violet-200',
  A5: 'bg-amber-50 text-amber-700 border-amber-200',
  A6: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  OFF: 'bg-slate-100 text-slate-500 border-slate-200',
  AL: 'bg-rose-50 text-rose-600 border-rose-200'
}