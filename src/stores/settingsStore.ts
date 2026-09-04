// src/stores/settingsStore.ts
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { ShiftCode } from '@/types/employee'
import type { OffPolicy } from '@/types/schedule'
import { DEFAULT_QUOTAS, DEFAULT_REQUIRED_WORKING } from '@/services/shiftRules'
import { buildMonthContext } from '@/services/calendar'
import { loadState, saveState } from '@/services/storage'

interface SettingsState {
  year: number
  month: number
  requiredWorking: number
  quotas: Record<ShiftCode, number>
  offPolicy: OffPolicy
}

const now = new Date()

export const useSettingsStore = defineStore('settings', () => {
  const saved = loadState<SettingsState>('settings', {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    requiredWorking: DEFAULT_REQUIRED_WORKING,
    quotas: { ...DEFAULT_QUOTAS },
    offPolicy: 'STAFFING_FIRST'
  })

  const year = ref(saved.year)
  const month = ref(saved.month)
  const requiredWorking = ref(saved.requiredWorking)
  const quotas = ref<Record<ShiftCode, number>>({ ...saved.quotas })
  const offPolicy = ref<OffPolicy>(saved.offPolicy)

  const monthContext = computed(() => buildMonthContext(year.value, month.value))
  const quotaTotal = computed(() =>
    (Object.values(quotas.value) as number[]).reduce((a, b) => a + b, 0)
  )

  watch(
    [year, month, requiredWorking, quotas, offPolicy],
    () =>
      saveState<SettingsState>('settings', {
        year: year.value, month: month.value,
        requiredWorking: requiredWorking.value,
        quotas: { ...quotas.value },
        offPolicy: offPolicy.value
      }),
    { deep: true }
  )

  function setMonth(y: number, m: number) { year.value = y; month.value = m }

  return { year, month, requiredWorking, quotas, offPolicy, monthContext, quotaTotal, setMonth }
})