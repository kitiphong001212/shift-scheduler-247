// src/services/scheduler.ts
import type { CellStatus, Employee, ShiftCode } from '@/types/employee'
import type { GenerateInput, GenerateResult, ScheduleEntry, AssignmentSource } from '@/types/schedule'
import type { LeaveRequest } from '@/types/leave'
import { SHIFT_CODES, MAX_CONSECUTIVE_WORKING_DAYS, MAX_CONSECUTIVE_A6_COVER, LAST_RESORT_COVER_FOR, isTransitionAllowed, canWorkShift, isLastResortCover, isShift } from './shiftRules'
import { pickOffCandidates, pickAlCandidates, type EmployeeState, type OffPickContext } from './fairness'
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
 * Leave / OFF assignment:
 * 1. AL requests are locked and consume daily leave capacity.
 * 2. Max consecutive working days → forced rest (OFF if under weekend target, else AL).
 * 3. OFF requests FCFS: granted as OFF while under weekend target, else as AL.
 *    Late requests past daily capacity must work.
 * 4. Leftover daily leave slots: Fair Random OFF for staff still under weekend target,
 *    then Fair Random AL for staffing extras (Pattarapong: target 8 OFF + ~2 AL).
 * 5. Post-pass: convert excess OFF above weekend target → AL; top up shortfall with OFF/AL.
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
    states.set(e.id, {
      offCount: 0,
      alCount: 0,
      workStreak: 0,
      lastStatus: null,
      shiftMoveCount: 0,
      a6CoverStreak: 0,
      a6CoverDays: 0
    })
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
    // Prefer OFF while under weekend target; otherwise forced AL.
    // Also end A5→A6 cover after MAX_CONSECUTIVE_A6_COVER days (cannot return to A5 without rest).
    for (const emp of employees) {
      if (leaveToday.has(emp.id) || shiftLocked.has(emp.id)) continue
      const st = states.get(emp.id)!
      const home = baseShiftOf(emp)
      const coverCap =
        home === 'A5' && st.lastStatus === 'A6' && st.a6CoverStreak >= MAX_CONSECUTIVE_A6_COVER
      if (st.workStreak >= MAX_CONSECUTIVE_WORKING_DAYS || coverCap) {
        const status = st.offCount < month.offTarget ? 'OFF' : 'AL'
        leaveToday.set(emp.id, { status, source: 'AUTO' })
      }
    }

    const leaveCapacity = Math.max(0, N - config.requiredWorking)
    let remainingLeave = Math.max(0, leaveCapacity - leaveToday.size)

    const offReqs = requests
      .filter((r) => r.date === day.date && r.type === 'OFF')
      .filter((r) => !leaveToday.has(r.employeeId) && !shiftLocked.has(r.employeeId))
      .sort(compareOffRequestOrder)

    for (const r of offReqs) {
      if (remainingLeave <= 0) {
        mustWork.add(r.employeeId)
        continue
      }
      const st = states.get(r.employeeId)!
      // Weekend OFF entitlement first; extra requested leave days become AL
      const status = st.offCount < month.offTarget ? 'OFF' : 'AL'
      leaveToday.set(r.employeeId, { status, source: 'REQUEST' })
      remainingLeave -= 1
    }

    if (remainingLeave > 0) {
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

      const remainingAlByEmployee = new Map<string, number>()
      const plannedAlByEmployee = new Map<string, number>()
      for (const e of employees) {
        const taken = states.get(e.id)?.alCount ?? 0
        const planned = requests.filter((r) => r.employeeId === e.id && r.type === 'AL').length
        plannedAlByEmployee.set(e.id, planned)
        remainingAlByEmployee.set(e.id, Math.max(0, planned - taken))
      }

      const ctx: OffPickContext = {
        states,
        assignedShift,
        quotas: config.quotas,
        availableByShift,
        offTarget: month.offTarget,
        daysRemaining: month.days.length - dayIndex,
        offPolicy: config.offPolicy,
        plannedAlByEmployee,
        remainingAlByEmployee,
        rng
      }

      // OFF only for people still under weekend target
      const offPicks = pickOffCandidates(candidates, remainingLeave, ctx)
      offPicks.forEach((e) => leaveToday.set(e.id, { status: 'OFF', source: 'AUTO' }))
      remainingLeave -= offPicks.length

      // Staffing extras beyond weekend OFF target → AL (not more OFF)
      if (remainingLeave > 0) {
        const alPool = candidates.filter((e) => !leaveToday.has(e.id))
        pickAlCandidates(alPool, remainingLeave, ctx).forEach((e) =>
          leaveToday.set(e.id, { status: 'AL', source: 'AUTO' })
        )
      }
    }

    const working = employees.filter((e) => !leaveToday.has(e.id))
    const assign = new Map<string, ShiftCode>()
    const homeOf = new Map<string, ShiftCode>()
    working.forEach((e) => {
      const home = baseShiftOf(e)
      homeOf.set(e.id, home)
      const locked = shiftLocked.get(e.id)
      if (locked) {
        // Manual lock still respected; validator will flag illegal A1/A7→A6 locks
        assign.set(e.id, locked)
        return
      }
      const prev = states.get(e.id)?.lastStatus ?? null
      assign.set(e.id, legalShiftFor(prev, home, home))
    })

    balanceShifts(working, assign, shiftLocked, states, homeOf, config.quotas, rng)

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
        st.a6CoverStreak = 0
      } else {
        status = assign.get(emp.id) ?? baseShiftOf(emp)
        source = shiftLocked.has(emp.id) ? 'MANUAL' : 'AUTO'
        st.workStreak++
        if (status !== baseShiftOf(emp)) st.shiftMoveCount++
        const home = baseShiftOf(emp)
        if (home === 'A5' && status === 'A6') {
          st.a6CoverStreak++
          st.a6CoverDays++
        } else {
          st.a6CoverStreak = 0
        }
      }

      st.lastStatus = status
      schedule.push({ employeeId: emp.id, date: day.date, shift: status, source })
    }
  })

  applyLeaveTargetNormalization(schedule, employees, month.offTarget, config.requiredWorking)

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

