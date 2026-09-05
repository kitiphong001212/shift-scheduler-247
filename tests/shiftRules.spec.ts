// tests/shiftRules.spec.ts
import { describe, expect, it } from 'vitest'
import {
  canWorkShift, cloneDefaultTransitionMatrix, isTransitionAllowed,
  LAST_RESORT_COVER_FOR, SHIFT_CODES, TRANSITION_MATRIX, transitionViolation
} from '@/services/shiftRules'

describe('shift transition rules', () => {
  it('matches the documented allow matrix', () => {
    expect(TRANSITION_MATRIX.A1).toEqual({ A1: true, A7: true, A5: true, A6: false })
    expect(TRANSITION_MATRIX.A7).toEqual({ A1: true, A7: true, A5: true, A6: false })
    expect(TRANSITION_MATRIX.A5).toEqual({ A1: false, A7: false, A5: true, A6: true })
    expect(TRANSITION_MATRIX.A6).toEqual({ A1: false, A7: false, A5: false, A6: true })
  })

  it('allows day-to-day transitions from the matrix', () => {
    expect(isTransitionAllowed('A1', 'A1')).toBe(true)
    expect(isTransitionAllowed('A1', 'A7')).toBe(true)
    expect(isTransitionAllowed('A1', 'A5')).toBe(true)
    expect(isTransitionAllowed('A7', 'A1')).toBe(true)
    expect(isTransitionAllowed('A7', 'A7')).toBe(true)
    expect(isTransitionAllowed('A7', 'A5')).toBe(true)
    expect(isTransitionAllowed('A5', 'A5')).toBe(true)
    expect(isTransitionAllowed('A5', 'A6')).toBe(true)
    expect(isTransitionAllowed('A6', 'A6')).toBe(true)
  })

  it('uses configured next shifts for every source shift', () => {
    const configured = cloneDefaultTransitionMatrix()
    configured.A1.A7 = false
    configured.A7.A5 = false
    configured.A5.A1 = true

    expect(isTransitionAllowed('A1', 'A7', configured)).toBe(false)
    expect(isTransitionAllowed('A7', 'A5', configured)).toBe(false)
    expect(isTransitionAllowed('A5', 'A1', configured)).toBe(true)
    expect(transitionViolation('A7', 'A5', configured)).toBe('FORBIDDEN')

    // Hard rest cannot be bypassed through configuration.
    configured.A6.A5 = true
    expect(isTransitionAllowed('A6', 'A5', configured)).toBe(false)
    expect(transitionViolation('A6', 'A5', configured)).toBe('A6_NO_REST')
  })

  it('forbids blocked transitions', () => {
    expect(isTransitionAllowed('A1', 'A6')).toBe(false)
    expect(isTransitionAllowed('A7', 'A6')).toBe(false)
    expect(isTransitionAllowed('A5', 'A1')).toBe(false)
    expect(isTransitionAllowed('A5', 'A7')).toBe(false)
    expect(isTransitionAllowed('A6', 'A1')).toBe(false)
    expect(isTransitionAllowed('A6', 'A7')).toBe(false)
  })

  it('treats A6 → A5 as needing at least one OFF/AL day', () => {
    expect(transitionViolation('A6', 'A5')).toBe('A6_NO_REST')
    expect(isTransitionAllowed('A6', 'A5')).toBe(false)
    expect(isTransitionAllowed('A6', 'OFF')).toBe(true)
    expect(isTransitionAllowed('OFF', 'A5')).toBe(true)
    expect(isTransitionAllowed('A6', 'AL')).toBe(true)
    expect(isTransitionAllowed('AL', 'A5')).toBe(true)
  })

  it('covers every shift pair explicitly', () => {
    for (const from of SHIFT_CODES) {
      for (const to of SHIFT_CODES) {
        const allowed = TRANSITION_MATRIX[from][to]
        if (from === 'A6' && to === 'A5') {
          expect(transitionViolation(from, to)).toBe('A6_NO_REST')
        } else if (allowed) {
          expect(isTransitionAllowed(from, to)).toBe(true)
        } else {
          expect(isTransitionAllowed(from, to)).toBe(false)
          expect(transitionViolation(from, to)).toBe('FORBIDDEN')
        }
      }
    }
  })

  it('documents A5 → A6 as allowed (including last-resort A6 cover)', () => {
    expect(TRANSITION_MATRIX.A5.A6).toBe(true)
    expect(LAST_RESORT_COVER_FOR.A6).toBe('A5')
    expect(isTransitionAllowed('A5', 'A6')).toBe(true)
  })

  it('restricts monthly home groups to eligible shifts only', () => {
    expect(canWorkShift('A5', 'A5')).toBe(true)
    expect(canWorkShift('A5', 'A6')).toBe(true)
    expect(canWorkShift('A5', 'A1')).toBe(false)
    expect(canWorkShift('A5', 'A7')).toBe(false)
    expect(canWorkShift('A1', 'A1')).toBe(true)
    expect(canWorkShift('A1', 'A7')).toBe(true)
    expect(canWorkShift('A1', 'A5')).toBe(true)
    expect(canWorkShift('A1', 'A6')).toBe(false)
    expect(canWorkShift('A7', 'A6')).toBe(false)
    expect(canWorkShift('A6', 'A6')).toBe(true)
    expect(canWorkShift('A6', 'A5')).toBe(true)
    expect(canWorkShift('A6', 'A1')).toBe(false)
    // OFF resets day-to-day transition, but home-group rule still forbids illegal shifts
    expect(isTransitionAllowed('OFF', 'A1')).toBe(true)
    expect(canWorkShift('A5', 'A1')).toBe(false)
    expect(isTransitionAllowed('OFF', 'A6')).toBe(true)
    expect(canWorkShift('A7', 'A6')).toBe(false)
  })
})
