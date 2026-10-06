import { Option } from 'effect'

import { clamp } from '../internal/range.js'
import * as Timeline from '../timeline/index.js'
import type { Model } from './model.js'

// GEOMETRY

const MIN_MAX_ZOOM = 8
const MILLISECOND_STEP = 0.001

/** The spacing the ruler aims for between labelled ticks. */
export const MAJOR_TICK_TARGET_PIXELS = 140

/** Fine ruler ticks per labelled tick. */
export const FINE_TICKS_PER_MAJOR = 10

/** The shortest the dock can be, in pixels. */
export const MIN_DOCK_HEIGHT = 120

/** The room the dock leaves at the top of the viewport, in pixels. */
export const DOCK_VIEWPORT_MARGIN = 24

/** Slack for comparing tick and cycle times. */
export const TICK_TOLERANCE = 1e-6

/** The visible slice of the timeline. */
export type ViewWindow = Readonly<{
  duration: number
  start: number
  visible: number
}>

/** Clamps the start of the visible window so it stays inside the
 *  timeline. */
export const clampViewStart = (
  start: number,
  duration: number,
  visible: number,
): number => clamp(start, 0, Math.max(0, duration - visible))

/** The visible slice of a timeline of `duration` at the Model's zoom and
 *  pan. */
export const viewWindowOf = (model: Model, duration: number): ViewWindow => {
  const visible = duration > 0 ? duration / model.zoom : duration
  return {
    duration,
    start: clampViewStart(model.viewStart, duration, visible),
    visible,
  }
}

/** The deepest zoom, where the finest ruler step still spaces its ticks. */
export const maxZoomOf = (duration: number, rulerWidth: number): number => {
  if (rulerWidth > 0 && duration > 0) {
    return Math.max(
      MIN_MAX_ZOOM,
      (MAJOR_TICK_TARGET_PIXELS * duration) /
        (MILLISECOND_STEP * FINE_TICKS_PER_MAJOR * rulerWidth),
    )
  } else {
    return MIN_MAX_ZOOM
  }
}

/** The edited timeline's effective duration in seconds. */
export const durationOf = (model: Model): number =>
  Timeline.durationOfTimeline(model.timeline)

/** Continuous time across loop wraps, for sampling looping clips. */
export const cycleTimeOf = (model: Model): number =>
  Timeline.cycleTimeOf(model.time, model.wraps, durationOf(model), model.loop)

/** The tallest the dock can be: the viewport less a margin, once the
 *  viewport height is known. */
export const maybeMaxDockHeightOf = (model: Model): Option.Option<number> =>
  Option.map(model.maybeViewportHeight, viewportHeight =>
    Math.max(MIN_DOCK_HEIGHT, viewportHeight - DOCK_VIEWPORT_MARGIN),
  )

/** Keeps a dock height between the minimum and the viewport bound. */
export const clampDockHeight = (model: Model, height: number): number =>
  Option.match(maybeMaxDockHeightOf(model), {
    onNone: () => Math.max(MIN_DOCK_HEIGHT, height),
    onSome: maxHeight => clamp(height, MIN_DOCK_HEIGHT, maxHeight),
  })
