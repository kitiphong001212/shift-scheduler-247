// src/services/scheduler.ts
import type { CellStatus, Employee, ShiftCode } from '@/types/employee'
import type { GenerateInput, GenerateResult, ScheduleEntry, AssignmentSource } from '@/types/schedule'
import type { LeaveRequest } from '@/types/leave'
import { SHIFT_CODES, MAX_CONSECUTIVE_WORKING_DAYS, isTransitionAllowed } from './shiftRules'
import { pickOffCandidates, type EmployeeState, type OffPickContext } from './fairness'
import { cellKey, mulberry32 } from '@/utils/date'
import { validateSchedule } from './validator'

/** Daily OFF slots after AL is locked: N − required working − AL. */
export function dailyOffQuota(staffCount: number, requiredWorking: number, alCount: number): number {
  return Math.max(0, staffCount - requiredWorking - alCount)
}

export function compareOffRequestOrder(a: LeaveRequest, b: LeaveRequest): number {
  const ta = a.requestedAt ?? ''
  const tb = b.requestedAt ?? ''
  if (ta !== tb) return ta.localeCompare(tb)
  return a.id.localeCompare(b.id)
}

/**
 * Generate-first, report-later.
 * This function NEVER throws and NEVER aborts on conflicts.
 *
 * OFF assignment:
 * 1. AL is locked and reduces the day's OFF quota.
 * 2. Anyone already at Max Consec. working days is forced OFF (hard rule).
 * 3. OFF requests are granted first-come (requestedAt) up to remaining quota.
 *    Late requests past quota must work that day (not eligible for AUTO OFF),
 *    unless they hit the consecutive-work hard rule above.
 * 4. Leftover quota is filled with Fair Random among people who did not request OFF.
 */
export function generateSchedule(input: GenerateInput): GenerateResult {
  const { month, config, shiftAssignments } = input
  const employees = input.employees.filter((e) => e.active)
  const N = employees.length
  const rng = mulberry32(config.seed)
  const dateSet = new Set(month.days.map((d) => d.date))

  const activeIds = new Set(employees.map((e) => e.id))
  const requests = input.leaveRequests.filter((r) => activeIds.has(r.employeeId) && dateSet.has(r.date))

  const manualMap = new Map<string, CellStatus>()
  for (const e of input.lockedEntries ?? []) {
    if (e.source === 'MANUAL' && activeIds.has(e.employeeId) && dateSet.has(e.date)) {
      manualMap.set(cellKey(e.employeeId, e.date), e.shift)
    }
  }

  const baseShiftOf = (emp: Employee): ShiftCode =>
    shiftAssignments[emp.id] ?? emp.defaultShift

  const states = new Map<string, EmployeeState>()
  employees.forEach((e) =>
    states.set(e.id, { offCount: 0, alCount: 0, workStreak: 0, lastStatus: null, shiftMoveCount: 0 })
  )

  const schedule: ScheduleEntry[] = []

  month.days.forEach((day, dayIndex) => {
    const leaveToday = new Map<string, { status: 'OFF' | 'AL'; source: AssignmentSource }>()
    const shiftLocked = new Map<string, ShiftCode>()
    const mustWork = new Set<string>()

    for (const emp of employees) {
      const k = cellKey(emp.id, day.date)
      const manual = manualMap.get(k)
      if (manual === 'OFF' || manual === 'AL') {
        leaveToday.set(emp.id, { status: manual, source: 'MANUAL' })
      } else if (manual) {
        shiftLocked.set(emp.id, manual)
      }
    }

    for (const r of requests) {
      if (r.date !== day.date || r.type !== 'AL') continue
      if (leaveToday.has(r.employeeId) || shiftLocked.has(r.employeeId)) continue
      leaveToday.set(r.employeeId, { status: 'AL', source: 'REQUEST' })
    }

    // Hard rule: after MAX consecutive working days, must rest today.
    for (const emp of employees) {
      if (leaveToday.has(emp.id) || shiftLocked.has(emp.id)) continue
      const streak = states.get(emp.id)?.workStreak ?? 0
      if (streak >= MAX_CONSECUTIVE_WORKING_DAYS) {
        leaveToday.set(emp.id, { status: 'OFF', source: 'AUTO' })
      }
    }

    const alCount = [...leaveToday.values()].filter((v) => v.status === 'AL').length
    const offQuota = dailyOffQuota(N, config.requiredWorking, alCount)
    const alreadyOff = [...leaveToday.values()].filter((v) => v.status === 'OFF').length
    let remaining = Math.max(0, offQuota - alreadyOff)

    const offReqs = requests
      .filter((r) => r.date === day.date && r.type === 'OFF')
      .filter((r) => !leaveToday.has(r.employeeId) && !shiftLocked.has(r.employeeId))
      .sort(compareOffRequestOrder)

    for (const r of offReqs) {
      if (remaining > 0) {
        leaveToday.set(r.employeeId, { status: 'OFF', source: 'REQUEST' })
        remaining -= 1
      } else {
        mustWork.add(r.employeeId)
      }
    }

    if (remaining > 0) {
      const availableByShift = SHIFT_CODES.reduce((acc, s) => {
        acc[s] = 0
        return acc
      }, {} as Record<ShiftCode, number>)

      const candidates = employees.filter(
        (e) => !leaveToday.has(e.id) && !shiftLocked.has(e.id) && !mustWork.has(e.id)
      )
      const assignedShift = new Map<string, ShiftCode>()
      for (const e of employees) {
        if (leaveToday.has(e.id)) continue
        const s = baseShiftOf(e)
        assignedShift.set(e.id, s)
        availableByShift[s] += 1
      }

      const ctx: OffPickContext = {
        states,
        assignedShift,
        quotas: config.quotas,
        availableByShift,
        offTarget: month.offTarget,
        daysRemaining: month.days.length - dayIndex,
        offPolicy: config.offPolicy,
        rng
      }

      pickOffCandidates(candidates, remaining, ctx).forEach((e) =>
        leaveToday.set(e.id, { status: 'OFF', source: 'AUTO' })
      )
    }

    const working = employees.filter((e) => !leaveToday.has(e.id))
    const assign = new Map<string, ShiftCode>()
    working.forEach((e) => {
      const locked = shiftLocked.get(e.id)
      if (locked) {
        assign.set(e.id, locked)
        return
      }
      const prev = states.get(e.id)?.lastStatus ?? null
      assign.set(e.id, legalShiftFor(prev, baseShiftOf(e)))
    })

    balanceShifts(working, assign, shiftLocked, states, config.quotas, rng)

    for (const emp of employees) {
      const leave = leaveToday.get(emp.id)
      const st = states.get(emp.id)!
      let status: CellStatus
      let source: AssignmentSource

      if (leave) {
        status = leave.status
        source = leave.source
        if (leave.status === 'OFF') st.offCount++
        else st.alCount++
        st.workStreak = 0
      } else {
        status = assign.get(emp.id) ?? baseShiftOf(emp)
        source = shiftLocked.has(emp.id) ? 'MANUAL' : 'AUTO'
        st.workStreak++
        if (status !== baseShiftOf(emp)) st.shiftMoveCount++
      }

      st.lastStatus = status
      schedule.push({ employeeId: emp.id, date: day.date, shift: status, source })
    }
  })

  const validation = validateSchedule({
    employees: input.employees,
    month,
    entries: schedule,
    shiftAssignments,
    leaveRequests: input.leaveRequests,
    config
  })

  return { schedule, conflicts: validation.conflicts, statistics: validation.statistics }
}

