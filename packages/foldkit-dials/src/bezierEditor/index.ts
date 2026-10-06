import {
  Effect,
  Equal,
  Match,
  Number,
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
import { clamp, percentageFromFraction } from '../internal/range.js'
import { attributeSelector, idSelector } from '../internal/selectors.js'
import { CubicBezier } from '../transition/index.js'

// MODEL

/** One of the curve's two control points: `First` is `(x1, y1)` and
 *  `Second` is `(x2, y2)`. */
export const Handle = Schema.Literals(['First', 'Second'])
export type Handle = typeof Handle.Type

const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number })
type Point = typeof Point.Type

const Size = Schema.Struct({ width: Schema.Number, height: Schema.Number })

const DragState = defineTaggedUnion({
  Idle: {},
  Dragging: {
    handle: Handle,
    originValue: CubicBezier,
    latestValue: CubicBezier,
    start: Point,
    valuePerPixel: Point,
  },
})

/** Schema for the BezierEditor's private interaction state. The curve is
 *  owned by the parent and passed in through `ViewInputs.value`. A drag
 *  remembers the curve before it started, so Escape can restore it, the last
 *  curve it reported, so a move that changes nothing reports nothing, and how
 *  far one client pixel moves the handle, fixed at the press so the graph
 *  refitting around an overshoot cannot speed up the drag. */
export const Model = Schema.Struct({
  id: Schema.String,
  dragState: DragState,
})
export type Model = typeof Model.Type

// MESSAGE

/** Union of all Messages the BezierEditor can produce. */
export const Message = defineMessageUnion({
  PressedHandle: {
    handle: Handle,
    pointer: Point,
    editorSize: Size,
    originValue: CubicBezier,
  },
  MovedDragPointer: { pointer: Point },
  ReleasedDragPointer: {},
  CancelledDrag: {},
  PressedKeyboardNavigation: {
    handle: Handle,
    direction: ArrowDirection,
    increment: Increment,
    value: CubicBezier,
  },
  CompletedFocusHandle: {},
})
export type Message = typeof Message.Type

export type PressedHandle = typeof Message.PressedHandle.Type
export type MovedDragPointer = typeof Message.MovedDragPointer.Type
export type ReleasedDragPointer = typeof Message.ReleasedDragPointer.Type
export type CancelledDrag = typeof Message.CancelledDrag.Type
export type PressedKeyboardNavigation =
  typeof Message.PressedKeyboardNavigation.Type

// OUT MESSAGE

/** Union of OutMessages the BezierEditor can emit to its parent. */
export const OutMessage = defineMessageUnion({
  ChangedValue: { value: CubicBezier },
})
export type OutMessage = typeof OutMessage.Type

// INIT

/** Configuration for creating a BezierEditor Model with `init`. */
export type InitConfig = Readonly<{ id: string }>

/** Creates an initial BezierEditor Model. The curve lives in the parent
 *  Model. */
export const init = (config: InitConfig): Model => ({
  id: config.id,
  dragState: DragState.Idle(),
})

// COMMAND

/** Moves focus to a handle when a drag starts on it. */
export const FocusHandle = Command.define('FocusHandle', {
  args: { id: Schema.String, handle: Handle },
  messages: [Message.CompletedFocusHandle],
  execute: ({ id, handle }) =>
    Dom.focus(idSelector(handleId(id, handle))).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusHandle()),
    ),
})

// GEOMETRY

/** The width of the editor's SVG viewBox. The editor keeps DialKit's
 *  256 by 180 proportions. */
export const VIEW_BOX_WIDTH = 256

/** The height of the editor's SVG viewBox. */
export const VIEW_BOX_HEIGHT = 180

const GRAPH_PADDING = 12
const CURVE_CENTER = 0.5
const MIN_Y_RADIUS = 0.5
const HANDLE_RIM_RADIUS = 5
const MIN_Y = -1
const MAX_Y = 2
const VALUE_PRECISION = 2

/** The editor's drawing in viewBox units: the `0,0` to `1,1` endpoints, the
 *  two control points, where each control line stops at its handle's rim,
 *  the curve as an SVG path, and the viewBox units per curve unit. */
