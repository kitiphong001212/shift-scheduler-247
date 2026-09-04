// tests/scheduler.spec.ts
import { describe, expect, it } from 'vitest'
import { buildMonthContext } from '@/services/calendar'
import { generateSchedule } from '@/services/scheduler'
import { createSeedEmployees } from '@/stores/employeeStore'
import { DEFAULT_QUOTAS } from '@/services/shiftRules'
import type { SchedulerConfig, ShiftAssignmentMap } from '@/types/schedule'

const employees = createSeedEmployees()
const assignments: ShiftAssignmentMap = Object.fromEntries(employees.map((e) => [e.id, e.defaultShift]))
const config: SchedulerConfig = {
  requiredWorking: 10, quotas: { ...DEFAULT_QUOTAS }, offPolicy: 'STAFFING_FIRST', seed: 42
}

describe('generateSchedule', () => {
  const month = buildMonthContext(2026, 9)

  it('September 2026 has 8 weekend days and OFF target 8', () => {
    expect(month.days.length).toBe(30)
    expect(month.weekendCount).toBe(8)
    expect(month.offTarget).toBe(8)
  })

  it('fills every employee/day cell', () => {
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests: [], config })
    expect(r.schedule.length).toBe(15 * 30)
  })

  it('keeps exactly 10 people working each day (staffing-first)', () => {
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests: [], config })
    for (const d of r.statistics.perDay) expect(d.working).toBe(10)
  })

  it('respects AL requests (priority 1)', () => {
    const leaveRequests = [
      { id: '1', employeeId: 'EMP001', date: '2026-09-05', type: 'AL' as const },
      { id: '2', employeeId: 'EMP001', date: '2026-09-06', type: 'AL' as const }
    ]
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests, config })
    const cells = r.schedule.filter((e) => e.employeeId === 'EMP001' && e.date.startsWith('2026-09-0'))
    expect(cells.find((c) => c.date === '2026-09-05')?.shift).toBe('AL')
    expect(cells.find((c) => c.date === '2026-09-06')?.source).toBe('REQUEST')
  })

  it('never aborts when leave requests exceed the daily quota', () => {
    const leaveRequests = employees.slice(0, 7).map((e, i) => ({
      id: `x${i}`, employeeId: e.id, date: '2026-09-10', type: 'OFF' as const
    }))
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests, config })
    expect(r.schedule.length).toBe(15 * 30)
    expect(r.conflicts.some((c) => c.type === 'TOO_MANY_LEAVE_REQUEST')).toBe(true)
  })

  it('produces no forbidden shift transitions', () => {
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests: [], config })
    expect(r.conflicts.filter((c) => c.type === 'INVALID_SHIFT_TRANSITION').length).toBe(0)
    expect(r.conflicts.filter((c) => c.type === 'A6_NO_REST').length).toBe(0)
  })

  it('never schedules more than 5 consecutive working days', () => {
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests: [], config })
    for (const s of r.statistics.perEmployee) expect(s.maxConsecutive).toBeLessThanOrEqual(5)
  })

  it('distributes OFF fairly (max-min spread <= 2)', () => {
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests: [], config })
    const offs = r.statistics.perEmployee.map((s) => s.off)
    expect(Math.max(...offs) - Math.min(...offs)).toBeLessThanOrEqual(2)
  })

  it('flags insufficient staffing when AL exceeds capacity', () => {
    const leaveRequests = employees.slice(0, 6).map((e, i) => ({
      id: `al${i}`, employeeId: e.id, date: '2026-09-12', type: 'AL' as const
    }))
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests, config })
    expect(r.conflicts.some((c) => c.type === 'AL_OVER_CAPACITY' && c.date === '2026-09-12')).toBe(true)
    expect(r.conflicts.some((c) => c.type === 'INSUFFICIENT_STAFF' && c.date === '2026-09-12')).toBe(true)
  })

  it('handles a 10-weekend-day month and a different team size', () => {
    const m = buildMonthContext(2026, 8) // check weekend count is computed, not assumed
    const smaller = employees.slice(0, 12)
    const a: ShiftAssignmentMap = Object.fromEntries(smaller.map((e) => [e.id, e.defaultShift]))
    const r = generateSchedule({ employees: smaller, month: m, shiftAssignments: a, leaveRequests: [], config })
    expect(r.schedule.length).toBe(12 * m.days.length)
  })

  it('entitlement-first caps OFF at the target', () => {
    const r = generateSchedule({
      employees, month, shiftAssignments: assignments, leaveRequests: [],
      config: { ...config, offPolicy: 'ENTITLEMENT_FIRST' }
    })
    for (const s of r.statistics.perEmployee) expect(s.off).toBeLessThanOrEqual(month.offTarget)
  })
})