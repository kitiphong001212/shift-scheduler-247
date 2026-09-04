// src/services/calendar.ts
import type { DayInfo, MonthContext } from '@/types/schedule'
import { WEEKDAY_LABELS, daysInMonth, monthKeyOf, monthLabel, toISO, weekdayOf } from '@/utils/date'

export function buildMonthContext(year: number, month: number): MonthContext {
  const total = daysInMonth(year, month)
  const days: DayInfo[] = []
  let saturdayCount = 0
  let sundayCount = 0

  for (let d = 1; d <= total; d++) {
    const weekday = weekdayOf(year, month, d)
    if (weekday === 6) saturdayCount++
    if (weekday === 0) sundayCount++
    days.push({
      date: toISO(year, month, d),
      day: d,
      weekday,
      weekdayLabel: WEEKDAY_LABELS[weekday],
      isWeekend: weekday === 0 || weekday === 6
    })
  }

  const weekendCount = saturdayCount + sundayCount
  return {
    year, month,
    monthKey: monthKeyOf(year, month),
    label: monthLabel(year, month),
    days, saturdayCount, sundayCount, weekendCount,
    offTarget: weekendCount
  }
}