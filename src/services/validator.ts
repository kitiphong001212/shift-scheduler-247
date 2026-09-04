// src/services/validator.ts
import type { CellStatus, Employee, ShiftCode } from '@/types/employee'
import type { LeaveRequest } from '@/types/leave'
import type {
  DayStat, EmployeeStat, MonthContext, ScheduleEntry,
  ScheduleStatistics, SchedulerConfig, ShiftAssignmentMap
} from '@/types/schedule'
import type { Conflict } from '@/types/conflict'
import { SHIFT_CODES, isShift, transitionViolation } from './shiftRules'
import { cellKey } from '@/utils/date'

export interface ValidateInput {
  employees: Employee[]
  month: MonthContext
  entries: ScheduleEntry[]
  shiftAssignments: ShiftAssignmentMap
  leaveRequests: LeaveRequest[]
  config: SchedulerConfig
}

export interface ValidationResult {
  valid: boolean
  conflicts: Conflict[]
  statistics: ScheduleStatistics
}

const SEVERITY_WEIGHT = { ERROR: 6, WARNING: 2, INFO: 0.5 } as const

export function validateSchedule(input: ValidateInput): ValidationResult {
  const { month, config, shiftAssignments } = input
  const employees = input.employees.filter((e) => e.active)
  const N = employees.length
  const conflicts: Conflict[] = []
  const push = (c: Omit<Conflict, 'id'>) =>
    conflicts.push({ ...c, id: `${c.type}:${c.date ?? '-'}:${c.employeeId ?? '-'}:${conflicts.length}` })

  const grid = new Map<string, CellStatus>()
  for (const e of input.entries) grid.set(cellKey(e.employeeId, e.date), e.shift)

  const maxLeaveCapacity = Math.max(0, N - config.requiredWorking)

  // ---------- Employee level ----------
  const perEmployee: EmployeeStat[] = []
  const employeeConflictCount = new Map<string, number>()
  const bump = (id: string) => employeeConflictCount.set(id, (employeeConflictCount.get(id) ?? 0) + 1)

  for (const emp of employees) {
    const assigned = shiftAssignments[emp.id] ?? null
    if (!assigned) {
      push({
        type: 'EMPLOYEE_NOT_ASSIGNED_SHIFT', severity: 'ERROR',
        rule: 'Monthly shift assignment is required before generating',
        employeeId: emp.id,
        message: `${emp.name} has no assigned shift for ${month.label}`
      })
      bump(emp.id)
    }

    let working = 0, off = 0, al = 0, streak = 0, maxStreak = 0
    let prev: CellStatus | null = null

    for (const day of month.days) {
      const status = grid.get(cellKey(emp.id, day.date)) ?? null
      if (!status) { prev = null; streak = 0; continue }

      if (status === 'OFF') { off++; streak = 0 }
      else if (status === 'AL') { al++; streak = 0 }
      else {
        working++
        streak++
        maxStreak = Math.max(maxStreak, streak)
        if (streak > 5) {
          push({
            type: 'TOO_MANY_CONSECUTIVE_WORKING_DAYS', severity: 'ERROR',
            rule: 'Max 5 consecutive working days',
            date: day.date, employeeId: emp.id,
            message: `${emp.name}: working ${streak} consecutive days`,
            meta: { streak }
          })
          bump(emp.id)
        }
      }

      const violation = transitionViolation(prev, status)
      if (violation === 'FORBIDDEN') {
        push({
          type: 'INVALID_SHIFT_TRANSITION', severity: 'ERROR',
          rule: 'Shift transition matrix',
          date: day.date, employeeId: emp.id,
          message: `${emp.name}: ${prev} → ${status} is not allowed`,
          meta: { from: String(prev), to: String(status) }
        })
        bump(emp.id)
      } else if (violation === 'A6_NO_REST') {
        push({
          type: 'A6_NO_REST', severity: 'ERROR',
          rule: 'A6 → A5 requires at least 1 rest day',
          date: day.date, employeeId: emp.id,
          message: `${emp.name}: A6 → A5 without a rest day in between`,
          meta: { from: 'A6', to: 'A5' }
        })
        bump(emp.id)
      }
      prev = status
    }

    if (off < month.offTarget) {
      push({
        type: 'OFF_TARGET_NOT_REACHED', severity: 'WARNING',
        rule: `OFF target = weekend days of the month (${month.offTarget})`,
        employeeId: emp.id,
        message: `${emp.name}: OFF ${off}/${month.offTarget} (short by ${month.offTarget - off})`,
        meta: { actual: off, target: month.offTarget }
      })
      bump(emp.id)
    } else if (off > month.offTarget) {
      push({
        type: 'OFF_TARGET_NOT_REACHED', severity: 'INFO',
        rule: 'Daily staffing forces extra OFF days',
        employeeId: emp.id,
        message: `${emp.name}: OFF ${off}/${month.offTarget} (+${off - month.offTarget} above entitlement)`,
        meta: { actual: off, target: month.offTarget }
      })
    }

    perEmployee.push({
      employeeId: emp.id,
      shift: assigned,
      working, off, al,
      totalLeave: off + al,
      maxConsecutive: maxStreak,
      conflicts: 0
    })
  }

  // ---------- Duplicate leave requests ----------
  const seen = new Set<string>()
  for (const r of input.leaveRequests) {
    const k = cellKey(r.employeeId, r.date)
    if (seen.has(k)) {
      push({
        type: 'DUPLICATE_LEAVE', severity: 'WARNING',
        rule: 'One leave request per employee per day',
        date: r.date, employeeId: r.employeeId,
        message: 'Duplicate leave request for the same date'
      })
      bump(r.employeeId)
    }
    seen.add(k)
  }

  // ---------- Day level ----------
  const requestsByDate = new Map<string, LeaveRequest[]>()
  for (const r of input.leaveRequests) {
    const list = requestsByDate.get(r.date) ?? []
    list.push(r)
    requestsByDate.set(r.date, list)
  }

  const perDay: DayStat[] = []
  for (const day of month.days) {
    const byShift = { A1: 0, A7: 0, A5: 0, A6: 0 } as Record<ShiftCode, number>
    let working = 0, off = 0, al = 0
    let dayConflicts = 0
    const before = conflicts.length

    for (const emp of employees) {
      const status = grid.get(cellKey(emp.id, day.date))
      if (!status) continue
      if (status === 'OFF') off++
      else if (status === 'AL') al++
      else if (isShift(status)) { working++; byShift[status]++ }
    }

    if (al > maxLeaveCapacity) {
      push({
        type: 'AL_OVER_CAPACITY', severity: 'ERROR',
        rule: `AL count must be ≤ ${maxLeaveCapacity} (N − required working)`,
        date: day.date,
        message: `Insufficient Staffing: AL ${al} exceeds capacity ${maxLeaveCapacity}`,
        meta: { al, capacity: maxLeaveCapacity }
      })
    }

    if (working < config.requiredWorking) {
      push({
        type: 'INSUFFICIENT_STAFF', severity: 'ERROR',
        rule: `Required working = ${config.requiredWorking}/day`,
        date: day.date,
        message: `Insufficient Staffing: ${working}/${config.requiredWorking} working`,
        meta: { working, required: config.requiredWorking }
      })
    } else if (working > config.requiredWorking) {
      push({
        type: 'OVERSTAFFED', severity: 'INFO',
        rule: 'Entitlement-first policy may leave extra staff on duty',
        date: day.date,
        message: `Overstaffed: ${working}/${config.requiredWorking} working`,
        meta: { working, required: config.requiredWorking }
      })
    }

    const requested = requestsByDate.get(day.date)?.length ?? 0
    if (requested > maxLeaveCapacity) {
      push({
        type: 'TOO_MANY_LEAVE_REQUEST', severity: 'WARNING',
        rule: `Daily leave quota = ${maxLeaveCapacity}`,
        date: day.date,
        message: `Leave request exceeds daily quota by ${requested - maxLeaveCapacity}`,
        meta: { required: maxLeaveCapacity, requested, excess: requested - maxLeaveCapacity }
      })
    }

    for (const s of SHIFT_CODES) {
      if (byShift[s] !== config.quotas[s]) {
        push({
          type: 'SHIFT_QUOTA_MISMATCH', severity: 'WARNING',
          rule: `${s} quota = ${config.quotas[s]}/day`,
          date: day.date,
          message: `${s} = ${byShift[s]}/${config.quotas[s]}`,
          meta: { shift: s, actual: byShift[s], expected: config.quotas[s] }
        })
      }
    }

    dayConflicts = conflicts.length - before
    perDay.push({ date: day.date, working, off, al, byShift, conflicts: dayConflicts })
  }

  // ---------- Score ----------
  const errors = conflicts.filter((c) => c.severity === 'ERROR').length
  const warnings = conflicts.filter((c) => c.severity === 'WARNING').length
  const infos = conflicts.filter((c) => c.severity === 'INFO').length

  const penalty =
    errors * SEVERITY_WEIGHT.ERROR + warnings * SEVERITY_WEIGHT.WARNING + infos * SEVERITY_WEIGHT.INFO
  const score = Math.max(0, Math.round(100 - penalty))

  perEmployee.forEach((s) => (s.conflicts = employeeConflictCount.get(s.employeeId) ?? 0))

  return {
    valid: errors === 0,
    conflicts,
    statistics: { perEmployee, perDay, errors, warnings, infos, score }
  }
}