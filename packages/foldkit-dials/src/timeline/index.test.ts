import { Array, Option, Predicate, Record, pipe } from 'effect'
import { describe, expect, it } from 'vitest'

import { Transition } from '../transition/index.js'
import * as Timeline from './index.js'

const easing = (
  duration: number,
  ease: readonly [number, number, number, number],
): Transition => Transition.Easing({ duration, ease })

const closeTo = (actual: number, expected: number, tolerance: number) => {
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance)
}

const clipAt = (
  timelineStatic: Timeline.TimelineStatic,
  index: number,
): Timeline.ClipStatic =>
  Option.getOrThrow(Array.get(timelineStatic.clips, index))

const numberAt = (values: Timeline.Values, prop: string): number =>
  pipe(
    Record.get(values, prop),
    Option.filter(Predicate.isNumber),
    Option.getOrThrow,
  )

const current = (clipValues: Timeline.ClipValues, prop: string): number =>
  Timeline.ClipValues.match(clipValues, {
    Marker: () => {
      throw new Error('markers have no values')
    },
    Tween: ({ current: values }) => numberAt(values, prop),
    Sequence: ({ current: values }) => numberAt(values, prop),
    Tracks: ({ current: values }) => numberAt(values, prop),
  })

const stepOf = (clipValues: Timeline.ClipValues): number =>
  Timeline.ClipValues.matchOrElse(
    clipValues,
    { Sequence: ({ step }) => step },
    () => {
      throw new Error('only sequences have steps')
    },
  )

const sample = (clip: Timeline.ClipStatic, time: number, cycleTime = time) =>
  Timeline.sampleClip(clip, time, cycleTime)

const scene = Timeline.make({
  duration: 4.8,
  clips: {
    circle: Timeline.group({
      path: Timeline.sequence({
        at: 0,
        loop: true,
        from: { x: -70, y: 0 },
        transition: easing(0.8, [0.65, 0, 0.35, 1]),
        steps: [
          { duration: 0.8, to: { x: 0, y: 36 } },
          { duration: 0.8, to: { x: 70, y: 0 } },
          { duration: 0.8, to: { x: -70 } },
        ],
      }),
      float: Timeline.tracks({
        at: 0,
        loop: true,
        props: {
          y: {
            from: -9,
            transition: easing(0.6, [0.45, 0, 0.55, 1]),
            steps: [
              { duration: 0.6, to: 9 },
              { duration: 0.6, to: -9 },
            ],
          },
          scale: {
            from: 0.94,
            delay: 0.12,
            transition: easing(0.6, [0.8, 0, 0.2, 1]),
            steps: [
              { duration: 0.6, to: 1.06 },
              { duration: 0.6, to: 0.94 },
            ],
          },
        },
      }),
    }),
  },
})

const resolvedScene = Timeline.resolve(scene)
const path = clipAt(resolvedScene, 0)
const float = clipAt(resolvedScene, 1)

