import { Array, Match, Number, Schema, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { clamp } from '../internal/range.js'

// MODEL

/** A cubic Bézier easing curve as `[x1, y1, x2, y2]`, the same four numbers
 *  CSS `cubic-bezier()` takes. */
export const CubicBezier = Schema.Tuple([
  Schema.Number,
  Schema.Number,
  Schema.Number,
  Schema.Number,
])
export type CubicBezier = typeof CubicBezier.Type

/** A tunable transition. `TimeSpring` is Motion's duration-and-bounce spring,
 *  `PhysicsSpring` is a stiffness, damping, and mass spring, and `Easing` is a
 *  duration with a cubic Bézier curve. The transition editor switches between
 *  the three, so a transition dial's value is always this whole union. */
export const Transition = defineTaggedUnion({
  TimeSpring: { visualDuration: Schema.Number, bounce: Schema.Number },
  PhysicsSpring: {
    stiffness: Schema.Number,
    damping: Schema.Number,
    mass: Schema.Number,
  },
  Easing: { duration: Schema.Number, ease: CubicBezier },
})
export type Transition = typeof Transition.Type

/** Whether an unknown value, such as a stored dial value, is a
 *  `Transition`. */
export const isTransition = Schema.is(Transition)

/** The tag of each `Transition` variant, in editor order. */
export const TransitionMode = Schema.Literals([
  'Easing',
  'TimeSpring',
  'PhysicsSpring',
])
export type TransitionMode = typeof TransitionMode.Type

/** Stiffness, damping, and mass for a spring simulation. */
export type SpringParams = Readonly<{
  stiffness: number
  damping: number
  mass: number
}>

// CONSTANTS

const MIN_VISUAL_DURATION_SECONDS = 0.05
const VISUAL_DURATION_TO_PERIOD = 1.2
const MIN_DAMPING_RATIO_FACTOR = 0.05
const SETTLE_TOLERANCE = 0.005
const SETTLE_TOLERANCE_LOG = Math.log(1 / SETTLE_TOLERANCE)
const MIN_DECAY_RATE = 1e-6
const MIN_SETTLE_SECONDS = 0.05
const MAX_SETTLE_SECONDS = 10
const SETTLE_DECIMALS = 2
const CRITICAL_DAMPING_LOW = 0.9999
const CRITICAL_DAMPING_HIGH = 1.0001
const NEWTON_ITERATIONS = 8
const NEWTON_TOLERANCE = 1e-5
const NEWTON_MIN_SLOPE = 1e-6
const BISECTION_TOLERANCE = 1e-5
const CSS_SPRING_SAMPLES = 40
const CSS_SPRING_DECIMALS = 4
const REST_SEARCH_STEPS = 40

/** The spring editor's default easing, matching DialKit. */
export const DEFAULT_EASING = Transition.Easing({
  duration: 0.3,
  ease: [1, -0.4, 0.5, 1],
})

/** The spring editor's default time spring, matching DialKit. */
export const DEFAULT_TIME_SPRING = Transition.TimeSpring({
  visualDuration: 0.3,
  bounce: 0.2,
})

/** The spring editor's default physics spring, matching DialKit. */
export const DEFAULT_PHYSICS_SPRING = Transition.PhysicsSpring({
  stiffness: 200,
  damping: 25,
  mass: 1,
})

/** The spring editor's default for a mode, matching DialKit. */
export const defaultTransitionForMode = (mode: TransitionMode): Transition =>
  Match.value(mode).pipe(
    Match.withReturnType<Transition>(),
    Match.when('Easing', () => DEFAULT_EASING),
    Match.when('TimeSpring', () => DEFAULT_TIME_SPRING),
    Match.when('PhysicsSpring', () => DEFAULT_PHYSICS_SPRING),
    Match.exhaustive,
  )

// SPRING MATH

/** Converts a time spring to physics parameters with Motion's mapping, so a
 *  tuned spring matches what Motion plays. A physics spring passes through. */
export const springParams = (
  spring: Extract<Transition, { _tag: 'TimeSpring' | 'PhysicsSpring' }>,
): SpringParams =>
  Match.value(spring).pipe(
    Match.withReturnType<SpringParams>(),
    Match.tagsExhaustive({
      PhysicsSpring: ({ stiffness, damping, mass }) => ({
        stiffness,
        damping,
        mass,
      }),
      TimeSpring: ({ visualDuration, bounce }) => {
        const root =
          (2 * Math.PI) /
          (Math.max(MIN_VISUAL_DURATION_SECONDS, visualDuration) *
            VISUAL_DURATION_TO_PERIOD)
        const stiffness = root * root
        const damping =
          2 *
          clamp(1 - bounce, MIN_DAMPING_RATIO_FACTOR, 1) *
          Math.sqrt(stiffness)
        return { stiffness, damping, mass: 1 }
      },
    }),
  )

/** Normalized spring position (0 to 1, may overshoot) `seconds` after a
 *  spring at rest is released toward 1. Closed-form damped oscillator. */
export const springProgress = (
  seconds: number,
  { stiffness, damping, mass }: SpringParams,
): number => {
  if (seconds <= 0) {
    return 0
  }

  const naturalFrequency = Math.sqrt(stiffness / mass)
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass))

  if (dampingRatio < CRITICAL_DAMPING_LOW) {
    const dampedFrequency =
      naturalFrequency * Math.sqrt(1 - dampingRatio * dampingRatio)
    return (
      1 -
      Math.exp(-dampingRatio * naturalFrequency * seconds) *
        (Math.cos(dampedFrequency * seconds) +
          ((dampingRatio * naturalFrequency) / dampedFrequency) *
            Math.sin(dampedFrequency * seconds))
    )
  } else if (dampingRatio < CRITICAL_DAMPING_HIGH) {
    return (
      1 -
      Math.exp(-naturalFrequency * seconds) * (1 + naturalFrequency * seconds)
    )
  } else {
    const overdampedFrequency =
      naturalFrequency * Math.sqrt(dampingRatio * dampingRatio - 1)
    const slowRoot = -dampingRatio * naturalFrequency + overdampedFrequency
    const fastRoot = -dampingRatio * naturalFrequency - overdampedFrequency
    return (
      1 +
      (fastRoot * Math.exp(slowRoot * seconds) -
        slowRoot * Math.exp(fastRoot * seconds)) /
        (slowRoot - fastRoot)
    )
  }
}

