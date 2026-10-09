import { Array, Option, Record, pipe } from 'effect'

import { type Transition } from '../transition/index.js'
import {
  Clip,
  type ClipInput,
  type ClipLoop,
  type Entry,
  Group,
  type GroupOf,
  type MakeConfig,
  type MarkerClip,
  type MarkerInput,
  type PartialValues,
  type SequenceClip,
  type SequenceInput,
  type TimelineClip,
  type TimelineOf,
  Track,
  type TrackInput,
  type TracksClip,
  type TracksInput,
  type TweenClip,
  type Values,
  type Widen,
} from './model.js'
import { clipShapeOf } from './resolve.js'
import {
  DEFAULT_TRANSITION,
  barDuration,
  ceilToHundredths,
  isFiniteNumber,
  sanitizeTime,
} from './timing.js'

const EMPTY_TIMELINE_DURATION = 1

// NOTE: a partial record of `V`'s values is a `Values`, but TypeScript cannot
// relate a mapped type over a generic `V` to an index signature.
const toValues = <V extends Values>(values: PartialValues<V>): Values =>
  /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
  values as Values

const loopOf = (isLooping: boolean | undefined): ClipLoop =>
  isLooping === true ? 'Repeat' : 'Off'

// CONSTRUCTORS

/** A clip that animates `from` to `to` with one transition. Without
 *  `duration`, the bar uses the transition's duration or a spring's settle
 *  time. Without `transition`, it uses `DEFAULT_TRANSITION`. */
export const clip = <V extends Values>(input: ClipInput<V>): TweenClip<V> => {
  const transition = input.transition ?? DEFAULT_TRANSITION

  return Clip.Tween({
    at: Math.max(0, input.at),
    duration: barDuration(Option.fromNullishOr(input.duration), transition),
    from: input.from,
    to: toValues(input.to),
    transition,
    loop: loopOf(input.loop),
  })
}

/** A clip whose legs each animate from the previous state. Each leg
 *  inherits the clip's transition unless it sets its own. The clip's length
 *  is the sum of its legs. */
export const sequence = <V extends Values>(
  input: SequenceInput<V>,
): SequenceClip<V> => {
  const inheritedTransition = input.transition ?? DEFAULT_TRANSITION

  return Clip.Sequence({
    at: Math.max(0, input.at),
    from: input.from,
    steps: Array.map(input.steps, step => {
      const transition = step.transition ?? inheritedTransition
      return {
        duration: barDuration(Option.fromNullishOr(step.duration), transition),
        to: toValues(step.to),
        transition,
      }
    }),
    loop: loopOf(input.loop),
  })
}

const trackFromInput = (
  prop: string,
  input: TrackInput,
  inheritedTransition: Transition,
): Track => {
  const transition = input.transition ?? inheritedTransition
  const delay = sanitizeTime(input.delay ?? 0)

  return Option.match(Option.fromNullishOr(input.steps), {
    onNone: () =>
      Track.Tween({
        prop,
        delay,
        duration: barDuration(Option.fromNullishOr(input.duration), transition),
        from: input.from,
        to: input.to ?? input.from,
        transition,
      }),
    onSome: steps =>
      Track.Sequence({
        prop,
        delay,
        from: input.from,
        steps: Array.map(steps, step => {
          const stepTransition = step.transition ?? transition
          return {
            duration: barDuration(
              Option.fromNullishOr(step.duration),
              stepTransition,
            ),
            to: step.to,
            transition: stepTransition,
          }
        }),
      }),
  })
}

/** A clip whose properties animate with independent timing. Each track has
 *  its own values, transition, duration, and `delay` from the clip's `at`.
 *  When looping, each track repeats at its own period. */
export const tracks = <Props extends Readonly<Record<string, TrackInput>>>(
  input: TracksInput<Props>,
): TracksClip<{ readonly [K in keyof Props]: Widen<Props[K]['from']> }> => {
  const inheritedTransition = input.transition ?? DEFAULT_TRANSITION

  return Clip.Tracks({
    at: Math.max(0, input.at),
    tracks: Array.map(Record.toEntries(input.props), ([prop, track]) =>
      trackFromInput(prop, track, inheritedTransition),
    ),
    loop: loopOf(input.loop),
  })
}

/** A timing window with no animated values. A marker without `duration` is
 *  instant. */
export const marker = (input: MarkerInput): MarkerClip =>
  Clip.Marker({
    at: Math.max(0, input.at),
    duration: sanitizeTime(input.duration ?? 0),
  })

/** Groups clips into one collapsible layer. Their values nest under the
 *  group's name. */
export const group = <Clips extends Readonly<Record<string, Clip>>>(
  clips: Clips,
): GroupOf<Clips> => Group({ clips })

const timelineClipsOfEntry = (
  name: string,
  entry: Entry,
): ReadonlyArray<TimelineClip> => {
  if (entry._tag === 'Group') {
    return Array.map(Record.toEntries(entry.clips), ([childName, child]) => ({
      name: childName,
      maybeGroup: Option.some(name),
      clip: child,
    }))
  } else {
    return [{ name, maybeGroup: Option.none(), clip: entry }]
  }
}

const authoredDuration = (
  maybeDuration: Option.Option<number>,
  contentEnd: number,
): number =>
  Option.getOrElse(
    Option.filter(
      maybeDuration,
      duration => isFiniteNumber(duration) && duration > 0,
    ),
    () =>
      contentEnd > 0 ? ceilToHundredths(contentEnd) : EMPTY_TIMELINE_DURATION,
  )

/** Parses clips and groups into a `Timeline`. Clips keep config order, and a
 *  clip whose `at` is not finite is skipped. Without `duration`, the window
 *  ends where the content does, rounded up to the hundredth. */
export const make = <Entries extends Readonly<Record<string, Entry>>>(
  config: MakeConfig<Entries>,
): TimelineOf<Entries> => {
  const clips = pipe(
    Record.toEntries(config.clips),
    Array.flatMap(([name, entry]) => timelineClipsOfEntry(name, entry)),
    Array.filter(({ clip: { at } }) => isFiniteNumber(at)),
  )
  const contentEnd = pipe(
    clips,
    Array.map(({ clip: timelineClip }) => clipShapeOf(timelineClip)),
    Array.reduce(0, (end, shape) => Math.max(end, shape.at + shape.duration)),
  )

  return {
    minimumDuration: authoredDuration(
      Option.fromNullishOr(config.duration),
      contentEnd,
    ),
    clips,
  }
}
