import {
  Array,
  Effect,
  Equal,
  Function,
  Match,
  Number,
  Option,
  Schema,
  Stream,
  String,
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
import { type Reflect, defineView } from 'foldkit/submodel'
import * as Subscription from 'foldkit/subscription'

import { documentDragStyles } from '../internal/dragStyles.js'
import { editorKeyToMessage } from '../internal/keyboard.js'
import { LEFT_MOUSE_BUTTON, closestElement } from '../internal/pointer.js'
import {
  formatStepValue,
  fractionOfValue,
  percentageFromFraction,
  snapAndClamp,
  valueOfFraction,
} from '../internal/range.js'
import { attributeSelector, idSelector } from '../internal/selectors.js'

// MODEL

const DragState = defineTaggedUnion({
  Idle: {},
  Dragging: { originValue: Schema.Number },
})

const EditState = defineTaggedUnion({
  Viewing: {},
  Editing: { draft: Schema.String },
})

/** Schema for the ScrubSlider's private interaction state. The value is owned
 *  by the parent and passed in through `ViewInputs.value`. `dragState`
 *  remembers the value before a drag so Escape can restore it, and
 *  `editState` holds the text while the value is being typed. */
export const Model = Schema.Struct({
  id: Schema.String,
  min: Schema.Number,
  max: Schema.Number,
  step: Schema.Number,
  dragState: DragState,
  editState: EditState,
})
export type Model = typeof Model.Type

// MESSAGE

/** Union of all Messages the ScrubSlider can produce. */
export const Message = defineMessageUnion({
  PressedTrack: { value: Schema.Number, originValue: Schema.Number },
  MovedDragPointer: { value: Schema.Number },
  ReleasedDragPointer: {},
  CancelledDrag: {},
  PressedKeyboardNavigation: {
    direction: Schema.Literals([
      'StepDecrement',
      'StepIncrement',
      'PageDecrement',
      'PageIncrement',
      'Min',
      'Max',
    ]),
    value: Schema.Number,
  },
  RequestedEdit: { value: Schema.Number },
  UpdatedDraft: { draft: Schema.String },
  PressedEnterInEditor: {},
  PressedEscapeInEditor: {},
  BlurredEditor: {},
  CompletedFocusEditor: {},
  CompletedFocusSlider: {},
})
export type Message = typeof Message.Type

export type PressedTrack = typeof Message.PressedTrack.Type
export type MovedDragPointer = typeof Message.MovedDragPointer.Type
export type ReleasedDragPointer = typeof Message.ReleasedDragPointer.Type
export type CancelledDrag = typeof Message.CancelledDrag.Type
export type PressedKeyboardNavigation =
  typeof Message.PressedKeyboardNavigation.Type
export type RequestedEdit = typeof Message.RequestedEdit.Type
export type UpdatedDraft = typeof Message.UpdatedDraft.Type

// OUT MESSAGE

/** Union of OutMessages the ScrubSlider can emit to its parent. */
export const OutMessage = defineMessageUnion({
  ChangedValue: { value: Schema.Number },
})
export type OutMessage = typeof OutMessage.Type

// INIT

/** Configuration for creating a ScrubSlider Model with `init`. */
export type InitConfig = Readonly<{
  id: string
  min: number
  max: number
  step: number
}>

/** Creates an initial ScrubSlider Model. The value lives in the parent Model. */
export const init = (config: InitConfig): Model => ({
  id: config.id,
  min: config.min,
  max: config.max,
  step: config.step,
  dragState: DragState.Idle(),
  editState: EditState.Viewing(),
})

/** Whether the pointer is dragging the slider. */
export const isDragging = (model: Model): boolean =>
  model.dragState._tag === 'Dragging'

// COMMAND

const sliderSelector = (id: string): string => idSelector(sliderId(id))
const editorSelector = (id: string): string => idSelector(editorId(id))

/** Moves focus into the value editor after it opens. */
export const FocusEditor = Command.define('FocusEditor', {
  args: { id: Schema.String },
  messages: [Message.CompletedFocusEditor],
  execute: ({ id }) =>
    Dom.focus(editorSelector(id)).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusEditor()),
    ),
})