/** Seconds until a spring's decay envelope falls to 0.5% of the distance to
 *  its target, clamped to between 0.05 and 10 seconds and rounded to
 *  hundredths. It ignores the factor in front of the decay, so a spring can
 *  still be short of its target at that time: up to about 3.3% with no
 *  bounce, where damping is critical, and about 0.9% for the default time
 *  spring. This is DialKit's formula; the timeline sizes physics-spring bars
 *  and snaps `progressAt` with it. For a curve that must end at rest, use
 *  {@link springRestDuration}. */
export const springSettleDuration = ({
  stiffness,
  damping,
  mass,
}: SpringParams): number => {
  const naturalFrequency = Math.sqrt(stiffness / mass)
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass))
  const decayRate =
    dampingRatio >= 1
      ? dampingRatio * naturalFrequency -
        naturalFrequency *
          Math.sqrt(Math.max(0, dampingRatio * dampingRatio - 1))
      : dampingRatio * naturalFrequency
  const seconds = SETTLE_TOLERANCE_LOG / Math.max(decayRate, MIN_DECAY_RATE)
  return Number.round(
    clamp(seconds, MIN_SETTLE_SECONDS, MAX_SETTLE_SECONDS),
    SETTLE_DECIMALS,
  )
}

const isAwayFromRest =
  (params: SpringParams) =>
  (seconds: number): boolean =>
    Math.abs(1 - springProgress(seconds, params)) > SETTLE_TOLERANCE

type SearchWindow = Readonly<{ low: number; high: number }>

