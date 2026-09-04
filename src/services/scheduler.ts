// src/services/scheduler.ts
import type { CellStatus, Employee, ShiftCode } from '@/types/employee'
import type { GenerateInput, GenerateResult, ScheduleEntry, AssignmentSource } from '@/types/schedule'
import type { LeaveType } from '@/types/leave'
import { SHIFT_CODES, isTransitionAllowed } from './shiftRules'
import { pickOffCandidates, type EmployeeState, type OffPickContext } from './fairness'
import { cellKey, mulberry32 } from '@/utils/date'
import { validateSchedule } from './validator'

/**
 * Generate-first, report-later.
 * This function NEVER throws and NEVER aborts on conflicts.
 */
export function generateSchedule(input: GenerateInput): GenerateResult {
  const { month, config, shiftAssignments } = input
  const employees = input.employees.filter((e) => e.active)
  const N = employees.length
  const rng = mulberry32(config.seed)
  const dateSet = new Set(month.days.map((d) => d.date))

  // ---- Priority 1 & 2: lock AL then OFF requests -------------------------
  const requestMap = new Map<string, LeaveType>()
  const activeIds = new Set(employees.map((e) => e.id))
  for (const r of input.leaveRequests) {
    if (!activeIds.has(r.employeeId) || !dateSet.has(r.date)) continue
    const k = cellKey(r.employeeId, r.date)
    if (requestMap.get(k) === 'AL') continue   // AL wins over OFF
    requestMap.set(k, r.type)
  }

  // ---- Manual locks preserved across regeneration (optional) ------------
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

  // ---- Day by day -------------------------------------------------------
  month.days.forEach((day, dayIndex) => {
    const leaveToday = new Map<string, { status: 'OFF' | 'AL'; source: AssignmentSource }>()
    const shiftLocked = new Map<string, ShiftCode>()

    for (const emp of employees) {
      const k = cellKey(emp.id, day.date)
      const manual = manualMap.get(k)
      if (manual === 'OFF' || manual === 'AL') {
        leaveToday.set(emp.id, { status: manual, source: 'MANUAL' })
      } else if (manual) {
        shiftLocked.set(emp.id, manual)
      } else {
        const req = requestMap.get(k)
        if (req) leaveToday.set(emp.id, { status: req, source: 'REQUEST' })
      }
    }

    const alCount = [...leaveToday.values()].filter((v) => v.status === 'AL').length
    const offRequested = [...leaveToday.values()].filter((v) => v.status === 'OFF').length

    // §6 formula — clamped, conflicts are reported by the validator
    const offRequired = Math.max(0, N - config.requiredWorking - alCount)
    const need = offRequired - offRequested

    if (need > 0) {
      const availableByShift = SHIFT_CODES.reduce((acc, s) => {
        acc[s] = 0
        return acc
      }, {} as Record<ShiftCode, number>)

      const candidates = employees.filter(
        (e) => !leaveToday.has(e.id) && !shiftLocked.has(e.id)
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

      pickOffCandidates(candidates, need, ctx).forEach((e) =>
        leaveToday.set(e.id, { status: 'OFF', source: 'AUTO' })
      )
    }

    // ---- Shift placement + rebalance to meet daily quota ----------------
    const working = employees.filter((e) => !leaveToday.has(e.id))
    const assign = new Map<string, ShiftCode>()
    working.forEach((e) => assign.set(e.id, shiftLocked.get(e.id) ?? baseShiftOf(e)))

    balanceShifts(working, assign, shiftLocked, states, config.quotas, rng)

    // ---- Commit the day -------------------------------------------------
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

  // ---- Then validate ----------------------------------------------------
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

        // fairest: whoever has been moved the least this month
        const minMoves = Math.min(...candidates.map((e) => states.get(e.id)!.shiftMoveCount))
        const tied = candidates.filter((e) => states.get(e.id)!.shiftMoveCount === minMoves)
        const picked = tied[Math.floor(rng() * tied.length)]

        assign.set(picked.id, to)
        moved = true
        break outer
      }
    }
    // No legal move left → keep the quota mismatch (WARNING) instead of
    // creating an INVALID_SHIFT_TRANSITION (ERROR).
    if (!moved) break
  }
}