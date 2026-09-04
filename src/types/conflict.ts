// src/types/conflict.ts
export type ConflictSeverity = 'ERROR' | 'WARNING' | 'INFO'

export type ConflictType =
  | 'INSUFFICIENT_STAFF'
  | 'SHIFT_QUOTA_MISMATCH'
  | 'INVALID_SHIFT_TRANSITION'
  | 'A6_NO_REST'
  | 'TOO_MANY_CONSECUTIVE_WORKING_DAYS'
  | 'OFF_TARGET_NOT_REACHED'
  | 'EMPLOYEE_NOT_ASSIGNED_SHIFT'
  | 'DUPLICATE_LEAVE'
  | 'AL_OVER_CAPACITY'
  | 'OVERSTAFFED'

export interface Conflict {
  id: string
  type: ConflictType
  severity: ConflictSeverity
  rule: string
  message: string
  date?: string
  employeeId?: string
  meta?: Record<string, string | number>
}