// NOTE: an underdamped spring's distance from its target peaks only at
// multiples of half its damped period, where the peak is its decay envelope.
// The search starts at the last peak still beyond the tolerance, so within
// the window the spring is away from rest until one moment and at rest after
// it. Critical and overdamped springs approach their target without
// overshoot, so the whole range is such a window.
const restSearchWindow = ({
  stiffness,
  damping,
  mass,
}: SpringParams): SearchWindow => {
  const naturalFrequency = Math.sqrt(stiffness / mass)
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass))
  const decayRate = dampingRatio * naturalFrequency

  if (dampingRatio < CRITICAL_DAMPING_LOW && decayRate > MIN_DECAY_RATE) {
    const halfPeriod =
      Math.PI / (naturalFrequency * Math.sqrt(1 - dampingRatio * dampingRatio))
    const lastPeakAway =
      Math.floor(SETTLE_TOLERANCE_LOG / decayRate / halfPeriod) * halfPeriod
    return {
      low: Math.min(lastPeakAway, MAX_SETTLE_SECONDS),
      high: Math.min(lastPeakAway + halfPeriod, MAX_SETTLE_SECONDS),
    }
  } else {
    return { low: 0, high: MAX_SETTLE_SECONDS }
  }
}

/** Seconds until a spring is within 0.5% of its target and stays there,
 *  found by bisection and clamped to between 0.05 and 10 seconds. Unlike
 *  {@link springSettleDuration}, the spring is truly at rest by then, so a
 *  CSS curve over this time ends without a jump. */
export const springRestDuration = (params: SpringParams): number => {
  const isAway = isAwayFromRest(params)
  const window = restSearchWindow(params)
  const { high } = Array.reduce(
    Array.range(1, REST_SEARCH_STEPS),
    window,
    ({ low, high: windowHigh }): SearchWindow => {
      const middle = (low + windowHigh) / 2
      return isAway(middle)
        ? { low: middle, high: windowHigh }
        : { low, high: middle }
    },
  )
  return clamp(high, MIN_SETTLE_SECONDS, MAX_SETTLE_SECONDS)
}

// BEZIER MATH

const bezierAxis = (parameter: number, first: number, second: number): number =>
  (1 - 3 * second + 3 * first) * parameter ** 3 +
  (3 * second - 6 * first) * parameter ** 2 +
  3 * first * parameter

const bezierAxisSlope = (
  parameter: number,
  first: number,
  second: number,
): number =>
  3 * (1 - 3 * second + 3 * first) * parameter ** 2 +
  2 * (3 * second - 6 * first) * parameter +
  3 * first

const solveBezierParameterByNewton = (
  progress: number,
  [x1, , x2]: CubicBezier,
): number =>
  Array.reduce(Array.range(1, NEWTON_ITERATIONS), progress, parameter => {
    const error = bezierAxis(parameter, x1, x2) - progress
    const slope = bezierAxisSlope(parameter, x1, x2)
    if (
      Math.abs(error) < NEWTON_TOLERANCE ||
      Math.abs(slope) < NEWTON_MIN_SLOPE
    ) {
      return parameter
    } else {
      return parameter - error / slope
    }
  })

const solveBezierParameterByBisection = (
  progress: number,
  curve: CubicBezier,
  low: number,
  high: number,
): number => {
  const [x1, , x2] = curve
  const middle = (low + high) / 2
  if (high - low <= BISECTION_TOLERANCE) {
    return middle
  } else if (bezierAxis(middle, x1, x2) < progress) {
    return solveBezierParameterByBisection(progress, curve, middle, high)
  } else {
    return solveBezierParameterByBisection(progress, curve, low, middle)
  }
}

/** Eased progress of a cubic Bézier curve at linear progress `progress`
 *  (0 to 1). Solves the curve's parameter by Newton's method and falls back
 *  to bisection when Newton does not converge. */
export const cubicBezierProgress = (
  progress: number,
  curve: CubicBezier,
): number => {
  if (progress <= 0) {
    return 0
  } else if (progress >= 1) {
    return 1
  }

  const [x1, y1, x2, y2] = curve
  const newtonParameter = solveBezierParameterByNewton(progress, curve)
  const isNewtonConverged =
    Math.abs(bezierAxis(newtonParameter, x1, x2) - progress) < NEWTON_TOLERANCE
  const parameter = isNewtonConverged
    ? newtonParameter
    : solveBezierParameterByBisection(progress, curve, 0, 1)

  return bezierAxis(parameter, y1, y2)
}

