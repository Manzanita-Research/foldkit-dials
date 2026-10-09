import { Array, Option, Record, pipe } from 'effect'
import { makeModifyFieldsFor, modifyFields } from 'foldkit/struct'

import { inferStep } from '../dial/index.js'
import { clamp } from '../internal/range.js'
import { type Transition } from '../transition/index.js'
import { clipKey } from './grouping.js'
import {
  Clip,
  NO_VALUES,
  type Segment,
  Span,
  type Timeline,
  type TimelineClip,
  Track,
  type TrackSegment,
  type Value,
  type Values,
} from './model.js'
import { singleProp } from './resolve.js'
import {
  MIN_CLIP_DURATION,
  isPhysics,
  roundToHundredths,
  transitionDuration,
} from './timing.js'

// EDIT CLAMPS

/** Clamps a moved clip start so the whole bar stays inside the timeline. */
export const clampClipMove = (
  at: number,
  duration: number,
  timelineDuration: number,
): number =>
  clamp(roundToHundredths(at), 0, Math.max(0, timelineDuration - duration))

/** Clamps a duration dragged from the end edge. */
export const clampClipResizeEnd = (
  duration: number,
  at: number,
  timelineDuration: number,
): number =>
  clamp(roundToHundredths(duration), MIN_CLIP_DURATION, timelineDuration - at)

/** Clamps a start dragged from the start edge. The end stays put, so the
 *  duration takes up the difference. */
export const clampClipResizeStart = (
  nextAt: number,
  at: number,
  duration: number,
): Readonly<{ at: number; duration: number }> => {
  const clampedAt = clamp(
    roundToHundredths(nextAt),
    0,
    at + duration - MIN_CLIP_DURATION,
  )
  return {
    at: clampedAt,
    duration: roundToHundredths(at + duration - clampedAt),
  }
}

/** Clamps one leg of a sequence. The other legs keep their length, and the
 *  whole bar must still fit the timeline. */
export const clampStepResize = (
  duration: number,
  at: number,
  otherStepsTotal: number,
  timelineDuration: number,
): number =>
  clamp(
    roundToHundredths(duration),
    MIN_CLIP_DURATION,
    Math.max(MIN_CLIP_DURATION, timelineDuration - at - otherStepsTotal),
  )

/** Clamps a property track's delay so the track stays inside the
 *  timeline. */
export const clampTrackDelay = (
  delay: number,
  at: number,
  trackDuration: number,
  timelineDuration: number,
): number =>
  clamp(
    roundToHundredths(delay),
    0,
    Math.max(0, roundToHundredths(timelineDuration - at - trackDuration)),
  )

// EDITING

/** Finds a clip by its key. */
export const findClip = (
  timeline: Timeline,
  key: string,
): Option.Option<TimelineClip> =>
  Array.findFirst(timeline.clips, timelineClip => clipKey(timelineClip) === key)

/** Replaces the clip with `key` by applying `updateClip`. */
export const modifyClip =
  (key: string, updateClip: (clip: Clip) => Clip) =>
  (timeline: Timeline): Timeline =>
    modifyFields(timeline, {
      clips: Array.map(timelineClip =>
        clipKey(timelineClip) === key
          ? modifyFields(timelineClip, { clip: updateClip })
          : timelineClip,
      ),
    })

const modifyIndex =
  <A>(index: number, updateItem: (item: A) => A) =>
  (items: Array.NonEmptyReadonlyArray<A>): Array.NonEmptyReadonlyArray<A> =>
    Array.map(items, (item, itemIndex) =>
      itemIndex === index ? updateItem(item) : item,
    )

const modifyTrack = (prop: string, updateTrack: (track: Track) => Track) =>
  Array.map((track: Track) =>
    track.prop === prop ? updateTrack(track) : track,
  )

/** Finds a property track of a `Tracks` clip. */
export const trackOf = (clip: Clip, prop: string): Option.Option<Track> =>
  Clip.matchOrElse(
    clip,
    {
      Tracks: ({ tracks: clipTracks }) =>
        Array.findFirst(clipTracks, track => track.prop === prop),
    },
    () => Option.none(),
  )

/** Moves a clip to start at `at`. */
export const setClipStart = (clip: Clip, at: number): Clip =>
  modifyFields(clip, { at: () => at })