export type BezierGeometry = Readonly<{
  scale: number
  start: Point
  end: Point
  firstHandle: Point
  secondHandle: Point
  firstControlLineEnd: Point
  secondControlLineEnd: Point
  curvePath: string
}>

const finiteOr = (value: number, fallback: number): number =>
  globalThis.Number.isFinite(value) ? value : fallback

const normalizedCurve = ([x1, y1, x2, y2]: CubicBezier): CubicBezier => [
  clamp(finiteOr(x1, 0), 0, 1),
  finiteOr(y1, 0),
  clamp(finiteOr(x2, 1), 0, 1),
  finiteOr(y2, 1),
]

/** Where a control line from `from` toward `handle` stops: at the handle's
 *  rim, or at `from` when the handle overlaps it. */
export const controlLineEnd = (from: Point, handle: Point): Point => {
  const deltaX = handle.x - from.x
  const deltaY = handle.y - from.y
  const distance = Math.hypot(deltaX, deltaY)

  if (distance <= HANDLE_RIM_RADIUS) {
    return from
  } else {
    return {
      x: handle.x - (deltaX / distance) * HANDLE_RIM_RADIUS,
      y: handle.y - (deltaY / distance) * HANDLE_RIM_RADIUS,
    }
  }
}

/** Fits the curve into the viewBox. Both axes share one scale, so the
 *  `0,0` to `1,1` diagonal stays at 45 degrees, and the scale shrinks as the
 *  handles overshoot so everything stays 12 units inside the edges. */
export const bezierGeometry = (curve: CubicBezier): BezierGeometry => {
  const [x1, y1, x2, y2] = normalizedCurve(curve)
  const yRadius = Math.max(
    MIN_Y_RADIUS,
    Math.abs(y1 - CURVE_CENTER),
    Math.abs(y2 - CURVE_CENTER),
  )
  const scale = Math.min(
    VIEW_BOX_WIDTH - GRAPH_PADDING * 2,
    (VIEW_BOX_HEIGHT / 2 - GRAPH_PADDING) / yRadius,
  )
  const project = (x: number, y: number): Point => ({
    x: VIEW_BOX_WIDTH / 2 + (x - CURVE_CENTER) * scale,
    y: VIEW_BOX_HEIGHT / 2 - (y - CURVE_CENTER) * scale,
  })

  const start = project(0, 0)
  const end = project(1, 1)
  const firstHandle = project(x1, y1)
  const secondHandle = project(x2, y2)

  return {
    scale,
    start,
    end,
    firstHandle,
    secondHandle,
    firstControlLineEnd: controlLineEnd(start, firstHandle),
    secondControlLineEnd: controlLineEnd(end, secondHandle),
    curvePath: `M ${start.x} ${start.y} C ${firstHandle.x} ${firstHandle.y}, ${secondHandle.x} ${secondHandle.y}, ${end.x} ${end.y}`,
  }
}

const movedCoordinate = (
  coordinate: number,
  delta: number,
  min: number,
  max: number,
): number =>
  delta === 0
    ? coordinate
    : Number.round(clamp(coordinate + delta, min, max), VALUE_PRECISION)

/** Moves one handle by `delta` in curve units, with Y increasing upward. X
 *  stays within 0 to 1 and Y within -1 to 2, rounded to two decimals. An
 *  axis with no movement keeps its exact value. */
export const moveHandle = (
  curve: CubicBezier,
  handle: Handle,
  delta: Point,
): CubicBezier => {
  const [x1, y1, x2, y2] = curve

  return Match.value(handle).pipe(
    Match.withReturnType<CubicBezier>(),
    Match.when('First', () => [
      movedCoordinate(x1, delta.x, 0, 1),
      movedCoordinate(y1, delta.y, MIN_Y, MAX_Y),
      x2,
      y2,
    ]),
    Match.when('Second', () => [
      x1,
      y1,
      movedCoordinate(x2, delta.x, 0, 1),
      movedCoordinate(y2, delta.y, MIN_Y, MAX_Y),
    ]),
    Match.exhaustive,
  )
}

