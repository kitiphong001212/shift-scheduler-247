<!-- src/components/SummaryCard.vue -->
<script setup lang="ts">
defineProps<{ label: string; value: string | number; hint?: string; tone?: 'default' | 'ok' | 'warn' | 'error' }>()

const tones: Record<string, string> = {
  default: 'text-slate-900',
  ok: 'text-emerald-600',
  warn: 'text-amber-600',
  error: 'text-rose-600'
}
</script>

<template>
  <div class="card">
    <p class="text-xs uppercase tracking-wide text-slate-500">{{ label }}</p>
    <p class="mt-1 text-2xl font-semibold" :class="tones[tone ?? 'default']">{{ value }}</p>
    <p v-if="hint" class="mt-0.5 text-xs text-slate-400">{{ hint }}</p>
  </div>
</template>