/**
 * Normalize personal leave to weekend OFF target:
 * - Excess OFF above target → convert to AL (Pattarapong: 10 OFF → 8 OFF + 2 AL)
 * - Shortfall: top up OFF from spare staffing, then force AL
 */
export function applyLeaveTargetNormalization(
  schedule: ScheduleEntry[],
  employees: Employee[],
  offTarget: number,
  requiredWorking: number
): void {
  const byDate = new Map<string, ScheduleEntry[]>()
  const byEmp = new Map<string, ScheduleEntry[]>()
  for (const e of schedule) {
    ;(byDate.get(e.date) ?? byDate.set(e.date, []).get(e.date)!).push(e)
    ;(byEmp.get(e.employeeId) ?? byEmp.set(e.employeeId, []).get(e.employeeId)!).push(e)
  }

  const workingCount = (date: string) =>
    (byDate.get(date) ?? []).filter((e) => isShift(e.shift)).length

  const offCells = (employeeId: string) =>
    (byEmp.get(employeeId) ?? []).filter((e) => e.shift === 'OFF')

  // Pass A: excess OFF → AL
  for (const emp of employees) {
    const offs = offCells(emp.id).slice().sort((a, b) => {
      // Prefer converting AUTO, then REQUEST, keep MANUAL OFF if possible
      const rank = (s: AssignmentSource) => (s === 'AUTO' ? 0 : s === 'REQUEST' ? 1 : 2)
      if (rank(a.source) !== rank(b.source)) return rank(a.source) - rank(b.source)
      return b.date.localeCompare(a.date)
    })
    let excess = offs.length - offTarget
    for (const cell of offs) {
      if (excess <= 0) break
      cell.shift = 'AL'
      if (cell.source === 'MANUAL') cell.source = 'AUTO'
      excess--
    }
  }

  // Pass B: shortfall — top up OFF from spare days
  for (const emp of employees) {
    let need = offTarget - offCells(emp.id).length
    if (need <= 0) continue
    const cells = (byEmp.get(emp.id) ?? [])
      .filter((c) => isShift(c.shift) && c.source !== 'MANUAL')
      .slice()
      .sort((a, b) => {
        const spareA = workingCount(a.date) - requiredWorking
        const spareB = workingCount(b.date) - requiredWorking
        if (spareA !== spareB) return spareB - spareA
        return b.date.localeCompare(a.date)
      })
    for (const cell of cells) {
      if (need <= 0) break
      if (workingCount(cell.date) <= requiredWorking) continue
      cell.shift = 'OFF'
      cell.source = 'AUTO'
      need--
    }
  }

  // Pass C: remaining shortfall → forced AL
  for (const emp of employees) {
    let need = offTarget - offCells(emp.id).length
    if (need <= 0) continue
    const cells = (byEmp.get(emp.id) ?? [])
      .filter((c) => isShift(c.shift))
      .slice()
      .sort((a, b) => {
        const manA = a.source === 'MANUAL' ? 1 : 0
        const manB = b.source === 'MANUAL' ? 1 : 0
        if (manA !== manB) return manA - manB
        const spareA = workingCount(a.date) - requiredWorking
        const spareB = workingCount(b.date) - requiredWorking
        if (spareA !== spareB) return spareB - spareA
        return b.date.localeCompare(a.date)
      })
    for (const cell of cells) {
      if (need <= 0) break
      cell.shift = 'AL'
      cell.source = 'AUTO'
      need--
    }
  }
}

