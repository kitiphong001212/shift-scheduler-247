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
  A5: { A1: false, A7: false, A5: true,  A6: true  },
  A6: { A1: false, A7: false, A5: true,  A6: true  }
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