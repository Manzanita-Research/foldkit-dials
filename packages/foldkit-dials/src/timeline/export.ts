import { Array, Number, Option, Predicate, Record } from 'effect'

import { createTransitionSource } from '../internal/transitionSource.js'
import { Transition } from '../transition/index.js'
import { nestByGroup } from './grouping.js'
import {
  Clip,
  type ClipLoop,
  type Timeline,
  type TimelineClip,
  Track,
  type Value,
  type Values,
} from './model.js'
import { resolve } from './resolve.js'
import { effectiveTransition } from './timing.js'

const EXPORT_DECIMALS = 3

// EXPORT

const roundForExport = (value: number): number =>
  Number.round(value, EXPORT_DECIMALS)

const exportValues = (values: Values): Readonly<Record<string, Value>> =>
  Record.map(values, value =>
    Predicate.isNumber(value) ? roundForExport(value) : value,
  )

const exportTransition = (
  transition: Transition,
  duration: number,
): Readonly<Record<string, unknown>> =>
  Transition.match<Readonly<Record<string, unknown>>>(
    effectiveTransition(transition, duration).transition,
    {
      Easing: ({ duration: easingDuration, ease }) => ({
        _tag: 'Easing',
        duration: roundForExport(easingDuration),
        ease: Array.map(ease, roundForExport),
      }),
      TimeSpring: ({ visualDuration, bounce }) => ({
        _tag: 'TimeSpring',
        visualDuration: roundForExport(visualDuration),
        bounce: roundForExport(bounce),
      }),
      PhysicsSpring: ({ stiffness, damping, mass }) => ({
        _tag: 'PhysicsSpring',
        stiffness: roundForExport(stiffness),
        damping: roundForExport(damping),
        mass: roundForExport(mass),
      }),
    },
  )

const exportDuration = (transition: Transition, duration: number): number =>
  roundForExport(effectiveTransition(transition, duration).duration)

const exportLoop = (loop: ClipLoop): Readonly<Record<string, unknown>> =>
  loop === 'Repeat' ? { loop: true } : {}

const exportTrack = (track: Track): Readonly<Record<string, unknown>> => {
  const delay = track.delay > 0 ? { delay: roundForExport(track.delay) } : {}

  return Track.match<Readonly<Record<string, unknown>>>(track, {
    Tween: ({ from, to, duration, transition }) => ({
      from,
      to,
      duration: exportDuration(transition, duration),
      ...delay,
      transition: exportTransition(transition, duration),
    }),
    Sequence: ({ from, steps }) => ({
      from,
      ...delay,
      steps: Array.map(steps, step => ({
        duration: exportDuration(step.transition, step.duration),
        to: step.to,
        transition: exportTransition(step.transition, step.duration),
      })),
    }),
  })
}

const exportClip = (clip: Clip): Readonly<Record<string, unknown>> =>
  Clip.match<Readonly<Record<string, unknown>>>(clip, {
    Marker: ({ at, duration }) => ({
      kind: 'marker',
      at: roundForExport(at),
      duration: roundForExport(duration),
    }),
    Tween: ({ at, duration, from, to, transition, loop }) => ({
      kind: 'clip',
      at: roundForExport(at),
      duration: exportDuration(transition, duration),
      from: exportValues(from),
      to: exportValues(to),
      transition: exportTransition(transition, duration),
      ...exportLoop(loop),
    }),
    Sequence: ({ at, from, steps, loop }) => ({
      kind: 'sequence',
      at: roundForExport(at),
      from: exportValues(from),
      steps: Array.map(steps, step => ({
        duration: exportDuration(step.transition, step.duration),
        to: exportValues(step.to),
        transition: exportTransition(step.transition, step.duration),
      })),
      ...exportLoop(loop),
    }),
    Tracks: ({ at, tracks: clipTracks, loop }) => ({
      kind: 'tracks',
      at: roundForExport(at),
      props: Record.fromEntries(
        Array.map(clipTracks, track => [track.prop, exportTrack(track)]),
      ),
      ...exportLoop(loop),
    }),
  })

