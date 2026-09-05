// src/stores/scheduleStore.ts
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { CellStatus, ShiftCode } from '@/types/employee'
import type { ScheduleEntry, ShiftAssignmentMap, SchedulerConfig } from '@/types/schedule'
import type { Conflict } from '@/types/conflict'
import { generateSchedule } from '@/services/scheduler'
import { validateSchedule } from '@/services/validator'
import { loadState, saveState } from '@/services/storage'
import { cellKey } from '@/utils/date'
import { useEmployeeStore } from './employeeStore'
import { useLeaveStore } from './leaveStore'
import { useSettingsStore } from './settingsStore'

export const useScheduleStore = defineStore('schedule', () => {
  const employeeStore = useEmployeeStore()
  const leaveStore = useLeaveStore()
  const settings = useSettingsStore()

  const assignmentsByMonth = ref<Record<string, ShiftAssignmentMap>>(
    loadState('assignments', {} as Record<string, ShiftAssignmentMap>)
  )
  const entriesByMonth = ref<Record<string, ScheduleEntry[]>>(
    loadState('entries', {} as Record<string, ScheduleEntry[]>)
  )
  const generatedAtByMonth = ref<Record<string, string>>(
    loadState('generatedAt', {} as Record<string, string>)
  )

  watch(assignmentsByMonth, (v) => saveState('assignments', v), { deep: true })
  watch(entriesByMonth, (v) => saveState('entries', v), { deep: true })
  watch(generatedAtByMonth, (v) => saveState('generatedAt', v), { deep: true })

  const monthKey = computed(() => settings.monthContext.monthKey)
  const monthContext = computed(() => settings.monthContext)

  const config = computed<SchedulerConfig>(() => ({
    requiredWorking: settings.requiredWorking,
    quotas: settings.quotas,
    transitionMatrix: settings.transitionMatrix,
    offPolicy: settings.offPolicy,
    seed: 1
  }))

  /** Assignment map merged with each employee's default shift. */
  const currentAssignments = computed<ShiftAssignmentMap>(() => {
    const stored = assignmentsByMonth.value[monthKey.value] ?? {}
    const out: ShiftAssignmentMap = {}
    for (const e of employeeStore.activeEmployees) out[e.id] = stored[e.id] ?? e.defaultShift
    return out
  })

  const currentEntries = computed<ScheduleEntry[]>(() => entriesByMonth.value[monthKey.value] ?? [])
  const hasSchedule = computed(() => currentEntries.value.length > 0)
  const generatedAt = computed(() => generatedAtByMonth.value[monthKey.value] ?? null)

  const cellMap = computed<Record<string, ScheduleEntry>>(() => {
    const m: Record<string, ScheduleEntry> = {}
    for (const e of currentEntries.value) m[cellKey(e.employeeId, e.date)] = e
    return m
  })

  const monthRequests = computed(() => leaveStore.byMonth(monthKey.value))

  /** Re-validated automatically on ANY change (generate / manual edit / request change). */
  const validation = computed(() =>
    validateSchedule({
      employees: employeeStore.employees,
      month: monthContext.value,
      entries: currentEntries.value,
      shiftAssignments: currentAssignments.value,
      leaveRequests: monthRequests.value,
      config: config.value
    })
  )

  const conflicts = computed<Conflict[]>(() => (hasSchedule.value ? validation.value.conflicts : []))
  const statistics = computed(() => validation.value.statistics)
  const score = computed(() => (hasSchedule.value ? statistics.value.score : 0))

  const conflictsByDate = computed<Record<string, Conflict[]>>(() => {
    const m: Record<string, Conflict[]> = {}
    for (const c of conflicts.value) {
      if (!c.date) continue
      ;(m[c.date] ??= []).push(c)
    }
    return m
  })

  const conflictsByCell = computed<Record<string, Conflict[]>>(() => {
    const m: Record<string, Conflict[]> = {}
    for (const c of conflicts.value) {
      if (!c.date || !c.employeeId) continue
      ;(m[cellKey(c.employeeId, c.date)] ??= []).push(c)
    }
    return m
  })

  function setAssignment(employeeId: string, shift: ShiftCode) {
    const map = { ...(assignmentsByMonth.value[monthKey.value] ?? {}) }
    map[employeeId] = shift
    assignmentsByMonth.value = { ...assignmentsByMonth.value, [monthKey.value]: map }
  }

  function resetAssignmentsToDefault() {
    const map: ShiftAssignmentMap = {}
    for (const e of employeeStore.activeEmployees) map[e.id] = e.defaultShift
    assignmentsByMonth.value = { ...assignmentsByMonth.value, [monthKey.value]: map }
  }

  function generate(options: { seed?: number; preserveManual?: boolean } = {}) {
    const seed = options.seed ?? Math.floor(Math.random() * 1_000_000) + 1
    const locked = options.preserveManual
      ? currentEntries.value.filter((e) => e.source === 'MANUAL')
      : []

    const result = generateSchedule({
      employees: employeeStore.employees,
      month: monthContext.value,
      shiftAssignments: currentAssignments.value,
      leaveRequests: monthRequests.value,
      config: { ...config.value, seed },
      lockedEntries: locked
    })

    entriesByMonth.value = { ...entriesByMonth.value, [monthKey.value]: result.schedule }
    generatedAtByMonth.value = { ...generatedAtByMonth.value, [monthKey.value]: new Date().toISOString() }
    return result
  }

  /** §22 — keeps user requests, resets AUTO cells, new random tie-breaking. */
  function regenerate(preserveManual = false) {
    return generate({ preserveManual })
  }

  function setCell(employeeId: string, date: string, status: CellStatus) {
    const list = [...(entriesByMonth.value[monthKey.value] ?? [])]
    const i = list.findIndex((e) => e.employeeId === employeeId && e.date === date)
    const entry: ScheduleEntry = { employeeId, date, shift: status, source: 'MANUAL' }
    if (i >= 0) list[i] = entry
    else list.push(entry)
    entriesByMonth.value = { ...entriesByMonth.value, [monthKey.value]: list }
  }

  function clearMonthSchedule() {
    const next = { ...entriesByMonth.value }
    delete next[monthKey.value]
    entriesByMonth.value = next
  }

  return {
    monthKey, monthContext, config,
    currentAssignments, currentEntries, cellMap, hasSchedule, generatedAt,
    conflicts, conflictsByDate, conflictsByCell, statistics, score,
    setAssignment, resetAssignmentsToDefault, generate, regenerate, setCell, clearMonthSchedule
  }
})