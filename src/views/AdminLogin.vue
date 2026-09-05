<script setup lang="ts">
import { ref } from 'vue'
import { signInAdmin } from '@/services/database'

const username = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)

async function submit() {
  error.value = ''
  submitting.value = true
  try {
    await signInAdmin(username.value, password.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Unable to sign in'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-100 p-4">
    <form class="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg" @submit.prevent="submit">
      <div class="mb-6">
        <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">24/7 Shift Scheduler</p>
        <h1 class="mt-2 text-2xl font-bold text-slate-900">Admin sign in</h1>
        <p class="mt-1 text-sm text-slate-500">Use the same admin account on every device.</p>
      </div>

      <div class="space-y-4">
        <div>
          <label class="label" for="admin-username">Username</label>
          <input
            id="admin-username"
            v-model="username"
            class="input"
            type="text"
            autocomplete="username"
            required
          />
        </div>
        <div>
          <label class="label" for="admin-password">Password</label>
          <input
            id="admin-password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="current-password"
            minlength="6"
            required
          />
        </div>
      </div>

      <p v-if="error" class="mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{{ error }}</p>

      <button class="btn-primary mt-5 w-full justify-center" type="submit" :disabled="submitting">
        {{ submitting ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
  </main>
</template>
