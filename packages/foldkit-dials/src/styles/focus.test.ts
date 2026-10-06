import { Array, String } from 'effect'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const FOCUS_RING = 'var(--dial-focus-ring)'

const styleRules: ReadonlyArray<CSSStyleRule> = (() => {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(
    readFileSync(resolve(import.meta.dirname, 'dials.css'), 'utf8'),
  )
  return Array.filter(
    globalThis.Array.from(sheet.cssRules),
    (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule,
  )
})()

const rulesMatching = (selector: string): ReadonlyArray<CSSStyleRule> =>
  Array.filter(styleRules, ({ selectorText }) =>
    String.includes(selector)(selectorText),
  )

const hasOutlineRing = (rule: CSSStyleRule): boolean =>
  rule.style.getPropertyValue('outline-color') === FOCUS_RING

const hasInsetRing = (rule: CSSStyleRule): boolean =>
  String.includes(FOCUS_RING)(rule.style.getPropertyValue('box-shadow'))

describe('dials.css focus styles', () => {
  it.each([
    ['the DialPad thumb', '.dialkit-pad-point:focus-visible'],
    ['the image Upload control', '.dialkit-image-upload:focus-within'],
    ['the dock resize handle', '.dialkit-timeline-resize-handle:focus-visible'],
  ])('rings %s with the focus colour', (_name, selector) => {
    expect(Array.some(rulesMatching(selector), hasOutlineRing)).toBe(true)
  })

  it('underlines the colour CSS input like the other text fields', () => {
    const focusVisibleRules = Array.filter(
      rulesMatching('.dialkit-color-css-input'),
      ({ selectorText }) => String.includes(':focus-visible')(selectorText),
    )

    expect(Array.some(focusVisibleRules, hasInsetRing)).toBe(true)
    expect(
      Array.some(
        focusVisibleRules,
        rule => rule.style.getPropertyValue('outline-style') === 'none',
      ),
    ).toBe(false)
  })
})
