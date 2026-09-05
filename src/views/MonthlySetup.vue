<!-- src/views/MonthlySetup.vue -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import SummaryCard from '@/components/SummaryCard.vue'
import { useSettingsStore } from '@/stores/settingsStore'
import { useEmployeeStore } from '@/stores/employeeStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { useLeaveStore } from '@/stores/leaveStore'
import {
  cloneDefaultTransitionMatrix, requiresRestBetween, SHIFT_CODES, STATUS_STYLES
} from '@/services/shiftRules'
import { MONTH_NAMES } from '@/utils/date'
import type { ShiftCode } from '@/types/employee'

const settings = useSettingsStore()
const employeeStore = useEmployeeStore()
const schedule = useScheduleStore()
const leaveStore = useLeaveStore()

const ctx = computed(() => settings.monthContext)
const years = Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 1 + i)
const draggingShift = ref<ShiftCode | null>(null)
const dragOverFrom = ref<ShiftCode | null>(null)

const alCountOf = (employeeId: string) =>
  leaveStore.byMonth(ctx.value.monthKey).filter((r) => r.employeeId === employeeId && r.type === 'AL').length

const capacity = computed(() => {
  const n = employeeStore.activeEmployees.length
  const perDayLeave = Math.max(0, n - settings.requiredWorking)
  const totalLeaveSlots = perDayLeave * ctx.value.days.length
  const perPerson = n ? totalLeaveSlots / n : 0
  return { n, perDayLeave, totalLeaveSlots, perPerson: Math.round(perPerson * 10) / 10 }
})

const groupCounts = computed(() => {
  const c: Record<ShiftCode, number> = { A1: 0, A7: 0, A5: 0, A6: 0 }
  for (const e of employeeStore.activeEmployees) c[schedule.currentAssignments[e.id] ?? e.defaultShift]++
  return c
})

const allowedTargets = (from: ShiftCode) =>
  SHIFT_CODES.filter((to) =>
    settings.transitionMatrix[from][to] && !requiresRestBetween(from, to)
  )

function startTransitionDrag(event: DragEvent, shift: ShiftCode) {
  draggingShift.value = shift
  event.dataTransfer?.setData('text/plain', shift)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}

function dropTransition(event: DragEvent, from: ShiftCode) {
  const raw = event.dataTransfer?.getData('text/plain') || draggingShift.value
  dragOverFrom.value = null
  draggingShift.value = null
  if (!raw || !SHIFT_CODES.includes(raw as ShiftCode)) return
  const to = raw as ShiftCode
  if (requiresRestBetween(from, to)) return
  settings.transitionMatrix[from][to] = true
}

function removeTransition(from: ShiftCode, to: ShiftCode) {
  settings.transitionMatrix[from][to] = false
}

function resetTransitions() {
  settings.transitionMatrix = cloneDefaultTransitionMatrix()
}
</script>

