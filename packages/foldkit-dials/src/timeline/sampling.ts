import {
  Array,
  Function,
  Number,
  Option,
  Predicate,
  Record,
  pipe,
} from 'effect'

import { clamp } from '../internal/range.js'
import {
  type Transition,
  cssDurationOf,
  progressAt,
  toCssTimingFunction,
} from '../transition/index.js'
import { nestByGroup } from './grouping.js'
import {
  Clip,
  type ClipCss,
  ClipValues,
  type TimelineOf,
  type Value,
  type Values,
  type ValuesOf,
} from './model.js'
import {
  type ClipStatic,
  type StepStatic,
  type TimelineStatic,
  type TrackStatic,
  resolve,
} from './resolve.js'
import { effectiveTransition } from './timing.js'

const CSS_DURATION_DECIMALS = 2
const MIDPOINT = 0.5
const HEX_RADIX = 16
const HEX_PAIR_LENGTH = 2
const SHORT_HEX_MAX_DIGITS = 4
const RGB_CHANNEL_COUNT = 3
const OPAQUE_CHANNEL = 255
const HEX_COLOR_PATTERN =
  /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

// SAMPLING

const stepIndexAt = (
  steps: Array.NonEmptyReadonlyArray<StepStatic>,
  position: number,
): number =>
  pipe(
    steps,
    Array.findFirstIndex(step => position < step.offset + step.duration),
    Option.getOrElse(() => steps.length - 1),
  )

const stepAt = (
  steps: Array.NonEmptyReadonlyArray<StepStatic>,
  position: number,
): StepStatic =>
  pipe(
    Array.get(steps, stepIndexAt(steps, position)),
    Option.getOrElse(() => Array.lastNonEmpty(steps)),
  )

const mixHexColors = (
  from: string,
  to: string,
  progress: number,
): Option.Option<string> =>
  Option.map(
    Option.all([parseHexChannels(from), parseHexChannels(to)]),
    ([fromChannels, toChannels]) => {
      const amount = clamp(progress, 0, 1)
      const mixed = Array.map(
        Array.zip(fromChannels, toChannels),
        ([start, end]) => Math.round(start + (end - start) * amount),
      )
      const isOpaque = Option.contains(Array.last(mixed), OPAQUE_CHANNEL)
      const visibleChannels = isOpaque
        ? Array.take(mixed, RGB_CHANNEL_COUNT)
        : mixed
      return `#${Array.join(Array.map(visibleChannels, hexPair), '')}`
    },
  )

const hexPair = (channel: number): string =>
  channel.toString(HEX_RADIX).padStart(HEX_PAIR_LENGTH, '0')

const parseHexChannels = (
  color: string,
): Option.Option<ReadonlyArray<number>> => {
  if (!HEX_COLOR_PATTERN.test(color)) {
    return Option.none()
  }

  const digits = color.slice(1)
  const expanded =
    digits.length <= SHORT_HEX_MAX_DIGITS
      ? Array.join(
          Array.map(digits.split(''), digit => `${digit}${digit}`),
          '',
        )
      : digits
  const channels = Array.makeBy(expanded.length / HEX_PAIR_LENGTH, index =>
    globalThis.Number.parseInt(
      expanded.slice(index * HEX_PAIR_LENGTH, (index + 1) * HEX_PAIR_LENGTH),
      HEX_RADIX,
    ),
  )

  return Option.some(
    channels.length === RGB_CHANNEL_COUNT
      ? [...channels, OPAQUE_CHANNEL]
      : channels,
  )
}

/** Mixes two values at eased progress `progress`. Numbers interpolate and
 *  may overshoot, hex colours mix in clamped RGB, and anything else switches
 *  at the midpoint. */
export const interpolate = (
  from: Value,
  to: Value,
  progress: number,
): Value => {
  const switched = progress < MIDPOINT ? from : to

  if (Predicate.isNumber(from) && Predicate.isNumber(to)) {
    return from + (to - from) * progress
  } else if (Predicate.isString(from) && Predicate.isString(to)) {
    return Option.getOrElse(mixHexColors(from, to, progress), () => switched)
  } else {
    return switched
  }
}

const valueAtPosition = (
  steps: Array.NonEmptyReadonlyArray<StepStatic>,
  prop: string,
  position: number,
): Option.Option<Value> => {
  const step = stepAt(steps, position)
  const maybeStart = Record.get(step.start, prop)

  return Option.match(Record.get(step.to, prop), {
    onNone: () => maybeStart,
    onSome: target => {
      const progress = progressAt(
        step.curve,
        Math.max(0, position - step.offset),
      )
      return Option.match(maybeStart, {
        onNone: () => Option.liftPredicate(target, () => progress >= MIDPOINT),
        onSome: start => Option.some(interpolate(start, target, progress)),
      })
    },
  })
}

type Phase = Readonly<{
  isStarted: boolean
  isLooping: boolean
  phaseElapsed: number
}>

const trackValue = (
  track: TrackStatic,
  prop: string,
  { isStarted, isLooping, phaseElapsed }: Phase,
): Option.Option<Value> => {
  const maybeStartValue = Record.get(
    Array.headNonEmpty(track.steps).start,
    prop,
  )
  const trackPhase = phaseElapsed - track.delay

  if (!isStarted || trackPhase <= 0) {
    return maybeStartValue
  } else {
    const position =
      isLooping && track.duration > 0 ? trackPhase % track.duration : trackPhase
    return valueAtPosition(track.steps, prop, position)
  }
}

