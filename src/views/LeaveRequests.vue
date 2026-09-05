<!-- src/views/LeaveRequests.vue -->
<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useLeaveStore } from '@/stores/leaveStore'
import { useEmployeeStore } from '@/stores/employeeStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { WEEKDAY_LABELS, cellKey } from '@/utils/date'
import type { LeaveType } from '@/types/leave'
import ConflictBadge from '@/components/ConflictBadge.vue'

const leaveStore = useLeaveStore()
const employeeStore = useEmployeeStore()
const schedule = useScheduleStore()

const filter = ref<'ALL' | 'OFF' | 'AL' | 'DENIED'>('ALL')
const form = reactive<{ employeeId: string; type: LeaveType; note: string }>({
  employeeId: employeeStore.activeEmployees[0]?.id ?? '',
  type: 'AL',
  note: ''
})
const selectedDates = ref<string[]>([])
const lastClicked = ref<string | null>(null)

const conflictDates = computed(() => {
  const s = new Set<string>()
  for (const c of schedule.conflicts) {
    if (c.date && (c.type === 'DUPLICATE_LEAVE' || c.type === 'AL_OVER_CAPACITY')) s.add(c.date)
  }
  return s
})

function requestOutcome(
  employeeId: string,
  date: string,
  type: LeaveType
): 'pending' | 'granted' | 'granted-al' | 'must-work' | 'conflict' {
  if (conflictDates.value.has(date) && type === 'AL') return 'conflict'
  if (!schedule.hasSchedule) return 'pending'
  const cell = schedule.cellMap[cellKey(employeeId, date)]
  if (!cell) return 'pending'
  if (type === 'AL') return cell.shift === 'AL' ? 'granted' : 'conflict'
  if (cell.shift === 'OFF') return 'granted'
  if (cell.shift === 'AL') return 'granted-al'
  return 'must-work'
}

const rows = computed(() => {
  const all = leaveStore.byMonth(schedule.monthKey).slice().sort((a, b) => {
    const d = a.date.localeCompare(b.date)
    if (d !== 0) return d
    return (a.requestedAt ?? '').localeCompare(b.requestedAt ?? '') || a.id.localeCompare(b.id)
  })
  if (filter.value === 'OFF') return all.filter((r) => r.type === 'OFF')
  if (filter.value === 'AL') return all.filter((r) => r.type === 'AL')
  if (filter.value === 'DENIED') {
    return all.filter((r) => {
      const o = requestOutcome(r.employeeId, r.date, r.type)
      return o === 'must-work' || o === 'conflict'
    })
  }
  return all
})

const existingForEmployee = computed(() => {
  const s = new Set<string>()
  for (const r of leaveStore.requests) {
    if (r.employeeId === form.employeeId) s.add(r.date)
  }
  return s
})

const calendarPad = computed(() => schedule.monthContext.days[0]?.weekday ?? 0)

const selectedSet = computed(() => new Set(selectedDates.value))

function toggleDate(date: string, event?: MouseEvent) {
  if (existingForEmployee.value.has(date)) return
  if (event?.shiftKey && lastClicked.value) {
    selectRange(lastClicked.value, date)
  } else {
    const i = selectedDates.value.indexOf(date)
    if (i >= 0) selectedDates.value = selectedDates.value.filter((d) => d !== date)
    else selectedDates.value = [...selectedDates.value, date].sort()
  }
  lastClicked.value = date
}

function selectRange(from: string, to: string) {
  const days = schedule.monthContext.days
  const a = days.findIndex((d) => d.date === from)
  const b = days.findIndex((d) => d.date === to)
  if (a < 0 || b < 0) return
  const [start, end] = a < b ? [a, b] : [b, a]
  const next = new Set(selectedDates.value)
  for (let i = start; i <= end; i++) {
    const date = days[i].date
    if (!existingForEmployee.value.has(date)) next.add(date)
  }
  selectedDates.value = [...next].sort()
}

function selectMatching(pred: (isWeekend: boolean) => boolean) {
  selectedDates.value = schedule.monthContext.days
    .filter((d) => pred(d.isWeekend) && !existingForEmployee.value.has(d.date))
    .map((d) => d.date)
}

function clearSelection() {
  selectedDates.value = []
  lastClicked.value = null
}

function add() {
  if (!form.employeeId || !selectedDates.value.length) return
  leaveStore.addRequests(form.employeeId, selectedDates.value, form.type, form.note)
  form.note = ''
  clearSelection()
}
</script>

