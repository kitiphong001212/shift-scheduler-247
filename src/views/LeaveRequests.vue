<!-- src/views/LeaveRequests.vue -->
<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useLeaveStore } from '@/stores/leaveStore'
import { useEmployeeStore } from '@/stores/employeeStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { useSettingsStore } from '@/stores/settingsStore'
import type { LeaveType } from '@/types/leave'
import ConflictBadge from '@/components/ConflictBadge.vue'

const leaveStore = useLeaveStore()
const employeeStore = useEmployeeStore()
const schedule = useScheduleStore()
const settings = useSettingsStore()

const filter = ref<'ALL' | 'OFF' | 'AL' | 'CONFLICT'>('ALL')
const form = reactive<{ employeeId: string; date: string; type: LeaveType; note: string }>({
  employeeId: employeeStore.activeEmployees[0]?.id ?? '',
  date: settings.monthContext.days[0]?.date ?? '',
  type: 'AL',
  note: ''
})

const conflictDates = computed(() => {
  const s = new Set<string>()
  for (const c of schedule.conflicts) {
    if (c.date && (c.type === 'TOO_MANY_LEAVE_REQUEST' || c.type === 'DUPLICATE_LEAVE' || c.type === 'AL_OVER_CAPACITY')) s.add(c.date)
  }
  return s
})

const rows = computed(() => {
  const all = leaveStore.byMonth(schedule.monthKey).slice().sort((a, b) => a.date.localeCompare(b.date))
  if (filter.value === 'OFF') return all.filter((r) => r.type === 'OFF')
  if (filter.value === 'AL') return all.filter((r) => r.type === 'AL')
  if (filter.value === 'CONFLICT') return all.filter((r) => conflictDates.value.has(r.date))
  return all
})

function add() {
  if (!form.employeeId || !form.date) return
  leaveStore.addRequest(form.employeeId, form.date, form.type, form.note)
  form.note = ''
}
</script>

<template>
  <div class="space-y-5">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">Leave Requests</h1>
        <p class="text-sm text-slate-500">{{ schedule.monthContext.label }} · daily leave quota {{ Math.max(0, employeeStore.activeEmployees.length - settings.requiredWorking) }}</p>
      </div>
      <div class="flex gap-1">
        <button v-for="f in (['ALL','OFF','AL','CONFLICT'] as const)" :key="f"
                class="rounded-md px-3 py-1.5 text-xs font-semibold"
                :class="filter === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-300'"
                @click="filter = f">{{ f }}</button>
      </div>
    </header>

    <div class="card grid gap-3 md:grid-cols-5 md:items-end">
      <div class="md:col-span-2">
        <label class="label">Employee</label>
        <select v-model="form.employeeId" class="input">
          <option v-for="e in employeeStore.activeEmployees" :key="e.id" :value="e.id">{{ e.name }} ({{ e.code }})</option>
        </select>
      </div>
      <div>
        <label class="label">Date</label>
        <select v-model="form.date" class="input">
          <option v-for="d in schedule.monthContext.days" :key="d.date" :value="d.date">{{ d.date }} ({{ d.weekdayLabel }})</option>
        </select>
      </div>
      <div>
        <label class="label">Type</label>
        <select v-model="form.type" class="input"><option value="OFF">OFF</option><option value="AL">AL</option></select>
      </div>
      <button class="btn-primary justify-center" @click="add">+ Add Request</button>
    </div>

    <div class="card overflow-x-auto">
      <table class="w-full">
        <thead>
          <tr>
            <th class="th">Employee</th><th class="th">Date</th><th class="th">Type</th>
            <th class="th">Status</th><th class="th text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!rows.length"><td class="td text-slate-400" colspan="5">No requests.</td></tr>
          <tr v-for="r in rows" :key="r.id">
            <td class="td">{{ employeeStore.nameOf(r.employeeId) }}</td>
            <td class="td font-mono text-xs">{{ r.date }}</td>
            <td class="td">
              <select class="input max-w-[90px]" :value="r.type"
                      @change="leaveStore.updateRequest(r.id, { type: ($event.target as HTMLSelectElement).value as LeaveType })">
                <option value="OFF">OFF</option><option value="AL">AL</option>
              </select>
            </td>
            <td class="td">
              <ConflictBadge v-if="conflictDates.has(r.date)" severity="WARNING" label="Over quota" />
              <span v-else class="text-xs text-emerald-600 font-semibold">OK</span>
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