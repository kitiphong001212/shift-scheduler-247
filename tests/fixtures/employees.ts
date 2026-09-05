import type { Employee, ShiftCode } from '@/types/employee'

const DISTRIBUTION: ShiftCode[] = [
  'A1', 'A1', 'A1', 'A1', 'A1',
  'A7', 'A7', 'A7',
  'A5', 'A5', 'A5', 'A5',
  'A6', 'A6', 'A6'
]

export function createTestEmployees(): Employee[] {
  return DISTRIBUTION.map((defaultShift, index) => {
    const suffix = String(index + 1).padStart(2, '0')
    const id = `EMP0${suffix}`
    return { id, code: id, name: `Employee ${suffix}`, active: true, defaultShift }
  })
}
