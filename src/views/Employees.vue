<!-- src/views/Employees.vue -->
<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useEmployeeStore } from '@/stores/employeeStore'
import type { Employee } from '@/types/employee'

const store = useEmployeeStore()
const showForm = ref(false)
const editingId = ref<string | null>(null)
const error = ref('')

const form = reactive<{ code: string; name: string; active: boolean }>({
  code: '', name: '', active: true
})

function openCreate() {
  editingId.value = null
  Object.assign(form, { code: '', name: '', active: true })
  error.value = ''
  showForm.value = true
}
function openEdit(e: Employee) {
  editingId.value = e.id
  Object.assign(form, { code: e.code, name: e.name, active: e.active })
  error.value = ''
  showForm.value = true
}
function submit() {
  error.value = ''
  if (!form.name.trim()) { error.value = 'Employee name is required'; return }
  try {
    if (editingId.value) store.updateEmployee(editingId.value, { name: form.name, active: form.active })
    else store.addEmployee({ code: form.code.trim(), name: form.name.trim(), defaultShift: 'A1', active: form.active })
    showForm.value = false
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>

<template>
  <div class="space-y-5">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold">Employees</h1>
        <p class="text-sm text-slate-500">{{ store.activeEmployees.length }} active / {{ store.employees.length }} total · assign shifts monthly in Monthly Setup</p>
      </div>
      <button class="btn-primary" @click="openCreate">+ Add Employee</button>
    </header>

    <div class="card overflow-x-auto">
      <table class="w-full">
        <thead>
          <tr>
            <th class="th">ID</th><th class="th">Name</th>
            <th class="th">Status</th><th class="th text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in store.employees" :key="e.id">
            <td class="td font-mono text-xs">{{ e.code }}</td>
            <td class="td font-medium">{{ e.name }}</td>
            <td class="td">
              <button class="rounded px-2 py-0.5 text-xs font-semibold"
                      :class="e.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'"
                      @click="store.toggleActive(e.id)">
                {{ e.active ? 'Active' : 'Inactive' }}
              </button>
            </td>
            <td class="td text-right">
              <button class="btn-ghost mr-2 px-2 py-1" @click="openEdit(e)">Edit</button>
              <button class="btn-danger px-2 py-1" @click="store.removeEmployee(e.id)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showForm" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" @click.self="showForm = false">
      <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h3 class="mb-4 text-sm font-semibold">{{ editingId ? 'Edit Employee' : 'Add Employee' }}</h3>
        <div class="space-y-3">
          <div v-if="!editingId">
            <label class="label">Employee ID</label>
            <input v-model="form.code" class="input" placeholder="EMP016 (auto if blank)" />
          </div>
          <div>
            <label class="label">Employee Name</label>
            <input v-model="form.name" class="input" placeholder="Employee 16" />
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="form.active" type="checkbox" /> Active
          </label>
          <p v-if="error" class="text-xs text-rose-600">{{ error }}</p>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button class="btn-ghost" @click="showForm = false">Cancel</button>
          <button class="btn-primary" @click="submit">Save</button>
        </div>
      </div>
    </div>
  </div>
</template>