/** The tuned timeline as plain data in the shape of `make`'s config. Each
 *  clip records which constructor builds it under `kind`, and every
 *  duration and transition is the effective one. */
export const exportConfig = (
  timeline: Timeline,
): Readonly<Record<string, unknown>> => ({
  duration: roundForExport(resolve(timeline).duration),
  clips: nestByGroup(
    timeline.clips,
    ({ clip: timelineClip }) => exportClip(timelineClip),
    clips => ({ kind: 'group', clips }),
  ),
})

const JSON_INDENT = 2

/** The instruction Copy writes to the clipboard: the tuned config as JSON,
 *  and a production handoff note, as DialKit's Copy does. */
export const copyInstruction = (name: string, timeline: Timeline): string => {
  const json = JSON.stringify(exportConfig(timeline), null, JSON_INDENT)

  return `Update the Timeline.make configuration for "${name}" with these values:

\`\`\`json
${json}
\`\`\`

Each clip's \`kind\` names the constructor that builds it: Timeline.clip, Timeline.sequence, Timeline.tracks, Timeline.marker, or Timeline.group. Apply these values as the new defaults. Keep the existing \`clip.current\` bindings while this timeline is being authored; do not convert the animation or remove the dock yet.

Add this comment immediately above the Timeline.make call as a production handoff note:

\`\`\`ts
// TODO(production): the dock's clip.current values are the scrubbable authoring preview.
// Replace them with equivalent real animations using the tuned timeline
// timings and transitions, then remove Timeline.make and the DialTimeline dock.
\`\`\``
}

// TYPESCRIPT SOURCE

const SOURCE_INDENT = '  '

const sourceNumber = (value: number): string =>
  Object.is(value, -0) ? '-0' : value.toString()

const sourceString = (value: string): string =>
  JSON.stringify(value)
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')

const sourceTransition = createTransitionSource(sourceNumber, {
  TimeSpring: 'Transition.Transition.TimeSpring',
  PhysicsSpring: 'Transition.Transition.PhysicsSpring',
  Easing: 'Transition.Transition.Easing',
})

type SourceField = readonly [key: string, expression: string]

const sourceObject = (
  fields: ReadonlyArray<SourceField>,
  depth: number,
): string =>
  Array.isReadonlyArrayEmpty(fields)
    ? '{}'
    : `{\n${Array.join(
        Array.map(
          fields,
          ([key, expression]) =>
            `${SOURCE_INDENT.repeat(depth + 1)}${key}: ${expression},`,
        ),
        '\n',
      )}\n${SOURCE_INDENT.repeat(depth)}}`

const sourceArray = (items: ReadonlyArray<string>, depth: number): string =>
  `[\n${Array.join(
    Array.map(items, item => `${SOURCE_INDENT.repeat(depth + 1)}${item},`),
    '\n',
  )}\n${SOURCE_INDENT.repeat(depth)}]`

const sourceKey = (key: string): string => `[${sourceString(key)}]`

const sourceValue = (value: Value): string =>
  Predicate.isNumber(value) ? sourceNumber(value) : sourceString(value)

const sourceValues = (values: Values, depth: number): string =>
  sourceObject(
    Array.map(Record.toEntries(values), ([key, value]) => [
      sourceKey(key),
      sourceValue(value),
    ]),
    depth,
  )

const sourceTiming = (
  duration: number,
  transition: Transition,
): ReadonlyArray<SourceField> => [
  ['duration', sourceNumber(duration)],
  ['transition', sourceTransition(transition)],
]

const sourceLoop = (loop: ClipLoop): ReadonlyArray<SourceField> =>
  loop === 'Repeat' ? [['loop', 'true']] : []

const sourceTrack = (track: Track, depth: number): string =>
  Track.match<string>(track, {
    Tween: ({ delay, from, to, duration, transition }) =>
      sourceObject(
        [
          ['delay', sourceNumber(delay)],
          ['from', sourceValue(from)],
          ['to', sourceValue(to)],
          ...sourceTiming(duration, transition),
        ],
        depth,
      ),
    Sequence: ({ delay, from, steps }) =>
      sourceObject(
        [
          ['delay', sourceNumber(delay)],
          ['from', sourceValue(from)],
          [
            'steps',
            sourceArray(
              Array.map(steps, step =>
                sourceObject(
                  [
                    ['to', sourceValue(step.to)],
                    ...sourceTiming(step.duration, step.transition),
                  ],
                  depth + 2,
                ),
              ),
              depth + 1,
            ),
          ],
        ],
        depth,
      ),
  })