const currentValues = (clip: ClipStatic, phase: Phase): Values =>
  pipe(
    clip.tracks,
    Array.flatMap(track =>
      Array.map(
        Option.match(track.maybeProp, {
          onNone: () => clip.props,
          onSome: Array.of,
        }),
        prop =>
          Option.map(
            trackValue(track, prop, phase),
            (value): readonly [string, Value] => [prop, value],
          ),
      ),
    ),
    Array.getSomes,
    Record.fromEntries,
  )

const progressOf = (
  duration: number,
  position: number,
  isStarted: boolean,
): number => {
  if (duration > 0) {
    return clamp(position / duration, 0, 1)
  } else if (isStarted) {
    return 1
  } else {
    return 0
  }
}

/** Samples one clip. `time` is the playhead. `cycleTime` is continuous time
 *  across timeline loop wraps, so looping clips keep their phase when the
 *  playhead wraps. Pass `time` for both to get the first-pass state, which
 *  is what seeking shows. */
export const sampleClip = (
  clip: ClipStatic,
  time: number,
  cycleTime: number,
): ClipValues => {
  const isLooping = clip.loop === 'Repeat' && clip.duration > 0
  const isStarted = time >= clip.at || (isLooping && cycleTime > time)
  const isDone = time >= clip.end
  const phaseElapsed = isLooping ? cycleTime - clip.at : time - clip.at
  const basePosition = isStarted
    ? foldCycle(Math.max(0, phaseElapsed), clip.duration, isLooping)
    : 0
  const phase: Phase = { isStarted, isLooping, phaseElapsed }
  const timing = {
    at: clip.at,
    duration: clip.duration,
    loop: clip.loop,
    started: isStarted,
    active: isStarted && !isDone,
    done: isDone,
    progress: progressOf(clip.duration, basePosition, isStarted),
  }
  const endpoints = () => ({
    from: clip.from,
    to: clip.to,
    current: currentValues(clip, phase),
    animate: isStarted ? clip.to : clip.from,
  })

  return Clip.match<ClipValues>(clip.clip, {
    Marker: () => ClipValues.Marker(timing),
    Tween: ({ transition, duration }) => {
      const effective = effectiveTransition(transition, duration)
      return ClipValues.Tween({
        ...timing,
        ...endpoints(),
        transition: effective.transition,
        css: cssOf(effective.transition),
      })
    },
    Sequence: () =>
      ClipValues.Sequence({
        ...timing,
        ...endpoints(),
        step: pipe(
          Array.head(clip.tracks),
          Option.filter(() => isStarted),
          Option.match({
            onNone: () => 0,
            onSome: ({ steps }) => stepIndexAt(steps, basePosition),
          }),
        ),
      }),
    Tracks: () => ClipValues.Tracks({ ...timing, ...endpoints() }),
  })
}

const foldCycle = (
  elapsed: number,
  duration: number,
  isLooping: boolean,
): number => (isLooping ? elapsed % duration : elapsed)

/** CSS transition values for an effective transition: its duration in
 *  seconds and its timing function. */
export const cssOf = (transition: Transition): ClipCss => ({
  transitionDuration: `${Number.round(cssDurationOf(transition), CSS_DURATION_DECIMALS)}s`,
  transitionTimingFunction: toCssTimingFunction(transition),
})

/** One sampled clip with the names it is reported under. */
export type SampledClip = Readonly<{
  key: string
  name: string
  maybeGroup: Option.Option<string>
  values: ClipValues
}>

/** Samples every clip of a resolved timeline. */
export const sampleTimeline = (
  timelineStatic: TimelineStatic,
  time: number,
  cycleTime: number,
): ReadonlyArray<SampledClip> =>
  Array.map(timelineStatic.clips, clipStatic => ({
    key: clipStatic.key,
    name: clipStatic.name,
    maybeGroup: clipStatic.maybeGroup,
    values: sampleClip(clipStatic, time, cycleTime),
  }))

/** Samples resolved clips under their config names, nesting grouped clips
 *  under their group. `cycleTime` defaults to the first-pass state. */
export const valuesAtResolved = <Entries>(
  timelineStatic: TimelineStatic,
  time: number,
  cycleTime: number = time,
): ValuesOf<Entries> =>
  // NOTE: this is the one place the runtime record meets the config's
  // type-level shape. The record is built from the same clips the shape
  // describes, so the keys and variants match by construction.
  /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
  nestByGroup(
    sampleTimeline(timelineStatic, time, cycleTime),
    ({ values }) => values,
    Function.identity,
  ) as ValuesOf<Entries>

/** Samples a timeline at `time` and returns each clip's values under its
 *  config name, with grouped clips nested under their group. `cycleTime`
 *  defaults to `time`, the first-pass state. */
export const valuesAt = <Entries>(
  timeline: TimelineOf<Entries>,
  time: number,
  cycleTime: number = time,
): ValuesOf<Entries> =>
  valuesAtResolved<Entries>(resolve(timeline), time, cycleTime)
