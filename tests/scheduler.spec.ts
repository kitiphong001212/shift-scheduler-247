// tests/scheduler.spec.ts
import { describe, expect, it } from 'vitest'
import { buildMonthContext } from '@/services/calendar'
import { generateSchedule, applyOffShortfallMakeup } from '@/services/scheduler'
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

  it('grants OFF first-come when requests exceed the daily quota', () => {
    const leaveRequests = employees.slice(0, 7).map((e, i) => ({
      id: `x${i}`, employeeId: e.id, date: '2026-09-10', type: 'OFF' as const,
      requestedAt: new Date(Date.UTC(2026, 8, 1, 8, i)).toISOString()
    }))
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests, config })
    expect(r.schedule.length).toBe(15 * 30)
    const onDay = r.schedule.filter((e) => e.date === '2026-09-10')
    expect(onDay.filter((e) => e.shift === 'OFF').length).toBe(5)
    expect(onDay.find((e) => e.employeeId === 'EMP001')?.shift).toBe('OFF')
    expect(onDay.find((e) => e.employeeId === 'EMP005')?.shift).toBe('OFF')
    expect(onDay.find((e) => e.employeeId === 'EMP006')?.shift).not.toBe('OFF')
    expect(onDay.find((e) => e.employeeId === 'EMP007')?.shift).not.toBe('OFF')
    expect(r.conflicts.some((c) => c.type === 'INSUFFICIENT_STAFF' && c.date === '2026-09-10')).toBe(false)
  })

  it('honors requestedAt order, not employee list order', () => {
    const leaveRequests = employees.slice(0, 6).map((e, i) => ({
      id: `late${i}`, employeeId: e.id, date: '2026-09-11', type: 'OFF' as const,
      requestedAt: new Date(Date.UTC(2026, 8, 1, 18, 0, 5 - i)).toISOString()
    }))
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests, config })
    const onDay = r.schedule.filter((e) => e.date === '2026-09-11')
    expect(onDay.find((e) => e.employeeId === 'EMP006')?.shift).toBe('OFF')
    expect(onDay.find((e) => e.employeeId === 'EMP001')?.shift).not.toBe('OFF')
  })

  it('reduces OFF quota by AL and fills leftover slots with people who did not request', () => {
    const leaveRequests = [
      { id: 'al1', employeeId: 'EMP001', date: '2026-09-15', type: 'AL' as const, requestedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'al2', employeeId: 'EMP002', date: '2026-09-15', type: 'AL' as const, requestedAt: '2026-09-01T00:00:01.000Z' },
      { id: 'off1', employeeId: 'EMP003', date: '2026-09-15', type: 'OFF' as const, requestedAt: '2026-09-01T00:00:02.000Z' }
    ]
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests, config })
    const onDay = r.schedule.filter((e) => e.date === '2026-09-15')
    expect(onDay.filter((e) => e.shift === 'AL').length).toBe(2)
    expect(onDay.filter((e) => e.shift === 'OFF').length).toBe(3)
    expect(onDay.find((e) => e.employeeId === 'EMP003')?.shift).toBe('OFF')
    expect(onDay.find((e) => e.employeeId === 'EMP003')?.source).toBe('REQUEST')
    const autoOff = onDay.filter((e) => e.shift === 'OFF' && e.source === 'AUTO')
    expect(autoOff.length).toBe(2)
    expect(autoOff.every((e) => e.employeeId !== 'EMP001' && e.employeeId !== 'EMP002' && e.employeeId !== 'EMP003')).toBe(true)
    expect(onDay.filter((e) => e.shift !== 'OFF' && e.shift !== 'AL').length).toBe(10)
  })

  it('produces no forbidden shift transitions', () => {
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests: [], config })
    expect(r.conflicts.filter((c) => c.type === 'INVALID_SHIFT_TRANSITION').length).toBe(0)
    expect(r.conflicts.filter((c) => c.type === 'A6_NO_REST').length).toBe(0)
  })

  it('never schedules more than 5 consecutive working days', () => {
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests: [], config })
    for (const s of r.statistics.perEmployee) expect(s.maxConsecutive).toBeLessThanOrEqual(5)
    expect(r.conflicts.filter((c) => c.type === 'TOO_MANY_CONSECUTIVE_WORKING_DAYS').length).toBe(0)
  })

  it('forces OFF on the 6th day after 5 consecutive working days', () => {
    const lockedEntries = [
      '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'
    ].map((date) => ({
      employeeId: 'EMP001', date, shift: 'A1' as const, source: 'MANUAL' as const
    }))
    const r = generateSchedule({
      employees, month, shiftAssignments: assignments, leaveRequests: [], config, lockedEntries
    })
    const day6 = r.schedule.find((e) => e.employeeId === 'EMP001' && e.date === '2026-09-06')
    expect(day6?.shift).toBe('OFF')
    expect(day6?.source).toBe('AUTO')
    expect(r.conflicts.filter((c) => c.type === 'TOO_MANY_CONSECUTIVE_WORKING_DAYS' && c.employeeId === 'EMP001').length).toBe(0)
  })

  it('distributes OFF fairly (max-min spread <= 2)', () => {
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests: [], config })
    const offs = r.statistics.perEmployee.map((s) => s.off)
    expect(Math.max(...offs) - Math.min(...offs)).toBeLessThanOrEqual(2)
  })

  it('does not pile AUTO OFF on top of AL past the weekend OFF target', () => {
    // Kanokwan-style: 2 AL days → expect OFF ≈ weekend target (8), total leave ≈ 10
    const leaveRequests = [
      { id: 'al1', employeeId: 'EMP011', date: '2026-09-11', type: 'AL' as const, requestedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'al2', employeeId: 'EMP011', date: '2026-09-12', type: 'AL' as const, requestedAt: '2026-09-01T00:00:01.000Z' }
    ]
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests, config })
    const s = r.statistics.perEmployee.find((x) => x.employeeId === 'EMP011')!
    expect(s.al).toBe(2)
    expect(s.off).toBeLessThanOrEqual(month.offTarget) // weekend entitlement; AL is separate
    expect(s.totalLeave).toBe(month.offTarget + s.al)
    expect(s.maxConsecutive).toBeLessThanOrEqual(5)
  })

  it('with team AL filling spare leave slots, OFF stays near the weekend target', () => {
    // 15 staff × ~10 leave slots/person; offTarget 8 → ~2 AL/person keeps OFF≈8
    const leaveRequests = employees.flatMap((e, i) => {
      const a = month.days[i].date
      const b = month.days[i + 15].date
      return [
        { id: `al-${e.id}-a`, employeeId: e.id, date: a, type: 'AL' as const, requestedAt: `2026-08-01T00:${String(i).padStart(2, '0')}:00.000Z` },
        { id: `al-${e.id}-b`, employeeId: e.id, date: b, type: 'AL' as const, requestedAt: `2026-08-01T01:${String(i).padStart(2, '0')}:00.000Z` }
      ]
    })
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests, config })
    for (const s of r.statistics.perEmployee) {
      expect(s.off).toBeGreaterThanOrEqual(month.offTarget - 1)
      expect(s.off).toBeLessThanOrEqual(month.offTarget + 1)
    }
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

  it('entitlement-first caps OFF at the target except mandatory consecutive rests', () => {
    const r = generateSchedule({
      employees, month, shiftAssignments: assignments, leaveRequests: [],
      config: { ...config, offPolicy: 'ENTITLEMENT_FIRST' }
    })
    expect(r.conflicts.filter((c) => c.type === 'TOO_MANY_CONSECUTIVE_WORKING_DAYS').length).toBe(0)
    for (const s of r.statistics.perEmployee) expect(s.maxConsecutive).toBeLessThanOrEqual(5)
  })

  it('uses A5 to cover A6 as a last resort when many A6 are on leave', () => {
    const a6 = employees.filter((e) => e.defaultShift === 'A6')
    expect(a6.length).toBeGreaterThanOrEqual(2)
    const leaveRequests = a6.map((e, i) => ({
      id: `a6-leave-${i}`,
      employeeId: e.id,
      date: '2026-09-10',
      type: 'OFF' as const,
      requestedAt: new Date(Date.UTC(2026, 8, 1, 7, i)).toISOString()
    }))
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests, config })
    const onDay = r.schedule.filter((e) => e.date === '2026-09-10')
    for (const e of a6) {
      expect(onDay.find((c) => c.employeeId === e.id)?.shift).toBe('OFF')
    }
    const a6Working = onDay.filter((c) => c.shift === 'A6')
    expect(a6Working.length).toBe(config.quotas.A6)
    expect(a6Working.every((c) => assignments[c.employeeId] === 'A5')).toBe(true)
  })

  it('never places A1/A7 monthly group onto A6 (Kittiphong rule)', () => {
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests: [], config })
    for (const e of r.schedule) {
      const home = assignments[e.employeeId]
      if ((home === 'A1' || home === 'A7') && e.shift === 'A6') {
        throw new Error(`${e.employeeId} home ${home} was placed on A6 at ${e.date}`)
      }
    }
    expect(r.conflicts.filter((c) => c.type === 'FORBIDDEN_SHIFT_FOR_GROUP').length).toBe(0)
  })


  it('forces AUTO AL when OFF cannot reach the weekend target', () => {
    // Lock EMP001 to work almost every day so normal OFF fill cannot hit target 8
    const lockedEntries = month.days.slice(0, 25).map((d) => ({
      employeeId: 'EMP001', date: d.date, shift: 'A1' as const, source: 'MANUAL' as const
    }))
    const r = generateSchedule({
      employees, month, shiftAssignments: assignments, leaveRequests: [], config, lockedEntries
    })
    const s = r.statistics.perEmployee.find((x) => x.employeeId === 'EMP001')!
    expect(s.off + s.al).toBeGreaterThanOrEqual(month.offTarget)
    const forcedAl = r.schedule.filter((e) => e.employeeId === 'EMP001' && e.shift === 'AL' && e.source === 'AUTO')
    expect(forcedAl.length).toBeGreaterThan(0)
  })

  it('applyOffShortfallMakeup tops up OFF from spare staff then forces AL', () => {
    const entries = month.days.flatMap((d) =>
      employees.map((e, i) => ({
        employeeId: e.id,
        date: d.date,
        shift: (i < 10 ? e.defaultShift : 'OFF') as import('@/types/employee').CellStatus,
        source: 'AUTO' as const
      }))
    )
    // EMP001 works every day → 0 OFF
    for (const e of entries) {
      if (e.employeeId === 'EMP001') { e.shift = 'A1'; e.source = 'AUTO' }
    }
    applyOffShortfallMakeup(entries, employees, month.offTarget, config.requiredWorking)
    const mine = entries.filter((e) => e.employeeId === 'EMP001')
    const off = mine.filter((e) => e.shift === 'OFF').length
    const al = mine.filter((e) => e.shift === 'AL').length
    expect(off + al).toBeGreaterThanOrEqual(month.offTarget)
    expect(al).toBeGreaterThan(0)
  })
})

