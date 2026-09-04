<!-- src/components/AppSidebar.vue -->
<script setup lang="ts">
import { useScheduleStore } from '@/stores/scheduleStore'
import { useSettingsStore } from '@/stores/settingsStore'

defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()

const settings = useSettingsStore()
const schedule = useScheduleStore()

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: '▤' },
  { to: '/monthly-setup', label: 'Monthly Setup', icon: '⚙' },
  { to: '/employees', label: 'Employees', icon: '☰' },
  { to: '/leave-requests', label: 'Leave Requests', icon: '✎' },
  { to: '/schedule', label: 'Schedule', icon: '▦' }
]
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" @click="$emit('close')" />

  <aside
    class="fixed inset-y-0 left-0 z-50 w-60 shrink-0 border-r border-slate-200 bg-white p-4
           transition-transform lg:static lg:translate-x-0"
    :class="open ? 'translate-x-0' : '-translate-x-full'"
  >
    <div class="mb-6">
      <p class="text-sm font-bold">24/7 Shift Scheduler</p>
      <p class="text-xs text-slate-500">{{ settings.monthContext.label }}</p>
    </div>

    <nav class="space-y-1">
      <RouterLink
        v-for="l in links" :key="l.to" :to="l.to" @click="$emit('close')"
        class="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
        active-class="bg-slate-900 text-white hover:bg-slate-900"
      >
        <span class="w-4 text-center">{{ l.icon }}</span>{{ l.label }}
      </RouterLink>
    </nav>

    <div class="mt-6 rounded-md border border-slate-200 p-3 text-xs text-slate-500">
      <div class="flex justify-between"><span>Score</span><span class="font-semibold text-slate-800">{{ schedule.score }}/100</span></div>
      <div class="mt-1 flex justify-between"><span>Conflicts</span><span class="font-semibold text-slate-800">{{ schedule.conflicts.length }}</span></div>
    </div>
  </aside>
</template>