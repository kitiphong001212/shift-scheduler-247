// tests/scheduler.spec.ts
import { describe, expect, it } from 'vitest'
import { buildMonthContext } from '@/services/calendar'
import { generateSchedule, applyLeaveTargetNormalization } from '@/services/scheduler'
import { createSeedEmployees } from '@/stores/employeeStore'
import {
  cloneDefaultTransitionMatrix,
  DEFAULT_QUOTAS,
  SHIFT_CODES
} from '@/services/shiftRules'
import type { SchedulerConfig, ShiftAssignmentMap } from '@/types/schedule'
import type { CellStatus } from '@/types/employee'

const employees = createSeedEmployees()
const assignments: ShiftAssignmentMap = Object.fromEntries(employees.map((e) => [e.id, e.defaultShift]))
const config: SchedulerConfig = {
  requiredWorking: 10,
  quotas: { ...DEFAULT_QUOTAS },
  transitionMatrix: cloneDefaultTransitionMatrix(),
  offPolicy: 'STAFFING_FIRST',
  seed: 42
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

  it('sets quotaMet true only on days that hit every shift quota', () => {
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests: [], config })
    for (const d of r.statistics.perDay) {
      const allMatch = SHIFT_CODES.every((s) => d.byShift[s] === config.quotas[s])
      expect(d.quotaMet).toBe(allMatch)
    }
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
    expect(onDay.filter((e) => e.shift === 'OFF' || e.shift === 'AL').length).toBe(5)
    expect(onDay.find((e) => e.employeeId === 'EMP001')?.shift).toMatch(/OFF|AL/)
    expect(onDay.find((e) => e.employeeId === 'EMP005')?.shift).toMatch(/OFF|AL/)
    expect(onDay.find((e) => e.employeeId === 'EMP006')?.shift).not.toMatch(/OFF|AL/)
    expect(onDay.find((e) => e.employeeId === 'EMP007')?.shift).not.toMatch(/OFF|AL/)
    expect(r.conflicts.some((c) => c.type === 'INSUFFICIENT_STAFF' && c.date === '2026-09-10')).toBe(false)
  })

  it('honors requestedAt order, not employee list order', () => {
    const leaveRequests = employees.slice(0, 6).map((e, i) => ({
      id: `late${i}`, employeeId: e.id, date: '2026-09-11', type: 'OFF' as const,
      requestedAt: new Date(Date.UTC(2026, 8, 1, 18, 0, 5 - i)).toISOString()
    }))
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests, config })
    const onDay = r.schedule.filter((e) => e.date === '2026-09-11')
    expect(onDay.find((e) => e.employeeId === 'EMP006')?.shift).toMatch(/OFF|AL/)
    expect(onDay.find((e) => e.employeeId === 'EMP001')?.shift).not.toMatch(/OFF|AL/)
  })

  it('reduces OFF quota by AL and fills leftover slots with people who did not request', () => {
    const leaveRequests = [
      { id: 'al1', employeeId: 'EMP001', date: '2026-09-15', type: 'AL' as const, requestedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'al2', employeeId: 'EMP002', date: '2026-09-15', type: 'AL' as const, requestedAt: '2026-09-01T00:00:01.000Z' },
      { id: 'off1', employeeId: 'EMP003', date: '2026-09-15', type: 'OFF' as const, requestedAt: '2026-09-01T00:00:02.000Z' }
    ]
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests, config })
    const onDay = r.schedule.filter((e) => e.date === '2026-09-15')
    expect(onDay.filter((e) => e.shift === 'AL').length).toBeGreaterThanOrEqual(2)
    expect(onDay.find((e) => e.employeeId === 'EMP003')?.shift).toMatch(/OFF|AL/)
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
    expect(day6?.shift).toMatch(/OFF|AL/)
    expect(day6?.source).toBe('AUTO')
    expect(r.conflicts.filter((c) => c.type === 'TOO_MANY_CONSECUTIVE_WORKING_DAYS' && c.employeeId === 'EMP001').length).toBe(0)
  })

  it('distributes OFF fairly (max-min spread <= 2)', () => {
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests: [], config })
    const offs = r.statistics.perEmployee.map((s) => s.off)
    expect(Math.max(...offs) - Math.min(...offs)).toBeLessThanOrEqual(2)
  })

  it('does not pile AUTO OFF on top of AL past the weekend OFF target', () => {
    const leaveRequests = [
      { id: 'al1', employeeId: 'EMP011', date: '2026-09-11', type: 'AL' as const, requestedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'al2', employeeId: 'EMP011', date: '2026-09-12', type: 'AL' as const, requestedAt: '2026-09-01T00:00:01.000Z' }
    ]
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests, config })
    const s = r.statistics.perEmployee.find((x) => x.employeeId === 'EMP011')!
    expect(s.al).toBeGreaterThanOrEqual(2)
    expect(s.off).toBeLessThanOrEqual(month.offTarget)
    expect(s.maxConsecutive).toBeLessThanOrEqual(5)
  })

  it('with team AL filling spare leave slots, OFF stays near the weekend target', () => {
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
      expect(s.off).toBeLessThanOrEqual(month.offTarget)
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
    const m = buildMonthContext(2026, 8)
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
      expect(onDay.find((c) => c.employeeId === e.id)?.shift).toMatch(/OFF|AL/)
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

  it('never places A5 monthly group onto A1 or A7 (Pattarapong rule)', () => {
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests: [], config })
    for (const e of r.schedule) {
      const home = assignments[e.employeeId]
      if (home === 'A5' && (e.shift === 'A1' || e.shift === 'A7')) {
        throw new Error(`${e.employeeId} home A5 was placed on ${e.shift} at ${e.date}`)
      }
    }
    expect(r.conflicts.filter((c) => c.type === 'FORBIDDEN_SHIFT_FOR_GROUP').length).toBe(0)
  })

  it('limits consecutive A6 cover days for A5-home staff', () => {
    const a6 = employees.filter((e) => e.defaultShift === 'A6')
    // Keep A6 short for several days so cover is needed repeatedly
    const leaveRequests = a6.flatMap((e, i) =>
      ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'].map((date, di) => ({
        id: `a6-leave-${i}-${di}`,
        employeeId: e.id,
        date,
        type: 'OFF' as const,
        requestedAt: new Date(Date.UTC(2026, 8, 1, 7, i * 10 + di)).toISOString()
      }))
    )
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests, config })
    const a5Ids = new Set(employees.filter((e) => e.defaultShift === 'A5').map((e) => e.id))
    for (const empId of a5Ids) {
      const cells = r.schedule
        .filter((e) => e.employeeId === empId)
        .sort((a, b) => a.date.localeCompare(b.date))
      let streak = 0
      for (const c of cells) {
        if (c.shift === 'A6') {
          streak++
          expect(streak).toBeLessThanOrEqual(2)
        } else {
          streak = 0
        }
      }
    }
  })

  it('caps OFF at weekend target and turns extras into AL (Pattarapong rule)', () => {
    const dates = month.days.slice(0, 10).map((d) => d.date)
    const leaveRequests = dates.map((date, i) => ({
      id: `off-${i}`,
      employeeId: 'EMP004',
      date,
      type: 'OFF' as const,
      requestedAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString()
    }))
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests, config })
    const s = r.statistics.perEmployee.find((x) => x.employeeId === 'EMP004')!
    expect(s.off).toBeLessThanOrEqual(month.offTarget)
    expect(s.off + s.al).toBeGreaterThanOrEqual(Math.min(10, month.offTarget + 2))
    expect(s.al).toBeGreaterThanOrEqual(2)
  })

  it('applyLeaveTargetNormalization converts excess OFF into AL', () => {
    const entries = month.days.map((d, i) => ({
      employeeId: 'EMP004',
      date: d.date,
      shift: (i < 10 ? 'OFF' : 'A5') as CellStatus,
      source: 'AUTO' as const
    }))
    for (const e of employees) {
      if (e.id === 'EMP004') continue
      for (const d of month.days) {
        entries.push({ employeeId: e.id, date: d.date, shift: e.defaultShift, source: 'AUTO' })
      }
    }
    applyLeaveTargetNormalization(entries, employees, month.offTarget, config.requiredWorking)
    const mine = entries.filter((e) => e.employeeId === 'EMP004')
    expect(mine.filter((e) => e.shift === 'OFF').length).toBe(month.offTarget)
    expect(mine.filter((e) => e.shift === 'AL').length).toBe(10 - month.offTarget)
  })

  it('never leaves AUTO OFF above the weekend target after generate', () => {
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests: [], config })
    for (const s of r.statistics.perEmployee) {
      expect(s.off).toBeLessThanOrEqual(month.offTarget)
    }
  })

  it('does not force AUTO AL when OFF cannot reach the weekend target', () => {
    // Lock most days as MANUAL work so OFF cannot reach target via spare days
    const lockedEntries = month.days.slice(0, 25).map((d) => ({
      employeeId: 'EMP001', date: d.date, shift: 'A1' as const, source: 'MANUAL' as const
    }))
    const r = generateSchedule({
      employees, month, shiftAssignments: assignments, leaveRequests: [], config, lockedEntries
    })
    const s = r.statistics.perEmployee.find((x) => x.employeeId === 'EMP001')!
    expect(s.off).toBeLessThan(month.offTarget)
    // Shortfall stays as OFF warning — do not makeup with forced AUTO AL
    const forcedAl = r.schedule.filter((e) => e.employeeId === 'EMP001' && e.shift === 'AL' && e.source === 'AUTO')
    expect(forcedAl.length).toBe(0)
    expect(r.conflicts.some((c) => c.type === 'OFF_TARGET_NOT_REACHED' && c.employeeId === 'EMP001')).toBe(true)
  })

  it('applyLeaveTargetNormalization never forces AL to cover OFF shortfall', () => {
    // EMP001 is MANUAL every day (cannot be converted) and short of OFF;
    // others already at OFF target. Normalization must not invent AUTO AL.
    const entries = month.days.flatMap((d) =>
      employees.map((e) => ({
        employeeId: e.id,
        date: d.date,
        shift: e.defaultShift as CellStatus,
        source: (e.id === 'EMP001' ? 'MANUAL' : 'AUTO') as 'MANUAL' | 'AUTO'
      }))
    )
    for (const e of employees) {
      if (e.id === 'EMP001') continue
      let need = month.offTarget
      for (const cell of entries) {
        if (cell.employeeId !== e.id) continue
        if (need <= 0) break
        cell.shift = 'OFF'
        cell.source = 'AUTO'
        need--
      }
    }

    applyLeaveTargetNormalization(entries, employees, month.offTarget, config.requiredWorking, config.quotas)

    const mine = entries.filter((e) => e.employeeId === 'EMP001')
    expect(mine.filter((e) => e.shift === 'OFF').length).toBe(0)
    expect(mine.filter((e) => e.shift === 'AL').length).toBe(0)
  })

  it('never emits SHIFT_QUOTA_MISMATCH on a normal generate', () => {
    const r = generateSchedule({ employees, month, shiftAssignments: assignments, leaveRequests: [], config })
    expect(r.conflicts.filter((c) => c.type === 'SHIFT_QUOTA_MISMATCH')).toHaveLength(0)
    expect(r.statistics.perDay.every((d) => d.quotaMet)).toBe(true)
  })
})
