<!-- src/App.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import AppSidebar from '@/components/AppSidebar.vue'
import AdminLogin from '@/views/AdminLogin.vue'
import { databaseConnection } from '@/services/database'

const sidebarOpen = ref(false)
</script>

<template>
  <div
    v-if="databaseConnection.status === 'connecting'"
    class="flex min-h-screen items-center justify-center bg-slate-50"
  >
    <div class="text-center">
      <div class="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
      <p class="mt-3 text-sm text-slate-500">{{ databaseConnection.message }}</p>
    </div>
  </div>

  <AdminLogin v-else-if="databaseConnection.status === 'unauthenticated'" />

  <div v-else class="flex min-h-screen">
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