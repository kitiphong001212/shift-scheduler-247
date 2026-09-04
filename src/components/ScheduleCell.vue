<!-- src/components/ScheduleCell.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import type { ScheduleEntry } from '@/types/schedule'
import type { Conflict } from '@/types/conflict'
import { STATUS_STYLES } from '@/services/shiftRules'

const props = defineProps<{
  entry: ScheduleEntry | undefined
  conflicts: Conflict[]
  weekend: boolean
}>()
defineEmits<{ select: [] }>()

const severity = computed(() =>
  props.conflicts.some((c) => c.severity === 'ERROR') ? 'ERROR'
  : props.conflicts.some((c) => c.severity === 'WARNING') ? 'WARNING'
  : null
)

const classes = computed(() => {
  const base = props.entry ? STATUS_STYLES[props.entry.shift] : 'bg-white text-slate-300 border-slate-200'
  if (severity.value === 'ERROR') return `${base} ring-2 ring-inset ring-rose-500`
  if (severity.value === 'WARNING') return `${base} ring-1 ring-inset ring-amber-400`
  return base
})

const tooltip = computed(() =>
  props.conflicts.map((c) => `${c.severity}: ${c.message}`).join('\n') || undefined
)
</script>

<template>
  <button
    type="button"
    :title="tooltip"
    class="relative h-8 w-full rounded border text-[11px] font-semibold transition hover:brightness-95"
    :class="[classes, weekend ? 'shadow-[inset_0_0_0_9999px_rgba(251,191,36,0.06)]' : '']"
    @click="$emit('select')"
  >
    {{ entry?.shift ?? '–' }}
    <span v-if="entry?.source === 'REQUEST'" class="absolute right-0.5 top-0 text-[8px] text-slate-500">•</span>
    <span v-else-if="entry?.source === 'MANUAL'" class="absolute right-0.5 top-0 text-[8px] text-slate-900">✎</span>
  </button>
</template>