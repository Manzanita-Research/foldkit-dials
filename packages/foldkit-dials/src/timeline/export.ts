import { Array, Number, Predicate, Record } from 'effect'

import { Transition } from '../transition/index.js'
import { nestByGroup } from './grouping.js'
import {
  Clip,
  type ClipLoop,
  type Timeline,
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
