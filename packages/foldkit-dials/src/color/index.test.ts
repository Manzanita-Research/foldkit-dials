import { Array, Option } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  type Color,
  type Gamut,
  colorFromOklab,
  fitToFormat,
  fitToGamut,
  formatColor,
  isInGamut,
  maxChroma,
  oklabFromColor,
  rgbFromColor,
} from './index.js'
import { colorFormatOf, isColorString, parseColor } from './parse.js'

const PRECISION_DIGITS = 5

const parsed = (text: string): Color =>
  Option.getOrThrowWith(parseColor(text), () => new Error(text))

const gamuts: ReadonlyArray<Gamut> = ['Srgb', 'DisplayP3']

describe('color', () => {
  describe('parseColor', () => {
    it('matches the reference OKLCH for sRGB red', () => {
      const red = parsed('#ff0000')

      expect(red.lightness).toBeCloseTo(0.62795536, PRECISION_DIGITS)
      expect(red.chroma).toBeCloseTo(0.25768331, PRECISION_DIGITS)
      expect(red.hue).toBeCloseTo(29.233885, 3)
      expect(red.alpha).toBe(1)
    })

    it('reads OKLCH percentages, angle units, and negative hues', () => {
      expect(parsed('oklch(60% 50% -30deg / 25%)')).toEqual({
        lightness: 0.6,
        chroma: 0.2,
        hue: 330,
        alpha: 0.25,
      })
    })

    it.each([
      'rgb(255 0 0 / 50%)',
      'rgba(255, 0, 0, 0.5)',
      'hsl(1turn 100% 50% / .5)',
      'hsla(0, 100%, 50%, 0.5)',
      'rgb(100% 0% 0% / .5)',
      'RGB(255 0 0 / 50%)',
      '  #ff000080  ',
    ])('reads %s as half-transparent red', text => {
      expect(formatColor(parsed(text), 'Hex')).toBe('#ff000080')
    })

    it('reads transparent as black with no alpha', () => {
      expect(parsed('transparent')).toEqual({
        lightness: 0,
        chroma: 0,
        hue: 0,
        alpha: 0,
      })
    })

    it('reads Display P3 channels without clamping them to sRGB', () => {
      const wide = parsed('color(display-p3 1 0 0 / 0.5)')

      expect(isInGamut(wide, 'Srgb')).toBe(false)
      expect(isInGamut(wide, 'DisplayP3')).toBe(true)
      expect(wide.alpha).toBe(0.5)
    })

    it.each([
      '#12',
      '#12345',
      'oklch(NaN 0.2 40)',
      'oklch(1e999 .2 40)',
      'rgb(1 2)',
      'rgb(1 2 3 / / .5)',
      'rgb(1, 2 3)',
      'rgb(1,2,3,4,5)',
      'rgb(10%, 2, 3)',
      'oklch(1, .2, 40)',
      'hsl(120 50 50)',
      'oklch(0.5 0.1 40%)',
      'color(display-p3 1, 0, 0)',
      'color(srgb 1 0 0)',
      'color(display-p3 1 0 0) trailing',
      'var(--accent)',
      'red',
      '',
    ])('rejects %j', text => {
      expect(Option.isNone(parseColor(text))).toBe(true)
    })
  })

  describe('round trips', () => {
    it.each([
      '#ff0000',
      '#00ff00',
      '#0000ff',
      '#ffffff',
      '#000000',
      '#808080',
      '#1e82f080',
      '#abcdef00',
    ])('writes %s back unchanged', hex => {
      expect(formatColor(parsed(hex), 'Hex')).toBe(hex)
    })

    it('expands short hex, including its alpha digit', () => {
      expect(formatColor(parsed('#abc'), 'Hex')).toBe('#aabbcc')
      expect(formatColor(parsed('#f008'), 'Hex')).toBe('#ff000088')
    })

    it('keeps a wide-gamut colour through OKLCH text', () => {
      const wide = parsed('color(display-p3 1 0 0 / 0.5)')
      const roundTrip = parsed(formatColor(wide, 'Oklch'))

      expect(roundTrip.chroma).toBeCloseTo(wide.chroma, 4)
      expect(roundTrip.alpha).toBe(wide.alpha)
    })

    it('keeps Display P3 text exact', () => {
      const text = 'color(display-p3 1 0 0 / 0.5)'

      expect(formatColor(parsed(text), 'DisplayP3')).toBe(text)
    })

    it('converts through OKLab and back', () => {
      const color = parsed('oklch(0.7 0.15 250 / 0.4)')
      const roundTrip = colorFromOklab(oklabFromColor(color), color.alpha)

      expect(roundTrip.lightness).toBeCloseTo(color.lightness, 10)
      expect(roundTrip.chroma).toBeCloseTo(color.chroma, 10)
      expect(roundTrip.hue).toBeCloseTo(color.hue, 8)
    })

    it('treats a colour with no chroma as a neutral with hue 0', () => {
      expect(parsed('#808080')).toMatchObject({ chroma: 0, hue: 0 })
    })
  })

  describe('gamut mapping', () => {
    it('reduces chroma and keeps lightness, hue, and alpha', () => {
      const color = parsed('oklch(70% 0.35 145 / 40%)')
      const fitted = fitToGamut(color, 'Srgb')

      expect(fitted.chroma).toBeLessThan(color.chroma)
      expect(isInGamut(fitted, 'Srgb')).toBe(true)
      expect([fitted.lightness, fitted.hue, fitted.alpha]).toEqual([
        color.lightness,
        color.hue,
        color.alpha,
      ])
      expect(Array.every(rgbFromColor(fitted, 'Srgb'), Number.isFinite)).toBe(
        true,
      )
    })

    it('returns a colour already inside the gamut unchanged', () => {
      const color = parsed('#1e82f0')

      expect(fitToGamut(color, 'Srgb')).toBe(color)
    })

    it('leaves OKLCH unbounded and fits hex and Display P3 to their gamuts', () => {
      const color = parsed('oklch(0.7 0.35 145)')

      expect(fitToFormat(color, 'Oklch')).toBe(color)
      expect(isInGamut(fitToFormat(color, 'Hex'), 'Srgb')).toBe(true)
      expect(isInGamut(fitToFormat(color, 'DisplayP3'), 'DisplayP3')).toBe(true)
    })

    it.each(gamuts)(
      'fills the %s area with selectable colours up to the most chroma',
      gamut => {
        Array.forEach([0, 30, 90, 145, 220, 285], hue => {
          expect(maxChroma(0, hue, gamut)).toBe(0)
          expect(maxChroma(1, hue, gamut)).toBe(0)

          Array.forEach([0.05, 0.25, 0.5, 0.75, 0.95], lightness => {
            const most = maxChroma(lightness, hue, gamut)

            expect(most).toBeGreaterThan(0)
            expect(
              Array.every([0, 0.25, 0.5, 0.75, 1], saturation =>
                isInGamut(
                  { lightness, chroma: saturation * most, hue, alpha: 1 },
                  gamut,
                ),
              ),
            ).toBe(true)
            expect(
              isInGamut(
                { lightness, chroma: most + 0.00001, hue, alpha: 1 },
                gamut,
              ),
            ).toBe(false)
          })
        })
      },
    )

    it('allows more chroma in Display P3 than in sRGB', () => {
      const wide = parsed('color(display-p3 1 0 0)')

      expect(maxChroma(wide.lightness, wide.hue, 'DisplayP3')).toBeGreaterThan(
        maxChroma(wide.lightness, wide.hue, 'Srgb'),
      )
      expect(maxChroma(wide.lightness, wide.hue, 'DisplayP3')).toBeCloseTo(
        wide.chroma,
        PRECISION_DIGITS,
      )
    })
  })

  describe('formatColor', () => {
    const color = parsed('oklch(0.62796 0.25768 29.2339 / 0.5)')

    it('writes OKLCH with four decimals and a two-decimal hue', () => {
      expect(formatColor(color, 'Oklch')).toBe(
        'oklch(0.628 0.2577 29.23 / 0.5)',
      )
    })

    it('writes hex with an alpha byte only below full opacity', () => {
      expect(formatColor(color, 'Hex')).toBe('#ff000080')
      expect(formatColor({ ...color, alpha: 1 }, 'Hex')).toBe('#ff0000')
    })

    it('writes Display P3 with five decimals', () => {
      expect(formatColor(parsed('#ff0000'), 'DisplayP3')).toBe(
        'color(display-p3 0.91749 0.20029 0.13856)',
      )
    })

    it('maps a wide colour into sRGB by chroma before writing hex', () => {
      const wide = parsed('color(display-p3 0 1 0)')
      const written = parsed(formatColor(wide, 'Hex'))

      expect(written.chroma).toBeLessThan(wide.chroma)
      expect(written.lightness).toBeCloseTo(wide.lightness, 2)
      expect(written.hue).toBeCloseTo(wide.hue, 0)
    })
  })

  describe('colorFormatOf', () => {
    it.each([
      ['oklch(0.7 0.1 40)', 'Oklch'],
      ['color(display-p3 1 0 0)', 'DisplayP3'],
      ['#a78bfa', 'Hex'],
      ['rgb(255 0 0)', 'Hex'],
      ['hsl(0 100% 50%)', 'Hex'],
    ] as const)('continues %s as %s', (text, format) => {
      expect(colorFormatOf(text)).toBe(format)
    })
  })

  describe('isColorString', () => {
    it('accepts the colour forms a dial detects', () => {
      expect(
        Array.every(
          ['#a78bfa', 'oklch(0.7 0.2 145 / 0.8)', 'transparent'],
          isColorString,
        ),
      ).toBe(true)
      expect(isColorString('not a colour')).toBe(false)
    })

    it('rejects text the picker cannot read', () => {
      expect(isColorString('rgb(1 2)')).toBe(false)
      expect(isColorString('oklab(0.5 0.1 0.1)')).toBe(false)
    })
  })
})
