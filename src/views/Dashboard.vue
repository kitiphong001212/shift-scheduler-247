<!-- src/views/Dashboard.vue -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import SummaryCard from '@/components/SummaryCard.vue'
import ConflictBadge from '@/components/ConflictBadge.vue'
import { useEmployeeStore } from '@/stores/employeeStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { SHIFT_CODES } from '@/services/shiftRules'
import { todayISO } from '@/utils/date'

const employeeStore = useEmployeeStore()
const schedule = useScheduleStore()
const settings = useSettingsStore()

const days = computed(() => schedule.monthContext.days)
const selectedDate = ref(days.value.some((d) => d.date === todayISO()) ? todayISO() : days.value[0]?.date ?? '')

const dayStat = computed(() =>
  schedule.statistics.perDay.find((d) => d.date === selectedDate.value)
)
const dayConflicts = computed(() => schedule.conflictsByDate[selectedDate.value] ?? [])
</script>

<template>
  <div class="space-y-5">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">Dashboard</h1>
        <p class="text-sm text-slate-500">{{ schedule.monthContext.label }} · policy {{ settings.offPolicy }}</p>
      </div>
      <select v-model="selectedDate" class="input max-w-[200px]">
        <option v-for="d in days" :key="d.date" :value="d.date">{{ d.weekdayLabel }} {{ d.day }} — {{ d.date }}</option>
      </select>
    </header>

    <div v-if="!schedule.hasSchedule" class="card text-sm text-slate-500">
      No schedule for this month yet. Go to <RouterLink class="font-semibold text-slate-900 underline" to="/schedule">Schedule</RouterLink> and press Generate.
    </div>

    <template v-else>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Employees" :value="employeeStore.activeEmployees.length" hint="active" />
        <SummaryCard
          label="Working" :value="`${dayStat?.working ?? 0}/${settings.requiredWorking}`"
          :tone="(dayStat?.working ?? 0) === settings.requiredWorking ? 'ok' : 'error'"
        />
        <SummaryCard label="OFF" :value="dayStat?.off ?? 0" />
        <SummaryCard label="AL" :value="dayStat?.al ?? 0" />
      </div>

      <div class="grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryCard
          v-for="s in SHIFT_CODES" :key="s"
          :label="s"
          :value="`${dayStat?.byShift[s] ?? 0}/${settings.quotas[s]}`"
          :tone="(dayStat?.byShift[s] ?? 0) === settings.quotas[s] ? 'ok' : 'warn'"
        />
        <SummaryCard
          label="Schedule Score" :value="`${schedule.score}/100`"
          :tone="schedule.score >= 90 ? 'ok' : schedule.score >= 70 ? 'warn' : 'error'"
        />
      </div>

      <div class="card">
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <h2 class="mr-2 text-sm font-semibold">Conflicts</h2>
          <ConflictBadge severity="ERROR" :count="schedule.statistics.errors" label="Errors" />
          <ConflictBadge severity="WARNING" :count="schedule.statistics.warnings" label="Warnings" />
          <ConflictBadge severity="INFO" :count="schedule.statistics.infos" label="Info" />
        </div>

        <p v-if="!dayConflicts.length" class="text-sm text-slate-500">No conflicts on {{ selectedDate }}.</p>
        <ul v-else class="space-y-1">
          <li v-for="c in dayConflicts" :key="c.id" class="flex items-start gap-2 text-sm">
            <ConflictBadge :severity="c.severity" />
            <span class="text-slate-700">{{ c.message }}</span>
            <span class="text-xs text-slate-400">({{ c.type }})</span>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>