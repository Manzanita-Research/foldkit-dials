import { Array, Equal, Match, Option, pipe } from 'effect'
import type {
  Attribute,
  Html,
  HtmlBuilder,
  KeyboardModifiers,
} from 'foldkit/html'

import * as Timeline from '../../timeline/index.js'
import { findRuler, fractionWithin, isLeftButton } from '../dom.js'
import { TICK_TOLERANCE, type ViewWindow } from '../geometry.js'
import { barHelpId, barId, editorId, segmentId } from '../ids.js'
import { Message, type NudgeSize } from '../message.js'
import { BarHandle, BarRow, DragState, type Model } from '../model.js'
import { indicesFrom, percent } from './shared.js'

// VIEW

const CLIP_COLOR = '#E8E8E8'
const COMPOSITE_CLIP_COLOR = '#E8E8E880'
const MIN_BAR_WIDTH_PIXELS = 14
const DURATION_LABEL_MIN_WIDTH_PIXELS = 56
const SEGMENT_LABEL_MIN_WIDTH_PIXELS = 52
const HANDLE_HALF_WIDTH_PIXELS = 4
const MAX_GHOST_CYCLES = 256

/** How a bar draws: one span, step segments, or a composite of property
 *  tracks. */
export type BarKind = 'Single' | 'Steps' | 'Composite'

/** What a bar draws, read from its clip or property track. */
export type BarSpec = Readonly<{
  row: BarRow
  label: string
  start: number
  duration: number
  loop: Timeline.ClipLoop
  kind: BarKind
  steps: ReadonlyArray<Timeline.StepStatic>
  isPhysics: boolean
  isExpanded: boolean
}>

type Selection = Readonly<{
  isSelected: boolean
  maybeStepIndex: Option.Option<number>
}>

const notSelected: Selection = {
  isSelected: false,
  maybeStepIndex: Option.none(),
}

const selected = (maybeStepIndex: Option.Option<number>): Selection => ({
  isSelected: true,
  maybeStepIndex,
})

const selectionOf = (model: Model, row: BarRow): Selection =>
  pipe(
    model.maybeEditor,
    Option.filter(({ target }) => target.key === row.key),
    Option.match({
      onNone: () => notSelected,
      onSome: ({ target: { span } }) =>
        BarRow.match<Selection>(row, {
          Clip: () =>
            Timeline.Span.matchOrElse<Selection>(
              span,
              {
                Whole: () => selected(Option.none()),
                Step: ({ index }) => selected(Option.some(index)),
              },
              () => notSelected,
            ),
          Track: ({ prop }) =>
            Timeline.Span.matchOrElse<Selection>(
              span,
              {
                Track: track =>
                  track.prop === prop ? selected(Option.none()) : notSelected,
                TrackStep: trackStep =>
                  trackStep.prop === prop
                    ? selected(Option.some(trackStep.index))
                    : notSelected,
              },
              () => notSelected,
            ),
        }),
    }),
  )

const isDraggingRow = (model: Model, row: BarRow): boolean =>
  DragState.matchOrElse(
    model.dragState,
    {
      DraggingBar: dragging =>
        dragging.isMoved && Equal.equals(dragging.row, row),
    },
    () => false,
  )

const handleBarPointerDown =
  (id: string, row: BarRow, handle: BarHandle) =>
  (
    _pointerType: string,
    button: number,
    _screenX: number,
    _screenY: number,
    _timeStamp: number,
    clientX: number,
  ): Option.Option<Message> =>
    pipe(
      Option.liftPredicate(button, isLeftButton),
      Option.flatMap(() => findRuler(id)),
      Option.map(ruler =>
        Message.PressedBar({
          row,
          handle,
          fraction: fractionWithin(ruler, clientX),
        }),
      ),
    )

const handleBarKeyDown =
  (row: BarRow, maybeStepIndex: Option.Option<number>) =>
  (key: string, modifiers: KeyboardModifiers): Option.Option<Message> => {
    const size: NudgeSize = modifiers.shiftKey ? 'Coarse' : 'Fine'
    return Match.value(key).pipe(
      Match.withReturnType<Message>(),
      Match.whenOr('Enter', ' ', () =>
        Message.PressedEnterOnBar({ row, maybeStepIndex }),
      ),
      Match.when('ArrowLeft', () =>
        Message.PressedBarNudge({ row, direction: 'Earlier', size }),
      ),
      Match.when('ArrowRight', () =>
        Message.PressedBarNudge({ row, direction: 'Later', size }),
      ),
      Match.option,
    )
  }

// NOTE: bars and step segments are hand-rolled `role="button"` elements, not
// `@foldkit/ui` Buttons. Each is also a drag surface: a press measures the
// ruler and starts a move or resize, a release without movement activates
// it, and Left and Right arrows nudge it. A native `<button>` would turn the
// release into a second activation, and its edge handles would sit inside
// interactive content.
/** A bar or segment that opens the clip editor: a popup button that names
 *  the editor while it edits this span, and describes its arrow keys. */
