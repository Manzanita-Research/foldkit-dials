import { Array, Option, Record } from 'effect'

import { type Transition } from '../transition/index.js'
import { clipKey } from './grouping.js'
import {
  Clip,
  type ClipLoop,
  NO_VALUES,
  type Timeline,
  Track,
  type Value,
  type Values,
} from './model.js'
import { ceilToHundredths, effectiveTransition } from './timing.js'

// STATIC PASS

/** One leg ready to sample: where it starts in its track's cycle, its
 *  effective duration and curve, the full state it starts from, and the
 *  properties it animates. */
export type StepStatic = Readonly<{
  offset: number
  duration: number
  isPhysics: boolean
  start: Values
  to: Values
  curve: Transition
}>

/** A chain of legs with its own cycle length and phase offset. A tween or
 *  sequence clip is one track over all its properties. A `Tracks` clip has
 *  one track per property. */
export type TrackStatic = Readonly<{
  maybeProp: Option.Option<string>
  delay: number
  duration: number
  steps: Array.NonEmptyReadonlyArray<StepStatic>
}>

/** A clip resolved for sampling and drawing. `duration` is the bar, one
 *  cycle for looping clips, and `end` is where the clip stops affecting
 *  values: `at + duration`, or the timeline end when it loops. */
export type ClipStatic = Readonly<{
  key: string
  name: string
  maybeGroup: Option.Option<string>
  clip: Clip
  at: number
  duration: number
  loop: ClipLoop
  end: number
  isPhysics: boolean
  tracks: ReadonlyArray<TrackStatic>
  props: ReadonlyArray<string>
  from: Values
  to: Values
}>

/** A timeline resolved for sampling: its effective duration and clips. */
export type TimelineStatic = Readonly<{
  duration: number
  clips: ReadonlyArray<ClipStatic>
}>

type ClipShape = Omit<ClipStatic, 'key' | 'name' | 'maybeGroup' | 'end'>

const chainSteps = (
  from: Values,
  legs: Array.NonEmptyReadonlyArray<
    Readonly<{ duration: number; to: Values; transition: Transition }>
  >,
): Readonly<{
  duration: number
  final: Values
  steps: Array.NonEmptyReadonlyArray<StepStatic>
}> => {
  const [state, steps] = Array.mapAccum(
    legs,
    { offset: 0, running: from },
    (accumulated, leg) => {
      const effective = effectiveTransition(leg.transition, leg.duration)
      const step: StepStatic = {
        offset: accumulated.offset,
        duration: effective.duration,
        isPhysics: effective.isPhysics,
        start: accumulated.running,
        to: leg.to,
        curve: effective.transition,
      }
      return [
        {
          offset: accumulated.offset + effective.duration,
          running: { ...accumulated.running, ...leg.to },
        },
        step,
      ]
    },
  )

  return { duration: state.offset, final: state.running, steps }
}

/** Wraps a property track endpoint as animated values. */
export const singleProp = (prop: string, value: Value): Values =>
  Record.singleton(prop, value)

const trackStaticOf = (track: Track): TrackStatic =>
  Track.match<TrackStatic>(track, {
    Tween: ({ prop, delay, duration, from, to, transition }) => {
      const effective = effectiveTransition(transition, duration)
      return {
        maybeProp: Option.some(prop),
        delay,
        duration: effective.duration,
        steps: [
          {
            offset: 0,
            duration: effective.duration,
            isPhysics: effective.isPhysics,
            start: singleProp(prop, from),
            to: singleProp(prop, to),
            curve: effective.transition,
          },
        ],
      }
    },
    Sequence: ({ prop, delay, from, steps }) => {
      const chained = chainSteps(
        singleProp(prop, from),
        Array.map(steps, step => ({
          duration: step.duration,
          to: singleProp(prop, step.to),
          transition: step.transition,
        })),
      )
      return {
        maybeProp: Option.some(prop),
        delay,
        duration: chained.duration,
        steps: chained.steps,
      }
    },
  })