// TRANSITION QUERIES

/** How long the transition runs, in seconds. Physics springs report their
 *  settle time. */
export const durationOf = (transition: Transition): number =>
  Transition.match(transition, {
    Easing: ({ duration }) => duration,
    TimeSpring: ({ visualDuration }) => visualDuration,
    PhysicsSpring: spring => springSettleDuration(springParams(spring)),
  })

/** Eased progress `seconds` after the transition starts. Springs may
 *  overshoot 1 and converge to it; easings clamp at 1. */
export const progressAt = (transition: Transition, seconds: number): number => {
  if (seconds <= 0) {
    return 0
  }

  return Transition.match(transition, {
    Easing: ({ duration, ease }) =>
      cubicBezierProgress(
        duration > 0 ? Math.min(1, seconds / duration) : 1,
        ease,
      ),
    TimeSpring: spring => springProgressSettled(springParams(spring), seconds),
    PhysicsSpring: spring =>
      springProgressSettled(springParams(spring), seconds),
  })
}

const springProgressSettled = (
  params: SpringParams,
  seconds: number,
): number =>
  seconds >= springSettleDuration(params) ? 1 : springProgress(seconds, params)

/** Samples `count` points of the transition's progress curve across its
 *  duration, for drawing it. */
export const sampleCurve = (
  transition: Transition,
  count: number,
): ReadonlyArray<Readonly<{ time: number; progress: number }>> => {
  const duration = durationOf(transition)
  return Array.makeBy(count, index => {
    const time = (index / Math.max(1, count - 1)) * duration
    return { time, progress: progressAt(transition, time) }
  })
}

/** The CSS duration to pair with `toCssTimingFunction`: an easing's
 *  duration, or the seconds until a spring is at rest. A spring's `linear()`
 *  curve runs over that time, so it ends at rest rather than mid-bounce at
 *  `visualDuration`, or short of its target at its settle time. */
export const cssDurationOf = (transition: Transition): number =>
  Transition.match(transition, {
    Easing: ({ duration }) => duration,
    TimeSpring: spring => springRestDuration(springParams(spring)),
    PhysicsSpring: spring => springRestDuration(springParams(spring)),
  })

/** A CSS timing value for the transition: `cubic-bezier()` for an easing,
 *  and a sampled `linear()` curve for a spring that ends exactly at 1. Pair
 *  it with `cssDurationOf`. */
export const toCssTimingFunction = (transition: Transition): string =>
  Transition.match(transition, {
    Easing: ({ ease }) =>
      pipe(
        ease,
        Array.map(value => value.toString()),
        Array.join(', '),
        values => `cubic-bezier(${values})`,
      ),
    TimeSpring: spring => linearCurve(springParams(spring)),
    PhysicsSpring: spring => linearCurve(springParams(spring)),
  })

// NOTE: the samples read the spring itself rather than `progressAt`, which
// snaps to 1 at the earlier settle time and would put a jump inside the
// curve.
const linearCurve = (params: SpringParams): string => {
  const duration = springRestDuration(params)
  const lastIndex = CSS_SPRING_SAMPLES - 1
  return pipe(
    Array.makeBy(CSS_SPRING_SAMPLES, index =>
      index === lastIndex
        ? 1
        : springProgress((index / lastIndex) * duration, params),
    ),
    Array.map(progress =>
      Number.round(progress, CSS_SPRING_DECIMALS).toString(),
    ),
    Array.join(', '),
    points => `linear(${points})`,
  )
}

/** The transition in Motion's config shape (`{ type: 'spring', ... }` or
 *  `{ duration, ease }`), the shape DialKit hands to Motion. */
export const toMotion = (
  transition: Transition,
): Readonly<Record<string, unknown>> =>
  Transition.match(transition, {
    Easing: ({ duration, ease }) => ({ duration, ease }),
    TimeSpring: ({ visualDuration, bounce }) => ({
      type: 'spring',
      visualDuration,
      bounce,
    }),
    PhysicsSpring: ({ stiffness, damping, mass }) => ({
      type: 'spring',
      stiffness,
      damping,
      mass,
    }),
  })
