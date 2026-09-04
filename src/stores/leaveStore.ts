// src/stores/leaveStore.ts
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { LeaveRequest, LeaveType } from '@/types/leave'
import { loadState, saveState } from '@/services/storage'
import { uid } from '@/utils/date'

export const useLeaveStore = defineStore('leave', () => {
  const requests = ref<LeaveRequest[]>(loadState<LeaveRequest[]>('leaveRequests', []))
  watch(requests, (v) => saveState('leaveRequests', v), { deep: true })

  const byMonth = computed(() => (monthKey: string) =>
    requests.value.filter((r) => r.date.startsWith(monthKey))
  )

  function addRequest(employeeId: string, date: string, type: LeaveType, note = '') {
    if (requests.value.some((r) => r.employeeId === employeeId && r.date === date)) return
    requests.value.push({ id: uid('LR'), employeeId, date, type, note })
  }
  function addRequests(employeeId: string, dates: string[], type: LeaveType, note = '') {
    for (const date of dates) addRequest(employeeId, date, type, note)
  }
  function updateRequest(id: string, patch: Partial<Omit<LeaveRequest, 'id'>>) {
    const i = requests.value.findIndex((r) => r.id === id)
    if (i >= 0) requests.value[i] = { ...requests.value[i], ...patch }
  }
  function removeRequest(id: string) {
    requests.value = requests.value.filter((r) => r.id !== id)
  }
  function clearMonth(monthKey: string) {
    requests.value = requests.value.filter((r) => !r.date.startsWith(monthKey))
  }

  return { requests, byMonth, addRequest, addRequests, updateRequest, removeRequest, clearMonth }
})