/** Returns focus to the slider after the editor closes from the keyboard. */
export const FocusSlider = Command.define('FocusSlider', {
  args: { id: Schema.String },
  messages: [Message.CompletedFocusSlider],
  execute: ({ id }) =>
    Dom.focus(sliderSelector(id)).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusSlider()),
    ),
})

// UPDATE

const PAGE_STEP_MULTIPLIER = 10

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>
const withUpdateReturn = Match.withReturnType<UpdateReturn>()

const snapToRange = (model: Model, value: number): number =>
  snapAndClamp(value, model.min, model.max, model.step)

const nextValueForDirection = (
  model: Model,
  value: number,
  direction: PressedKeyboardNavigation['direction'],
): number =>
  Match.value(direction).pipe(
    Match.withReturnType<number>(),
    Match.when('StepIncrement', () => snapToRange(model, value + model.step)),
    Match.when('StepDecrement', () => snapToRange(model, value - model.step)),
    Match.when('PageIncrement', () =>
      snapToRange(model, value + model.step * PAGE_STEP_MULTIPLIER),
    ),
    Match.when('PageDecrement', () =>
      snapToRange(model, value - model.step * PAGE_STEP_MULTIPLIER),
    ),
    Match.when('Min', () => model.min),
    Match.when('Max', () => model.max),
    Match.exhaustive,
  )

const withChangedValue = (
  model: Model,
  currentValue: number,
  nextValue: number,
): UpdateReturn => {
  if (nextValue === currentValue) {
    return { model }
  } else {
    return {
      model,
      outMessage: OutMessage.ChangedValue({ value: nextValue }),
    }
  }
}

const parseDraft = (draft: string): Option.Option<number> =>
  pipe(draft, String.trim, Number.parse)

const closeEditor = (
  model: Model,
  draft: string,
  maybeFocusCommand: Option.Option<Command.Command<Message>>,
): UpdateReturn => {
  const closed = modifyFields(model, { editState: () => EditState.Viewing() })
  const commands = Array.fromOption(maybeFocusCommand)

  return Option.match(parseDraft(draft), {
    onNone: () => ({ model: closed, commands }),
    onSome: parsed => ({
      model: closed,
      commands,
      outMessage: OutMessage.ChangedValue({
        value: snapToRange(model, parsed),
      }),
    }),
  })
}

/** Processes a ScrubSlider Message and returns the next Model, optional
 *  Commands, and an optional `ChangedValue` OutMessage. The value lives in
 *  the parent, so Messages that need it carry it from the view. */
export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    PressedTrack: ({ value, originValue }) =>
      Match.value(model.dragState).pipe(
        withUpdateReturn,
        Match.tag('Dragging', () => ({ model })),
        Match.orElse(() =>
          withChangedValue(
            modifyFields(model, {
              dragState: () => DragState.Dragging({ originValue }),
            }),
            originValue,
            snapToRange(model, value),
          ),
        ),
      ),

    MovedDragPointer: ({ value }) =>
      Match.value(model.dragState).pipe(
        withUpdateReturn,
        Match.tag('Dragging', () => ({
          model,
          outMessage: OutMessage.ChangedValue({
            value: snapToRange(model, value),
          }),
        })),
        Match.orElse(() => ({ model })),
      ),

    ReleasedDragPointer: () => ({
      model: modifyFields(model, { dragState: () => DragState.Idle() }),
    }),

    CancelledDrag: () =>
      Match.value(model.dragState).pipe(
        withUpdateReturn,
        Match.tag('Dragging', ({ originValue }) => ({
          model: modifyFields(model, { dragState: () => DragState.Idle() }),
          outMessage: OutMessage.ChangedValue({ value: originValue }),
        })),
        Match.orElse(() => ({ model })),
      ),

    PressedKeyboardNavigation: ({ direction, value }) =>
      withChangedValue(
        model,
        value,
        nextValueForDirection(model, value, direction),
      ),

    RequestedEdit: ({ value }) => ({
      model: modifyFields(model, {
        editState: () =>
          EditState.Editing({ draft: formatStepValue(value, model.step) }),
      }),
      commands: [FocusEditor({ id: model.id })],
    }),

    UpdatedDraft: ({ draft }) =>
      EditState.match<UpdateReturn>(model.editState, {
        Viewing: () => ({ model }),
        Editing: () => ({
          model: modifyFields(model, {
            editState: () => EditState.Editing({ draft }),
          }),
        }),
      }),

    PressedEnterInEditor: () =>
      EditState.match<UpdateReturn>(model.editState, {
        Viewing: () => ({ model }),
        Editing: ({ draft }) =>
          closeEditor(model, draft, Option.some(FocusSlider({ id: model.id }))),
      }),

    PressedEscapeInEditor: () =>
      EditState.match<UpdateReturn>(model.editState, {
        Viewing: () => ({ model }),
        Editing: () => ({
          model: modifyFields(model, { editState: () => EditState.Viewing() }),
          commands: [FocusSlider({ id: model.id })],
        }),
      }),

    BlurredEditor: () =>
      EditState.match<UpdateReturn>(model.editState, {
        Viewing: () => ({ model }),
        Editing: ({ draft }) => closeEditor(model, draft, Option.none()),
      }),

    CompletedFocusEditor: () => ({ model }),
    CompletedFocusSlider: () => ({ model }),
  })

