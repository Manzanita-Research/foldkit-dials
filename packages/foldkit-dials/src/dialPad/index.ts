import {
  Array,
  Effect,
  Equal,
  Match,
  Option,
  Schema,
  Stream,
  pipe,
} from 'effect'
import { type Update } from 'foldkit'
import * as Command from 'foldkit/command'
import * as Dom from 'foldkit/dom'
import {
  type ChildAttribute,
  type Html,
  type KeyboardModifiers,
  childAttributes,
} from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { defineView } from 'foldkit/submodel'
import * as Subscription from 'foldkit/subscription'

import { documentDragStyles } from '../internal/dragStyles.js'
import {
  ArrowDirection,
  Increment,
  arrowKeyToDirection,
  hasCommandModifier,
  incrementOf,
} from '../internal/keyboard.js'
import { LEFT_MOUSE_BUTTON, closestElement } from '../internal/pointer.js'
import {
  clamp,
  fractionOfValue,
  percentageFromFraction,
  valueOfFraction,
} from '../internal/range.js'
import { attributeSelector, idSelector } from '../internal/selectors.js'
import { withCommand } from '../internal/update.js'

// MODEL

/** One axis of the pad: its range, the step values snap to, and the value
 *  Home and a double-click restore. */
export const Axis = Schema.Struct({
  min: Schema.Number,
  max: Schema.Number,
  step: Schema.Number,
  default: Schema.Number,
})
export type Axis = typeof Axis.Type

/** A pad value. X increases to the right and Y increases upward. */
export const Value = Schema.Struct({ x: Schema.Number, y: Schema.Number })
export type Value = typeof Value.Type

const ScreenPoint = Schema.Struct({ x: Schema.Number, y: Schema.Number })
type ScreenPoint = typeof ScreenPoint.Type

const ScreenRect = Schema.Struct({
  left: Schema.Number,
  top: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
})
type ScreenRect = typeof ScreenRect.Type

const AxisLock = defineTaggedUnion({
  Free: {},
  LockedToX: { heldY: Schema.Number },
  LockedToY: { heldX: Schema.Number },
})
type AxisLock = typeof AxisLock.Type

const Gesture = Schema.Struct({
  originValue: Value,
  latestValue: Value,
  start: ScreenPoint,
  grabOffset: ScreenPoint,
  plane: ScreenRect,
  surface: ScreenRect,
})
type Gesture = typeof Gesture.Type

const DragState = defineTaggedUnion({
  Idle: {},
  Pressed: { gesture: Gesture },
  Dragging: { gesture: Gesture, axisLock: AxisLock },
})
type DragState = typeof DragState.Type

/** Schema for the DialPad's private interaction state. The value is owned by
 *  the parent and passed in through `ViewInputs.value`. A press is `Pressed`
 *  until the pointer travels 3px, then `Dragging`. Both remember the value
 *  before the press, so Escape can restore it, and the element rectangles
 *  measured at the press, which map later pointer positions to values. */
export const Model = Schema.Struct({
  id: Schema.String,
  x: Axis,
  y: Axis,
  dragState: DragState,
})
export type Model = typeof Model.Type

// MESSAGE

/** Union of all Messages the DialPad can produce. */
export const Message = defineMessageUnion({
  PressedSurface: {
    pointer: ScreenPoint,
    grabOffset: ScreenPoint,
    plane: ScreenRect,
    surface: ScreenRect,
    originValue: Value,
  },
  MovedDragPointer: { pointer: ScreenPoint, isShiftHeld: Schema.Boolean },
  ReleasedDragPointer: { pointer: ScreenPoint, isShiftHeld: Schema.Boolean },
  CancelledDrag: {},
  PressedKeyboardNavigation: {
    direction: ArrowDirection,
    increment: Increment,
    value: Value,
  },
  RequestedReset: { value: Value },
  CompletedFocusThumb: {},
})
export type Message = typeof Message.Type

export type PressedSurface = typeof Message.PressedSurface.Type
export type MovedDragPointer = typeof Message.MovedDragPointer.Type
export type ReleasedDragPointer = typeof Message.ReleasedDragPointer.Type
export type CancelledDrag = typeof Message.CancelledDrag.Type
export type PressedKeyboardNavigation =
  typeof Message.PressedKeyboardNavigation.Type