describe('Timeline', () => {
  describe('make', () => {
    it('flattens groups into namespaced clips', () => {
      expect(Array.map(resolvedScene.clips, ({ key }) => key)).toEqual([
        'circle.path',
        'circle.float',
      ])
      expect(path.name).toBe('path')
      expect(path.maybeGroup).toEqual(Option.some('circle'))
    })

    it('keeps sequence steps and gives a props clip one track per property', () => {
      expect(path.clip._tag).toBe('Sequence')
      expect(Array.map(float.tracks, ({ maybeProp }) => maybeProp)).toEqual([
        Option.some('y'),
        Option.some('scale'),
      ])
    })

    it('keeps the configured loop and timeline duration', () => {
      expect([path.loop, float.loop]).toEqual(['Repeat', 'Repeat'])
      expect(scene.minimumDuration).toBe(4.8)
    })

    it('fits the window to the content when duration is omitted', () => {
      const fitted = Timeline.make({
        clips: {
          fade: Timeline.clip({
            at: 0.5,
            duration: 1.2,
            from: { x: 0 },
            to: { x: 1 },
          }),
        },
      })

      expect(fitted.minimumDuration).toBe(1.7)
    })

    it('extends the fitted window by track delays', () => {
      const fitted = Timeline.make({
        clips: {
          slide: Timeline.tracks({
            at: 0,
            props: { x: { from: 0, to: 1, duration: 1, delay: 0.6 } },
          }),
        },
      })

      expect(fitted.minimumDuration).toBe(1.6)
    })

    it('sanitizes malformed timing values', () => {
      const malformed = Timeline.make({
        duration: globalThis.Number.POSITIVE_INFINITY,
        clips: {
          skipped: Timeline.marker({ at: globalThis.Number.NaN, duration: 10 }),
          clamped: Timeline.tracks({
            at: -2,
            props: {
              x: {
                from: 0,
                to: 1,
                duration: -1,
                delay: globalThis.Number.POSITIVE_INFINITY,
              },
            },
          }),
        },
      })
      const clamped = clipAt(Timeline.resolve(malformed), 0)

      expect(malformed.minimumDuration).toBe(0.05)
      expect(Array.map(malformed.clips, ({ name }) => name)).toEqual([
        'clamped',
      ])
      expect(clamped.at).toBe(0)
      expect(
        Array.map(clamped.tracks, ({ delay, duration }) => [delay, duration]),
      ).toEqual([[0, 0.05]])
    })
  })

  describe('resolve', () => {
    it('sums a sequence from its legs and runs a looping clip to the timeline end', () => {
      closeTo(path.duration, 2.4, 1e-9)
      expect(path.end).toBe(4.8)
      expect([...path.props].sort()).toEqual(['x', 'y'])
    })

    it('measures a props clip by its widest track', () => {
      closeTo(float.duration, 1.32, 1e-9)
      expect(Array.map(float.tracks, ({ delay }) => delay)).toEqual([0, 0.12])
    })
  })

  describe('sequences', () => {
    it('starts at from', () => {
      const values = sample(path, 0)

      expect(current(values, 'x')).toBe(-70)
      expect(stepOf(values)).toBe(0)
    })

    it('lands each leg exactly', () => {
      const values = sample(path, 0.8 - 1e-9)

      closeTo(current(values, 'x'), 0, 0.1)
      closeTo(current(values, 'y'), 36, 0.1)
    })

    it('holds properties a leg leaves out', () => {
      const values = sample(path, 2.0)

      expect(stepOf(values)).toBe(2)
      expect(current(values, 'y')).toBe(0)
    })

    it('folds the cycle when looping', () => {
      const values = sample(path, 2.45)

      expect(stepOf(values)).toBe(0)
      closeTo(current(values, 'x'), -70, 5)
    })

    it('reports the merged final state as to', () => {
      expect(path.to).toEqual({ x: -70, y: 0 })
    })
  })

  describe('property tracks', () => {
    it('runs each track on its own curve', () => {
      const values = sample(float, 0.6 - 1e-9)

      closeTo(current(values, 'y'), 9, 0.05)
      expect(current(values, 'scale')).toBeLessThan(1.06 - 0.001)
    })

    it('keeps a delay as a phase shift across cycles', () => {
      closeTo(current(sample(float, 0.72 - 1e-9), 'scale'), 1.06, 0.01)
      closeTo(current(sample(float, 1.2 + 0.72 - 1e-9), 'scale'), 1.06, 0.01)
    })

    it('holds from until the delay elapses', () => {
      closeTo(current(sample(float, 0.05), 'scale'), 0.94, 0.01)
    })

    it('lets tracks have independent periods', () => {
      const edited = Timeline.modifyClip('circle.float', clip =>
        Timeline.setSpanDuration(
          clip,
          Timeline.Span.TrackStep({ prop: 'scale', index: 0 }),
          0.7,
        ),
      )(scene)
      const editedFloat = clipAt(Timeline.resolve(edited), 1)
      const values = sample(editedFloat, 0, 6.0)

      closeTo(
        Option.getOrThrow(Array.get(editedFloat.tracks, 0)).duration,
        1.2,
        1e-9,
      )
      closeTo(
        Option.getOrThrow(Array.get(editedFloat.tracks, 1)).duration,
        1.3,
        1e-9,
      )
      closeTo(current(values, 'y'), -9, 0.05)
      expect(Math.abs(current(values, 'scale') - 0.94)).toBeGreaterThan(0.005)
    })
  })

  describe('loop wraps', () => {
    it('matches the equivalent first-pass phase after wrapping', () => {
      const wrapped = sample(float, 0, 5.0)
      const firstPass = sample(float, 0.2)

      closeTo(current(wrapped, 'y'), current(firstPass, 'y'), 1e-6)
      expect(Math.abs(current(wrapped, 'y') - -9)).toBeGreaterThan(1)
    })

    it('pins the first-pass state when seeking', () => {
      closeTo(current(sample(float, 0), 'y'), -9, 1e-6)
    })
  })

  describe('tweens and markers', () => {
    const simple = Timeline.resolve(
      Timeline.make({
        clips: {
          fade: Timeline.clip({
            at: 0.5,
            duration: 1,
            from: { opacity: 0 },
            to: { opacity: 1 },
          }),
          beat: Timeline.marker({ at: 2 }),
        },
      }),
    )
    const fade = clipAt(simple, 0)
    const beat = clipAt(simple, 1)

    it('animates from to to through the default spring', () => {
      const midway = current(sample(fade, 1.0), 'opacity')

      expect(fade.duration).toBe(1)
      expect(midway).toBeGreaterThan(0)
      expect(midway).toBeLessThanOrEqual(1.2)
      closeTo(current(sample(fade, 3), 'opacity'), 1, 0.005)
    })

    it('reports animate as from before the start and to after it', () => {
      const before = sample(fade, 0.2)
      const after = sample(fade, 0.6)

      expect(before).toMatchObject({ animate: { opacity: 0 }, started: false })
      expect(after).toMatchObject({
        animate: { opacity: 1 },
        started: true,
        active: true,
      })
    })

    it('reports done once the clip ends', () => {
      expect(sample(fade, 1.6)).toMatchObject({
        done: true,
        active: false,
        progress: 1,
      })
    })

    it('gives markers timing and no values', () => {
      expect(beat.duration).toBe(0)
      expect(sample(beat, 2.1)).toMatchObject({ _tag: 'Marker', started: true })
      expect(sample(beat, 1.9)).toMatchObject({
        _tag: 'Marker',
        started: false,
      })
    })

    it('exposes the effective transition and its CSS for a tween', () => {
      const tween = clipAt(
        Timeline.resolve(
          Timeline.make({
            clips: {
              card: Timeline.clip({
                at: 0,
                duration: 0.8,
                from: { y: 24 },
                to: { y: 0 },
                transition: easing(0.3, [0.65, 0, 0.35, 1]),
              }),
            },
          }),
        ),
        0,
      )

      expect(sample(tween, 0)).toMatchObject({
        transition: { _tag: 'Easing', duration: 0.8 },
        css: {
          transitionDuration: '0.8s',
          transitionTimingFunction: 'cubic-bezier(0.65, 0, 0.35, 1)',
        },
      })
    })
  })

  describe('valuesAt', () => {
    it('nests grouped clips under their group, typed by the config', () => {
      const values = Timeline.valuesAt(scene, 0)

      expect(values.circle.path.current.x).toBe(-70)
      expect(values.circle.float.current.scale).toBe(0.94)
      expect(values.circle.path.step).toBe(0)
    })
  })

  describe('interpolate', () => {
    it('mixes hex colours in RGB', () => {
      expect(Timeline.interpolate('#000000', '#ffffff', 0.5)).toBe('#808080')
      expect(Timeline.interpolate('#000', '#fff', 1)).toBe('#ffffff')
    })

    it('switches other strings at the midpoint', () => {
      expect(Timeline.interpolate('auto', 'none', 0.4)).toBe('auto')
      expect(Timeline.interpolate('auto', 'none', 0.6)).toBe('none')
    })
  })

  describe('effectiveTransition', () => {
    it('injects the bar duration into easings and time springs', () => {
      expect(
        Timeline.effectiveTransition(easing(0, [0.65, 0, 0.35, 1]), 0.8),
      ).toEqual({
        transition: easing(0.8, [0.65, 0, 0.35, 1]),
        duration: 0.8,
        isPhysics: false,
      })
    })

    it('derives a physics spring duration from its settle time', () => {
      const physics = Transition.PhysicsSpring({
        stiffness: 100,
        damping: 10,
        mass: 1,
      })

      expect(Timeline.effectiveTransition(physics, 0.2)).toMatchObject({
        duration: 1.06,
        isPhysics: true,
      })
    })
  })

  describe('duration defaults', () => {
    it('defaults a tween with no duration or transition to the default spring settle time', () => {
      const fitted = Timeline.make({
        clips: {
          slide: Timeline.clip({ at: 0, from: { x: 0 }, to: { x: 1 } }),
        },
      })
      const slide = clipAt(Timeline.resolve(fitted), 0)

      expect(slide.duration).toBeGreaterThan(0.2)
      expect(slide.duration).toBeLessThan(1)
      closeTo(fitted.minimumDuration, slide.duration, 0.011)
    })

    it('uses a transition duration when duration is omitted', () => {
      const slide = Timeline.clip({
        at: 0,
        from: { x: 0 },
        to: { x: 1 },
        transition: easing(0.45, [0, 0, 1, 1]),
      })

      expect(slide.duration).toBe(0.45)
    })

    it('uses a physics settle time even when a duration is given', () => {
      const fitted = Timeline.make({
        clips: {
          bounce: Timeline.clip({
            at: 0,
            duration: 0.1,
            from: { x: 0 },
            to: { x: 1 },
            transition: Transition.PhysicsSpring({
              stiffness: 100,
              damping: 10,
              mass: 1,
            }),
          }),
        },
      })

      expect(fitted.minimumDuration).toBe(1.06)
      expect(clipAt(Timeline.resolve(fitted), 0).duration).toBe(1.06)
    })

    it('grows the timeline when an edited physics spring outgrows the window', () => {
      const authored = Timeline.make({
        clips: {
          dismiss: Timeline.clip({
            at: 1.8,
            duration: 0.35,
            from: { opacity: 1 },
            to: { opacity: 0 },
            transition: easing(0.35, [0.55, 0, 1, 0.45]),
          }),
        },
      })
      const edited = Timeline.modifyClip('dismiss', clip =>
        Timeline.setSpanTransition(
          clip,
          Timeline.Span.Whole(),
          Transition.PhysicsSpring({ stiffness: 200, damping: 25, mass: 1 }),
        ),
      )(authored)
      const resolved = Timeline.resolve(edited)

      expect(authored.minimumDuration).toBe(2.15)
      expect(clipAt(resolved, 0).duration).toBe(0.42)
      expect(resolved.duration).toBe(2.22)
    })

    it('keeps animated clips at the minimum length while markers may be instant', () => {
      const resolved = Timeline.resolve(
        Timeline.make({
          clips: {
            animated: Timeline.clip({
              at: 0,
              duration: 0,
              from: { opacity: 0 },
              to: { opacity: 1 },
              transition: easing(0, [0, 0, 1, 1]),
            }),
            beat: Timeline.marker({ at: 1, duration: 0 }),
          },
        }),
      )

      expect(clipAt(resolved, 0).duration).toBe(0.05)
      expect(clipAt(resolved, 1).duration).toBe(0)
    })
  })

  describe('edit clamps', () => {
    it('keeps bars inside the timeline', () => {
      expect(Timeline.clampClipMove(4.5, 1, 4.8)).toBe(3.8)
      expect(Timeline.clampClipMove(-1, 1, 4.8)).toBe(0)
      closeTo(Timeline.clampClipResizeEnd(10, 4, 4.8), 0.8, 1e-9)
      expect(Timeline.clampClipResizeStart(0.5, 0, 1)).toEqual({
        at: 0.5,
        duration: 0.5,
      })
      closeTo(Timeline.clampStepResize(10, 0, 1.6, 4.8), 3.2, 1e-9)
      expect(Timeline.clampTrackDelay(-1, 0, 1.2, 4.8)).toBe(0)
      expect(Timeline.clampTrackDelay(9, 0, 1.2, 4.8)).toBe(3.6)
    })
  })

  describe('loop region', () => {
    it('wraps back to the region start, not zero', () => {
      expect(Timeline.foldLoopTime(2.0, 4.8, 1.2)).toEqual({
        time: 2.0,
        wraps: 0,
      })

      const folded = Timeline.foldLoopTime(4.9, 4.8, 1.2)
      closeTo(folded.time, 1.3, 1e-9)
      expect(folded.wraps).toBe(1)
    })

    it('keeps continuous time from jumping at the wrap', () => {
      const span = Timeline.loopSpan(4.8, 1.2)
      const folded = Timeline.foldLoopTime(4.81, 4.8, 1.2)

      closeTo(folded.wraps * span + folded.time, 4.81, 1e-9)
    })

    it('treats a whole-timeline loop as a region starting at zero', () => {
      const folded = Timeline.foldLoopTime(5.0, 4.8, 0)

      closeTo(folded.time, 0.2, 1e-9)
      expect(folded.wraps).toBe(1)
      expect(Timeline.loopSpan(4.8, 0)).toBe(4.8)
    })

    it.each([
      ['a zero duration', 1, 0],
      ['a negative duration', 1, -2],
      ['a non-finite duration', 1, globalThis.Number.POSITIVE_INFINITY],
      ['a non-finite time', globalThis.Number.NaN, 4.8],
    ])('parks the playhead at 0 for %s', (_case, time, duration) => {
      expect(Timeline.foldLoopTime(time, duration, 0)).toEqual({
        time: 0,
        wraps: 0,
      })
    })

    it('falls back to whole-timeline looping for a start past the end', () => {
      const folded = Timeline.foldLoopTime(5.0, 4.8, 9)

      closeTo(folded.time, 0.2, 1e-9)
      expect(folded.wraps).toBe(1)
    })

    it('leaves intro clips finished once the region loops', () => {
      const loop = Timeline.TimelineLoop.Repeat({ from: 1.4 })
      const intro = clipAt(
        Timeline.resolve(
          Timeline.make({
            duration: 6,
            clips: {
              intro: Timeline.clip({
                at: 0.2,
                duration: 0.5,
                from: { opacity: 0 },
                to: { opacity: 1 },
              }),
            },
          }),
        ),
        0,
      )
      const wrapped = Timeline.foldLoopTime(6.3, 6, 1.4)
      const values = sample(
        intro,
        wrapped.time,
        Timeline.cycleTimeOf(wrapped.time, wrapped.wraps, 6, loop),
      )

      expect(values.done).toBe(true)
      closeTo(current(values, 'opacity'), 1, 0.005)
    })
  })

  describe('spans', () => {
    const pathClip = Option.getOrThrow(
      Timeline.findClip(scene, 'circle.path'),
    ).clip

    it('shows the clip from on the first step only', () => {
      expect(
        Timeline.spanFrom(pathClip, Timeline.Span.Step({ index: 0 })),
      ).toEqual({
        x: -70,
        y: 0,
      })
      expect(
        Timeline.spanFrom(pathClip, Timeline.Span.Step({ index: 1 })),
      ).toEqual({})
    })

    it('reads and writes a step target', () => {
      const span = Timeline.Span.Step({ index: 2 })
      const edited = Timeline.setSpanTo(pathClip, span, 'x', -40)

      expect(Timeline.spanTo(pathClip, span)).toEqual({ x: -70 })
      expect(Timeline.spanTo(edited, span)).toEqual({ x: -40 })
    })

    it('has no duration of its own for a sequence as a whole', () => {
      expect(Timeline.spanDuration(pathClip, Timeline.Span.Whole())).toEqual(
        Option.none(),
      )
      expect(
        Timeline.spanDuration(pathClip, Timeline.Span.Step({ index: 0 })),
      ).toEqual(Option.some(0.8))
    })
  })

  describe('valueRange', () => {
    it('uses property presets expanded to the endpoints', () => {
      expect(Timeline.valueRange('x', -70, Option.some(140))).toEqual({
        min: -100,
        max: 140,
        step: 1,
      })
      expect(Timeline.valueRange('opacity', 0, Option.some(1))).toEqual({
        min: 0,
        max: 1,
        step: 0.01,
      })
    })

    it('falls back to a range around the values', () => {
      expect(Timeline.valueRange('width', 120, Option.none())).toMatchObject({
        min: 0,
        max: 240,
      })
    })
  })

  describe('exportConfig', () => {
    it('drops zero delays and pins easing durations to the bar', () => {
      const edited = Timeline.modifyClip('circle.path', clip =>
        Timeline.setSpanDuration(clip, Timeline.Span.Step({ index: 0 }), 0.5),
      )(scene)

      expect(Timeline.exportConfig(edited)).toMatchObject({
        clips: {
          circle: {
            kind: 'group',
            clips: {
              path: { kind: 'sequence' },
              float: {
                kind: 'tracks',
                props: { y: { from: -9 }, scale: { delay: 0.12 } },
              },
            },
          },
        },
      })
      expect(Timeline.exportConfig(edited)).toHaveProperty(
        'clips.circle.clips.path.steps.0',
        {
          duration: 0.5,
          to: { x: 0, y: 36 },
          transition: {
            _tag: 'Easing',
            duration: 0.5,
            ease: [0.65, 0, 0.35, 1],
          },
        },
      )
      expect(Timeline.exportConfig(edited)).not.toHaveProperty(
        'clips.circle.clips.float.props.y.delay',
      )
    })

    it('exports the derived duration of a physics spring', () => {
      const bounce = Timeline.make({
        clips: {
          bounce: Timeline.clip({
            at: 0,
            from: { x: 0 },
            to: { x: 1 },
            transition: Transition.PhysicsSpring({
              stiffness: 100,
              damping: 10,
              mass: 1,
            }),
          }),
        },
      })

      expect(Timeline.exportConfig(bounce)).toMatchObject({
        clips: { bounce: { duration: 1.06 } },
      })
    })
  })

  describe('formatting', () => {
    it('formats clocks and step labels', () => {
      expect(Timeline.formatClock(63.25, 'Tenths')).toBe('01:03.3')
      expect(Timeline.formatClock(5)).toBe('00:05')
      expect(Timeline.formatStepLabel(1)).toBe('Step 2')
      expect(Timeline.formatSeconds(0.704)).toBe('0.7s')
    })
  })
})
