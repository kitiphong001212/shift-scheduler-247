<!-- src/views/Schedule.vue -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import ScheduleGrid from '@/components/ScheduleGrid.vue'
import CellEditorModal from '@/components/CellEditorModal.vue'
import ConflictBadge from '@/components/ConflictBadge.vue'
import SummaryCard from '@/components/SummaryCard.vue'
import { useEmployeeStore } from '@/stores/employeeStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useLeaveStore } from '@/stores/leaveStore'
import { ALL_STATUSES, SHIFT_CODES, STATUS_STYLES } from '@/services/shiftRules'
import { cellKey } from '@/utils/date'
import type { CellStatus } from '@/types/employee'

const employeeStore = useEmployeeStore()
const schedule = useScheduleStore()
const settings = useSettingsStore()
const leaveStore = useLeaveStore()

const showConfirm = ref(false)
const preserveManual = ref(false)
const editing = ref<{ employeeId: string; date: string } | null>(null)
const conflictFilter = ref<'ALL' | 'ERROR' | 'WARNING' | 'INFO'>('ERROR')

const employees = computed(() => employeeStore.activeEmployees)
const alTotal = computed(() => leaveStore.byMonth(schedule.monthKey).filter((r) => r.type === 'AL').length)

const filteredConflicts = computed(() =>
  conflictFilter.value === 'ALL'
    ? schedule.conflicts
    : schedule.conflicts.filter((c) => c.severity === conflictFilter.value)
)

function confirmGenerate() {
  schedule.generate({ preserveManual: preserveManual.value })
  showConfirm.value = false
}
function applyCell(status: CellStatus) {
  if (!editing.value) return
  schedule.setCell(editing.value.employeeId, editing.value.date, status) // triggers re-validation
  editing.value = null
}
const editingConflicts = computed(() =>
  editing.value ? schedule.conflictsByCell[cellKey(editing.value.employeeId, editing.value.date)] ?? [] : []
)
</script>