export type RequestedReset = typeof Message.RequestedReset.Type

// OUT MESSAGE

/** Union of OutMessages the DialPad can emit to its parent. */
export const OutMessage = defineMessageUnion({
  ChangedValue: { value: Value },
})
export type OutMessage = typeof OutMessage.Type

// INIT

/** Configuration for creating a DialPad Model with `init`. */
export type InitConfig = Readonly<{
  id: string
  x: Axis
  y: Axis
}>

/** Creates an initial DialPad Model. The value lives in the parent Model. */
export const init = (config: InitConfig): Model => ({
  id: config.id,
  x: config.x,
  y: config.y,
  dragState: DragState.Idle(),
})

// COMMAND

const thumbIdSelector = (id: string): string => idSelector(thumbId(id))

/** Moves focus to the thumb when a press starts anywhere on the surface. */
export const FocusThumb = Command.define('FocusThumb', {
  args: { id: Schema.String },
  messages: [Message.CompletedFocusThumb],
  execute: ({ id }) =>
    Dom.focus(thumbIdSelector(id)).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusThumb()),
    ),
})

// GEOMETRY

const GRID_DIVISIONS = 6
const GRID_SNAP_TOLERANCE_PIXELS = 8
const DRAG_THRESHOLD_PIXELS = 3
const SNAP_PRECISION = 12

/** Clamps a value into the axis range and snaps it to the step, counting
 *  steps from `min`. Both ends stay reachable even when the step does not
 *  divide the range. */
export const snapToAxis = (value: number, axis: Axis): number => {
  const clamped = clamp(value, axis.min, axis.max)

  if (clamped === axis.min || clamped === axis.max) {
    return clamped
  } else {
    const snapped =
      axis.min + Math.round((clamped - axis.min) / axis.step) * axis.step
    return clamp(
      Number(snapped.toPrecision(SNAP_PRECISION)),
      axis.min,
      axis.max,
    )
  }
}

/** Maps a point given as fractions of the plane, left to right and top to
 *  bottom, to a snapped pad value. The top edge is the Y maximum. */
export const valueAtFraction = (
  fractionX: number,
  fractionY: number,
  axes: Readonly<{ x: Axis; y: Axis }>,
): Value => ({
  x: snapToAxis(valueOfFraction(fractionX, axes.x.min, axes.x.max), axes.x),
  y: snapToAxis(valueOfFraction(1 - fractionY, axes.y.min, axes.y.max), axes.y),
})

type Size = Readonly<{ width: number; height: number }>

const hasArea = ({ width, height }: Size): boolean => width > 0 && height > 0

const nearestGridLine = (offset: number, size: number): number =>
  Math.round((offset / size) * GRID_DIVISIONS)

const isInteriorGridLine = (line: number): boolean =>
  line >= 1 && line < GRID_DIVISIONS

/** Finds the interior grid intersection within 8px of a point on both axes.
 *  The point and the result are pixels from the top left of a grid of the
 *  given size, divided into six columns and six rows. */
export const gridIntersection = (
  x: number,
  y: number,
  width: number,
  height: number,
): Option.Option<ScreenPoint> => {
  const isWithinTolerance = (intersection: ScreenPoint): boolean =>
    Math.abs(x - intersection.x) <= GRID_SNAP_TOLERANCE_PIXELS &&
    Math.abs(y - intersection.y) <= GRID_SNAP_TOLERANCE_PIXELS

  return pipe(
    Option.liftPredicate({ width, height }, hasArea),
    Option.map(() => ({
      column: nearestGridLine(x, width),
      row: nearestGridLine(y, height),
    })),
    Option.filter(
      ({ column, row }) =>
        isInteriorGridLine(column) && isInteriorGridLine(row),
    ),
    Option.map(({ column, row }) => ({
      x: (column / GRID_DIVISIONS) * width,
      y: (row / GRID_DIVISIONS) * height,
    })),
    Option.filter(isWithinTolerance),
  )
}

