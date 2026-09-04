export type LeaveType = 'OFF' | 'AL'

export interface LeaveRequest {
  id: string
  employeeId: string
  date: string      // YYYY-MM-DD
  type: LeaveType
  note?: string
  requestedAt?: string  // ISO timestamp — earlier requests win OFF quota
}