<template>
  <div class="space-y-5">
    <h1 class="text-xl font-semibold">Monthly Setup</h1>

    <div class="card grid gap-4 md:grid-cols-4">
      <div>
        <label class="label">Year</label>
        <select class="input" :value="settings.year" @change="settings.setMonth(Number(($event.target as HTMLSelectElement).value), settings.month)">
          <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
        </select>
      </div>
      <div>
        <label class="label">Month</label>
        <select class="input" :value="settings.month" @change="settings.setMonth(settings.year, Number(($event.target as HTMLSelectElement).value))">
          <option v-for="(m, i) in MONTH_NAMES" :key="m" :value="i + 1">{{ m }}</option>
        </select>
      </div>
      <div>
        <label class="label">Required Working / day</label>
        <input v-model.number="settings.requiredWorking" type="number" min="1" class="input" />
      </div>
      <div>
        <label class="label">OFF Policy</label>
        <select v-model="settings.offPolicy" class="input">
          <option value="STAFFING_FIRST">Staffing-first (10 working/day)</option>
          <option value="ENTITLEMENT_FIRST">Entitlement-first (cap OFF at target)</option>
        </select>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 md:grid-cols-5">
      <SummaryCard label="Days" :value="ctx.days.length" />
      <SummaryCard label="Saturday" :value="ctx.saturdayCount" />
      <SummaryCard label="Sunday" :value="ctx.sundayCount" />
      <SummaryCard label="Weekend" :value="ctx.weekendCount" />
      <SummaryCard label="OFF Target / person" :value="ctx.offTarget" tone="ok" />
    </div>

    <div class="card text-sm">
      <p class="font-semibold text-slate-800">Capacity check</p>
      <p class="mt-1 text-slate-600">
        {{ capacity.n }} employees × {{ ctx.days.length }} days → leave slots =
        {{ capacity.perDayLeave }}/day × {{ ctx.days.length }} = <b>{{ capacity.totalLeaveSlots }}</b>
        (~<b>{{ capacity.perPerson }}</b> per person) vs OFF target <b>{{ ctx.offTarget }}</b>.
      </p>
      <p v-if="capacity.perPerson > ctx.offTarget" class="mt-1 text-amber-600">
        Team needs ≈ {{ Math.round((capacity.perPerson - ctx.offTarget) * capacity.n) }} AL days this month,
        otherwise some staff will exceed the OFF entitlement (reported as INFO).
      </p>
    </div>

    <div class="card">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold">Shift quota per day</h2>
        <span class="text-xs" :class="settings.quotaTotal === settings.requiredWorking ? 'text-emerald-600' : 'text-rose-600'">
          Total {{ settings.quotaTotal }} / {{ settings.requiredWorking }}
        </span>
      </div>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div v-for="s in SHIFT_CODES" :key="s">
          <label class="label">{{ s }} (group: {{ groupCounts[s] }})</label>
          <input v-model.number="settings.quotas[s]" type="number" min="0" class="input" />
        </div>
      </div>
    </div>

    <div class="card">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 class="text-sm font-semibold">Shift Transition Rules</h2>
          <p class="mt-1 text-xs text-slate-500">
            Drag a shift into each row to allow it on the next consecutive working day.
          </p>
        </div>
        <button class="btn-ghost" @click="resetTransitions">Reset defaults</button>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2 rounded-md bg-slate-50 p-3">
        <span class="mr-1 text-xs font-semibold text-slate-500">Drag shift:</span>
        <button
          v-for="s in SHIFT_CODES"
          :key="s"
          type="button"
          draggable="true"
          class="cursor-grab rounded border px-3 py-1.5 text-xs font-semibold active:cursor-grabbing"
          :class="[STATUS_STYLES[s], draggingShift === s ? 'opacity-50' : '']"
          @dragstart="startTransitionDrag($event, s)"
          @dragend="draggingShift = null; dragOverFrom = null"
        >
          {{ s }}
        </button>
      </div>

      <div class="mt-3 space-y-3">
        <div
          v-for="from in SHIFT_CODES"
          :key="from"
          class="grid gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[90px_1fr]"
        >
          <div class="flex items-center">
            <span class="rounded border px-2 py-1 text-xs font-semibold" :class="STATUS_STYLES[from]">
              After {{ from }}
            </span>
          </div>
          <div
            class="flex min-h-12 flex-wrap items-center gap-2 rounded-md border-2 border-dashed p-2 transition"
            :class="dragOverFrom === from ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-white'"
            @dragover.prevent="dragOverFrom = from"
            @dragleave.self="dragOverFrom = null"
            @drop.prevent="dropTransition($event, from)"
          >
            <span v-if="!allowedTargets(from).length" class="text-xs text-slate-400">
              Drop allowed next shifts here
            </span>
            <button
              v-for="to in allowedTargets(from)"
              :key="to"
              type="button"
              class="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-semibold"
              :class="STATUS_STYLES[to]"
              :title="`Remove ${from} → ${to}`"
              @click="removeTransition(from, to)"
            >
              {{ to }} <span aria-hidden="true">×</span>
            </button>
            <span
              v-if="from === 'A6'"
              class="rounded bg-slate-100 px-2 py-1 text-[10px] text-slate-500"
              title="A6 to A5 needs OFF or AL in between"
            >
              A5 requires OFF/AL first
            </span>
          </div>
        </div>
      </div>
      <p class="mt-3 text-xs text-slate-400">
        Click an assigned chip to remove it. Monthly home-group eligibility and A6 → A5 rest remain hard safety rules.
      </p>
    </div>

    <div class="card">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold">Monthly Shift Assignment</h2>
        <button class="btn-ghost" @click="schedule.resetAssignmentsToDefault()">Reset seed distribution</button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr>
              <th class="th">Employee</th>
              <th class="th">Assigned Shift</th>
              <th class="th">OFF Target</th>
              <th class="th">AL</th>
              <th class="th">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in employeeStore.employees" :key="e.id">
              <td class="td">
                <span class="font-medium">{{ e.name }}</span>
                <span class="ml-2 text-xs text-slate-400">{{ e.code }}</span>
              </td>
              <td class="td">
                <select
                  class="input max-w-[110px]"
                  :disabled="!e.active"
                  :value="schedule.currentAssignments[e.id] ?? e.defaultShift"
                  @change="schedule.setAssignment(e.id, ($event.target as HTMLSelectElement).value as ShiftCode)"
                >
                  <option v-for="s in SHIFT_CODES" :key="s" :value="s">{{ s }}</option>
                </select>
              </td>
              <td class="td">{{ e.active ? ctx.offTarget : '–' }}</td>
              <td class="td">{{ alCountOf(e.id) }}</td>
              <td class="td">
                <span class="rounded px-2 py-0.5 text-xs font-semibold"
                      :class="e.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'">
                  {{ e.active ? 'Active' : 'Inactive' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>