const sourceClip = (clip: Clip, depth: number): string =>
  Clip.match<string>(clip, {
    Marker: ({ at, duration }) =>
      `Timeline.marker(${sourceObject(
        [
          ['at', sourceNumber(at)],
          ['duration', sourceNumber(duration)],
        ],
        depth,
      )})`,
    Tween: ({ at, from, to, duration, transition, loop }) =>
      `Timeline.clip(${sourceObject(
        [
          ['at', sourceNumber(at)],
          ['from', sourceValues(from, depth + 1)],
          ['to', sourceValues(to, depth + 1)],
          ...sourceTiming(duration, transition),
          ...sourceLoop(loop),
        ],
        depth,
      )})`,
    Sequence: ({ at, from, steps, loop }) =>
      `Timeline.sequence(${sourceObject(
        [
          ['at', sourceNumber(at)],
          ['from', sourceValues(from, depth + 1)],
          [
            'steps',
            sourceArray(
              Array.map(steps, step =>
                sourceObject(
                  [
                    ['to', sourceValues(step.to, depth + 3)],
                    ...sourceTiming(step.duration, step.transition),
                  ],
                  depth + 2,
                ),
              ),
              depth + 1,
            ),
          ],
          ...sourceLoop(loop),
        ],
        depth,
      )})`,
    Tracks: ({ at, tracks: clipTracks, loop }) =>
      `Timeline.tracks(${sourceObject(
        [
          ['at', sourceNumber(at)],
          [
            'props',
            sourceObject(
              Array.map(clipTracks, track => [
                sourceKey(track.prop),
                sourceTrack(track, depth + 2),
              ]),
              depth + 1,
            ),
          ],
          ...sourceLoop(loop),
        ],
        depth,
      )})`,
  })

const sourceEntries = (
  clips: ReadonlyArray<TimelineClip>,
): ReadonlyArray<SourceField> =>
  Array.flatMap(clips, ({ name, maybeGroup, clip }, index) =>
    Option.match(maybeGroup, {
      onNone: (): ReadonlyArray<SourceField> => [
        [sourceKey(name), sourceClip(clip, 2)],
      ],
      onSome: groupName => {
        const isInGroup = (entry: TimelineClip): boolean =>
          Option.contains(entry.maybeGroup, groupName)
        return Option.contains(Array.findFirstIndex(clips, isInGroup), index)
          ? [
              [
                sourceKey(groupName),
                `Timeline.group(${sourceObject(
                  Array.map(Array.filter(clips, isInGroup), entry => [
                    sourceKey(entry.name),
                    sourceClip(entry.clip, 3),
                  ]),
                  2,
                )})`,
              ],
            ]
          : []
      },
    }),
  )

/** A paste-ready `Timeline.make(...)` TypeScript expression. Import
 *  `{ Timeline, Transition }` from `foldkit-dials` where it is pasted.
 *  Constructors retain inferred clip/property types, full numeric precision,
 *  stored transitions, bar durations, partial updates, clip loops, group and
 *  clip order, and the authored minimum editing window.
 *
 *  Input must be a timeline produced by `make` and the dock's edits: names
 *  must be representable by unique record keys, grouped clips contiguous,
 *  and timing values normalized by the constructors. Empty groups have no
 *  representation in the parsed model. Dock playback loop state lives
 *  outside the timeline and is not exported. This pure helper does not change
 *  `exportConfig`, `copyInstruction`, or the dock's clipboard behavior. */
export const toTimelineSource = (timeline: Timeline): string =>
  `Timeline.make(${sourceObject(
    [
      ['duration', sourceNumber(timeline.minimumDuration)],
      ['clips', sourceObject(sourceEntries(timeline.clips), 1)],
    ],
    0,
  )})`
