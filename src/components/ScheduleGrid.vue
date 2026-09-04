<!-- src/components/ScheduleGrid.vue -->
<script setup lang="ts">
import type { Employee } from '@/types/employee'
import type { MonthContext, ScheduleEntry, ShiftAssignmentMap } from '@/types/schedule'
import type { Conflict } from '@/types/conflict'
import { cellKey } from '@/utils/date'
import ScheduleCell from './ScheduleCell.vue'
import DayHeader from './DayHeader.vue'

defineProps<{
  employees: Employee[]
  month: MonthContext
  cellMap: Record<string, ScheduleEntry>
  assignments: ShiftAssignmentMap
  conflictsByCell: Record<string, Conflict[]>
  conflictsByDate: Record<string, Conflict[]>
}>()

defineEmits<{ editCell: [employeeId: string, date: string] }>()
</script>

<template>
  <div class="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
    <table class="border-separate border-spacing-0">
      <thead>
        <tr>
          <th class="sticky left-0 top-0 z-30 min-w-[190px] border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-500">
            Employee
          </th>
          <th
            v-for="d in month.days" :key="d.date"
            class="sticky top-0 z-20 min-w-[44px] border-b border-slate-200 px-1 py-1"
            :class="d.isWeekend ? 'bg-amber-50' : 'bg-slate-50'"
          >
            <DayHeader :day="d" :conflicts="conflictsByDate[d.date] ?? []" />
          </th>
        </tr>
      </thead>

      <tbody>
        <tr v-for="emp in employees" :key="emp.id" class="hover:bg-slate-50/60">
          <td class="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-3 py-1">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate text-xs font-medium text-slate-800">{{ emp.name }}</p>
                <p class="text-[10px] text-slate-400">{{ emp.code }}</p>
              </div>
              <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                {{ assignments[emp.id] ?? emp.defaultShift }}
              </span>
            </div>
          </td>

          <td
            v-for="d in month.days" :key="d.date"
            class="border-b border-slate-100 p-0.5"
            :class="d.isWeekend ? 'bg-amber-50/50' : ''"
          >
            <ScheduleCell
              :entry="cellMap[cellKey(emp.id, d.date)]"
              :conflicts="conflictsByCell[cellKey(emp.id, d.date)] ?? []"
              :weekend="d.isWeekend"
              @select="$emit('editCell', emp.id, d.date)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>