function legalShiftFor(prev: CellStatus | null, preferred: ShiftCode, home: ShiftCode): ShiftCode {
  const eligible = (s: ShiftCode) => canWorkShift(home, s) && isTransitionAllowed(prev, s)
  if (eligible(preferred)) return preferred
  const legal = SHIFT_CODES.filter(eligible)
  if (legal.length === 0) {
    // Fall back to any home-eligible shift even if transition is imperfect (validator reports)
    const homeLegal = SHIFT_CODES.filter((s) => canWorkShift(home, s))
    return homeLegal.includes(preferred) ? preferred : (homeLegal[0] ?? preferred)
  }
  if (prev && (SHIFT_CODES as string[]).includes(prev) && legal.includes(prev as ShiftCode)) {
    return prev as ShiftCode
  }
  if (legal.includes(home)) return home
  return legal[0]
}

/** Move people between shift groups (legal transitions only) to hit daily quotas. */
function balanceShifts(
  working: Employee[],
  assign: Map<string, ShiftCode>,
  shiftLocked: Map<string, ShiftCode>,
  states: Map<string, EmployeeState>,
  homeOf: Map<string, ShiftCode>,
  quotas: Record<ShiftCode, number>,
  rng: () => number
): void {
  const tally = (): Record<ShiftCode, number> => {
    const c = { A1: 0, A7: 0, A5: 0, A6: 0 } as Record<ShiftCode, number>
    for (const s of assign.values()) c[s] += 1
    return c
  }

  const pickMover = (from: ShiftCode, to: ShiftCode, requireHome?: ShiftCode): Employee | null => {
    const candidates = working.filter((e) => {
      if (assign.get(e.id) !== from) return false
      if (shiftLocked.has(e.id)) return false
      const home = homeOf.get(e.id) ?? from
      if (requireHome && home !== requireHome) return false
      if (!canWorkShift(home, to)) return false
      // Fresh A6 cover only — do not extend someone already at cover cap via rebalance
      if (isLastResortCover(home, to)) {
        const st = states.get(e.id)!
        if (st.a6CoverStreak >= MAX_CONSECUTIVE_A6_COVER) return false
      }
      const prev = states.get(e.id)?.lastStatus ?? null
      return isTransitionAllowed(prev, to)
    })
    if (candidates.length === 0) return null
    // Prefer least A6 cover days this month, then fewest moves
    candidates.sort((a, b) => {
      const sa = states.get(a.id)!
      const sb = states.get(b.id)!
      if (sa.a6CoverDays !== sb.a6CoverDays) return sa.a6CoverDays - sb.a6CoverDays
      return sa.shiftMoveCount - sb.shiftMoveCount
    })
    const bestCover = states.get(candidates[0]!.id)!.a6CoverDays
    const minMoves = Math.min(
      ...candidates
        .filter((e) => states.get(e.id)!.a6CoverDays === bestCover)
        .map((e) => states.get(e.id)!.shiftMoveCount)
    )
    const tied = candidates.filter((e) => {
      const st = states.get(e.id)!
      return st.a6CoverDays === bestCover && st.shiftMoveCount === minMoves
    })
    return tied[Math.floor(rng() * tied.length)] ?? null
  }

  // Phase 1: normal rebalance — only move from over-quota → under-quota.
  // Do not freely dump A5 onto A6; that is last-resort only.
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
        if (LAST_RESORT_COVER_FOR[to]) continue // cover fills only in phase 2
        const picked = pickMover(from, to)
        if (!picked) continue
        assign.set(picked.id, to)
        moved = true
        break outer
      }
    }
    if (!moved) break
  }

  // Phase 2 (last resort): if A6 is still short, pull true A5-group staff onto A6
  // for a few days only (cover streak capped; prefer staff with fewest A6 days).
  for (let guard = 0; guard < 20; guard++) {
    const counts = tally()
    const short = SHIFT_CODES.filter((s) => counts[s] < quotas[s])
    if (short.length === 0) break

    let moved = false
    for (const to of short) {
      const from = LAST_RESORT_COVER_FOR[to]
      if (!from) continue
      if (counts[to] >= quotas[to]) continue
      const picked = pickMover(from, to, from)
      if (!picked) continue
      assign.set(picked.id, to)
      moved = true
      break
    }
    if (!moved) break
  }
}
