import { Array, Match, Number, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { clamp } from '../../internal/range.js'
import * as Timeline from '../../timeline/index.js'
import { ObserveRuler } from '../command.js'
import {
  FINE_TICKS_PER_MAJOR,
  MAJOR_TICK_TARGET_PIXELS,
  TICK_TOLERANCE,
  type ViewWindow,
} from '../geometry.js'
import type { Message } from '../message.js'
import type { Model } from '../model.js'
import { indicesFrom, percent } from './shared.js'

// VIEW

const MEDIUM_TICK_INTERVAL = 5

const MAX_RULER_DECIMALS = 3
const FULL_SCALE_ZOOM_LIMIT = 1.5
const TICK_TIME_DECIMALS = 6
const SECOND_TICK_STEPS: Array.NonEmptyReadonlyArray<number> = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60,
  120, 300, 600,
]

type TickKind = 'Major' | 'Medium' | 'Fine'

type Tick = Readonly<{ time: number; kind: TickKind }>

const majorTickStep = (
  viewWindow: ViewWindow,
  rulerWidth: number,
  zoom: number,
): number => {
  const pixelsPerSecond =
    viewWindow.visible > 0 && rulerWidth > 0
      ? rulerWidth / viewWindow.visible
      : 0
  const rawStep =
    pixelsPerSecond > 0 ? MAJOR_TICK_TARGET_PIXELS / pixelsPerSecond : 1
  const adaptiveStep = Option.getOrElse(
    Array.findFirst(SECOND_TICK_STEPS, step => step >= rawStep),
    () => Array.lastNonEmpty(SECOND_TICK_STEPS),
  )

  if (zoom < FULL_SCALE_ZOOM_LIMIT && viewWindow.duration >= 1) {
    return Math.max(1, adaptiveStep)
  } else {
    return adaptiveStep
  }
}

const tickKindOf = (index: number): TickKind => {
  if (index % FINE_TICKS_PER_MAJOR === 0) {
    return 'Major'
  } else if (index % MEDIUM_TICK_INTERVAL === 0) {
    return 'Medium'
  } else {
    return 'Fine'
  }
}

const ticksOf = (
  viewWindow: ViewWindow,
  majorStep: number,
): ReadonlyArray<Tick> => {
  const fineStep = majorStep / FINE_TICKS_PER_MAJOR
  const firstIndex = Math.ceil((viewWindow.start - TICK_TOLERANCE) / fineStep)
  const lastIndex = Math.floor(
    (viewWindow.start + viewWindow.visible + TICK_TOLERANCE) / fineStep,
  )

  return Array.map(
    indicesFrom(firstIndex, lastIndex - firstIndex + 1),
    index => ({
      time: Number.round(index * fineStep, TICK_TIME_DECIMALS),
      kind: tickKindOf(index),
    }),
  )
}

const formatRulerSeconds = (time: number, step: number): string => {
  if (step >= 1 && globalThis.Number.isInteger(time)) {
    return Timeline.formatClock(time)
  } else {
    const decimals = clamp(Math.ceil(-Math.log10(step)), 1, MAX_RULER_DECIMALS)
    return `${time.toFixed(decimals)}s`
  }
}

const tickClass = (kind: TickKind): string =>
  Match.value(kind).pipe(
    Match.withReturnType<string>(),
    Match.when('Major', () => 'dialkit-timeline-tick'),
    Match.when(
      'Medium',
      () => 'dialkit-timeline-tick dialkit-timeline-tick-medium',
    ),
    Match.when(
      'Fine',
      () => 'dialkit-timeline-tick dialkit-timeline-tick-fine',
    ),
    Match.exhaustive,
  )

/** Renders the ruler, with labelled ticks at a step that suits the zoom. */
export const rulerView = (
  model: Model,
  viewWindow: ViewWindow,
  h: HtmlBuilder<Message>,
): Html => {
  const majorStep = majorTickStep(viewWindow, model.rulerWidth, model.zoom)

  return h.div(
    [h.Class('dialkit-timeline-row dialkit-timeline-ruler-row')],
    [
      h.div([h.Class('dialkit-timeline-label')]),
      h.div(
        [
          h.Class('dialkit-timeline-ruler'),
          h.DataAttribute('dial-timeline-ruler', model.id),
          h.Title(
            'Drag to seek. Option-drag to zoom. Shift-drag to reset zoom.',
          ),
          h.OnMount(ObserveRuler()),
        ],
        Array.map(ticksOf(viewWindow, majorStep), ({ time, kind }) =>
          h.keyed('div')(
            `tick-${time}`,
            [
              h.Class(tickClass(kind)),
              h.Style({
                left: percent((time - viewWindow.start) / viewWindow.visible),
              }),
            ],
            kind === 'Major'
              ? [
                  h.span(
                    [h.Class('dialkit-timeline-tick-label')],
                    [formatRulerSeconds(time, majorStep)],
                  ),
                ]
              : [],
          ),
        ),
      ),
    ],
  )
}