/** The offsets of the interior grid lines, as percentages of the surface.
 *  The same offsets place the vertical lines from the left and the
 *  horizontal lines from the top. */
export const gridLineOffsets: ReadonlyArray<string> = Array.makeBy(
  GRID_DIVISIONS - 1,
  index => percentageFromFraction((index + 1) / GRID_DIVISIONS),
)

// UPDATE

const COARSE_STEP_MULTIPLIER = 10

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

type GesturePhase = 'Press' | 'Move' | 'Release'

const withChangedValue = (
  model: Model,
  currentValue: Value,
  nextValue: Value,
): UpdateReturn => {
  if (Equal.equals(currentValue, nextValue)) {
    return { model }
  } else {
    return { model, outMessage: OutMessage.ChangedValue({ value: nextValue }) }
  }
}

const defaultValue = (model: Model): Value => ({
  x: snapToAxis(model.x.default, model.x),
  y: snapToAxis(model.y.default, model.y),
})

const nudgedValue = (
  model: Model,
  value: Value,
  direction: PressedKeyboardNavigation['direction'],
  increment: PressedKeyboardNavigation['increment'],
): Value => {
  const stepCount = increment === 'Coarse' ? COARSE_STEP_MULTIPLIER : 1
  const xDelta = model.x.step * stepCount
  const yDelta = model.y.step * stepCount

  return Match.value(direction).pipe(
    Match.withReturnType<Value>(),
    Match.when('Left', () => ({
      x: snapToAxis(value.x - xDelta, model.x),
      y: value.y,
    })),
    Match.when('Right', () => ({
      x: snapToAxis(value.x + xDelta, model.x),
      y: value.y,
    })),
    Match.when('Down', () => ({
      x: value.x,
      y: snapToAxis(value.y - yDelta, model.y),
    })),
    Match.when('Up', () => ({
      x: value.x,
      y: snapToAxis(value.y + yDelta, model.y),
    })),
    Match.exhaustive,
  )
}

const travelFromStart = (
  gesture: Gesture,
  pointer: ScreenPoint,
): ScreenPoint => ({
  x: Math.abs(pointer.x - gesture.start.x),
  y: Math.abs(pointer.y - gesture.start.y),
})

const hasPassedDragThreshold = (travel: ScreenPoint): boolean =>
  Math.max(travel.x, travel.y) >= DRAG_THRESHOLD_PIXELS

const snappedGridPoint = (
  surface: ScreenRect,
  pointer: ScreenPoint,
): Option.Option<ScreenPoint> =>
  Option.map(
    gridIntersection(
      pointer.x - surface.left,
      pointer.y - surface.top,
      surface.width,
      surface.height,
    ),
    intersection => ({
      x: surface.left + intersection.x,
      y: surface.top + intersection.y,
    }),
  )

const targetPoint = (
  gesture: Gesture,
  pointer: ScreenPoint,
  isGridSnapAllowed: boolean,
): ScreenPoint => {
  const grabbedPoint = {
    x: pointer.x - gesture.grabOffset.x,
    y: pointer.y - gesture.grabOffset.y,
  }

  if (isGridSnapAllowed) {
    return Option.getOrElse(
      snappedGridPoint(gesture.surface, pointer),
      () => grabbedPoint,
    )
  } else {
    return grabbedPoint
  }
}

const valueAtPoint = (
  model: Model,
  plane: ScreenRect,
  point: ScreenPoint,
): Option.Option<Value> =>
  Option.map(
    Option.liftPredicate(plane, hasArea),
    ({ left, top, width, height }) =>
      valueAtFraction(
        (point.x - left) / width,
        (point.y - top) / height,
        model,
      ),
  )

const lockToDominantAxis = (gesture: Gesture, travel: ScreenPoint): AxisLock =>
  travel.x >= travel.y
    ? AxisLock.LockedToX({ heldY: gesture.latestValue.y })
    : AxisLock.LockedToY({ heldX: gesture.latestValue.x })

const applyAxisLock = (value: Value, axisLock: AxisLock): Value =>
  AxisLock.match<Value>(axisLock, {
    Free: () => value,
    LockedToX: ({ heldY }) => ({ x: value.x, y: heldY }),
    LockedToY: ({ heldX }) => ({ x: heldX, y: value.y }),
  })

