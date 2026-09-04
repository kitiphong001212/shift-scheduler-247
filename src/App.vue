<!-- src/App.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import AppSidebar from '@/components/AppSidebar.vue'

const sidebarOpen = ref(false)
</script>

<template>
  <div class="flex min-h-screen">
    <AppSidebar :open="sidebarOpen" @close="sidebarOpen = false" />

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <button class="btn-ghost px-2 py-1" @click="sidebarOpen = true">☰</button>
        <span class="text-sm font-semibold">24/7 Shift Scheduler</span>
      </header>

      <main class="min-w-0 flex-1 p-4 lg:p-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>