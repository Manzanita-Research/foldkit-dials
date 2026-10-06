import { Array, Number, Option, String, pipe } from 'effect'
import { type Update } from 'foldkit'
import { type HtmlBuilder, inertHtml as ih } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import * as Scene from 'foldkit/scene'
import { describe, expect, it } from 'vitest'

import { Transition, sampleCurve } from '../transition/index.js'
import { type ViewConfig, curvePath, targetLineY, view } from './index.js'

const Message = defineMessageUnion({
  Ignored: {},
})
type Message = typeof Message.Type

type Model = Readonly<Record<string, never>>

const update = (model: Model): Update.Return<Model, Message> => ({ model })

const easing = Transition.Easing({ duration: 0.3, ease: [1, -0.4, 0.5, 1] })
const bouncySpring = Transition.TimeSpring({ visualDuration: 0.3, bounce: 0.5 })

const testView =
  (config: ViewConfig<Message>) => (_model: Model, h: HtmlBuilder<Message>) =>
    view(config, h)

const svg = Scene.role('img')
const curve = Scene.selector('path')
const targetLine = Scene.selector('line[stroke-dasharray]')

const pathYCoordinates = (path: string): ReadonlyArray<number> =>
  pipe(
    path,
    String.split(' '),
    Array.chunksOf(3),
    Array.map(([, , y]) => Option.getOrThrow(Number.parse(y ?? ''))),
  )

describe('curve view', () => {
  describe('rendering', () => {
    it('renders a labeled image in DialKit’s 256 by 140 viewBox', () => {
      Scene.scene(
        { update, view: testView({ transition: bouncySpring }) },
        Scene.given({}),
        Scene.expect(svg).toHaveAttr('viewBox', '0 0 256 140'),
        Scene.expect(svg).toHaveAttr('aria-label', 'Spring response curve'),
      )
    })

    it('names an easing curve', () => {
      Scene.scene(
        { update, view: testView({ transition: easing }) },
        Scene.given({}),
        Scene.expect(svg).toHaveAttr('aria-label', 'Easing curve'),
      )
    })

    it('accepts a custom name and more svg attributes', () => {
      Scene.scene(
        {
          update,
          view: testView({
            transition: easing,
            ariaLabel: 'Hover curve',
            attributes: [ih.Class('dialkit-spring-viz')],
          }),
        },
        Scene.given({}),
        Scene.expect(svg).toHaveAttr('aria-label', 'Hover curve'),
        Scene.expect(Scene.selector('svg.dialkit-spring-viz')).toExist(),
      )
    })

    it('draws a 4 by 4 grid and one dashed target line', () => {
      Scene.scene(
        { update, view: testView({ transition: easing }) },
        Scene.given({}),
        Scene.expectAll(
          Scene.all.selector('line:not([stroke-dasharray])'),
        ).toHaveCount(6),
        Scene.expectAll(
          Scene.all.selector('line[stroke-dasharray]'),
        ).toHaveCount(1),
        Scene.expect(targetLine).toHaveAttr('stroke-dasharray', '4,4'),
      )
    })
  })

  describe('easing', () => {
    it('draws the sampled easing with the target line at progress 1', () => {
      const samples = sampleCurve(easing, 101)

      Scene.scene(
        { update, view: testView({ transition: easing }) },
        Scene.given({}),
        Scene.expect(curve).toHaveAttr('d', curvePath(samples)),
        Scene.expect(targetLine).toHaveAttr('y1', `${targetLineY(samples)}`),
      )
    })
  })

  describe('spring', () => {
    it('draws a bouncy time spring through its overshoot until it settles on the target', () => {
      Scene.scene(
        { update, view: testView({ transition: bouncySpring }) },
        Scene.given({}),
        Scene.tap(({ html }) => {
          const attributeOf = (selector: string, name: string): string =>
            pipe(
              Scene.find(html, selector),
              Option.flatMap(Scene.attr(name)),
              Option.getOrThrow,
            )
          const targetY = globalThis.Number(
            attributeOf('line[stroke-dasharray]', 'y1'),
          )
          const curveYs = pathYCoordinates(attributeOf('path', 'd'))

          expect(Array.last(curveYs)).toEqual(Option.some(targetY))
          expect(Math.min(...curveYs)).toBeLessThan(targetY)
        }),
      )
    })
  })
})