<template>
  <div class="space-y-5">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">Leave Requests</h1>
        <p class="text-sm text-slate-500">{{ schedule.monthContext.label }} · OFF quota = staff − required working − AL that day · earlier requests win</p>
      </div>
      <div class="flex gap-1">
        <button v-for="f in (['ALL','OFF','AL','DENIED'] as const)" :key="f"
                class="rounded-md px-3 py-1.5 text-xs font-semibold"
                :class="filter === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-300'"
                @click="filter = f">{{ f }}</button>
      </div>
    </header>

    <div class="card space-y-4">
      <div class="grid gap-3 md:grid-cols-4 md:items-end">
        <div class="md:col-span-2">
          <label class="label">Employee</label>
          <select v-model="form.employeeId" class="input" @change="clearSelection">
            <option v-for="e in employeeStore.activeEmployees" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
        </div>
        <div>
          <label class="label">Type</label>
          <select v-model="form.type" class="input"><option value="OFF">OFF</option><option value="AL">AL</option></select>
        </div>
        <button class="btn-primary justify-center" :disabled="!selectedDates.length" @click="add">
          {{ selectedDates.length ? `+ Add ${selectedDates.length} Request${selectedDates.length === 1 ? '' : 's'}` : '+ Add Requests' }}
        </button>
      </div>

      <div>
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label class="label mb-0">Dates</label>
          <div class="flex flex-wrap gap-1">
            <button type="button" class="btn-ghost px-2 py-1 text-xs" @click="selectMatching(() => true)">All</button>
            <button type="button" class="btn-ghost px-2 py-1 text-xs" @click="selectMatching((w) => !w)">Weekdays</button>
            <button type="button" class="btn-ghost px-2 py-1 text-xs" @click="selectMatching((w) => w)">Weekends</button>
            <button type="button" class="btn-ghost px-2 py-1 text-xs" @click="clearSelection">Clear</button>
          </div>
        </div>
        <p class="mb-2 text-xs text-slate-500">Click to toggle days. Shift-click to select a range.</p>
        <div class="grid grid-cols-7 gap-1">
          <div v-for="label in WEEKDAY_LABELS" :key="label" class="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {{ label }}
          </div>
          <div v-for="n in calendarPad" :key="`pad-${n}`" />
          <button
            v-for="d in schedule.monthContext.days"
            :key="d.date"
            type="button"
            class="rounded-md border px-1 py-2 text-center text-sm leading-tight transition-colors"
            :disabled="existingForEmployee.has(d.date)"
            :class="existingForEmployee.has(d.date)
              ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
              : selectedSet.has(d.date)
                ? 'border-slate-900 bg-slate-900 text-white'
                : d.isWeekend
                  ? 'border-amber-200 bg-amber-50 text-amber-900 hover:border-slate-400'
                  : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400'"
            :title="existingForEmployee.has(d.date) ? 'Already requested' : d.date"
            @click="toggleDate(d.date, $event)"
          >
            <span class="block font-semibold">{{ d.day }}</span>
            <span class="block text-[10px] opacity-70">{{ d.weekdayLabel }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="card overflow-x-auto">
      <table class="w-full">
        <thead>
          <tr>
            <th class="th">Employee</th><th class="th">Date</th><th class="th">Requested</th><th class="th">Type</th>
            <th class="th">Status</th><th class="th text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!rows.length"><td class="td text-slate-400" colspan="6">No requests.</td></tr>
          <tr v-for="r in rows" :key="r.id">
            <td class="td">{{ employeeStore.nameOf(r.employeeId) }}</td>
            <td class="td font-mono text-xs">{{ r.date }}</td>
            <td class="td font-mono text-xs text-slate-500">{{ r.requestedAt ? new Date(r.requestedAt).toLocaleString() : '—' }}</td>
            <td class="td">
              <select class="input max-w-[90px]" :value="r.type"
                      @change="leaveStore.updateRequest(r.id, { type: ($event.target as HTMLSelectElement).value as LeaveType })">
                <option value="OFF">OFF</option><option value="AL">AL</option>
              </select>
            </td>
            <td class="td">
              <ConflictBadge v-if="requestOutcome(r.employeeId, r.date, r.type) === 'must-work'" severity="WARNING" label="Must work" />
              <ConflictBadge v-else-if="requestOutcome(r.employeeId, r.date, r.type) === 'conflict'" severity="ERROR" label="Conflict" />
              <span v-else-if="requestOutcome(r.employeeId, r.date, r.type) === 'pending'" class="text-xs text-slate-400 font-semibold">Pending generate</span>
              <span v-else-if="requestOutcome(r.employeeId, r.date, r.type) === 'granted-al'" class="text-xs text-emerald-600 font-semibold">Granted (AL)</span>
              <span v-else class="text-xs text-emerald-600 font-semibold">Granted</span>
            </td>
            <td class="td text-right">
              <button class="btn-danger px-2 py-1" @click="leaveStore.removeRequest(r.id)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