/** The bounds and step `reflectRange` writes. */
export type Range = Readonly<{ min: number; max: number; step: number }>

/** Reflects a new range onto the ScrubSlider, for a dial whose bounds change
 *  at runtime. The parent snaps its value to the range in the same update. */
export const reflectRange: Reflect<Model, Range> = Function.dual(
  2,
  (model: Model, range: Range): Model =>
    modifyFields(model, {
      min: () => range.min,
      max: () => range.max,
      step: () => range.step,
    }),
)

// SUBSCRIPTION

const DragActivity = Schema.Literals(['Idle', 'Active'])

const dragActivityFromModel = (model: Model): typeof DragActivity.Type =>
  DragState.match<typeof DragActivity.Type>(model.dragState, {
    Idle: () => 'Idle',
    Dragging: () => 'Active',
  })

const findTrackElement = (
  id: string,
  trackRoot: Document | ShadowRoot,
): Option.Option<Element> =>
  Option.fromNullishOr(
    trackRoot.querySelector<Element>(
      attributeSelector('data-scrub-slider-id', id),
    ),
  )

/** Maps a pointer's horizontal position over the track to a value in
 *  `[min, max]`. */
export const valueFromPointer = (
  clientX: number,
  track: Element,
  min: number,
  max: number,
): number => {
  const trackRect = track.getBoundingClientRect()
  if (trackRect.width === 0) {
    return min
  } else {
    return valueOfFraction(
      (clientX - trackRect.left) / trackRect.width,
      min,
      max,
    )
  }
}

/** Builds the ScrubSlider's drag Subscriptions, finding the track through the
 *  supplied root. Use this when the slider renders inside a Shadow DOM. */
