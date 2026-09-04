// src/types/leave.ts
export type LeaveType = 'OFF' | 'AL'

export interface LeaveRequest {
  id: string
  employeeId: string
  date: string      // YYYY-MM-DD
  type: LeaveType
  note?: string
}