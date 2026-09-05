// tests/validator.spec.ts
import { describe, expect, it } from 'vitest'
import { buildMonthContext } from '@/services/calendar'
import { validateSchedule } from '@/services/validator'
import {
  cloneDefaultTransitionMatrix,
  DEFAULT_QUOTAS,
  MAX_CONSECUTIVE_WORKING_DAYS
} from '@/services/shiftRules'
import type { ScheduleEntry, SchedulerConfig } from '@/types/schedule'
import type { Employee } from '@/types/employee'

const month = buildMonthContext(2026, 9)
const config: SchedulerConfig = {
  requiredWorking: 10,
  quotas: { ...DEFAULT_QUOTAS },
  transitionMatrix: cloneDefaultTransitionMatrix(),
  offPolicy: 'STAFFING_FIRST',
  seed: 1
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

  it('detects a transition disabled in A1 settings', () => {
    const a1: Employee = { id: 'E2', code: 'E2', name: 'A1 Config', active: true, defaultShift: 'A1' }
    const r = validateSchedule({
      employees: [a1], month,
      entries: [
        { employeeId: 'E2', date: '2026-09-10', shift: 'A1', source: 'AUTO' },
        { employeeId: 'E2', date: '2026-09-11', shift: 'A7', source: 'AUTO' }
      ],
      shiftAssignments: { E2: 'A1' },
      leaveRequests: [],
      config: {
        ...config,
        transitionMatrix: {
          ...cloneDefaultTransitionMatrix(),
          A1: { A1: true, A7: false, A5: true, A6: false }
        }
      }
    })
    expect(r.conflicts.some((c) =>
      c.type === 'INVALID_SHIFT_TRANSITION' &&
      c.date === '2026-09-11' &&
      c.employeeId === 'E2'
    )).toBe(true)
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

  it('flags A5 monthly group working A1', () => {
    const a5: Employee = { id: 'E5', code: 'E5', name: 'Pattarapong', active: true, defaultShift: 'A5' }
    const r = validateSchedule({
      employees: [a5], month,
      entries: [{ employeeId: 'E5', date: '2026-09-09', shift: 'A1', source: 'AUTO' }],
      shiftAssignments: { E5: 'A5' }, leaveRequests: [], config
    })
    expect(r.conflicts.some((c) => c.type === 'FORBIDDEN_SHIFT_FOR_GROUP' && c.employeeId === 'E5')).toBe(true)
  })

  it('marks quotaMet when every shift hits its daily quota', () => {
    const team: Employee[] = [
      { id: 'a1a', code: 'a1a', name: 'A1a', active: true, defaultShift: 'A1' },
      { id: 'a1b', code: 'a1b', name: 'A1b', active: true, defaultShift: 'A1' },
      { id: 'a1c', code: 'a1c', name: 'A1c', active: true, defaultShift: 'A1' },
      { id: 'a7a', code: 'a7a', name: 'A7a', active: true, defaultShift: 'A7' },
      { id: 'a7b', code: 'a7b', name: 'A7b', active: true, defaultShift: 'A7' },
      { id: 'a5a', code: 'a5a', name: 'A5a', active: true, defaultShift: 'A5' },
      { id: 'a5b', code: 'a5b', name: 'A5b', active: true, defaultShift: 'A5' },
      { id: 'a5c', code: 'a5c', name: 'A5c', active: true, defaultShift: 'A5' },
      { id: 'a6a', code: 'a6a', name: 'A6a', active: true, defaultShift: 'A6' },
      { id: 'a6b', code: 'a6b', name: 'A6b', active: true, defaultShift: 'A6' },
      { id: 'off1', code: 'off1', name: 'Off1', active: true, defaultShift: 'A1' },
      { id: 'off2', code: 'off2', name: 'Off2', active: true, defaultShift: 'A5' }
    ]
    const date = '2026-09-10'
    const shifts: Record<string, string> = {
      a1a: 'A1', a1b: 'A1', a1c: 'A1',
      a7a: 'A7', a7b: 'A7',
      a5a: 'A5', a5b: 'A5', a5c: 'A5',
      a6a: 'A6', a6b: 'A6',
      off1: 'OFF', off2: 'OFF'
    }
    const entries = team.map((e) => ({
      employeeId: e.id, date, shift: shifts[e.id] as never, source: 'AUTO' as const
    }))
    const assignments = Object.fromEntries(team.map((e) => [e.id, e.defaultShift]))
    const r = validateSchedule({
      employees: team, month, entries, shiftAssignments: assignments, leaveRequests: [], config
    })
    const day = r.statistics.perDay.find((d) => d.date === date)!
    expect(day.byShift).toEqual({ A1: 3, A7: 2, A5: 3, A6: 2 })
    expect(day.quotaMet).toBe(true)
    expect(r.conflicts.filter((c) => c.type === 'SHIFT_QUOTA_MISMATCH' && c.date === date)).toHaveLength(0)
  })

  it('clears quotaMet when any shift misses its daily quota', () => {
    const team: Employee[] = [
      { id: 'a1a', code: 'a1a', name: 'A1a', active: true, defaultShift: 'A1' },
      { id: 'a1b', code: 'a1b', name: 'A1b', active: true, defaultShift: 'A1' },
      { id: 'a7a', code: 'a7a', name: 'A7a', active: true, defaultShift: 'A7' },
      { id: 'a5a', code: 'a5a', name: 'A5a', active: true, defaultShift: 'A5' },
      { id: 'a6a', code: 'a6a', name: 'A6a', active: true, defaultShift: 'A6' }
    ]
    const date = '2026-09-11'
    const entries = team.map((e) => ({
      employeeId: e.id, date, shift: e.defaultShift as never, source: 'AUTO' as const
    }))
    const assignments = Object.fromEntries(team.map((e) => [e.id, e.defaultShift]))
    const r = validateSchedule({
      employees: team, month, entries, shiftAssignments: assignments, leaveRequests: [], config
    })
    const day = r.statistics.perDay.find((d) => d.date === date)!
    expect(day.quotaMet).toBe(false)
    expect(r.conflicts.some((c) => c.type === 'SHIFT_QUOTA_MISMATCH' && c.date === date)).toBe(true)
  })

  it('treats OFF shortfall covered by AL as INFO not WARNING', () => {
    const a1: Employee = { id: 'E2', code: 'E2', name: 'Short', active: true, defaultShift: 'A1' }
    const entries = month.days.map((d, i) => ({
      employeeId: 'E2',
      date: d.date,
      shift: (i < 6 ? 'OFF' : i < 8 ? 'AL' : 'A1') as never,
      source: 'AUTO' as const
    }))
    // 6 OFF + 2 AL = 8 target
    const r = validateSchedule({
      employees: [a1], month, entries,
      shiftAssignments: { E2: 'A1' }, leaveRequests: [], config
    })
    const c = r.conflicts.find((x) => x.type === 'OFF_TARGET_NOT_REACHED' && x.employeeId === 'E2')
    expect(c?.severity).toBe('INFO')
  })
})
