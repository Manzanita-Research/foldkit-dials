import { describe, expect, it } from 'vitest'

import { curvePath, targetLineY } from './index.js'

const samplesOf = (...progresses: ReadonlyArray<number>) =>
  progresses.map((progress, index) => ({ time: index, progress }))

describe('curve', () => {
  describe('curvePath', () => {
    it('spreads samples across the width and fits 0 to 1 into the middle 60% of the height', () => {
      const samples = samplesOf(0, 0.5, 1)

      expect(curvePath(samples)).toBe('M 0 112 L 128 70 L 256 28')
      expect(targetLineY(samples)).toBe(28)
    })

    it('fits spring overshoot into the band and drops the target line below the peak', () => {
      const samples = samplesOf(0, 1.25, 1)

      expect(curvePath(samples)).toBe('M 0 112 L 128 28 L 256 44.8')
      expect(targetLineY(samples)).toBe(44.8)
    })

    it('fits easing undershoot into the band and lifts the start above the bottom', () => {
      const samples = samplesOf(0, -0.25, 1)

      expect(curvePath(samples)).toBe('M 0 95.2 L 128 112 L 256 28')
      expect(targetLineY(samples)).toBe(28)
    })

    it('draws a flat curve at the bottom of the band', () => {
      expect(curvePath(samplesOf(1, 1))).toBe('M 0 112 L 256 112')
    })
  })
})
