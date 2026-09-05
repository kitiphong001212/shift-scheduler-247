// src/stores/settingsStore.ts
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { ShiftCode } from '@/types/employee'
import type {
  A1AllowedTransitions, OffPolicy, ShiftTransitionMatrix
} from '@/types/schedule'
import {
  cloneDefaultTransitionMatrix,
  DEFAULT_QUOTAS,
  DEFAULT_REQUIRED_WORKING
} from '@/services/shiftRules'
import { buildMonthContext } from '@/services/calendar'
import { loadState, saveState } from '@/services/storage'

interface SettingsState {
  year: number
  month: number
  requiredWorking: number
  quotas: Record<ShiftCode, number>
  transitionMatrix: ShiftTransitionMatrix
  /** Legacy setting migrated into transitionMatrix.A1. */
  a1AllowedTransitions?: A1AllowedTransitions
  offPolicy: OffPolicy
}

const now = new Date()

export const useSettingsStore = defineStore('settings', () => {
  const saved = loadState<SettingsState>('settings', {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    requiredWorking: DEFAULT_REQUIRED_WORKING,
    quotas: { ...DEFAULT_QUOTAS },
    transitionMatrix: cloneDefaultTransitionMatrix(),
    offPolicy: 'STAFFING_FIRST'
  })

  const year = ref(saved.year)
  const month = ref(saved.month)
  const requiredWorking = ref(saved.requiredWorking)
  const quotas = ref<Record<ShiftCode, number>>({ ...saved.quotas })
  const defaults = cloneDefaultTransitionMatrix()
  const transitionMatrix = ref<ShiftTransitionMatrix>({
    A1: {
      ...defaults.A1,
      ...(saved.transitionMatrix?.A1 ?? saved.a1AllowedTransitions ?? {})
    },
    A7: { ...defaults.A7, ...(saved.transitionMatrix?.A7 ?? {}) },
    A5: { ...defaults.A5, ...(saved.transitionMatrix?.A5 ?? {}) },
    A6: { ...defaults.A6, ...(saved.transitionMatrix?.A6 ?? {}) }
  })
  const offPolicy = ref<OffPolicy>(saved.offPolicy)

  const monthContext = computed(() => buildMonthContext(year.value, month.value))
  const quotaTotal = computed(() =>
    (Object.values(quotas.value) as number[]).reduce((a, b) => a + b, 0)
  )

  watch(
    [year, month, requiredWorking, quotas, transitionMatrix, offPolicy],
    () =>
      saveState<SettingsState>('settings', {
        year: year.value, month: month.value,
        requiredWorking: requiredWorking.value,
        quotas: { ...quotas.value },
        transitionMatrix: {
          A1: { ...transitionMatrix.value.A1 },
          A7: { ...transitionMatrix.value.A7 },
          A5: { ...transitionMatrix.value.A5 },
          A6: { ...transitionMatrix.value.A6 }
        },
        offPolicy: offPolicy.value
      }),
    { deep: true }
  )

  function setMonth(y: number, m: number) { year.value = y; month.value = m }

  return {
    year, month, requiredWorking, quotas, transitionMatrix, offPolicy,
    monthContext, quotaTotal, setMonth
  }
})