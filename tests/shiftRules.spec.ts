// tests/shiftRules.spec.ts
import { describe, expect, it } from 'vitest'
import { isTransitionAllowed, transitionViolation } from '@/services/shiftRules'

describe('shift transition rules', () => {
  it('allows the documented transitions', () => {
    expect(isTransitionAllowed('A1', 'A7')).toBe(true)
    expect(isTransitionAllowed('A7', 'A1')).toBe(true)
    expect(isTransitionAllowed('A7', 'A5')).toBe(true)
    expect(isTransitionAllowed('A5', 'A7')).toBe(true)
    expect(isTransitionAllowed('A5', 'A6')).toBe(true)
  })
  it('forbids the documented transitions', () => {
    expect(isTransitionAllowed('A1', 'A5')).toBe(false)
    expect(isTransitionAllowed('A1', 'A6')).toBe(false)
    expect(isTransitionAllowed('A6', 'A1')).toBe(false)
    expect(isTransitionAllowed('A6', 'A7')).toBe(false)
  })
  it('treats A6 → A5 as needing rest', () => {
    expect(transitionViolation('A6', 'A5')).toBe('A6_NO_REST')
    expect(isTransitionAllowed('A6', 'OFF')).toBe(true)
    expect(isTransitionAllowed('OFF', 'A5')).toBe(true)
  })
})