const editorTriggerAttributes = (
  model: Model,
  isSelected: boolean,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Attribute<Message>> => [
  h.Role('button'),
  h.Tabindex(0),
  h.AriaHasPopup('dialog'),
  h.AriaExpanded(isSelected),
  ...(isSelected ? [h.AriaControls(editorId(model.id))] : []),
  h.AriaDescribedBy(barHelpId(model.id)),
]

const handleView = (
  id: string,
  row: BarRow,
  handle: BarHandle,
  maybeEdge: Option.Option<string>,
  style: Readonly<Record<string, string>>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div([
    h.Class('dialkit-timeline-clip-handle'),
    ...Array.fromOption(
      Option.map(maybeEdge, edgeName => h.DataAttribute('edge', edgeName)),
    ),
    ...BarHandle.matchOrElse(
      handle,
      { Boundary: ({ index }) => [h.DataAttribute('boundary', `${index}`)] },
      () => [],
    ),
    h.AriaHidden(true),
    h.Style(style),
    h.OnPointerDown(handleBarPointerDown(id, row, handle)),
  ])

const ghostsView = (
  viewWindow: ViewWindow,
  bar: BarSpec,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const firstIndex = Math.max(
    1,
    Math.floor((viewWindow.start - bar.start) / bar.duration),
  )
  const count = Math.min(
    MAX_GHOST_CYCLES,
    Math.ceil(
      (viewWindow.duration - TICK_TOLERANCE - bar.start) / bar.duration,
    ) - firstIndex,
  )

  return Array.map(indicesFrom(firstIndex, count), index => {
    const cycleStart = bar.start + bar.duration * index
    const cycleDuration = Math.min(
      bar.duration,
      viewWindow.duration - cycleStart,
    )
    return h.keyed('div')(
      `ghost-${index}`,
      [
        h.Class('dialkit-timeline-clip-ghost'),
        ...(bar.kind === 'Steps' ? [h.DataAttribute('steps', '')] : []),
        h.AriaHidden(true),
        h.Style({
          left: percent((cycleStart - viewWindow.start) / viewWindow.visible),
          width: percent(cycleDuration / viewWindow.visible),
          background: CLIP_COLOR,
        }),
      ],
      Array.map(bar.steps, step =>
        h.span([
          h.Class('dialkit-timeline-clip-ghost-segment'),
          h.Style({ width: percent(step.duration / bar.duration) }),
        ]),
      ),
    )
  })
}

const segmentsView = (
  model: Model,
  viewWindow: ViewWindow,
  bar: BarSpec,
  selection: Selection,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const segments = Array.map(bar.steps, (step, index) => {
    const segmentWidthPixels =
      (step.duration / viewWindow.visible) * model.rulerWidth
    const isStepSelected = Option.contains(selection.maybeStepIndex, index)
    return h.div(
      [
        h.Id(segmentId(model.id, bar.row, index)),
        h.Class('dialkit-timeline-clip-segment'),
        h.DataAttribute('step', `${index}`),
        ...(isStepSelected ? [h.DataAttribute('selected', '')] : []),
        ...editorTriggerAttributes(model, isStepSelected, h),
        h.AriaLabel(
          `${bar.label}, ${Timeline.formatStepLabel(index)}, ${Timeline.formatSeconds(step.duration)}`,
        ),
        h.Style({ width: percent(step.duration / bar.duration) }),
        h.OnPointerDown(
          handleBarPointerDown(
            model.id,
            bar.row,
            BarHandle.Body({ maybeStepIndex: Option.some(index) }),
          ),
        ),
        h.OnKeyDownPreventDefault(
          handleBarKeyDown(bar.row, Option.some(index)),
        ),
      ],
      segmentWidthPixels > SEGMENT_LABEL_MIN_WIDTH_PIXELS
        ? [
            h.span(
              [h.Class('dialkit-timeline-clip-duration')],
              [Timeline.formatSeconds(step.duration)],
            ),
          ]
        : [],
    )
  })
  const boundaries = Array.getSomes(
    Array.map(bar.steps, (step, index) =>
      Option.liftPredicate(
        handleView(
          model.id,
          bar.row,
          BarHandle.Boundary({ index }),
          Option.none(),
          {
            left: `calc(${percent((step.offset + step.duration) / bar.duration)} - ${HANDLE_HALF_WIDTH_PIXELS}px)`,
          },
          h,
        ),
        () => !step.isPhysics,
      ),
    ),
  )
  const isFirstStepResizable = Option.exists(
    Array.head(bar.steps),
    step => !step.isPhysics,
  )
  const startHandle = isFirstStepResizable
    ? [
        handleView(
          model.id,
          bar.row,
          BarHandle.StartEdge(),
          Option.some('start'),
          {},
          h,
        ),
      ]
    : []

  return [...segments, ...boundaries, ...startHandle]
}

type BarLayout = Readonly<{
  attributes: ReadonlyArray<Attribute<Message>>
  selection: Selection
  durationLabel: ReadonlyArray<Html>
  timingLabel: string
}>

const barLayoutOf = (
  model: Model,
  viewWindow: ViewWindow,
  bar: BarSpec,
  h: HtmlBuilder<Message>,
): BarLayout => {
  const width = bar.duration / viewWindow.visible
  const widthPixels = width * model.rulerWidth
  const selection = selectionOf(model, bar.row)
  const durationText = `${bar.isPhysics ? '~' : ''}${Timeline.formatSeconds(bar.duration)}`

  return {
    attributes: [
      h.Id(barId(model.id, bar.row)),
      h.Class('dialkit-timeline-clip'),
      h.DataAttribute('dial-timeline-bar', model.id),
      ...(selection.isSelected ? [h.DataAttribute('selected', '')] : []),
      ...(isDraggingRow(model, bar.row)
        ? [h.DataAttribute('dragging', '')]
        : []),
      h.Style({
        left: percent((bar.start - viewWindow.start) / viewWindow.visible),
        width: `max(${MIN_BAR_WIDTH_PIXELS}px, ${percent(width)})`,
        background:
          bar.kind === 'Composite' ? COMPOSITE_CLIP_COLOR : CLIP_COLOR,
      }),
    ],
    selection,
    durationLabel:
      widthPixels > DURATION_LABEL_MIN_WIDTH_PIXELS
        ? [h.span([h.Class('dialkit-timeline-clip-duration')], [durationText])]
        : [],
    timingLabel: `${bar.label}, starts at ${Timeline.formatSeconds(bar.start)}, lasts ${durationText}`,
  }
}

const barInputAttributes = (
  model: Model,
  bar: BarSpec,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Attribute<Message>> => [
  h.OnPointerDown(
    handleBarPointerDown(
      model.id,
      bar.row,
      BarHandle.Body({ maybeStepIndex: Option.none() }),
    ),
  ),
  h.OnKeyDownPreventDefault(handleBarKeyDown(bar.row, Option.none())),
]

const singleBarView = (
  model: Model,
  bar: BarSpec,
  layout: BarLayout,
  h: HtmlBuilder<Message>,
): Html => {
  const isResizable = bar.duration > 0 && !bar.isPhysics
  const edgeHandle = (handle: BarHandle, edge: string): ReadonlyArray<Html> =>
    isResizable
      ? [handleView(model.id, bar.row, handle, Option.some(edge), {}, h)]
      : []

  return h.div(
    [
      ...layout.attributes,
      ...editorTriggerAttributes(model, layout.selection.isSelected, h),
      ...barInputAttributes(model, bar, h),
      h.AriaLabel(layout.timingLabel),
      h.Title(
        bar.isPhysics
          ? `${layout.timingLabel}. Duration is set by spring physics.`
          : layout.timingLabel,
      ),
    ],
    [
      ...edgeHandle(BarHandle.StartEdge(), 'start'),
      ...layout.durationLabel,
      ...edgeHandle(BarHandle.EndEdge(), 'end'),
    ],
  )
}

const stepsBarView = (
  model: Model,
  viewWindow: ViewWindow,
  bar: BarSpec,
  layout: BarLayout,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      ...layout.attributes,
      h.DataAttribute('steps', ''),
      h.Role('group'),
      h.AriaLabel(layout.timingLabel),
    ],
    segmentsView(model, viewWindow, bar, layout.selection, h),
  )

const compositeBarView = (
  model: Model,
  bar: BarSpec,
  layout: BarLayout,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      ...layout.attributes,
      h.Role('button'),
      h.Tabindex(0),
      ...barInputAttributes(model, bar, h),
      h.DataAttribute('composite', ''),
      h.AriaExpanded(bar.isExpanded),
      h.AriaDescribedBy(barHelpId(model.id)),
      h.AriaLabel(`${layout.timingLabel}, property tracks`),
      h.Title(
        `${bar.label}: composite of its property tracks. Click to expand.`,
      ),
    ],
    layout.durationLabel,
  )

/** Renders a bar, with its loop ghosts and loop marker when it repeats. */
export const barView = (
  model: Model,
  viewWindow: ViewWindow,
  bar: BarSpec,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const layout = barLayoutOf(model, viewWindow, bar, h)
  const isLooping = bar.loop === 'Repeat' && bar.duration > 0
  const barElement = Match.value(bar.kind).pipe(
    Match.withReturnType<Html>(),
    Match.when('Single', () => singleBarView(model, bar, layout, h)),
    Match.when('Steps', () => stepsBarView(model, viewWindow, bar, layout, h)),
    Match.when('Composite', () => compositeBarView(model, bar, layout, h)),
    Match.exhaustive,
  )
  const loopMarker = isLooping
    ? [
        h.span(
          [
            h.Class('dialkit-timeline-loop-infinity'),
            h.AriaHidden(true),
            h.Title('Repeats indefinitely'),
          ],
          ['∞'],
        ),
      ]
    : []

  return [
    ...(isLooping ? ghostsView(viewWindow, bar, h) : []),
    barElement,
    ...loopMarker,
  ]
}
