<!-- src/components/DayHeader.vue -->
<script setup lang="ts">
import type { DayInfo } from '@/types/schedule'
import type { Conflict } from '@/types/conflict'

const props = defineProps<{ day: DayInfo; conflicts: Conflict[] }>()
const hasError = () => props.conflicts.some((c) => c.severity === 'ERROR')
</script>

<template>
  <div class="flex flex-col items-center leading-tight">
    <span class="text-[10px] uppercase" :class="day.isWeekend ? 'text-amber-700' : 'text-slate-400'">
      {{ day.weekdayLabel }}
    </span>
    <span class="text-xs font-semibold">{{ day.day }}</span>
    <span v-if="conflicts.length" :class="hasError() ? 'text-rose-600' : 'text-amber-500'" class="text-[10px]">
      ⚠{{ conflicts.length }}
    </span>
  </div>
</template>