function legalShiftFor(prev: CellStatus | null, preferred: ShiftCode): ShiftCode {
  if (isTransitionAllowed(prev, preferred)) return preferred
  const legal = SHIFT_CODES.filter((s) => isTransitionAllowed(prev, s))
  if (legal.length === 0) return preferred
  if (prev && (SHIFT_CODES as string[]).includes(prev) && legal.includes(prev as ShiftCode)) {
    return prev as ShiftCode
  }
  return legal[0]
}

/** Move people between shift groups (legal transitions only) to hit daily quotas. */
function balanceShifts(
  working: Employee[],
  assign: Map<string, ShiftCode>,
  shiftLocked: Map<string, ShiftCode>,
  states: Map<string, EmployeeState>,
  quotas: Record<ShiftCode, number>,
  rng: () => number
): void {
  const tally = (): Record<ShiftCode, number> => {
    const c = { A1: 0, A7: 0, A5: 0, A6: 0 } as Record<ShiftCode, number>
    for (const s of assign.values()) c[s] += 1
    return c
  }

  for (let guard = 0; guard < 60; guard++) {
    const counts = tally()
    const over = SHIFT_CODES.filter((s) => counts[s] > quotas[s])
      .sort((a, b) => counts[b] - quotas[b] - (counts[a] - quotas[a]))
    const under = SHIFT_CODES.filter((s) => counts[s] < quotas[s])
      .sort((a, b) => quotas[b] - counts[b] - (quotas[a] - counts[a]))

    if (over.length === 0 || under.length === 0) break

    let moved = false
    outer: for (const from of over) {
      for (const to of under) {
        const candidates = working.filter((e) => {
          if (assign.get(e.id) !== from) return false
          if (shiftLocked.has(e.id)) return false
          const prev = states.get(e.id)?.lastStatus ?? null
          return isTransitionAllowed(prev, to)
        })
        if (candidates.length === 0) continue

        const minMoves = Math.min(...candidates.map((e) => states.get(e.id)!.shiftMoveCount))
        const tied = candidates.filter((e) => states.get(e.id)!.shiftMoveCount === minMoves)
        const picked = tied[Math.floor(rng() * tied.length)]

        assign.set(picked.id, to)
        moved = true
        break outer
      }
    }
    if (!moved) break
  }
}
