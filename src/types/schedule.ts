// src/types/schedule.ts
import type { CellStatus, ShiftCode } from './employee'
import type { Conflict } from './conflict'
import type { Employee } from './employee'
import type { LeaveRequest } from './leave'

export type AssignmentSource = 'REQUEST' | 'AUTO' | 'MANUAL'
export type OffPolicy = 'STAFFING_FIRST' | 'ENTITLEMENT_FIRST'

export interface ScheduleEntry {
  employeeId: string
  date: string
  shift: CellStatus
  source: AssignmentSource
}

export interface DayInfo {
  date: string
  day: number
  weekday: number        // 0=Sun .. 6=Sat
  weekdayLabel: string
  isWeekend: boolean
}

export interface MonthContext {
  year: number
  month: number          // 1-12
  monthKey: string       // YYYY-MM
  label: string
  days: DayInfo[]
  saturdayCount: number
  sundayCount: number
  weekendCount: number
  offTarget: number
}

export type ShiftAssignmentMap = Record<string, ShiftCode>
export type A1AllowedTransitions = Record<ShiftCode, boolean>

export interface SchedulerConfig {
  requiredWorking: number
  quotas: Record<ShiftCode, number>
  /** Allowed next-day shifts after working A1. */
  a1AllowedTransitions: A1AllowedTransitions
  offPolicy: OffPolicy
  seed: number
}

export interface EmployeeStat {
  employeeId: string
  shift: ShiftCode | null
  working: number
  off: number
  al: number
  totalLeave: number
  maxConsecutive: number
  conflicts: number
}

export interface DayStat {
  date: string
  working: number
  off: number
  al: number
  byShift: Record<ShiftCode, number>
  /** True when every shift code hits its configured daily quota. */
  quotaMet: boolean
  conflicts: number
}

export interface ScheduleStatistics {
  perEmployee: EmployeeStat[]
  perDay: DayStat[]
  errors: number
  warnings: number
  infos: number
  score: number
}

export interface GenerateInput {
  employees: Employee[]
  month: MonthContext
  shiftAssignments: ShiftAssignmentMap
  leaveRequests: LeaveRequest[]
  config: SchedulerConfig
  lockedEntries?: ScheduleEntry[]
}

export interface GenerateResult {
  schedule: ScheduleEntry[]
  conflicts: Conflict[]
  statistics: ScheduleStatistics
}