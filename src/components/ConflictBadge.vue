<!-- src/components/ConflictBadge.vue -->
<script setup lang="ts">
import type { ConflictSeverity } from '@/types/conflict'

const props = defineProps<{ severity: ConflictSeverity; count?: number; label?: string }>()

const styles: Record<ConflictSeverity, string> = {
  ERROR: 'bg-rose-50 text-rose-700 border-rose-200',
  WARNING: 'bg-amber-50 text-amber-700 border-amber-200',
  INFO: 'bg-sky-50 text-sky-700 border-sky-200'
}
</script>

<template>
  <span class="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-semibold"
        :class="styles[props.severity]">
    {{ label ?? severity }}<template v-if="count !== undefined"> · {{ count }}</template>
  </span>
</template>