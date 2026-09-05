// src/stores/employeeStore.ts
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { Employee } from '@/types/employee'
import { loadState, saveState, syncState } from '@/services/storage'
import { uid } from '@/utils/date'

export const useEmployeeStore = defineStore('employees', () => {
  const employees = ref<Employee[]>(loadState<Employee[]>('employees', []))
  watch(employees, (v) => saveState('employees', v), { deep: true })
  syncState('employees', employees.value, (value) => { employees.value = value })

  const activeEmployees = computed(() => employees.value.filter((e) => e.active))
  const byId = computed(() => {
    const m: Record<string, Employee> = {}
    employees.value.forEach((e) => (m[e.id] = e))
    return m
  })
  const nameOf = (id: string) => byId.value[id]?.name ?? id

  function addEmployee(payload: Omit<Employee, 'id'>) {
    const id = payload.code?.trim() || uid('EMP')
    if (employees.value.some((e) => e.id === id)) throw new Error(`Employee ID "${id}" already exists`)
    employees.value.push({ ...payload, id, code: id })
  }
  function updateEmployee(id: string, patch: Partial<Omit<Employee, 'id'>>) {
    const i = employees.value.findIndex((e) => e.id === id)
    if (i >= 0) employees.value[i] = { ...employees.value[i], ...patch }
  }
  function removeEmployee(id: string) {
    employees.value = employees.value.filter((e) => e.id !== id)
  }
  function toggleActive(id: string) {
    const e = employees.value.find((x) => x.id === id)
    if (e) e.active = !e.active
  }

  return { employees, activeEmployees, byId, nameOf, addEmployee, updateEmployee, removeEmployee, toggleActive }
})