// UPDATE

const FINE_INCREMENT = 0.01
const COARSE_INCREMENT = 0.1

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const withChangedValue = (
  model: Model,
  currentValue: CubicBezier,
  nextValue: CubicBezier,
): UpdateReturn => {
  if (Equal.equals(currentValue, nextValue)) {
    return { model }
  } else {
    return { model, outMessage: OutMessage.ChangedValue({ value: nextValue }) }
  }
}

const keyboardDelta = (
  direction: PressedKeyboardNavigation['direction'],
  increment: PressedKeyboardNavigation['increment'],
): Point => {
  const amount = increment === 'Coarse' ? COARSE_INCREMENT : FINE_INCREMENT

  return Match.value(direction).pipe(
    Match.withReturnType<Point>(),
    Match.when('Left', () => ({ x: -amount, y: 0 })),
    Match.when('Right', () => ({ x: amount, y: 0 })),
    Match.when('Down', () => ({ x: 0, y: -amount })),
    Match.when('Up', () => ({ x: 0, y: amount })),
    Match.exhaustive,
  )
}

/** Processes a BezierEditor Message and returns the next Model, optional
 *  Commands, and an optional `ChangedValue` OutMessage. The curve lives in
 *  the parent, so Messages that need it carry it from the view. */
export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    PressedHandle: ({ handle, pointer, editorSize, originValue }) =>
      DragState.match<UpdateReturn>(model.dragState, {
        Idle: () => {
          const { scale } = bezierGeometry(originValue)
          return {
            model: modifyFields(model, {
              dragState: () =>
                DragState.Dragging({
                  handle,
                  originValue,
                  latestValue: originValue,
                  start: pointer,
                  valuePerPixel: {
                    x: VIEW_BOX_WIDTH / editorSize.width / scale,
                    y: VIEW_BOX_HEIGHT / editorSize.height / scale,
                  },
                }),
            }),
            commands: [FocusHandle({ id: model.id, handle })],
          }
        },
        Dragging: () => ({ model }),
      }),

    MovedDragPointer: ({ pointer }) =>
      DragState.match<UpdateReturn>(model.dragState, {
        Idle: () => ({ model }),
        Dragging: dragging => {
          const { handle, originValue, latestValue, start, valuePerPixel } =
            dragging
          const nextValue = moveHandle(originValue, handle, {
            x: (pointer.x - start.x) * valuePerPixel.x,
            y: (start.y - pointer.y) * valuePerPixel.y,
          })

          return withChangedValue(
            modifyFields(model, {
              dragState: () =>
                DragState.Dragging(
                  modifyFields(dragging, { latestValue: () => nextValue }),
                ),
            }),
            latestValue,
            nextValue,
          )
        },
      }),

    ReleasedDragPointer: () => ({
      model: modifyFields(model, { dragState: () => DragState.Idle() }),
    }),

    CancelledDrag: () =>
      DragState.match<UpdateReturn>(model.dragState, {
        Idle: () => ({ model }),
        Dragging: ({ originValue, latestValue }) =>
          withChangedValue(
            modifyFields(model, { dragState: () => DragState.Idle() }),
            latestValue,
            originValue,
          ),
      }),

    PressedKeyboardNavigation: ({ handle, direction, increment, value }) =>
      withChangedValue(
        modifyFields(model, { dragState: () => DragState.Idle() }),
        value,
        moveHandle(value, handle, keyboardDelta(direction, increment)),
      ),

    CompletedFocusHandle: () => ({ model }),
  })

// SUBSCRIPTION

const DragActivity = Schema.Literals(['Idle', 'Active'])

const dragActivityFromModel = (model: Model): typeof DragActivity.Type =>
  DragState.match<typeof DragActivity.Type>(model.dragState, {
    Idle: () => 'Idle',
    Dragging: () => 'Active',
  })

