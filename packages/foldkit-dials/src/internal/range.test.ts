import { describe, expect, it } from 'vitest'

import { snapAndClamp, stepDecimals } from './range.js'

describe('range', () => {
  it('snaps from the minimum and keeps the minimum precision', () => {
    expect(snapAndClamp(0.26, 0.05, 1, 0.1)).toBe(0.25)
  })

  it('clamps to the range', () => {
    expect(snapAndClamp(99, 0, 48, 1)).toBe(48)
    expect(snapAndClamp(-3, 0, 48, 1)).toBe(0)
  })

  it('counts decimals for steps written in exponent form', () => {
    expect(stepDecimals(1e-7)).toBe(7)
    expect(stepDecimals(0.01)).toBe(2)
    expect(stepDecimals(10)).toBe(0)
  })
})
