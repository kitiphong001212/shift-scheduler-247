// src/utils/date.ts
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}
export function toISO(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}
export function monthKeyOf(year: number, month: number): string {
  return `${year}-${pad2(month)}`
}
export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`
}
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay()
}
export function todayISO(): string {
  const d = new Date()
  return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate())
}
export function cellKey(employeeId: string, date: string): string {
  return `${employeeId}|${date}`
}
export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}
/** Deterministic PRNG so "Regenerate" can reproduce / vary by seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}