/** Sets the delay of a property track. */
export const setTrackDelay = (clip: Clip, prop: string, delay: number): Clip =>
  Clip.matchOrElse(
    clip,
    {
      Tracks: tracksClip =>
        modifyFields(tracksClip, {
          tracks: modifyTrack(prop, track =>
            modifyFields(track, { delay: () => delay }),
          ),
        }),
    },
    () => clip,
  )

const stepDurationAt = <A extends Readonly<{ duration: number }>>(
  steps: Array.NonEmptyReadonlyArray<A>,
  index: number,
): Option.Option<number> =>
  Option.map(Array.get(steps, index), ({ duration }) => duration)

/** The stored bar duration of a span. A sequence or `Tracks` clip as a
 *  whole has none, since its length comes from its parts. */
export const spanDuration = (clip: Clip, span: Span): Option.Option<number> =>
  Span.match<Option.Option<number>>(span, {
    Whole: () =>
      Clip.matchOrElse(
        clip,
        {
          Marker: ({ duration }) => Option.some(duration),
          Tween: ({ duration }) => Option.some(duration),
        },
        () => Option.none(),
      ),
    Step: ({ index }) =>
      Clip.matchOrElse(
        clip,
        { Sequence: ({ steps }) => stepDurationAt(steps, index) },
        () => Option.none(),
      ),
    Track: ({ prop }) =>
      Option.flatMap(trackOf(clip, prop), track =>
        Track.match<Option.Option<number>>(track, {
          Tween: ({ duration }) => Option.some(duration),
          Sequence: () => Option.none(),
        }),
      ),
    TrackStep: ({ prop, index }) =>
      Option.flatMap(trackOf(clip, prop), track =>
        Track.match<Option.Option<number>>(track, {
          Tween: () => Option.none(),
          Sequence: ({ steps }) => stepDurationAt(steps, index),
        }),
      ),
  })

type Timed = Readonly<{ duration: number }>

const modifyTimedFields = makeModifyFieldsFor<Timed>()

const withDuration =
  (duration: number) =>
  <A extends Timed>(item: A): A =>
    modifyTimedFields(item, { duration: () => duration })

/** Sets the stored bar duration of a span. */
export const setSpanDuration = (
  clip: Clip,
  span: Span,
  duration: number,
): Clip =>
  Span.match<Clip>(span, {
    Whole: () =>
      Clip.matchOrElse(
        clip,
        {
          Marker: withDuration(duration),
          Tween: withDuration(duration),
        },
        () => clip,
      ),
    Step: ({ index }) =>
      Clip.matchOrElse(
        clip,
        {
          Sequence: sequenceClip =>
            modifyFields(sequenceClip, {
              steps: modifyIndex(index, withDuration(duration)),
            }),
        },
        () => clip,
      ),
    Track: ({ prop }) =>
      modifyTracksClip(clip, prop, track =>
        Track.matchOrElse(
          track,
          { Tween: withDuration(duration) },
          () => track,
        ),
      ),
    TrackStep: ({ prop, index }) =>
      modifyTracksClip(clip, prop, track =>
        Track.matchOrElse(
          track,
          {
            Sequence: trackSequence =>
              modifyFields(trackSequence, {
                steps: modifyIndex(index, withDuration(duration)),
              }),
          },
          () => track,
        ),
      ),
  })

const modifyTracksClip = (
  clip: Clip,
  prop: string,
  updateTrack: (track: Track) => Track,
): Clip =>
  Clip.matchOrElse(
    clip,
    {
      Tracks: tracksClip =>
        modifyFields(tracksClip, { tracks: modifyTrack(prop, updateTrack) }),
    },
    () => clip,
  )

/** The stored transition of a span, for spans that animate on one curve. */
export const spanTransition = (
  clip: Clip,
  span: Span,
): Option.Option<Transition> =>
  Span.match<Option.Option<Transition>>(span, {
    Whole: () =>
      Clip.matchOrElse(
        clip,
        { Tween: ({ transition }) => Option.some(transition) },
        () => Option.none(),
      ),
    Step: ({ index }) =>
      Clip.matchOrElse(
        clip,
        {
          Sequence: ({ steps }) =>
            Option.map(Array.get(steps, index), ({ transition }) => transition),
        },
        () => Option.none(),
      ),
    Track: ({ prop }) =>
      Option.flatMap(trackOf(clip, prop), track =>
        Track.match<Option.Option<Transition>>(track, {
          Tween: ({ transition }) => Option.some(transition),
          Sequence: () => Option.none(),
        }),
      ),
    TrackStep: ({ prop, index }) =>
      Option.flatMap(trackOf(clip, prop), track =>
        Track.match<Option.Option<Transition>>(track, {
          Tween: () => Option.none(),
          Sequence: ({ steps }) =>
            Option.map(Array.get(steps, index), ({ transition }) => transition),
        }),
      ),
  })

