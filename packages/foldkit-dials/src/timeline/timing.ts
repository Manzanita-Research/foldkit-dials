import { Number, Option } from 'effect'

import {
  Transition,
  durationOf,
  springParams,
  springSettleDuration,
} from '../transition/index.js'

/** The shortest bar an animated clip or step can have, in seconds. */
export const MIN_CLIP_DURATION = 0.05

const DEFAULT_SPRING_BOUNCE = 0.2
const DEFAULT_SPRING_SHAPE_DURATION = 0.3
const HUNDREDTHS = 100
const HUNDREDTH_DECIMALS = 2
const CEIL_TOLERANCE = 1e-4

/** The transition a clip with values but no `transition` uses: a time
 *  spring with bounce 0.2, whose bar defaults to that spring's settle time,
 *  as in DialKit. */
export const DEFAULT_TRANSITION: Transition = Transition.TimeSpring({
  visualDuration: springSettleDuration(
    springParams(
      Transition.TimeSpring({
        visualDuration: DEFAULT_SPRING_SHAPE_DURATION,
        bounce: DEFAULT_SPRING_BOUNCE,
      }),
    ),
  ),
  bounce: DEFAULT_SPRING_BOUNCE,
})

// DURATION DEFAULTS

/** Whether a time or duration is finite. */
export const isFiniteNumber = (value: number): boolean =>
  globalThis.Number.isFinite(value)

/** Normalizes a time to a finite, nonnegative value. */
export const sanitizeTime = (value: number): number =>
  isFiniteNumber(value) ? Math.max(0, value) : 0

const animatedDuration = (value: number): number =>
  Math.max(MIN_CLIP_DURATION, sanitizeTime(value))

/** Rounds an editing window up to the nearest hundredth. */
export const ceilToHundredths = (value: number): number =>
  Math.ceil(value * HUNDREDTHS - CEIL_TOLERANCE) / HUNDREDTHS

/** Rounds a displayed or edited duration to hundredths. */
export const roundToHundredths = (value: number): number =>
  Number.round(value, HUNDREDTH_DECIMALS)

/** Whether a transition derives its bar duration from spring physics. */
export const isPhysics = (transition: Transition): boolean =>
  transition._tag === 'PhysicsSpring'

/** The transition duration normalized to the shortest animated bar. */
export const transitionDuration = (transition: Transition): number =>
  animatedDuration(durationOf(transition))

/** The bar length of an animated span. Physics springs always use their
 *  settle time. Otherwise an explicit duration wins, then the transition's
 *  own duration. */
export const barDuration = (
  maybeDuration: Option.Option<number>,
  transition: Transition,
): number => {
  if (isPhysics(transition)) {
    return transitionDuration(transition)
  } else {
    return Option.match(maybeDuration, {
      onNone: () => transitionDuration(transition),
      onSome: animatedDuration,
    })
  }
}

/** The transition as it runs over a bar: easings and time springs take the
 *  bar as their duration, and physics springs report their settle time and
 *  `isPhysics`, since their bar is derived and not resizable. */
export type EffectiveTransition = Readonly<{
  transition: Transition
  duration: number
  isPhysics: boolean
}>

/** Resolves a stored transition against its bar duration. */
export const effectiveTransition = (
  transition: Transition,
  duration: number,
): EffectiveTransition => {
  const safeDuration = Math.max(MIN_CLIP_DURATION, duration)

  return Transition.match<EffectiveTransition>(transition, {
    Easing: ({ ease }) => ({
      transition: Transition.Easing({ duration: safeDuration, ease }),
      duration: safeDuration,
      isPhysics: false,
    }),
    TimeSpring: ({ bounce }) => ({
      transition: Transition.TimeSpring({
        visualDuration: safeDuration,
        bounce,
      }),
      duration: safeDuration,
      isPhysics: false,
    }),
    PhysicsSpring: spring => ({
      transition: spring,
      duration: springSettleDuration(springParams(spring)),
      isPhysics: true,
    }),
  })
}
