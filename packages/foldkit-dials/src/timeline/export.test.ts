import { Array, Schema } from 'effect'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

import { Transition } from '../transition/index.js'
import * as Timeline from './index.js'

const easing = Transition.Easing({
  duration: 0.3141592653589793,
  ease: [0.123456789, -0.456789123, 0.876543219, 1.23456789],
})

const roundTrip = (timeline: Timeline.Timeline): Timeline.Timeline => {
  const rebuilt: unknown = runInNewContext(
    Timeline.toTimelineSource(timeline),
    { Timeline, Transition: { Transition } },
  )
  expect(Schema.is(Timeline.Timeline)(rebuilt)).toBe(true)
  if (!Schema.is(Timeline.Timeline)(rebuilt)) {
    throw new Error('Source must reconstruct a Timeline')
  }
  expect(rebuilt).toEqual(timeline)
  expect(Timeline.exportConfig(rebuilt)).toEqual(
    Timeline.exportConfig(timeline),
  )
  Array.range(-10, 200).forEach(tick => {
    expect(Timeline.valuesAt(rebuilt, tick / 20)).toEqual(
      Timeline.valuesAt(timeline, tick / 20),
    )
  })
  return rebuilt
}

describe('toTimelineSource', () => {
  it('preserves tuned spans and disjoint partial sequence updates', () => {
    const timeline = Timeline.make({
      duration: 0.1234567890123456,
      clips: {
        motion: Timeline.sequence({
          at: 0.3333333333333333,
          loop: true,
          from: { x: -1.2345678901234567, label: 'start', held: 7 },
          transition: easing,
          steps: [{ to: { x: 9 } }, { to: { label: 'end' } }, { to: {} }],
        }),
      },
    })
    const edited = Timeline.modifyClip('motion', clip =>
      Timeline.setSpanDuration(
        Timeline.setSpanTo(clip, Timeline.Span.Step({ index: 0 }), 'x', 8.9),
        Timeline.Span.Step({ index: 1 }),
        1.27,
      ),
    )(timeline)
    roundTrip(edited)
    expect(Timeline.toTimelineSource(edited)).toContain('duration: 1.27,')
    expect(Timeline.toTimelineSource(edited)).toContain(
      'duration: 0.3141592653589793,',
    )
  })

  it('retains groups, clip families and independent track sequences after edits', () => {
    const physics = Transition.PhysicsSpring({
      stiffness: 123.456789,
      damping: 14.1234567,
      mass: 1.2345678,
    })
    const spring = Transition.TimeSpring({
      visualDuration: 0.27182818,
      bounce: 0.2345678,
    })
    const timeline = Timeline.make({
      duration: 0.7,
      clips: {
        first: Timeline.group({
          marker: Timeline.marker({ at: 0 }),
          tween: Timeline.clip({
            at: 0.123456789,
            duration: 1.456789123,
            from: { x: 0 },
            to: { x: 1 },
            transition: spring,
          }),
        }),
        middle: Timeline.tracks({
          at: 0.23456789,
          loop: true,
          props: {
            x: { delay: 0.123456789, from: 0, to: 1, transition: physics },
            label: {
              from: 'before',
              steps: [
                { to: 'middle', transition: spring },
                { to: 'after', transition: easing },
              ],
            },
          },
        }),
        last: Timeline.group({
          marker: Timeline.marker({ at: 2.12345678, duration: 0.456789123 }),
        }),
      },
    })
    const edited = Timeline.modifyClip('middle', clip =>
      Timeline.setTrackDelay(
        Timeline.setSpanTransition(
          clip,
          Timeline.Span.TrackStep({ prop: 'label', index: 0 }),
          physics,
        ),
        'label',
        0.42,
      ),
    )(timeline)
    roundTrip(edited)
  })

  it('keeps the authored editing window when content grows and later shrinks', () => {
    const initial = Timeline.make({
      duration: 0.7654321098765432,
      clips: { marker: Timeline.marker({ at: 0 }) },
    })
    const extended = Timeline.modifyClip('marker', clip =>
      Timeline.setClipStart(clip, 5),
    )(initial)
    const rebuilt = roundTrip(extended)
    expect(rebuilt.minimumDuration).toBe(initial.minimumDuration)
    const shortened = Timeline.modifyClip('marker', clip =>
      Timeline.setClipStart(clip, 0),
    )(rebuilt)
    expect(Timeline.durationOfTimeline(shortened)).toBe(initial.minimumDuration)
  })

  it('escapes strings and emits safe computed record keys', () => {
    const tricky =
      'quote\'"\\\n\r\t\0\u2028\u2029💚\ud800`; throw new Error("injected"); //'
    const timeline = Timeline.make({
      clips: {
        [tricky]: Timeline.clip({
          at: 0,
          from: { [tricky]: tricky, ['__proto__']: -0 },
          to: { ['__proto__']: 2 },
          transition: easing,
        }),
        ['__proto__']: Timeline.group({
          ['__proto__']: Timeline.tracks({
            at: 0,
            props: {
              ['__proto__']: { from: tricky, to: 'end', transition: easing },
            },
          }),
        }),
        ['default']: Timeline.marker({ at: 1 }),
        ['a.b']: Timeline.marker({ at: 2 }),
      },
    })
    const rebuilt = roundTrip(timeline)
    expect(Timeline.toTimelineSource(rebuilt)).toContain('["__proto__"]:')
    expect(Timeline.toTimelineSource(rebuilt)).toContain('\\u2028\\u2029')
  })

  it('exports empty timelines and constructor-normalized timing defaults', () => {
    roundTrip(Timeline.make({ clips: {} }))
    roundTrip(
      Timeline.make({
        clips: {
          tween: Timeline.clip({ at: -1, duration: 0, from: {}, to: {} }),
          marker: Timeline.marker({ at: 0, duration: -1 }),
        },
      }),
    )
  })
})