type Transitioned = Readonly<{ duration: number; transition: Transition }>

const modifyTransitionedFields = makeModifyFieldsFor<Transitioned>()

const withTransition =
  (transition: Transition) =>
  <A extends Transitioned>(item: A): A =>
    modifyTransitionedFields(item, {
      transition: () => transition,
      duration: duration =>
        isPhysics(transition) ? transitionDuration(transition) : duration,
    })

/** Sets the transition of a span. A physics spring also sets the span's
 *  bar to its settle time, since that length is derived. */
export const setSpanTransition = (
  clip: Clip,
  span: Span,
  transition: Transition,
): Clip =>
  Span.match<Clip>(span, {
    Whole: () =>
      Clip.matchOrElse(clip, { Tween: withTransition(transition) }, () => clip),
    Step: ({ index }) =>
      Clip.matchOrElse(
        clip,
        {
          Sequence: sequenceClip =>
            modifyFields(sequenceClip, {
              steps: modifyIndex(index, withTransition(transition)),
            }),
        },
        () => clip,
      ),
    Track: ({ prop }) =>
      modifyTracksClip(clip, prop, track =>
        Track.matchOrElse(
          track,
          { Tween: withTransition(transition) },
          () => track,
        ),
      ),
    TrackStep: ({ prop, index }) =>
      modifyTracksClip(clip, prop, track =>
        Track.matchOrElse(
          track,
          {
            Sequence: trackSequence =>
              modifyFields(trackSequence, {
                steps: modifyIndex(index, withTransition(transition)),
              }),
          },
          () => track,
        ),
      ),
  })

const isFirstStep = (index: number): boolean => index === 0

/** The starting values a span edits: a clip's `from`, which the first step
 *  of a sequence also shows, or a track's `from`. */
export const spanFrom = (clip: Clip, span: Span): Values => {
  const clipFrom = Clip.matchOrElse(
    clip,
    {
      Tween: ({ from }) => from,
      Sequence: ({ from }) => from,
    },
    () => NO_VALUES,
  )
  const trackFrom = (prop: string): Values =>
    Option.match(trackOf(clip, prop), {
      onNone: () => NO_VALUES,
      onSome: track => singleProp(prop, track.from),
    })

  return Span.match<Values>(span, {
    Whole: () => clipFrom,
    Step: ({ index }) => (isFirstStep(index) ? clipFrom : NO_VALUES),
    Track: ({ prop }) => trackFrom(prop),
    TrackStep: ({ prop, index }) =>
      isFirstStep(index) ? trackFrom(prop) : NO_VALUES,
  })
}

/** Sets one starting value of a span. */
export const setSpanFrom = (
  clip: Clip,
  span: Span,
  prop: string,
  value: Value,
): Clip => {
  const setClipFrom = (): Clip =>
    Clip.matchOrElse(
      clip,
      {
        Tween: tween => modifyFields(tween, { from: Record.set(prop, value) }),
        Sequence: sequenceClip =>
          modifyFields(sequenceClip, { from: Record.set(prop, value) }),
      },
      () => clip,
    )
  const setTrackFrom = (trackProp: string): Clip =>
    modifyTracksClip(clip, trackProp, track =>
      modifyFields(track, { from: () => value }),
    )

  return Span.match<Clip>(span, {
    Whole: setClipFrom,
    Step: setClipFrom,
    Track: ({ prop: trackProp }) => setTrackFrom(trackProp),
    TrackStep: ({ prop: trackProp }) => setTrackFrom(trackProp),
  })
}

/** The target values a span edits: a tween's `to`, a step's `to`, or a
 *  track's `to`. */