/** The BezierEditor's drag Subscriptions. A press records the pixel scale,
 *  so the pointer Subscriptions only report client coordinates and need no
 *  DOM lookup. */
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
                  pointer: { x: event.clientX, y: event.clientY },
                }),
              ),
            ),
            Stream.fromEventListener<PointerEvent>(document, 'pointerup').pipe(
              Stream.map((): Message => Message.ReleasedDragPointer()),
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

const ENDPOINT_RADIUS = '2.5'

const EDITOR_LABEL = 'Bézier easing curve'

const INSTRUCTIONS =
  'Drag to adjust X from 0 to 1 and Y from -1 to 2. Arrow keys adjust by 0.01. Shift adjusts by 0.1. Escape cancels a drag.'

const handleNumber = (handle: Handle): number => (handle === 'First' ? 1 : 2)

/** The DOM id of a handle. */
export const handleId = (id: string, handle: Handle): string =>
  `${id}-handle-${handleNumber(handle)}`

const instructionsId = (id: string): string => `${id}-instructions`

const editorSelector = (id: string): string =>
  attributeSelector('data-bezier-editor-id', id)

/** Attribute groups the BezierEditor hands to the consumer's `toView`.
 *  Render the `svg` and both handles inside `root`, with the handles
 *  positioned absolutely over the SVG. */
export type BezierEditorAttributes = Readonly<{
  root: ReadonlyArray<ChildAttribute>
  svg: ReadonlyArray<ChildAttribute>
  referenceLine: ReadonlyArray<ChildAttribute>
  firstControlLine: ReadonlyArray<ChildAttribute>
  secondControlLine: ReadonlyArray<ChildAttribute>
  curve: ReadonlyArray<ChildAttribute>
  startPoint: ReadonlyArray<ChildAttribute>
  endPoint: ReadonlyArray<ChildAttribute>
  firstHandle: ReadonlyArray<ChildAttribute>
  secondHandle: ReadonlyArray<ChildAttribute>
  instructions: ReadonlyArray<ChildAttribute>
}>

/** What the consumer's `toView` receives: the attribute groups, the curve's
 *  geometry in viewBox units, the screen reader instructions, and the drag
 *  state for styling. */
export type RenderInfo = Readonly<{
  attributes: BezierEditorAttributes
  geometry: BezierGeometry
  instructions: string
  maybeDraggedHandle: Option.Option<Handle>
}>

/** Per-render view inputs passed to `view` through `h.submodel`'s
 *  `viewInputs`. */
export type ViewInputs = Readonly<{
  /** The current curve, read from the parent Model. */
  value: CubicBezier
  toView: (render: RenderInfo) => Html
}>

/** Renders a headless cubic Bézier editor: an SVG of the curve with its
 *  reference diagonal and control lines, plus two handles you drag or move
 *  with the arrow keys. Each handle is a 2D slider whose value text carries
 *  its X and Y. The `type="button"` on each handle keeps it from submitting
 *  a host form when rendered as a `button`. */
export const view = defineView<Model, Message, ViewInputs>(
  (model, viewInputs, h): Html => {
    const { value, toView } = viewInputs
    const { id } = model
    const geometry = bezierGeometry(value)
    const [x1, y1, x2, y2] = value
    const maybeDraggedHandle = DragState.match<Option.Option<Handle>>(
      model.dragState,
      {
        Idle: () => Option.none(),
        Dragging: ({ handle }) => Option.some(handle),
      },
    )

    const handlePointerDown =
      (handle: Handle) =>
      (
        _pointerType: string,
        button: number,
        _screenX: number,
        _screenY: number,
        _timeStamp: number,
        clientX: number,
        clientY: number,
        _pointerId: number,
        target: EventTarget | null,
      ): Option.Option<Message> =>
        pipe(
          button,
          Option.liftPredicate(Equal.equals(LEFT_MOUSE_BUTTON)),
          Option.flatMap(() => closestElement(target, editorSelector(id))),
          Option.map(editor => editor.getBoundingClientRect()),
          Option.filter(({ width, height }) => width > 0 && height > 0),
          Option.map(({ width, height }) =>
            Message.PressedHandle({
              handle,
              pointer: { x: clientX, y: clientY },
              editorSize: { width, height },
              originValue: value,
            }),
          ),
        )

    const handleKeyDown =
      (handle: Handle) =>
      (key: string, modifiers: KeyboardModifiers): Option.Option<Message> => {
        if (hasCommandModifier(modifiers)) {
          return Option.none()
        } else {
          return Option.map(arrowKeyToDirection(key), direction =>
            Message.PressedKeyboardNavigation({
              handle,
              direction,
              increment: incrementOf(modifiers),
              value,
            }),
          )
        }
      }

    const lineAttributes = (from: Point, to: Point) => [
      h.X1(`${from.x}`),
      h.Y1(`${from.y}`),
      h.X2(`${to.x}`),
      h.Y2(`${to.y}`),
    ]

    const pointAttributes = (point: Point) => [
      h.Cx(`${point.x}`),
      h.Cy(`${point.y}`),
      h.R(ENDPOINT_RADIUS),
    ]

    // NOTE: each handle is a hand-rolled 2D slider, not a @foldkit/ui Slider.
    // Slider moves one value along one axis. A handle moves its X and Y
    // together, so it takes `role="slider"` for the arrow keys,
    // `aria-roledescription` to say it is two-dimensional, X as its value,
    // and value text that names both coordinates.
    const handleAttributes = (
      handle: Handle,
      position: Point,
      x: number,
      y: number,
    ) => [
      h.Id(handleId(id, handle)),
      h.DataAttribute('bezier-handle', `${handleNumber(handle)}`),
      h.Type('button'),
      h.Role('slider'),
      h.Tabindex(0),
      h.AriaRoleDescription('2D slider'),
      h.AriaLabel(`Bézier handle ${handleNumber(handle)}`),
      h.AriaValuemin(0),
      h.AriaValuemax(1),
      h.AriaValuenow(x),
      h.AriaValuetext(`X ${x}, Y ${y}`),
      h.AriaDescribedBy(instructionsId(id)),
      h.Style({
        left: percentageFromFraction(position.x / VIEW_BOX_WIDTH),
        top: percentageFromFraction(position.y / VIEW_BOX_HEIGHT),
        'touch-action': 'none',
      }),
      h.OnPointerDown(handlePointerDown(handle)),
      h.OnKeyDownPreventDefault(handleKeyDown(handle)),
      ...(Option.contains(maybeDraggedHandle, handle)
        ? [h.DataAttribute('dragging', '')]
        : []),
    ]

    return toView({
      attributes: {
        root: childAttributes([
          h.DataAttribute('bezier-editor-id', id),
          h.Role('group'),
          h.AriaLabel(EDITOR_LABEL),
          h.Style({ 'aspect-ratio': `${VIEW_BOX_WIDTH} / ${VIEW_BOX_HEIGHT}` }),
          ...(Option.isSome(maybeDraggedHandle)
            ? [h.DataAttribute('dragging', '')]
            : []),
        ]),
        svg: childAttributes([
          h.ViewBox(`0 0 ${VIEW_BOX_WIDTH} ${VIEW_BOX_HEIGHT}`),
          h.AriaHidden(true),
        ]),
        referenceLine: childAttributes(
          lineAttributes(geometry.start, geometry.end),
        ),
        firstControlLine: childAttributes(
          lineAttributes(geometry.start, geometry.firstControlLineEnd),
        ),
        secondControlLine: childAttributes(
          lineAttributes(geometry.end, geometry.secondControlLineEnd),
        ),
        curve: childAttributes([h.D(geometry.curvePath)]),
        startPoint: childAttributes(pointAttributes(geometry.start)),
        endPoint: childAttributes(pointAttributes(geometry.end)),
        firstHandle: childAttributes(
          handleAttributes('First', geometry.firstHandle, x1, y1),
        ),
        secondHandle: childAttributes(
          handleAttributes('Second', geometry.secondHandle, x2, y2),
        ),
        instructions: childAttributes([h.Id(instructionsId(id))]),
      },
      geometry,
      instructions: INSTRUCTIONS,
      maybeDraggedHandle,
    })
  },
)