type PointerFollow = Readonly<{
  axisLock: AxisLock
  maybeValue: Option.Option<Value>
}>

const followPointer = (
  model: Model,
  gesture: Gesture,
  axisLock: AxisLock,
  pointer: ScreenPoint,
  isShiftHeld: boolean,
  isGridSnapAllowed: boolean,
): PointerFollow => {
  const travel = travelFromStart(gesture, pointer)
  const maybePointerValue = valueAtPoint(
    model,
    gesture.plane,
    targetPoint(gesture, pointer, isGridSnapAllowed),
  )
  const isLockPending = axisLock._tag === 'Free'

  if (!isShiftHeld) {
    return { axisLock: AxisLock.Free(), maybeValue: maybePointerValue }
  } else if (isLockPending && !hasPassedDragThreshold(travel)) {
    return { axisLock, maybeValue: Option.none() }
  } else {
    const nextAxisLock = isLockPending
      ? lockToDominantAxis(gesture, travel)
      : axisLock
    return {
      axisLock: nextAxisLock,
      maybeValue: Option.map(maybePointerValue, pointerValue =>
        applyAxisLock(pointerValue, nextAxisLock),
      ),
    }
  }
}

const dragStateAfter = (
  phase: GesturePhase,
  isDragging: boolean,
  gesture: Gesture,
  axisLock: AxisLock,
): DragState => {
  if (phase === 'Release') {
    return DragState.Idle()
  } else if (isDragging) {
    return DragState.Dragging({ gesture, axisLock })
  } else {
    return DragState.Pressed({ gesture })
  }
}

type GestureStep = Readonly<{
  gesture: Gesture
  axisLock: AxisLock
  isAlreadyDragging: boolean
  pointer: ScreenPoint
  isShiftHeld: boolean
  phase: GesturePhase
}>

// NOTE: a click that never became a drag may snap to a nearby grid
// intersection when it is released. A drag, or a press with Shift held,
// never snaps.
const isGridSnapAllowed = (
  phase: GesturePhase,
  isDragging: boolean,
  isShiftHeld: boolean,
): boolean => phase === 'Release' && !isDragging && !isShiftHeld

const continueGesture = (
  model: Model,
  {
    gesture,
    axisLock,
    isAlreadyDragging,
    pointer,
    isShiftHeld,
    phase,
  }: GestureStep,
): UpdateReturn => {
  const isDragging =
    isAlreadyDragging ||
    hasPassedDragThreshold(travelFromStart(gesture, pointer))
  const follow = followPointer(
    model,
    gesture,
    axisLock,
    pointer,
    isShiftHeld,
    isGridSnapAllowed(phase, isDragging, isShiftHeld),
  )
  const nextValue = Option.getOrElse(
    follow.maybeValue,
    () => gesture.latestValue,
  )
  const nextGesture = modifyFields(gesture, { latestValue: () => nextValue })

  return withChangedValue(
    modifyFields(model, {
      dragState: () =>
        dragStateAfter(phase, isDragging, nextGesture, follow.axisLock),
    }),
    gesture.latestValue,
    nextValue,
  )
}

const followDrag = (
  model: Model,
  pointer: ScreenPoint,
  isShiftHeld: boolean,
  phase: GesturePhase,
): UpdateReturn =>
  DragState.match<UpdateReturn>(model.dragState, {
    Idle: () => ({ model }),
    Pressed: ({ gesture }) =>
      continueGesture(model, {
        gesture,
        axisLock: AxisLock.Free(),
        isAlreadyDragging: false,
        pointer,
        isShiftHeld,
        phase,
      }),
    Dragging: ({ gesture, axisLock }) =>
      continueGesture(model, {
        gesture,
        axisLock,
        isAlreadyDragging: true,
        pointer,
        isShiftHeld,
        phase,
      }),
  })

/** Processes a DialPad Message and returns the next Model, optional
 *  Commands, and an optional `ChangedValue` OutMessage. The value lives in
 *  the parent, so Messages that need it carry it from the view. */
