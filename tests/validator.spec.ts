// tests/validator.spec.ts
import { describe, expect, it } from 'vitest'
import { buildMonthContext } from '@/services/calendar'
import { validateSchedule } from '@/services/validator'
import { DEFAULT_QUOTAS, MAX_CONSECUTIVE_WORKING_DAYS } from '@/services/shiftRules'
import type { ScheduleEntry, SchedulerConfig } from '@/types/schedule'
import type { Employee } from '@/types/employee'

const month = buildMonthContext(2026, 9)
const config: SchedulerConfig = {
  requiredWorking: 10, quotas: { ...DEFAULT_QUOTAS }, offPolicy: 'STAFFING_FIRST', seed: 1
}
const emp: Employee = { id: 'E1', code: 'E1', name: 'Test', active: true, defaultShift: 'A6' }

function entries(pairs: [string, string][]): ScheduleEntry[] {
  return pairs.map(([date, shift]) => ({ employeeId: 'E1', date, shift: shift as never, source: 'AUTO' }))
}

describe('validateSchedule', () => {
  it('detects A6 → A1', () => {
    const r = validateSchedule({
      employees: [emp], month,
      entries: entries([['2026-09-10', 'A6'], ['2026-09-11', 'A1']]),
      shiftAssignments: { E1: 'A6' }, leaveRequests: [], config
    })
    expect(r.conflicts.some((c) => c.type === 'INVALID_SHIFT_TRANSITION')).toBe(true)
  })

  it('detects A6 → A5 without a rest day', () => {
    const r = validateSchedule({
      employees: [emp], month,
      entries: entries([['2026-09-10', 'A6'], ['2026-09-11', 'A5']]),
      shiftAssignments: { E1: 'A6' }, leaveRequests: [], config
    })
    expect(r.conflicts.some((c) => c.type === 'A6_NO_REST')).toBe(true)
  })

  it('accepts A6 → OFF → A5', () => {
    const r = validateSchedule({
      employees: [emp], month,
      entries: entries([['2026-09-10', 'A6'], ['2026-09-11', 'OFF'], ['2026-09-12', 'A5']]),
      shiftAssignments: { E1: 'A6' }, leaveRequests: [], config
    })
    expect(r.conflicts.some((c) => c.type === 'A6_NO_REST')).toBe(false)
    expect(r.conflicts.some((c) => c.type === 'INVALID_SHIFT_TRANSITION')).toBe(false)
  })

  it('detects > 5 consecutive working days', () => {
    const r = validateSchedule({
      employees: [emp], month,
      entries: entries([
        ['2026-09-01', 'A1'], ['2026-09-02', 'A1'], ['2026-09-03', 'A1'],
        ['2026-09-04', 'A1'], ['2026-09-05', 'A1'], ['2026-09-06', 'A1']
      ]),
      shiftAssignments: { E1: 'A1' }, leaveRequests: [], config
    })
    const c = r.conflicts.find((x) => x.type === 'TOO_MANY_CONSECUTIVE_WORKING_DAYS')
    expect(c?.date).toBe('2026-09-06')
    expect(c?.rule).toContain(String(MAX_CONSECUTIVE_WORKING_DAYS))
  })

  it('detects duplicate leave requests', () => {
    const r = validateSchedule({
      employees: [emp], month, entries: [],
      shiftAssignments: { E1: 'A1' },
      leaveRequests: [
        { id: 'a', employeeId: 'E1', date: '2026-09-03', type: 'OFF' },
        { id: 'b', employeeId: 'E1', date: '2026-09-03', type: 'AL' }
      ],
      config
    })
    expect(r.conflicts.some((c) => c.type === 'DUPLICATE_LEAVE')).toBe(true)
  })

  it('flags A7 monthly group working A6', () => {
    const a7: Employee = { id: 'E7', code: 'E7', name: 'Kittiphong', active: true, defaultShift: 'A7' }
    const r = validateSchedule({
      employees: [a7], month,
      entries: [{ employeeId: 'E7', date: '2026-09-28', shift: 'A6', source: 'AUTO' }],
      shiftAssignments: { E7: 'A7' }, leaveRequests: [], config
    })
    expect(r.conflicts.some((c) => c.type === 'FORBIDDEN_SHIFT_FOR_GROUP' && c.employeeId === 'E7')).toBe(true)
  })
})