export const spanTo = (clip: Clip, span: Span): Values =>
  Span.match<Values>(span, {
    Whole: () =>
      Clip.matchOrElse(clip, { Tween: ({ to }) => to }, () => NO_VALUES),
    Step: ({ index }) =>
      Clip.matchOrElse(
        clip,
        {
          Sequence: ({ steps }) =>
            Option.match(Array.get(steps, index), {
              onNone: () => NO_VALUES,
              onSome: ({ to }) => to,
            }),
        },
        () => NO_VALUES,
      ),
    Track: ({ prop }) =>
      Option.match(trackOf(clip, prop), {
        onNone: () => NO_VALUES,
        onSome: track =>
          Track.match<Values>(track, {
            Tween: ({ to }) => singleProp(prop, to),
            Sequence: () => NO_VALUES,
          }),
      }),
    TrackStep: ({ prop, index }) =>
      Option.match(trackOf(clip, prop), {
        onNone: () => NO_VALUES,
        onSome: track =>
          Track.match<Values>(track, {
            Tween: () => NO_VALUES,
            Sequence: ({ steps }) =>
              Option.match(Array.get(steps, index), {
                onNone: () => NO_VALUES,
                onSome: ({ to }) => singleProp(prop, to),
              }),
          }),
      }),
  })

/** Sets one target value of a span. */
export const setSpanTo = (
  clip: Clip,
  span: Span,
  prop: string,
  value: Value,
): Clip =>
  Span.match<Clip>(span, {
    Whole: () =>
      Clip.matchOrElse(
        clip,
        {
          Tween: tween => modifyFields(tween, { to: Record.set(prop, value) }),
        },
        () => clip,
      ),
    Step: ({ index }) =>
      Clip.matchOrElse(
        clip,
        {
          Sequence: sequenceClip =>
            modifyFields(sequenceClip, {
              steps: modifyIndex(index, (step: Segment) =>
                modifyFields(step, { to: Record.set(prop, value) }),
              ),
            }),
        },
        () => clip,
      ),
    Track: ({ prop: trackProp }) =>
      modifyTracksClip(clip, trackProp, track =>
        Track.matchOrElse(
          track,
          { Tween: tween => modifyFields(tween, { to: () => value }) },
          () => track,
        ),
      ),
    TrackStep: ({ prop: trackProp, index }) =>
      modifyTracksClip(clip, trackProp, track =>
        Track.matchOrElse(
          track,
          {
            Sequence: trackSequence =>
              modifyFields(trackSequence, {
                steps: modifyIndex(index, (step: TrackSegment) =>
                  modifyFields(step, { to: () => value }),
                ),
              }),
          },
          () => track,
        ),
      ),
  })

// VALUE RANGES

/** A slider range for a from or to value. */
export type ValueRange = Readonly<{ min: number; max: number; step: number }>

const VALUE_RANGE_PRESETS: ReadonlyArray<
  Readonly<{ pattern: RegExp; range: ValueRange }>
> = [
  {
    pattern: /^(x|y|z|tx|ty|offsetx|offsety|translatex|translatey)$/i,
    range: { min: -100, max: 100, step: 1 },
  },
  { pattern: /rotat|angle|skew/i, range: { min: -180, max: 180, step: 1 } },
  { pattern: /^scale/i, range: { min: 0, max: 2, step: 0.01 } },
  { pattern: /opacity|alpha/i, range: { min: 0, max: 1, step: 0.01 } },
  { pattern: /blur|radius|spread/i, range: { min: 0, max: 100, step: 1 } },
]

const UNIT_RANGE: ValueRange = { min: 0, max: 1, step: 0.01 }
const FALLBACK_RANGE_MULTIPLIER = 2

/** A slider range for a property, sized by common property names (position,
 *  rotation, scale, opacity, blur) and expanded to include both endpoints. */
export const valueRange = (
  prop: string,
  value: number,
  maybeCounterpart: Option.Option<number>,
): ValueRange => {
  const counterpart = Option.getOrElse(maybeCounterpart, () => value)
  const low = Math.min(value, counterpart)
  const high = Math.max(value, counterpart)

  return pipe(
    VALUE_RANGE_PRESETS,
    Array.findFirst(({ pattern }) => pattern.test(prop)),
    Option.match({
      onSome: ({ range }) => ({
        min: Math.min(range.min, low),
        max: Math.max(range.max, high),
        step: range.step,
      }),
      onNone: () => {
        if (low >= 0 && high <= 1) {
          return UNIT_RANGE
        } else {
          const extent = Math.max(Math.abs(low), Math.abs(high), 1)
          const min = low < 0 ? -extent * FALLBACK_RANGE_MULTIPLIER : 0
          const max = Math.max(extent * FALLBACK_RANGE_MULTIPLIER, high)
          return { min, max, step: inferStep(min, max) }
        }
      },
    }),
  )
}