<template>
  <div class="space-y-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">Schedule — {{ schedule.monthContext.label }}</h1>
        <p class="text-sm text-slate-500">
          {{ employees.length }} employees · OFF target {{ schedule.monthContext.offTarget }}/person
          <template v-if="schedule.generatedAt"> · generated {{ new Date(schedule.generatedAt).toLocaleString() }}</template>
        </p>
      </div>
      <div class="flex gap-2">
        <button class="btn-ghost" :disabled="!schedule.hasSchedule" @click="schedule.regenerate(preserveManual)">↻ Regenerate</button>
        <button class="btn-primary" @click="showConfirm = true">Generate Schedule</button>
      </div>
    </header>

    <div v-if="schedule.hasSchedule" class="grid grid-cols-2 gap-3 md:grid-cols-4">
      <SummaryCard label="Schedule Score" :value="`${schedule.score}/100`"
                   :tone="schedule.score >= 90 ? 'ok' : schedule.score >= 70 ? 'warn' : 'error'" />
      <SummaryCard label="Errors" :value="schedule.statistics.errors" :tone="schedule.statistics.errors ? 'error' : 'ok'" />
      <SummaryCard label="Warnings" :value="schedule.statistics.warnings" tone="warn" />
      <SummaryCard label="Info" :value="schedule.statistics.infos" />
    </div>

    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="text-slate-500">Legend:</span>
      <span v-for="s in ALL_STATUSES" :key="s" class="rounded border px-2 py-0.5 font-semibold" :class="STATUS_STYLES[s]">{{ s }}</span>
      <span class="ml-2 text-slate-400">• = from request · ✎ = manual edit · weekend columns highlighted</span>
    </div>

    <div v-if="!schedule.hasSchedule" class="card text-sm text-slate-500">
      No schedule yet. Press <b>Generate Schedule</b>.
    </div>

    <ScheduleGrid
      v-else
      :employees="employees"
      :month="schedule.monthContext"
      :cell-map="schedule.cellMap"
      :assignments="schedule.currentAssignments"
      :conflicts-by-cell="schedule.conflictsByCell"
      :conflicts-by-date="schedule.conflictsByDate"
      @edit-cell="(id, date) => (editing = { employeeId: id, date })"
    />

    <!-- Monthly summary -->
    <div v-if="schedule.hasSchedule" class="card overflow-x-auto">
      <h2 class="mb-3 text-sm font-semibold">Monthly Summary</h2>
      <table class="w-full">
        <thead>
          <tr>
            <th class="th">Employee</th><th class="th">Shift</th><th class="th">Working</th>
            <th class="th">OFF</th><th class="th">AL</th><th class="th">Total Leave</th>
            <th class="th">Max Consec.</th><th class="th">Conflicts</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in schedule.statistics.perEmployee" :key="s.employeeId">
            <td class="td">{{ employeeStore.nameOf(s.employeeId) }}</td>
            <td class="td">{{ s.shift ?? '–' }}</td>
            <td class="td">{{ s.working }}</td>
            <td class="td" :class="s.off === schedule.monthContext.offTarget ? 'text-emerald-600 font-semibold' : 'text-amber-600'">
              {{ s.off }}/{{ schedule.monthContext.offTarget }}
            </td>
            <td class="td">{{ s.al }}</td>
            <td class="td">{{ s.totalLeave }}</td>
            <td class="td" :class="s.maxConsecutive > 5 ? 'text-rose-600 font-semibold' : ''">{{ s.maxConsecutive }}</td>
            <td class="td">{{ s.conflicts }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Conflict list -->
    <div v-if="schedule.hasSchedule" class="card">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-semibold">Conflict Report</h2>
        <div class="flex gap-1">
          <button v-for="f in (['ALL','ERROR','WARNING','INFO'] as const)" :key="f"
                  class="rounded-md px-3 py-1 text-xs font-semibold"
                  :class="conflictFilter === f ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-600'"
                  @click="conflictFilter = f">{{ f }}</button>
        </div>
      </div>
      <div class="max-h-72 space-y-1 overflow-auto">
        <p v-if="!filteredConflicts.length" class="text-sm text-slate-500">No conflicts in this category. 🎉</p>
        <div v-for="c in filteredConflicts" :key="c.id" class="flex items-start gap-2 border-b border-slate-100 py-1 text-sm">
          <ConflictBadge :severity="c.severity" />
          <span class="w-24 shrink-0 font-mono text-xs text-slate-400">{{ c.date ?? '—' }}</span>
          <span class="text-slate-700">{{ c.message }}</span>
          <span class="ml-auto shrink-0 text-[10px] text-slate-400">{{ c.type }}</span>
        </div>
      </div>
    </div>

    <!-- Confirmation -->
    <div v-if="showConfirm" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" @click.self="showConfirm = false">
      <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h3 class="text-sm font-semibold">Generate Schedule</h3>
        <dl class="mt-4 space-y-1 text-sm">
          <div class="flex justify-between"><dt class="text-slate-500">Month</dt><dd class="font-medium">{{ schedule.monthContext.label }}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-500">Employees</dt><dd class="font-medium">{{ employees.length }}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-500">Required Working</dt><dd class="font-medium">{{ settings.requiredWorking }}/day</dd></div>
          <div class="flex justify-between"><dt class="text-slate-500">OFF Target</dt><dd class="font-medium">{{ schedule.monthContext.offTarget }}/person</dd></div>
          <div class="flex justify-between"><dt class="text-slate-500">AL requests</dt><dd class="font-medium">{{ alTotal }}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-500">Shift quota</dt>
            <dd class="font-medium">{{ SHIFT_CODES.map(s => `${s}=${settings.quotas[s]}`).join(' · ') }}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-500">Policy</dt><dd class="font-medium">{{ settings.offPolicy }}</dd></div>
        </dl>
        <label class="mt-4 flex items-center gap-2 text-sm">
          <input v-model="preserveManual" type="checkbox" /> Keep my manual edits
        </label>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn-ghost" @click="showConfirm = false">Cancel</button>
          <button class="btn-primary" @click="confirmGenerate">Generate</button>
        </div>
      </div>
    </div>

    <CellEditorModal
      v-if="editing"
      :employee-name="employeeStore.nameOf(editing.employeeId)"
      :date="editing.date"
      :current="schedule.cellMap[cellKey(editing.employeeId, editing.date)]?.shift"
      :conflicts="editingConflicts"
      @apply="applyCell"
      @close="editing = null"
    />
  </div>
</template>