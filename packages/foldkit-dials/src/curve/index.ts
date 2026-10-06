import { Array, Number, pipe } from 'effect'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { Transition, sampleCurve, springParams } from '../transition/index.js'

// GEOMETRY

/** The width of the curve's SVG viewBox, matching DialKit's spring
 *  visualization. */
export const VIEW_BOX_WIDTH = 256

/** The height of the curve's SVG viewBox. */
export const VIEW_BOX_HEIGHT = 140

const GRID_DIVISIONS = 4
const CURVE_BAND_BOTTOM = 0.2
const CURVE_BAND_HEIGHT = 0.6
const COORDINATE_PRECISION = 2
const SAMPLE_COUNT = 101

/** One point of a transition's progress curve, as `sampleCurve` returns. */
export type Sample = Readonly<{ time: number; progress: number }>

const progressToY = (
  samples: ReadonlyArray<Sample>,
): ((progress: number) => number) => {
  const progresses = Array.map(samples, ({ progress }) => progress)
  const lowest = Math.min(...progresses)
  const highest = Math.max(...progresses)
  const span = highest > lowest ? highest - lowest : 1

  return progress =>
    Number.round(
      VIEW_BOX_HEIGHT -
        (((progress - lowest) / span) * CURVE_BAND_HEIGHT + CURVE_BAND_BOTTOM) *
          VIEW_BOX_HEIGHT,
      COORDINATE_PRECISION,
    )
}

/** Builds the SVG path for evenly spaced samples across the viewBox width.
 *  As in DialKit, the lowest and highest progress fill the middle 60% of the
 *  height, so overshoot and undershoot always fit. */
export const curvePath = (samples: ReadonlyArray<Sample>): string => {
  const toY = progressToY(samples)
  const lastIndex = Math.max(1, samples.length - 1)

  return pipe(
    samples,
    Array.map(({ progress }, index) => {
      const command = index === 0 ? 'M' : 'L'
      const x = Number.round(
        (index / lastIndex) * VIEW_BOX_WIDTH,
        COORDINATE_PRECISION,
      )
      return `${command} ${x} ${toY(progress)}`
    }),
    Array.join(' '),
  )
}

/** The y coordinate of progress 1, where the dashed target line sits, on the
 *  same scale as `curvePath`. */
export const targetLineY = (samples: ReadonlyArray<Sample>): number =>
  progressToY(samples)(1)

// VIEW

const GRID_STROKE = 'var(--dial-surface-active)'
const TARGET_STROKE = 'var(--dial-border-hover)'
const CURVE_STROKE = 'var(--dial-text-label)'
const TARGET_DASH = '4,4'
const CURVE_STROKE_WIDTH = '2'

// NOTE: a TimeSpring's duration is its visual duration, which ends near its
// first overshoot. Sampling the equivalent physics spring runs the curve
// until it settles, so the bounce back to the target shows.
const samplesForDrawing = (transition: Transition): ReadonlyArray<Sample> =>
  sampleCurve(
    Transition.match<Transition>(transition, {
      TimeSpring: spring => Transition.PhysicsSpring(springParams(spring)),
      PhysicsSpring: spring => spring,
      Easing: easing => easing,
    }),
    SAMPLE_COUNT,
  )

const defaultAriaLabel = (transition: Transition): string =>
  Transition.match<string>(transition, {
    TimeSpring: () => 'Spring response curve',
    PhysicsSpring: () => 'Spring response curve',
    Easing: () => 'Easing curve',
  })

/** Configuration for rendering a transition curve with {@link view}. */
export type ViewConfig<Message> = Readonly<{
  transition: Transition
  /** The image's accessible name. Defaults to "Spring response curve" for
   *  springs and "Easing curve" for easings. */
  ariaLabel?: string
  /** More attributes for the `svg` element, such as DialKit's
   *  `dialkit-spring-viz` class. */
  attributes?: ReadonlyArray<Attribute<Message>>
}>

/** Draws a transition's progress over time the way DialKit's spring
 *  visualization does: an SVG image with a 4 by 4 grid, a dashed line at the
 *  target, and the sampled curve. Strokes use DialKit's theme variables, so
 *  `.dialkit-spring-viz` styles apply. */
export const view = <Message>(
  config: ViewConfig<Message>,
  h: HtmlBuilder<Message>,
): Html => {
  const samples = samplesForDrawing(config.transition)
  const targetY = `${targetLineY(samples)}`

  const gridLines = Array.flatMap(Array.range(1, GRID_DIVISIONS - 1), index => {
    const x = `${(index / GRID_DIVISIONS) * VIEW_BOX_WIDTH}`
    const y = `${(index / GRID_DIVISIONS) * VIEW_BOX_HEIGHT}`
    return [
      h.line([
        h.X1(x),
        h.Y1('0'),
        h.X2(x),
        h.Y2(`${VIEW_BOX_HEIGHT}`),
        h.Stroke(GRID_STROKE),
      ]),
      h.line([
        h.X1('0'),
        h.Y1(y),
        h.X2(`${VIEW_BOX_WIDTH}`),
        h.Y2(y),
        h.Stroke(GRID_STROKE),
      ]),
    ]
  })

  return h.svg(
    [
      h.ViewBox(`0 0 ${VIEW_BOX_WIDTH} ${VIEW_BOX_HEIGHT}`),
      h.Role('img'),
      h.AriaLabel(config.ariaLabel ?? defaultAriaLabel(config.transition)),
      ...(config.attributes ?? []),
    ],
    [
      ...gridLines,
      h.line([
        h.X1('0'),
        h.Y1(targetY),
        h.X2(`${VIEW_BOX_WIDTH}`),
        h.Y2(targetY),
        h.Stroke(TARGET_STROKE),
        h.StrokeDasharray(TARGET_DASH),
      ]),
      h.path([
        h.D(curvePath(samples)),
        h.Fill('none'),
        h.Stroke(CURVE_STROKE),
        h.StrokeWidth(CURVE_STROKE_WIDTH),
        h.StrokeLinecap('round'),
        h.StrokeLinejoin('round'),
      ]),
    ],
  )
}