export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    PressedSurface: ({ pointer, grabOffset, plane, surface, originValue }) =>
      DragState.matchOrElse<UpdateReturn>(
        model.dragState,
        {
          Idle: () =>
            withCommand(
              continueGesture(model, {
                gesture: {
                  originValue,
                  latestValue: originValue,
                  start: pointer,
                  grabOffset,
                  plane,
                  surface,
                },
                axisLock: AxisLock.Free(),
                isAlreadyDragging: false,
                pointer,
                isShiftHeld: false,
                phase: 'Press',
              }),
              FocusThumb({ id: model.id }),
            ),
        },
        () => ({ model }),
      ),

    MovedDragPointer: ({ pointer, isShiftHeld }) =>
      followDrag(model, pointer, isShiftHeld, 'Move'),

    ReleasedDragPointer: ({ pointer, isShiftHeld }) =>
      followDrag(model, pointer, isShiftHeld, 'Release'),

    CancelledDrag: () =>
      DragState.matchOrElse(
        model.dragState,
        { Idle: () => ({ model }) },
        ({ gesture }) =>
          withChangedValue(
            modifyFields(model, { dragState: () => DragState.Idle() }),
            gesture.latestValue,
            gesture.originValue,
          ),
      ),

    PressedKeyboardNavigation: ({ direction, increment, value }) =>
      withChangedValue(
        model,
        value,
        nudgedValue(model, value, direction, increment),
      ),

    RequestedReset: ({ value }) =>
      withChangedValue(
        modifyFields(model, { dragState: () => DragState.Idle() }),
        value,
        defaultValue(model),
      ),

    CompletedFocusThumb: () => ({ model }),
  })

// SUBSCRIPTION

const DragActivity = Schema.Literals(['Idle', 'Active'])

const dragActivityFromModel = (model: Model): typeof DragActivity.Type =>
  DragState.match<typeof DragActivity.Type>(model.dragState, {
    Idle: () => 'Idle',
    Pressed: () => 'Active',
    Dragging: () => 'Active',
  })

const pointerOf = (event: PointerEvent): ScreenPoint => ({
  x: event.clientX,
  y: event.clientY,
})

/** The DialPad's drag Subscriptions. A press measures the plane and surface
 *  once, so the pointer Subscriptions only report client coordinates and
 *  need no DOM lookup. */
export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  dragPointer: entry(
    { dragActivity: DragActivity },
    {
      modelToDependencies: model => ({
        dragActivity: dragActivityFromModel(model),
      }),
      dependenciesToStream: ({ dragActivity }) => {
        const pointerEvents = Stream.mergeAll(
          [
            Stream.fromEventListener<PointerEvent>(
              document,
              'pointermove',
            ).pipe(
              Stream.map((event): Message =>
                Message.MovedDragPointer({
                  pointer: pointerOf(event),
                  isShiftHeld: event.shiftKey,
                }),
              ),
            ),
            Stream.fromEventListener<PointerEvent>(document, 'pointerup').pipe(
              Stream.map((event): Message =>
                Message.ReleasedDragPointer({
                  pointer: pointerOf(event),
                  isShiftHeld: event.shiftKey,
                }),
              ),
            ),
            Stream.fromEventListener<PointerEvent>(
              document,
              'pointercancel',
            ).pipe(Stream.map((): Message => Message.CancelledDrag())),
          ],
          { concurrency: 'unbounded' },
        )

        return Stream.when(
          Stream.merge(pointerEvents, documentDragStyles),
          Effect.sync(() => dragActivity === 'Active'),
        )
      },
    },
  ),

  dragEscape: entry(
    { dragActivity: DragActivity },
    {
      modelToDependencies: model => ({
        dragActivity: dragActivityFromModel(model),
      }),
      dependenciesToStream: ({ dragActivity }) =>
        Stream.when(
          Stream.fromEventListener<KeyboardEvent>(document, 'keydown').pipe(
            Stream.filter(({ key }) => key === 'Escape'),
            Stream.map(() => Message.CancelledDrag()),
          ),
          Effect.sync(() => dragActivity === 'Active'),
        ),
    },
  ),
}))

// VIEW

const DEFAULT_AXIS_LABELS = { x: 'X', y: 'Y' }

