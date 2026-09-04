<!-- src/components/CellEditorModal.vue -->
<script setup lang="ts">
import type { CellStatus } from '@/types/employee'
import type { Conflict } from '@/types/conflict'
import { ALL_STATUSES, SHIFTS, STATUS_STYLES, isShift } from '@/services/shiftRules'

defineProps<{
  employeeName: string
  date: string
  current: CellStatus | undefined
  conflicts: Conflict[]
}>()
defineEmits<{ apply: [status: CellStatus]; close: [] }>()
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" @click.self="$emit('close')">
    <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
      <h3 class="text-sm font-semibold text-slate-900">{{ employeeName }}</h3>
      <p class="text-xs text-slate-500">{{ date }}</p>

      <div class="mt-4 grid grid-cols-3 gap-2">
        <button
          v-for="s in ALL_STATUSES" :key="s"
          class="rounded border px-2 py-3 text-sm font-semibold"
          :class="[STATUS_STYLES[s], current === s ? 'ring-2 ring-slate-900' : '']"
          @click="$emit('apply', s)"
        >
          {{ s }}
          <span v-if="isShift(s)" class="block text-[10px] font-normal opacity-70">
            {{ SHIFTS[s].start }}–{{ SHIFTS[s].end }}
          </span>
        </button>
      </div>

      <div v-if="conflicts.length" class="mt-4 space-y-1 rounded border border-rose-200 bg-rose-50 p-3">
        <p class="text-xs font-semibold text-rose-700">Conflicts on this cell</p>
        <p v-for="c in conflicts" :key="c.id" class="text-xs text-rose-600">
          {{ c.severity }} · {{ c.message }}
        </p>
      </div>

      <div class="mt-5 flex justify-end">
        <button class="btn-ghost" @click="$emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>