const propsOf = (from: Values, to: Values): ReadonlyArray<string> =>
  Array.union(Record.keys(from), Record.keys(to))

const loopWhenAnimated = (loop: ClipLoop, duration: number): ClipLoop =>
  duration > 0 ? loop : 'Off'

/** Resolves one clip's duration, endpoints and sampling tracks. */
export const clipShapeOf = (clip: Clip): ClipShape =>
  Clip.match<ClipShape>(clip, {
    Marker: ({ at, duration }) => ({
      clip,
      at,
      duration,
      loop: 'Off',
      isPhysics: false,
      tracks: [],
      props: [],
      from: NO_VALUES,
      to: NO_VALUES,
    }),
    Tween: ({ at, duration, from, to, transition, loop }) => {
      const effective = effectiveTransition(transition, duration)
      const final = { ...from, ...to }
      return {
        clip,
        at,
        duration: effective.duration,
        loop: loopWhenAnimated(loop, effective.duration),
        isPhysics: effective.isPhysics,
        tracks: [
          {
            maybeProp: Option.none(),
            delay: 0,
            duration: effective.duration,
            steps: [
              {
                offset: 0,
                duration: effective.duration,
                isPhysics: effective.isPhysics,
                start: from,
                to,
                curve: effective.transition,
              },
            ],
          },
        ],
        props: propsOf(from, to),
        from,
        to: final,
      }
    },
    Sequence: ({ at, from, steps, loop }) => {
      const chained = chainSteps(from, steps)
      return {
        clip,
        at,
        duration: chained.duration,
        loop: loopWhenAnimated(loop, chained.duration),
        isPhysics: false,
        tracks: [
          {
            maybeProp: Option.none(),
            delay: 0,
            duration: chained.duration,
            steps: chained.steps,
          },
        ],
        props: propsOf(from, chained.final),
        from,
        to: chained.final,
      }
    },
    Tracks: ({ at, tracks: clipTracks, loop }) => {
      const trackStatics = Array.map(clipTracks, trackStaticOf)
      const duration = Array.reduce(trackStatics, 0, (extent, track) =>
        Math.max(extent, track.delay + track.duration),
      )
      return {
        clip,
        at,
        duration,
        loop: loopWhenAnimated(loop, duration),
        isPhysics: false,
        tracks: trackStatics,
        props: Array.map(clipTracks, ({ prop }) => prop),
        from: Record.fromEntries(
          Array.map(clipTracks, track => [track.prop, track.from]),
        ),
        to: Record.fromEntries(
          Array.map(clipTracks, track => [track.prop, finalTrackValue(track)]),
        ),
      }
    },
  })

const finalTrackValue = (track: Track): Value =>
  Track.match<Value>(track, {
    Tween: ({ to }) => to,
    Sequence: ({ steps }) => Array.lastNonEmpty(steps).to,
  })

/** Resolves a timeline for sampling. The duration grows past the authored
 *  window when a clip ends after it, as an edited physics spring can, and
 *  looping clips then run to the new end. */
export const resolve = (timeline: Timeline): TimelineStatic => {
  const shapes = Array.map(timeline.clips, timelineClip => ({
    timelineClip,
    shape: clipShapeOf(timelineClip.clip),
  }))
  const contentEnd = Array.reduce(shapes, 0, (end, { shape }) =>
    Math.max(end, shape.at + shape.duration),
  )
  const duration =
    contentEnd > timeline.minimumDuration
      ? ceilToHundredths(contentEnd)
      : timeline.minimumDuration

  return {
    duration,
    clips: Array.map(shapes, ({ timelineClip, shape }) => ({
      ...shape,
      key: clipKey(timelineClip),
      name: timelineClip.name,
      maybeGroup: timelineClip.maybeGroup,
      end: shape.loop === 'Off' ? shape.at + shape.duration : duration,
    })),
  }
}

/** The timeline's effective duration in seconds. */
export const durationOfTimeline = (timeline: Timeline): number =>
  resolve(timeline).duration