/** The DOM id of the focusable thumb. */
export const thumbId = (id: string): string => `${id}-thumb`

const INSTRUCTIONS =
  'Arrow keys adjust each axis. Shift adjusts by ten steps. Home resets both axes. Hold Shift while dragging to lock an axis.'

const labelId = (id: string): string => `${id}-label`
const axisLabelId = (id: string, axis: 'x' | 'y'): string =>
  `${id}-${axis}-label`
const instructionsId = (id: string): string => `${id}-instructions`

const surfaceSelector = (id: string): string =>
  attributeSelector('data-dial-pad-surface-id', id)
const planeSelector = (id: string): string =>
  attributeSelector('data-dial-pad-plane-id', id)
const thumbSelector = (id: string): string =>
  attributeSelector('data-dial-pad-thumb-id', id)

const rectOf = (element: Element): ScreenRect => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return { left, top, width, height }
}

const grabOffsetFrom = (
  target: EventTarget | null,
  id: string,
  pointer: ScreenPoint,
): ScreenPoint =>
  Option.match(closestElement(target, thumbSelector(id)), {
    onNone: () => ({ x: 0, y: 0 }),
    onSome: thumb => {
      const thumbRect = rectOf(thumb)
      return {
        x: pointer.x - thumbRect.left - thumbRect.width / 2,
        y: pointer.y - thumbRect.top - thumbRect.height / 2,
      }
    },
  })

/** Attribute groups the DialPad hands to the consumer's `toView`. The
 *  `surface` is the press target and the area the grid divides. The `plane`
 *  sits inside it and is the area values map across; the `thumb` goes inside
 *  the `plane`. Without a `plane`, values map across the whole surface. */
export type DialPadAttributes = Readonly<{
  root: ReadonlyArray<ChildAttribute>
  label: ReadonlyArray<ChildAttribute>
  xLabel: ReadonlyArray<ChildAttribute>
  yLabel: ReadonlyArray<ChildAttribute>
  surface: ReadonlyArray<ChildAttribute>
  grid: ReadonlyArray<ChildAttribute>
  plane: ReadonlyArray<ChildAttribute>
  thumb: ReadonlyArray<ChildAttribute>
  instructions: ReadonlyArray<ChildAttribute>
}>

/** What the consumer's `toView` receives: the attribute groups, the thumb
 *  position as CSS percentages of the plane, the grid line offsets, the axis
 *  names and formatted values, the screen reader instructions, and the drag
 *  state for styling. */
export type RenderInfo = Readonly<{
  attributes: DialPadAttributes
  thumbPosition: Readonly<{ left: string; top: string }>
  gridLineOffsets: ReadonlyArray<string>
  axisLabels: Readonly<{ x: string; y: string }>
  formattedValue: Readonly<{ x: string; y: string }>
  instructions: string
  isDragging: boolean
}>

/** Per-render view inputs passed to `view` through `h.submodel`'s
 *  `viewInputs`. */
export type ViewInputs = Readonly<{
  /** The current value, read from the parent Model. */
  value: Value
  label: string
  toView: (render: RenderInfo) => Html
  /** The axis names in the thumb's accessible name. Defaults to X and Y. */
  axisLabels?: Readonly<{ x: string; y: string }>
}>

/** Renders a headless XY pad. Pressing the surface sets the value from the
 *  pointer and dragging follows it. The thumb is the focusable control: a
 *  slider described as a 2D slider, named by the label, whose value text
 *  carries both axis values, and described by instructions for the keys. */