export const subscriptionsForRoot = (
  getTrackRoot: () => Document | ShadowRoot,
) =>
  Subscription.make<Model, Message>()(entry => ({
    dragPointer: entry(
      {
        dragActivity: DragActivity,
        id: Schema.String,
        min: Schema.Number,
        max: Schema.Number,
      },
      {
        modelToDependencies: model => ({
          dragActivity: dragActivityFromModel(model),
          id: model.id,
          min: model.min,
          max: model.max,
        }),
        dependenciesToStream: ({ dragActivity, id, min, max }) => {
          const pointerEvents = Stream.mergeAll(
            [
              Stream.fromEventListener<PointerEvent>(
                document,
                'pointermove',
              ).pipe(
                Stream.mapEffect(event =>
                  Effect.sync(() =>
                    Option.map(findTrackElement(id, getTrackRoot()), track =>
                      Message.MovedDragPointer({
                        value: valueFromPointer(event.clientX, track, min, max),
                      }),
                    ),
                  ),
                ),
                Stream.filter(Option.isSome),
                Stream.map(({ value }): Message => value),
              ),
              Stream.fromEventListener<PointerEvent>(
                document,
                'pointerup',
              ).pipe(Stream.map((): Message => Message.ReleasedDragPointer())),
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

/** The ScrubSlider's drag Subscriptions for a slider in the main document. */
export const subscriptions = subscriptionsForRoot(() => document)

// VIEW

/** The DOM id of the element with `role="slider"`. */
export const sliderId = (id: string): string => `${id}-slider`

/** The DOM id of the value editor input. */
export const editorId = (id: string): string => `${id}-editor`

const labelId = (id: string): string => `${id}-label`

const VALUE_SELECTOR = '[data-scrub-slider-value]'

const isOnValue = (target: EventTarget | null): boolean =>
  Option.isSome(closestElement(target, VALUE_SELECTOR))

const keyToDirection = (
  key: string,
  modifiers: KeyboardModifiers,
): Option.Option<PressedKeyboardNavigation['direction']> =>
  Match.value(key).pipe(
    Match.withReturnType<PressedKeyboardNavigation['direction']>(),
    Match.whenOr('ArrowRight', 'ArrowUp', () =>
      modifiers.shiftKey ? 'PageIncrement' : 'StepIncrement',
    ),
    Match.whenOr('ArrowLeft', 'ArrowDown', () =>
      modifiers.shiftKey ? 'PageDecrement' : 'StepDecrement',
    ),
    Match.when('PageUp', () => 'PageIncrement'),
    Match.when('PageDown', () => 'PageDecrement'),
    Match.when('Home', () => 'Min'),
    Match.when('End', () => 'Max'),
    Match.option,
  )

/** Attribute groups the ScrubSlider hands to the consumer's `toView`. The
 *  whole `track` row is the press target, and `value` opens the editor when
 *  clicked. Render `value` and `editor` beside the track, inside `root`, not
 *  inside the track: a slider role must not contain a text field, and the
 *  track ignores presses that start on the value. */
export type ScrubSliderAttributes = Readonly<{
  root: ReadonlyArray<ChildAttribute>
  track: ReadonlyArray<ChildAttribute>
  fill: ReadonlyArray<ChildAttribute>
  handle: ReadonlyArray<ChildAttribute>
  label: ReadonlyArray<ChildAttribute>
  value: ReadonlyArray<ChildAttribute>
  editor: ReadonlyArray<ChildAttribute>
}>

/** What the consumer's `toView` receives: the attribute groups, the
 *  formatted value, the value's fraction of the range, and the interaction
 *  state for styling. */
export type RenderInfo = Readonly<{
  attributes: ScrubSliderAttributes
  formattedValue: string
  fraction: number
  isDragging: boolean
  isEditing: boolean
}>

/** Per-render view inputs passed to `view` through `h.submodel`'s
 *  `viewInputs`. */
export type ViewInputs = Readonly<{
  /** The current value, read from the parent Model. */
  value: number
  label: string
  toView: (render: RenderInfo) => Html
  /** Formats the value for display and `aria-valuetext`. Defaults to the
   *  value with as many decimals as the step has. */
  formatValue?: (value: number) => string
  isDisabled?: boolean
  getTrackRoot?: () => Document | ShadowRoot
}>

// NOTE: this is not @foldkit/ui's Slider. DialKit's slider makes the whole
// labelled row the press target, draws the label inside the track, and shows
// the value as text that opens an inline editor. Slider presses only on its
// own track and has no editor, so this view keeps its own pointer and key
// handling while following the same slider pattern and drag Subscriptions.

/** Renders a headless scrub slider: a row you press or drag anywhere to set
 *  the value, with the value shown as text that opens an editor. Follows the
 *  WAI-ARIA slider pattern on the track row. */
export const view = defineView<Model, Message, ViewInputs>(
  (model, viewInputs, h): Html => {
    const {
      value,
      label,
      toView,
      isDisabled = false,
      getTrackRoot = () => document,
    } = viewInputs
    const { id, min, max, step } = model
    const formatValue =
      viewInputs.formatValue ??
      ((current: number) => formatStepValue(current, step))
    const fraction = fractionOfValue(value, min, max)
    const isSliderDragging = isDragging(model)
    const isEditing = model.editState._tag === 'Editing'

    const handleTrackPointerDown = (
      _pointerType: string,
      button: number,
      _screenX: number,
      _screenY: number,
      _timeStamp: number,
      clientX: number,
      _clientY: number,
      _pointerId: number,
      target: EventTarget | null,
    ): Option.Option<Message> =>
      pipe(
        button,
        Option.liftPredicate(Equal.equals(LEFT_MOUSE_BUTTON)),
        Option.filter(() => !isEditing && !isOnValue(target)),
        Option.flatMap(() => findTrackElement(id, getTrackRoot())),
        Option.map(track =>
          Message.PressedTrack({
            value: valueFromPointer(clientX, track, min, max),
            originValue: value,
          }),
        ),
      )

    const handleKeyDown = (
      key: string,
      modifiers: KeyboardModifiers,
    ): Option.Option<Message> =>
      key === 'Enter'
        ? Option.some(Message.RequestedEdit({ value }))
        : Option.map(keyToDirection(key, modifiers), direction =>
            Message.PressedKeyboardNavigation({ direction, value }),
          )

    const stateAttributes = [
      ...(isSliderDragging ? [h.DataAttribute('dragging', '')] : []),
      ...(isEditing ? [h.DataAttribute('editing', '')] : []),
      ...(isDisabled ? [h.DataAttribute('disabled', '')] : []),
    ]

    const interactiveTrackAttributes = isDisabled
      ? []
      : [
          h.OnPointerDown(handleTrackPointerDown),
          h.OnKeyDownSelfPreventDefault(handleKeyDown),
        ]

    const trackAttributes = [
      h.Id(sliderId(id)),
      h.DataAttribute('scrub-slider-id', id),
      h.Role('slider'),
      h.Tabindex(0),
      h.AriaLabelledBy(labelId(id)),
      h.AriaValuemin(min),
      h.AriaValuemax(max),
      h.AriaValuenow(value),
      h.AriaValuetext(formatValue(value)),
      ...(isDisabled ? [h.AriaDisabled(true)] : []),
      h.Style({ 'touch-action': 'none' }),
      ...stateAttributes,
      ...interactiveTrackAttributes,
    ]

    const percentage = percentageFromFraction(fraction)

    const valueAttributes = [
      h.DataAttribute('scrub-slider-value', id),
      h.AriaHidden(true),
      ...stateAttributes,
      ...(isDisabled ? [] : [h.OnClick(Message.RequestedEdit({ value }))]),
    ]

    const editorAttributes = [
      h.Id(editorId(id)),
      h.Type('text'),
      h.InputMode('decimal'),
      h.AriaLabel(`${label} value`),
      h.Value(
        EditState.match<string>(model.editState, {
          Viewing: () => formatValue(value),
          Editing: ({ draft }) => draft,
        }),
      ),
      h.OnInput(draft => Message.UpdatedDraft({ draft })),
      h.OnKeyDownPreventDefault(
        editorKeyToMessage<Message>(
          Message.PressedEnterInEditor(),
          Message.PressedEscapeInEditor(),
        ),
      ),
      h.OnBlur(Message.BlurredEditor()),
    ]

    return toView({
      attributes: {
        root: childAttributes([
          h.DataAttribute('scrub-slider-root', id),
          ...stateAttributes,
        ]),
        track: childAttributes(trackAttributes),
        fill: childAttributes([
          h.Style({ width: percentage }),
          ...stateAttributes,
        ]),
        handle: childAttributes([
          h.Style({ left: `max(5px, ${percentage} - 9px)` }),
          ...stateAttributes,
        ]),
        label: childAttributes([h.Id(labelId(id))]),
        value: childAttributes(valueAttributes),
        editor: childAttributes(editorAttributes),
      },
      formattedValue: formatValue(value),
      fraction,
      isDragging: isSliderDragging,
      isEditing,
    })
  },
)
