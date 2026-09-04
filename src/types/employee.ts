// src/types/employee.ts
export type ShiftCode = 'A1' | 'A7' | 'A5' | 'A6'
export type LeaveCode = 'OFF' | 'AL'
export type CellStatus = ShiftCode | LeaveCode

export interface Employee {
  id: string
  code: string
  name: string
  active: boolean
  defaultShift: ShiftCode
}

export interface ShiftDefinition {
  code: ShiftCode
  start: string
  end: string
  dailyQuota: number
}