export const view = defineView<Model, Message, ViewInputs>(
  (model, viewInputs, h): Html => {
    const {
      value,
      label,
      toView,
      axisLabels = DEFAULT_AXIS_LABELS,
    } = viewInputs
    const { id } = model
    const isDragging = model.dragState._tag === 'Dragging'
    const formattedValue = { x: `${value.x}`, y: `${value.y}` }
    const thumbPosition = {
      left: percentageFromFraction(
        fractionOfValue(value.x, model.x.min, model.x.max),
      ),
      top: percentageFromFraction(
        1 - fractionOfValue(value.y, model.y.min, model.y.max),
      ),
    }

    const handleSurfacePointerDown = (
      _pointerType: string,
      button: number,
      _screenX: number,
      _screenY: number,
      _timeStamp: number,
      clientX: number,
      clientY: number,
      _pointerId: number,
      target: EventTarget | null,
    ): Option.Option<Message> => {
      const pointer = { x: clientX, y: clientY }

      return pipe(
        button,
        Option.liftPredicate(Equal.equals(LEFT_MOUSE_BUTTON)),
        Option.flatMap(() => closestElement(target, surfaceSelector(id))),
        Option.map(surface => {
          const plane = Option.getOrElse(
            Option.fromNullishOr(surface.querySelector(planeSelector(id))),
            () => surface,
          )
          return Message.PressedSurface({
            pointer,
            grabOffset: grabOffsetFrom(target, id, pointer),
            plane: rectOf(plane),
            surface: rectOf(surface),
            originValue: value,
          })
        }),
      )
    }

    const handleThumbKeyDown = (
      key: string,
      modifiers: KeyboardModifiers,
    ): Option.Option<Message> => {
      if (hasCommandModifier(modifiers)) {
        return Option.none()
      } else if (key === 'Home') {
        return Option.some(Message.RequestedReset({ value }))
      } else {
        return Option.map(arrowKeyToDirection(key), direction =>
          Message.PressedKeyboardNavigation({
            direction,
            increment: incrementOf(modifiers),
            value,
          }),
        )
      }
    }

    const stateAttributes = isDragging ? [h.DataAttribute('dragging', '')] : []

    const surfaceAttributes = [
      h.DataAttribute('dial-pad-surface-id', id),
      h.Style({ 'touch-action': 'none' }),
      h.OnPointerDown(handleSurfacePointerDown),
      h.OnDoubleClick(Message.RequestedReset({ value })),
      ...stateAttributes,
    ]

    // NOTE: the thumb is a hand-rolled 2D slider, not a @foldkit/ui Slider.
    // Slider moves one value along one axis. The thumb moves X and Y
    // together, so it takes `role="slider"` for the arrow keys and a value,
    // `aria-roledescription` to say it is two-dimensional, and value text
    // that names both axes, as the ColorPicker's area thumb does.
    const thumbAttributes = [
      h.Id(thumbId(id)),
      h.DataAttribute('dial-pad-thumb-id', id),
      h.Role('slider'),
      h.Tabindex(0),
      h.AriaRoleDescription('2D slider'),
      h.AriaLabelledBy(labelId(id)),
      h.AriaValuemin(model.x.min),
      h.AriaValuemax(model.x.max),
      h.AriaValuenow(value.x),
      h.AriaValuetext(
        `${axisLabels.x} ${formattedValue.x}, ${axisLabels.y} ${formattedValue.y}`,
      ),
      h.AriaDescribedBy(instructionsId(id)),
      h.Style(thumbPosition),
      h.OnKeyDownPreventDefault(handleThumbKeyDown),
      ...stateAttributes,
    ]

    return toView({
      attributes: {
        root: childAttributes([
          h.DataAttribute('dial-pad-id', id),
          ...stateAttributes,
        ]),
        label: childAttributes([h.Id(labelId(id)), h.Title(label)]),
        xLabel: childAttributes([
          h.Id(axisLabelId(id, 'x')),
          h.DataAttribute('dial-pad-axis', 'x'),
          h.Title(axisLabels.x),
        ]),
        yLabel: childAttributes([
          h.Id(axisLabelId(id, 'y')),
          h.DataAttribute('dial-pad-axis', 'y'),
          h.Title(axisLabels.y),
        ]),
        surface: childAttributes(surfaceAttributes),
        grid: childAttributes([h.AriaHidden(true)]),
        plane: childAttributes([h.DataAttribute('dial-pad-plane-id', id)]),
        thumb: childAttributes(thumbAttributes),
        instructions: childAttributes([h.Id(instructionsId(id))]),
      },
      thumbPosition,
      gridLineOffsets,
      axisLabels,
      formattedValue,
      instructions: INSTRUCTIONS,
      isDragging,
    })
  },
)
