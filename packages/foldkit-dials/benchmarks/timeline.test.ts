import { Array, Record } from 'effect'
import * as Scene from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { defineView } from 'foldkit/submodel'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { arch, platform, release } from 'node:os'
import { performance } from 'node:perf_hooks'
import { expect, it, vi } from 'vitest'

import * as Dock from '../src/dialTimeline/index.js'
import * as Timeline from '../src/timeline/index.js'
import { Transition } from '../src/transition/index.js'

const WARMUP_MILLISECONDS = 100
const BATCH_MILLISECONDS = 100
const BATCH_COUNT = 9
const SAMPLE_TIME = 1.5
const EQUIVALENCE_TIMES = [-0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.7, 1.5, 3, 6, 7]
const EQUIVALENCE_WRAPS = [0, 1, 3]

const easing = Transition.Easing({ duration: 0.5, ease: [0.65, 0, 0.35, 1] })
const spring = Transition.PhysicsSpring({
  stiffness: 120,
  damping: 12,
  mass: 1,
})

const group = () =>
  Timeline.group({
    fade: Timeline.clip({
      at: 0.2,
      duration: 0.5,
      from: { opacity: 0 },
      to: { opacity: 1 },
      transition: easing,
    }),
    path: Timeline.sequence({
      at: 0.4,
      loop: true,
      from: { x: 0, y: 0, color: '#000000' },
      transition: easing,
      steps: [
        { duration: 0.5, to: { x: 30, color: '#ff0000' } },
        { duration: 0.5, to: { y: 20 } },
        { duration: 0.5, to: { x: 0, y: 0, color: '#000000' } },
      ],
    }),
    float: Timeline.tracks({
      at: 0.1,
      loop: true,
      props: {
        y: {
          from: -9,
          transition: easing,
          steps: [
            { duration: 0.6, to: 9 },
            { duration: 0.6, to: -9 },
          ],
        },
        scale: {
          from: 0.94,
          delay: 0.12,
          transition: easing,
          steps: [
            { duration: 0.6, to: 1.06 },
            { duration: 0.6, to: 0.94 },
          ],
        },
        opacity: {
          from: 0,
          to: 1,
          duration: 0.5,
          delay: 0.2,
          transition: spring,
        },
      },
    }),
    bounce: Timeline.clip({
      at: 0.3,
      loop: true,
      from: { scale: 0 },
      to: { scale: 1 },
      transition: spring,
    }),
  })

const fixture = (groupCount: number) =>
  Timeline.make({
    duration: 6,
    clips: {
      intro: Timeline.clip({
        at: 0,
        duration: 0.5,
        from: { opacity: 0 },
        to: { opacity: 1 },
        transition: easing,
      }),
      cue: Timeline.marker({ at: 3, duration: 0.2 }),
      ...Record.fromEntries(
        Array.makeBy(groupCount, index => [`group${index}`, group()]),
      ),
    },
  })

const batch = (operation: () => unknown, milliseconds: number): number => {
  const start = performance.now()
  let count = 0
  do {
    operation()
    count += 1
  } while (performance.now() - start < milliseconds)
  return ((performance.now() - start) * 1000) / count
}

const measure = (operation: () => unknown) => {
  batch(operation, WARMUP_MILLISECONDS)
  const samples = Array.makeBy(BATCH_COUNT, () =>
    batch(operation, BATCH_MILLISECONDS),
  ).sort((a, b) => a - b)
  return {
    medianMicroseconds: samples[Math.floor(BATCH_COUNT / 2)],
    minMicroseconds: samples[0],
    maxMicroseconds: samples[BATCH_COUNT - 1],
  }
}

it('measures timeline evaluation stages', () => {
  const results = Array.map([2, 20, 100], groupCount => {
    const timeline = fixture(groupCount)
    const dock = Dock.make({ name: 'Benchmark', timeline, loop: { from: 1 } })
    const model = modifyFields(dock.init(), {
      time: () => SAMPLE_TIME,
      wraps: () => 2,
      rulerWidth: () => 1000,
    })
    const resolved = Timeline.resolve(timeline)
    const cycleTime = Timeline.cycleTimeOf(
      model.time,
      model.wraps,
      resolved.duration,
      model.loop,
    )
    const tick = Dock.Message.TickedFrame({ deltaTime: 16 })
    const stages = {
      resolve: measure(() => Timeline.resolve(timeline)),
      sampleResolved: measure(() =>
        Timeline.sampleTimeline(resolved, model.time, cycleTime),
      ),
      valuesAt: measure(() =>
        Timeline.valuesAt(timeline, model.time, cycleTime),
      ),
      valuesOfSeparateResolution: measure(() =>
        Timeline.valuesAt(
          model.timeline,
          model.time,
          Timeline.cycleTimeOf(
            model.time,
            model.wraps,
            Timeline.durationOfTimeline(model.timeline),
            model.loop,
          ),
        ),
      ),
      valuesOf: measure(() => Dock.valuesOf(model)),
      typedValuesOf: measure(() => dock.valuesOf(model)),
      tick: measure(() => Dock.update(model, tick)),
    }
    const renderReports: Array<
      Readonly<Record<string, ReturnType<typeof measure>>>
    > = []
    Scene.scene(
      {
        update: Dock.update,
        view: defineView<Dock.Model, Dock.Message>((sceneModel, h) => {
          const dockView = measure(() => Dock.view(sceneModel, h))
          const evaluation = measure(() => {
            const nextModel = Dock.update(sceneModel, tick).model
            dock.valuesOf(nextModel)
            Dock.view(nextModel, h)
          })
          const resolve = vi
            .spyOn(Timeline, 'resolve')
            .mockReturnValue(resolved)
          const dockViewResolved = measure(() => Dock.view(sceneModel, h))
          resolve.mockRestore()
          renderReports.push({ dockView, evaluation, dockViewResolved })
          return h.div([])
        }),
      },
      Scene.given(model),
    )
    expect(dock.valuesOf(model)).toEqual(
      Timeline.valuesAt(timeline, model.time, cycleTime),
    )
    const samples = Array.flatMap(EQUIVALENCE_WRAPS, wraps =>
      Array.map(EQUIVALENCE_TIMES, time =>
        dock.valuesOf(
          modifyFields(model, { time: () => time, wraps: () => wraps }),
        ),
      ),
    )
    return {
      groupCount,
      clipCount: resolved.clips.length,
      trackCount: Array.reduce(
        resolved.clips,
        0,
        (count, clip) => count + clip.tracks.length,
      ),
      stepCount: Array.reduce(
        resolved.clips,
        0,
        (count, clip) =>
          count +
          Array.reduce(
            clip.tracks,
            0,
            (steps, track) => steps + track.steps.length,
          ),
      ),
      valuesDigest: createHash('sha256')
        .update(JSON.stringify(samples))
        .digest('hex'),
      stages: { ...stages, ...renderReports[0] },
    }
  })
  const report = {
    node: process.version,
    platform: `${platform()} ${release()} ${arch()}`,
    warmupMilliseconds: WARMUP_MILLISECONDS,
    batchMilliseconds: BATCH_MILLISECONDS,
    batchCount: BATCH_COUNT,
    results,
  }
  if (process.env.BENCHMARK_OUTPUT) {
    writeFileSync(
      process.env.BENCHMARK_OUTPUT,
      `${JSON.stringify(report, null, 2)}\n`,
    )
  }
  console.log(JSON.stringify(report, null, 2))
})
