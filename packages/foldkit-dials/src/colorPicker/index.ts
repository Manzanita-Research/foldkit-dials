import {
  Array,
  Effect,
  Equal,
  Function,
  Match,
  Option,
  Schema,
  Stream,
  String,
  pipe,
} from 'effect'
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
import * as Update from 'foldkit/update'

import { RadioGroup } from '@foldkit/ui'

import {
  Color,
  ColorFormat,
  DEGREES_PER_TURN,
  type Gamut,
  fitToFormat,
  formatColor,
  gamutOfFormat,
  maxChroma,
} from '../color/index.js'
import { colorFormatOf, parseColor } from '../color/parse.js'
import {
  ColorDraft,
  type InvalidDraftHandling,
  commitDraft,
  draftErrorAttributes,
  draftInputAttributes,
  isRejected as isDraftRejected,
} from '../internal/colorDraft.js'
import { documentDragStyles } from '../internal/dragStyles.js'
import { LEFT_MOUSE_BUTTON } from '../internal/pointer.js'
import { PERCENT, clamp, percentageFromFraction } from '../internal/range.js'
import { attributeSelector, idSelector } from '../internal/selectors.js'
import { withCommand } from '../internal/update.js'

// MODEL

/** The control a pointer drag moves: the saturation and lightness area, the
 *  hue track, or the alpha track. */
export const DragTarget = Schema.Literals(['Area', 'Hue', 'Alpha'])
export type DragTarget = typeof DragTarget.Type

/** A colour together with the area thumb's horizontal position.
 *  `saturation` is the colour's chroma as a fraction of the most chroma the
 *  area's gamut allows at its lightness and hue. It is kept apart from
 *  chroma because white and black have no chroma at any position. */
export const PickerColor = Schema.Struct({
  color: Color,
  saturation: Schema.Number,
})
export type PickerColor = typeof PickerColor.Type

/** A pointer position over the area or a track, as fractions from its left
 *  and top edges. */
export const PointerPosition = Schema.Struct({
  horizontal: Schema.Number,
  vertical: Schema.Number,
})
export type PointerPosition = typeof PointerPosition.Type

const DragState = defineTaggedUnion({
  Idle: {},
  Dragging: {
    target: DragTarget,
    originValue: Schema.String,
    originColor: PickerColor,
  },
})

const LastEdit = Schema.Struct({
  value: Schema.String,
  pickerColor: PickerColor,
})

/** Schema for the ColorPicker's private interaction state. The value is a
 *  colour string owned by the parent and passed in through
 *  `ViewInputs.value`. `selectedFormat` is the format edits are written in,
 *  and `formatGroup` is the RadioGroup that picks it. `dragState` remembers
 *  the value before a drag so Escape can restore it.
 *  `editState` holds text typed into the text input. `maybeLastEdit` keeps
 *  the exact colour behind the last value the picker wrote. While the parent
 *  still holds that value, edits start from it, so hex rounding does not
 *  drift and the hue and area position survive white, black, and grey. */
export const Model = Schema.Struct({
  id: Schema.String,
  selectedFormat: ColorFormat,
  formatGroup: RadioGroup.Model,
  dragState: DragState,
  editState: ColorDraft,
  maybeLastEdit: Schema.Option(LastEdit),
})
export type Model = typeof Model.Type

// MESSAGE

const AreaDirection = Schema.Literals(['Left', 'Right', 'Up', 'Down'])
const StepSize = Schema.Literals(['Step', 'Page'])
const Track = Schema.Literals(['Hue', 'Alpha'])
const TrackDirection = Schema.Literals([
  'StepDecrement',
  'StepIncrement',
  'PageDecrement',
  'PageIncrement',
  'Min',
  'Max',
])

/** Union of all Messages the ColorPicker can produce. */
export const Message = defineMessageUnion({
  PressedPointer: {
    target: DragTarget,
    position: PointerPosition,
    value: Schema.String,
  },
  MovedDragPointer: { position: PointerPosition },
  ReleasedDragPointer: {},
  CancelledDrag: {},
  PressedAreaKeyboardNavigation: {
    direction: AreaDirection,
    stepSize: StepSize,
    value: Schema.String,
  },
  PressedTrackKeyboardNavigation: {
    track: Track,
    direction: TrackDirection,
    value: Schema.String,
  },
  GotFormatGroupMessage: { message: RadioGroup.Message },
  SelectedFormatOption: {
    option: RadioGroup.Message.SelectedOption,
    value: Schema.String,
  },
  UpdatedDraft: { draft: Schema.String },
  PressedEnterInEditor: { value: Schema.String },
  PressedEscapeInEditor: {},
  BlurredEditor: { value: Schema.String },
  CompletedFocusThumb: {},
})
export type Message = typeof Message.Type

export type PressedPointer = typeof Message.PressedPointer.Type
export type MovedDragPointer = typeof Message.MovedDragPointer.Type
export type ReleasedDragPointer = typeof Message.ReleasedDragPointer.Type
export type CancelledDrag = typeof Message.CancelledDrag.Type
export type PressedAreaKeyboardNavigation =
  typeof Message.PressedAreaKeyboardNavigation.Type
export type PressedTrackKeyboardNavigation =
  typeof Message.PressedTrackKeyboardNavigation.Type
export type GotFormatGroupMessage = typeof Message.GotFormatGroupMessage.Type
export type SelectedFormatOption = typeof Message.SelectedFormatOption.Type
export type UpdatedDraft = typeof Message.UpdatedDraft.Type

// OUT MESSAGE

/** Union of OutMessages the ColorPicker can emit to its parent. */
export const OutMessage = defineMessageUnion({
  ChangedValue: { value: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

// INIT

/** Configuration for creating a ColorPicker Model with `init`. `value` is the
 *  parent's starting colour, which picks the format edits are written in. */
export type InitConfig = Readonly<{
  id: string
  value: string
}>

const FormatGroup = RadioGroup.create<ColorFormat>()

const formatGroupId = (id: string): string => `${id}-format`

/** Creates an initial ColorPicker Model. The value lives in the parent
 *  Model. */
export const init = (config: InitConfig): Model => ({
  id: config.id,
  selectedFormat: colorFormatOf(config.value),
  formatGroup: RadioGroup.init({ id: formatGroupId(config.id) }),
  dragState: DragState.Idle(),
  editState: ColorDraft.Viewing(),
  maybeLastEdit: Option.none(),
})

// COMMAND

/** Moves focus to the thumb of the control a pointer pressed, so the arrow
 *  keys adjust it next. */
export const FocusThumb = Command.define('FocusThumb', {
  args: { id: Schema.String, target: DragTarget },
  messages: [Message.CompletedFocusThumb],
  execute: ({ id, target }) =>
    Dom.focus(idSelector(thumbId(id, target))).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusThumb()),
    ),
})

// UPDATE

const AREA_STEP = 0.01
const AREA_PAGE_STEP = 0.1
const HUE_STEP_DEGREES = 1
const HUE_PAGE_STEP_DEGREES = 10
const ALPHA_STEP = 0.01
const ALPHA_PAGE_STEP = 0.1
const FALLBACK_COLOR: Color = { lightness: 0, chroma: 0, hue: 0, alpha: 1 }

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>
type Step = Update.StepWithOutMessage<Model, Message, OutMessage>

/** The gamut the area spans for a format. Hex spans sRGB, and OKLCH and
 *  Display P3 span Display P3. */
export const areaGamut = (format: ColorFormat): Gamut =>
  Option.getOrElse(gamutOfFormat(format), (): Gamut => 'DisplayP3')

const saturationOf = (
  color: Color,
  gamut: Gamut,
  fallbackSaturation: number,
): number => {
  const maxChromaHere = maxChroma(color.lightness, color.hue, gamut)
  if (maxChromaHere > 0) {
    return clamp(color.chroma / maxChromaHere, 0, 1)
  } else {
    return fallbackSaturation
  }
}

const pickerColorFromValue = (
  value: string,
  gamut: Gamut,
  maybePrevious: Option.Option<PickerColor>,
): PickerColor => {
  const parsed = Option.getOrElse(parseColor(value), () => FALLBACK_COLOR)
  const maybePreviousHue = Option.map(maybePrevious, ({ color }) => color.hue)
  const color =
    parsed.chroma === 0
      ? modifyFields(parsed, {
          hue: hue => Option.getOrElse(maybePreviousHue, () => hue),
        })
      : parsed
  const fallbackSaturation = Option.match(maybePrevious, {
    onNone: () => 0,
    onSome: previous => previous.saturation,
  })

  return { color, saturation: saturationOf(color, gamut, fallbackSaturation) }
}

/** The colour and area position the picker shows for a value. While the
 *  value is the last one the picker wrote, this is the exact colour behind
 *  it. Otherwise the value is parsed, keeping the previous hue and area
 *  position where the parsed colour has no chroma to carry them. */
export const pickerColorOf = (model: Model, value: string): PickerColor =>
  pipe(
    model.maybeLastEdit,
    Option.filter(lastEdit => lastEdit.value === value),
    Option.match({
      onSome: ({ pickerColor }) => pickerColor,
      onNone: () =>
        pickerColorFromValue(
          value,
          areaGamut(model.selectedFormat),
          Option.map(model.maybeLastEdit, ({ pickerColor }) => pickerColor),
        ),
    }),
  )

const withAreaPosition = (
  { color }: PickerColor,
  saturation: number,
  lightness: number,
  gamut: Gamut,
): PickerColor => {
  const nextSaturation = clamp(saturation, 0, 1)
  const nextLightness = clamp(lightness, 0, 1)

  return {
    color: modifyFields(color, {
      lightness: () => nextLightness,
      chroma: () => nextSaturation * maxChroma(nextLightness, color.hue, gamut),
    }),
    saturation: nextSaturation,
  }
}

const withHue = (
  { color, saturation }: PickerColor,
  hue: number,
  gamut: Gamut,
): PickerColor => {
  const nextHue = clamp(hue, 0, DEGREES_PER_TURN)

  return {
    color: modifyFields(color, {
      hue: () => nextHue,
      chroma: () => saturation * maxChroma(color.lightness, nextHue, gamut),
    }),
    saturation,
  }
}

const withAlpha = (pickerColor: PickerColor, alpha: number): PickerColor =>
  modifyFields(pickerColor, {
    color: color => modifyFields(color, { alpha: () => clamp(alpha, 0, 1) }),
  })

const pickerColorAtPosition = (
  origin: PickerColor,
  target: DragTarget,
  { horizontal, vertical }: PointerPosition,
  gamut: Gamut,
): PickerColor =>
  Match.value(target).pipe(
    Match.withReturnType<PickerColor>(),
    Match.when('Area', () =>
      withAreaPosition(origin, horizontal, 1 - vertical, gamut),
    ),
    Match.when('Hue', () =>
      withHue(origin, horizontal * DEGREES_PER_TURN, gamut),
    ),
    Match.when('Alpha', () => withAlpha(origin, horizontal)),
    Match.exhaustive,
  )

const pickerColorAfterAreaKey = (
  current: PickerColor,
  direction: PressedAreaKeyboardNavigation['direction'],
  stepSize: PressedAreaKeyboardNavigation['stepSize'],
  gamut: Gamut,
): PickerColor => {
  const step = stepSize === 'Page' ? AREA_PAGE_STEP : AREA_STEP
  const { saturation } = current
  const { lightness } = current.color

  return Match.value(direction).pipe(
    Match.withReturnType<PickerColor>(),
    Match.when('Left', () =>
      withAreaPosition(current, saturation - step, lightness, gamut),
    ),
    Match.when('Right', () =>
      withAreaPosition(current, saturation + step, lightness, gamut),
    ),
    Match.when('Up', () =>
      withAreaPosition(current, saturation, lightness + step, gamut),
    ),
    Match.when('Down', () =>
      withAreaPosition(current, saturation, lightness - step, gamut),
    ),
    Match.exhaustive,
  )
}

type TrackRange = Readonly<{
  max: number
  step: number
  pageStep: number
}>

const HUE_RANGE: TrackRange = {
  max: DEGREES_PER_TURN,
  step: HUE_STEP_DEGREES,
  pageStep: HUE_PAGE_STEP_DEGREES,
}

const ALPHA_RANGE: TrackRange = {
  max: 1,
  step: ALPHA_STEP,
  pageStep: ALPHA_PAGE_STEP,
}

const nextTrackValue = (
  value: number,
  { max, step, pageStep }: TrackRange,
  direction: PressedTrackKeyboardNavigation['direction'],
): number =>
  Match.value(direction).pipe(
    Match.withReturnType<number>(),
    Match.when('StepIncrement', () => value + step),
    Match.when('StepDecrement', () => value - step),
    Match.when('PageIncrement', () => value + pageStep),
    Match.when('PageDecrement', () => value - pageStep),
    Match.when('Min', () => 0),
    Match.when('Max', () => max),
    Match.exhaustive,
  )

const pickerColorAfterTrackKey = (
  current: PickerColor,
  track: PressedTrackKeyboardNavigation['track'],
  direction: PressedTrackKeyboardNavigation['direction'],
  gamut: Gamut,
): PickerColor =>
  Match.value(track).pipe(
    Match.withReturnType<PickerColor>(),
    Match.when('Hue', () =>
      withHue(
        current,
        nextTrackValue(current.color.hue, HUE_RANGE, direction),
        gamut,
      ),
    ),
    Match.when('Alpha', () =>
      withAlpha(
        current,
        nextTrackValue(current.color.alpha, ALPHA_RANGE, direction),
      ),
    ),
    Match.exhaustive,
  )

const withChangedValue = (
  model: Model,
  currentValue: string,
  nextValue: string,
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

const commitPickerColor = (
  model: Model,
  { color, saturation }: PickerColor,
  currentValue: string,
): UpdateReturn => {
  const nextColor = fitToFormat(color, model.selectedFormat)
  const nextValue = formatColor(nextColor, model.selectedFormat)

  return withChangedValue(
    modifyFields(model, {
      maybeLastEdit: () =>
        Option.some({
          value: nextValue,
          pickerColor: { color: nextColor, saturation },
        }),
    }),
    currentValue,
    nextValue,
  )
}

const lastWrittenValue = (model: Model, fallbackValue: string): string =>
  Option.match(model.maybeLastEdit, {
    onNone: () => fallbackValue,
    onSome: ({ value }) => value,
  })

const selectFormat = (
  model: Model,
  format: ColorFormat,
  value: string,
): UpdateReturn => {
  const current = pickerColorOf(model, value)
  const color = fitToFormat(current.color, format)

  return commitPickerColor(
    modifyFields(model, { selectedFormat: () => format }),
    {
      color,
      saturation: saturationOf(color, areaGamut(format), current.saturation),
    },
    value,
  )
}

/** Text typed into a colour input, and the parent's value at the time. */
export type TextSubmission = Readonly<{
  text: string
  value: string
}>

/** Commits typed colour text. Text that parses is reported as typed, trimmed,
 *  so RGB and HSL text keeps its form, and later picker edits write the
 *  format {@link colorFormatOf} picks for it. Text that does not parse is
 *  ignored. Use it with `Update.foldChild` for a text input outside the
 *  picker, such as ColorField's value input. */
export const submitText = (
  model: Model,
  { text, value }: TextSubmission,
): UpdateReturn => {
  const trimmed = String.trim(text)

  if (Option.isSome(parseColor(trimmed))) {
    return withChangedValue(
      modifyFields(model, { selectedFormat: () => colorFormatOf(trimmed) }),
      value,
      trimmed,
    )
  } else {
    return { model }
  }
}

const commitTypedText = (
  model: Model,
  value: string,
  handling: InvalidDraftHandling,
): UpdateReturn => {
  const { nextDraft, maybeSubmittedText } = commitDraft(
    model.editState,
    handling,
  )
  const committed = modifyFields(model, { editState: () => nextDraft })

  return Option.match(maybeSubmittedText, {
    onNone: () => ({ model: committed }),
    onSome: text => submitText(committed, { text, value }),
  })
}

const foldFormatGroup = (whenSelected: (format: ColorFormat) => Step) =>
  Update.foldChild({
    update: FormatGroup.update,
    read: (model: Model) => Option.some(model.formatGroup),
    write: (model, nextFormatGroup) =>
      modifyFields(model, { formatGroup: () => nextFormatGroup }),
    toParentMessage: message => Message.GotFormatGroupMessage({ message }),
    foldOutMessage: outMessage =>
      RadioGroup.OutMessage.match<Step, RadioGroup.OutMessage<ColorFormat>>(
        outMessage,
        { Selected: ({ value: format }) => whenSelected(format) },
      ),
  })

const keepFormat =
  (format: ColorFormat): Step =>
  model => ({ model: modifyFields(model, { selectedFormat: () => format }) })

const rewriteInFormat =
  (value: string) =>
  (format: ColorFormat): Step =>
  model =>
    selectFormat(model, format, value)

/** Processes a ColorPicker Message and returns the next Model, optional
 *  Commands, and an optional `ChangedValue` OutMessage. The value lives in
 *  the parent, so Messages that need it carry it from the view. */
export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    PressedPointer: ({ target, position, value }) =>
      DragState.match<UpdateReturn>(model.dragState, {
        Dragging: () => ({ model }),
        Idle: () => {
          const originColor = pickerColorOf(model, value)

          return withCommand(
            commitPickerColor(
              modifyFields(model, {
                dragState: () =>
                  DragState.Dragging({
                    target,
                    originValue: value,
                    originColor,
                  }),
              }),
              pickerColorAtPosition(
                originColor,
                target,
                position,
                areaGamut(model.selectedFormat),
              ),
              value,
            ),
            FocusThumb({ id: model.id, target }),
          )
        },
      }),

    MovedDragPointer: ({ position }) =>
      DragState.match<UpdateReturn>(model.dragState, {
        Idle: () => ({ model }),
        Dragging: ({ target, originValue, originColor }) =>
          commitPickerColor(
            model,
            pickerColorAtPosition(
              originColor,
              target,
              position,
              areaGamut(model.selectedFormat),
            ),
            lastWrittenValue(model, originValue),
          ),
      }),

    ReleasedDragPointer: () => ({
      model: modifyFields(model, { dragState: () => DragState.Idle() }),
    }),

    CancelledDrag: () =>
      DragState.match<UpdateReturn>(model.dragState, {
        Idle: () => ({ model }),
        Dragging: ({ originValue, originColor }) =>
          withChangedValue(
            modifyFields(model, {
              dragState: () => DragState.Idle(),
              maybeLastEdit: () =>
                Option.some({ value: originValue, pickerColor: originColor }),
            }),
            lastWrittenValue(model, originValue),
            originValue,
          ),
      }),

    PressedAreaKeyboardNavigation: ({ direction, stepSize, value }) =>
      commitPickerColor(
        model,
        pickerColorAfterAreaKey(
          pickerColorOf(model, value),
          direction,
          stepSize,
          areaGamut(model.selectedFormat),
        ),
        value,
      ),

    PressedTrackKeyboardNavigation: ({ track, direction, value }) =>
      commitPickerColor(
        model,
        pickerColorAfterTrackKey(
          pickerColorOf(model, value),
          track,
          direction,
          areaGamut(model.selectedFormat),
        ),
        value,
      ),

    GotFormatGroupMessage: ({ message: formatGroupMessage }) =>
      foldFormatGroup(keepFormat)(model, formatGroupMessage),

    SelectedFormatOption: ({ option, value }) =>
      foldFormatGroup(rewriteInFormat(value))(model, option),

    UpdatedDraft: ({ draft }) => ({
      model: modifyFields(model, {
        editState: () => ColorDraft.Editing({ draft }),
      }),
    }),

    PressedEnterInEditor: ({ value }) =>
      commitTypedText(model, value, 'Reject'),

    PressedEscapeInEditor: () => ({ model: discardDraft(model) }),

    BlurredEditor: ({ value }) => commitTypedText(model, value, 'Discard'),

    CompletedFocusThumb: () => ({ model }),
  })

/** Drops text typed into the text input without committing it. Call it when
 *  the parent hides the picker, so a reopened picker shows the value. */
export const discardDraft = (model: Model): Model =>
  modifyFields(model, { editState: () => ColorDraft.Viewing() })

/** Reflects a value the parent set from outside the picker, such as a loaded
 *  preset, so later edits write that value's format. A value the picker
 *  wrote itself leaves the Model unchanged. */
export const reflectValue: Reflect<Model, string> = Function.dual(
  2,
  (model: Model, value: string): Model => {
    const isLastEdit = Option.exists(
      model.maybeLastEdit,
      lastEdit => lastEdit.value === value,
    )

    if (isLastEdit) {
      return model
    } else {
      return modifyFields(model, { selectedFormat: () => colorFormatOf(value) })
    }
  },
)

// SUBSCRIPTION

const DragActivity = Schema.Literals(['Idle', 'Active'])

const dragActivityFromModel = (model: Model): typeof DragActivity.Type =>
  DragState.match<typeof DragActivity.Type>(model.dragState, {
    Idle: () => 'Idle',
    Dragging: () => 'Active',
  })

const maybeDragTargetFromModel = (model: Model): Option.Option<DragTarget> =>
  DragState.match<Option.Option<DragTarget>>(model.dragState, {
    Idle: () => Option.none(),
    Dragging: ({ target }) => Option.some(target),
  })

const targetDataAttribute = (target: DragTarget): string =>
  Match.value(target).pipe(
    Match.withReturnType<string>(),
    Match.when('Area', () => 'color-picker-area'),
    Match.when('Hue', () => 'color-picker-hue-track'),
    Match.when('Alpha', () => 'color-picker-alpha-track'),
    Match.exhaustive,
  )

const findTargetElement = (
  id: string,
  target: DragTarget,
  root: Document | ShadowRoot,
): Option.Option<Element> =>
  Option.fromNullishOr(
    root.querySelector<Element>(
      attributeSelector(`data-${targetDataAttribute(target)}`, id),
    ),
  )

const fractionAlong = (offset: number, size: number): number => {
  if (size === 0) {
    return 0
  } else {
    return clamp(offset / size, 0, 1)
  }
}

/** Maps a pointer's position over the area or a track element to fractions
 *  from its left and top edges. */
export const positionFromPointer = (
  clientX: number,
  clientY: number,
  element: Element,
): PointerPosition => {
  const rect = element.getBoundingClientRect()

  return {
    horizontal: fractionAlong(clientX - rect.left, rect.width),
    vertical: fractionAlong(clientY - rect.top, rect.height),
  }
}

const dragPointerStream = (
  id: string,
  target: DragTarget,
  getTrackRoot: () => Document | ShadowRoot,
): Stream.Stream<Message> => {
  const pointerEvents = Stream.mergeAll(
    [
      Stream.fromEventListener<PointerEvent>(document, 'pointermove').pipe(
        Stream.mapEffect(event =>
          Effect.sync(() =>
            Option.map(findTargetElement(id, target, getTrackRoot()), element =>
              Message.MovedDragPointer({
                position: positionFromPointer(
                  event.clientX,
                  event.clientY,
                  element,
                ),
              }),
            ),
          ),
        ),
        Stream.filter(Option.isSome),
        Stream.map(({ value }): Message => value),
      ),
      Stream.fromEventListener<PointerEvent>(document, 'pointerup').pipe(
        Stream.map((): Message => Message.ReleasedDragPointer()),
      ),
      Stream.fromEventListener<PointerEvent>(document, 'pointercancel').pipe(
        Stream.map((): Message => Message.CancelledDrag()),
      ),
    ],
    { concurrency: 'unbounded' },
  )

  return Stream.merge(pointerEvents, documentDragStyles)
}

/** Builds the ColorPicker's drag Subscriptions, finding the area and tracks
 *  through the supplied root. Use this when the picker renders inside a
 *  Shadow DOM. */
export const subscriptionsForRoot = (
  getTrackRoot: () => Document | ShadowRoot,
) =>
  Subscription.make<Model, Message>()(entry => ({
    dragPointer: entry(
      { maybeDragTarget: Schema.Option(DragTarget), id: Schema.String },
      {
        modelToDependencies: model => ({
          maybeDragTarget: maybeDragTargetFromModel(model),
          id: model.id,
        }),
        dependenciesToStream: ({ maybeDragTarget, id }) =>
          Option.match(maybeDragTarget, {
            onNone: () => Stream.empty,
            onSome: target => dragPointerStream(id, target, getTrackRoot),
          }),
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

/** The ColorPicker's drag Subscriptions for a picker in the main document. */
export const subscriptions = subscriptionsForRoot(() => document)

// VIEW

const AREA_EDGE_STOP_COUNT = 21
const HUE_TRACK_STOP_DEGREES = 5
const AREA_NEUTRAL_GRADIENT = 'linear-gradient(to bottom in oklab, #fff, #000)'
const AREA_NEUTRAL_PROPERTY = '--color-picker-area-neutral'
const AREA_EDGE_PROPERTY = '--color-picker-area-edge'
const TRACK_GRADIENT_PROPERTY = '--color-picker-track'
const THUMB_COLOR_PROPERTY = '--color-picker-thumb'

/** The label DialKit shows for a colour format option. */
export const colorFormatLabel = (format: ColorFormat): string =>
  Match.value(format).pipe(
    Match.withReturnType<string>(),
    Match.when('Hex', () => 'Hex'),
    Match.when('Oklch', () => 'OKLCH'),
    Match.when('DisplayP3', () => 'Display P3'),
    Match.exhaustive,
  )

/** The DOM id of a thumb, the element with `role="slider"` for the area, the
 *  hue track, or the alpha track. */
export const thumbId = (id: string, target: DragTarget): string =>
  `${id}-${String.toLowerCase(target)}-thumb`

/** The DOM id of the text input. */
export const textInputId = (id: string): string => `${id}-input`

/** A selector for the checked format option within a picker. A parent that
 *  opens the picker in a Popover focuses it first, as a radio group's tab
 *  stop. */
export const selectedFormatSelector = (id: string): string =>
  `${attributeSelector('data-color-picker-id', id)} [role="radio"][aria-checked="true"]`

const toPercent = (fraction: number): number => Math.round(fraction * PERCENT)

const opaqueOklch = (color: Color): string =>
  formatColor(modifyFields(color, { alpha: () => 1 }), 'Oklch')

const areaEdgeGradient = (hue: number, gamut: Gamut): string => {
  const stops = pipe(
    Array.makeBy(AREA_EDGE_STOP_COUNT, index => {
      const lightness = 1 - index / (AREA_EDGE_STOP_COUNT - 1)
      return opaqueOklch({
        lightness,
        chroma: maxChroma(lightness, hue, gamut),
        hue,
        alpha: 1,
      })
    }),
    Array.join(', '),
  )

  return `linear-gradient(to bottom in oklab, ${stops})`
}

const hueTrackGradient = (
  { color, saturation }: PickerColor,
  gamut: Gamut,
): string => {
  const stops = pipe(
    Array.makeBy(DEGREES_PER_TURN / HUE_TRACK_STOP_DEGREES + 1, index => {
      const hue = index * HUE_TRACK_STOP_DEGREES
      return opaqueOklch({
        lightness: color.lightness,
        chroma: saturation * maxChroma(color.lightness, hue, gamut),
        hue,
        alpha: 1,
      })
    }),
    Array.join(', '),
  )

  return `linear-gradient(to right in oklab, ${stops})`
}

const areaKeyToNavigation = (
  key: string,
  modifiers: KeyboardModifiers,
): Option.Option<
  Pick<PressedAreaKeyboardNavigation, 'direction' | 'stepSize'>
> => {
  const stepSize = modifiers.shiftKey ? 'Page' : 'Step'

  return Match.value(key).pipe(
    Match.withReturnType<
      Pick<PressedAreaKeyboardNavigation, 'direction' | 'stepSize'>
    >(),
    Match.when('ArrowLeft', () => ({ direction: 'Left', stepSize })),
    Match.when('ArrowRight', () => ({ direction: 'Right', stepSize })),
    Match.when('ArrowUp', () => ({ direction: 'Up', stepSize })),
    Match.when('ArrowDown', () => ({ direction: 'Down', stepSize })),
    Match.option,
  )
}

const trackKeyToDirection = (
  key: string,
  modifiers: KeyboardModifiers,
): Option.Option<PressedTrackKeyboardNavigation['direction']> =>
  Match.value(key).pipe(
    Match.withReturnType<PressedTrackKeyboardNavigation['direction']>(),
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

/** Attribute groups the ColorPicker hands to the consumer's `toView`. The
 *  `area`, `hueTrack`, and `alphaTrack` elements are the pointer targets, and
 *  each thumb is positioned inside its target with an inline style.
 *
 *  A second `Style` on these elements would replace that inline style, so
 *  they also carry their colours as CSS custom properties for the consumer's
 *  stylesheet:
 *
 *  - `area`: `--color-picker-area-neutral` and `--color-picker-area-edge`.
 *  - `hueTrack` and `alphaTrack`: `--color-picker-track`.
 *  - Each thumb: `--color-picker-thumb`.
 *
 *  {@link PickerColors} describes each value. */
export type ColorPickerAttributes = Readonly<{
  root: ReadonlyArray<ChildAttribute>
  area: ReadonlyArray<ChildAttribute>
  areaThumb: ReadonlyArray<ChildAttribute>
  hueTrack: ReadonlyArray<ChildAttribute>
  hueThumb: ReadonlyArray<ChildAttribute>
  alphaTrack: ReadonlyArray<ChildAttribute>
  alphaThumb: ReadonlyArray<ChildAttribute>
  textInput: ReadonlyArray<ChildAttribute>
  error: ReadonlyArray<ChildAttribute>
}>

/** CSS colours for painting the picker.
 *
 *  - `opaque`: the colour without its alpha, for the area and hue thumbs.
 *  - `current`: the colour with its alpha, for the alpha thumb and swatches.
 *  - `areaNeutralGradient`: the area's left edge, white to black. Paint it as
 *    the area background.
 *  - `areaEdgeGradient`: the area's right edge, the most chroma at each
 *    lightness for the current hue. Paint it over the neutral gradient,
 *    masked from transparent on the left to opaque on the right.
 *  - `hueTrackGradient`: every hue at the current lightness and saturation.
 *  - `alphaTrackGradient`: transparent to the opaque colour. */
export type PickerColors = Readonly<{
  opaque: string
  current: string
  areaNeutralGradient: string
  areaEdgeGradient: string
  hueTrackGradient: string
  alphaTrackGradient: string
}>

/** The picker's position on each control, as fractions from 0 to 1.
 *  `lightness` runs from the bottom of the area to the top. */
export type PickerFractions = Readonly<{
  saturation: number
  lightness: number
  hue: number
  alpha: number
}>

/** What the consumer's `toView` receives: the attribute groups, the format
 *  options rendered by `toFormatGroupView`, the CSS colours to paint, the
 *  thumb positions, and the interaction state for styling. Render `error`,
 *  with text such as "Not a valid color", only while `isRejected`. */
export type RenderInfo = Readonly<{
  attributes: ColorPickerAttributes
  formatGroup: Html
  colors: PickerColors
  fractions: PickerFractions
  selectedFormat: ColorFormat
  isDragging: boolean
  isEditing: boolean
  isRejected: boolean
}>

/** Per-render view inputs passed to `view` through `h.submodel`'s
 *  `viewInputs`. */
export type ViewInputs = Readonly<{
  /** The current colour string, read from the parent Model. */
  value: string
  toView: (render: RenderInfo) => Html
  /** Renders the format options, a horizontal RadioGroup, for
   *  `RenderInfo.formatGroup`. Label each option with
   *  {@link colorFormatLabel}. */
  toFormatGroupView: (render: RadioGroup.RenderInfo<ColorFormat>) => Html
  getTrackRoot?: () => Document | ShadowRoot
}>

/** Renders a headless colour picker: a saturation and lightness area, hue and
 *  alpha tracks, format options, and a text input. Each thumb follows the
 *  WAI-ARIA slider pattern, and the format options are a @foldkit/ui
 *  RadioGroup. */
export const view = defineView<Model, Message, ViewInputs>(
  (model, viewInputs, h): Html => {
    const {
      value,
      toView,
      toFormatGroupView,
      getTrackRoot = () => document,
    } = viewInputs
    const { id, selectedFormat } = model
    const gamut = areaGamut(selectedFormat)
    const pickerColor = pickerColorOf(model, value)
    const { color, saturation } = pickerColor
    const hueFraction = color.hue / DEGREES_PER_TURN
    const isDragging = model.dragState._tag === 'Dragging'
    const isEditing = model.editState._tag !== 'Viewing'
    const isRejected = isDraftRejected(model.editState)
    const opaque = opaqueOklch(color)

    const pointerHandler =
      (target: DragTarget) =>
      (
        _pointerType: string,
        button: number,
        _screenX: number,
        _screenY: number,
        _timeStamp: number,
        clientX: number,
        clientY: number,
      ): Option.Option<Message> =>
        pipe(
          button,
          Option.liftPredicate(Equal.equals(LEFT_MOUSE_BUTTON)),
          Option.flatMap(() => findTargetElement(id, target, getTrackRoot())),
          Option.map(element =>
            Message.PressedPointer({
              target,
              position: positionFromPointer(clientX, clientY, element),
              value,
            }),
          ),
        )

    const handleAreaKeyDown = (
      key: string,
      modifiers: KeyboardModifiers,
    ): Option.Option<Message> =>
      Option.map(
        areaKeyToNavigation(key, modifiers),
        ({ direction, stepSize }) =>
          Message.PressedAreaKeyboardNavigation({
            direction,
            stepSize,
            value,
          }),
      )

    const trackKeyDownHandler =
      (track: PressedTrackKeyboardNavigation['track']) =>
      (key: string, modifiers: KeyboardModifiers): Option.Option<Message> =>
        Option.map(trackKeyToDirection(key, modifiers), direction =>
          Message.PressedTrackKeyboardNavigation({ track, direction, value }),
        )

    const stateAttributes = isDragging ? [h.DataAttribute('dragging', '')] : []

    const colors: PickerColors = {
      opaque,
      current: formatColor(color, 'Oklch'),
      areaNeutralGradient: AREA_NEUTRAL_GRADIENT,
      areaEdgeGradient: areaEdgeGradient(color.hue, gamut),
      hueTrackGradient: hueTrackGradient(pickerColor, gamut),
      alphaTrackGradient: `linear-gradient(to right, transparent, ${opaque})`,
    }

    const targetAttributes = (
      target: DragTarget,
      paint: Readonly<Record<string, string>>,
    ) => [
      h.DataAttribute(targetDataAttribute(target), id),
      h.Style({ position: 'relative', 'touch-action': 'none', ...paint }),
      h.OnPointerDown(pointerHandler(target)),
      ...stateAttributes,
    ]

    const areaThumbAttributes = [
      h.Id(thumbId(id, 'Area')),
      h.Role('slider'),
      h.Tabindex(0),
      h.AriaRoleDescription('2D slider'),
      h.AriaLabel('Saturation and lightness'),
      h.AriaValuemin(0),
      h.AriaValuemax(PERCENT),
      h.AriaValuenow(toPercent(saturation)),
      h.AriaValuetext(
        `Saturation ${toPercent(saturation)}%, lightness ${toPercent(color.lightness)}%`,
      ),
      h.Style({
        position: 'absolute',
        left: percentageFromFraction(saturation),
        top: percentageFromFraction(1 - color.lightness),
        transform: 'translate(-50%, -50%)',
        [THUMB_COLOR_PROPERTY]: colors.opaque,
      }),
      h.OnKeyDownPreventDefault(handleAreaKeyDown),
      ...stateAttributes,
    ]

    // NOTE: the hue and opacity thumbs are not @foldkit/ui Sliders. Their
    // values are not stored numbers: each is read from the parent's colour
    // string, and each change rewrites the whole colour in the selected
    // format. Escape must restore the exact text the drag started from, such
    // as typed `rgb()` text, which a Slider's numeric origin cannot do. The
    // area and both tracks also share one drag state and one set of drag
    // Subscriptions.
    const trackThumbAttributes = (
      track: PressedTrackKeyboardNavigation['track'],
      fraction: number,
      thumbColor: string,
    ) => [
      h.Style({
        position: 'absolute',
        left: percentageFromFraction(fraction),
        transform: 'translateX(-50%)',
        [THUMB_COLOR_PROPERTY]: thumbColor,
      }),
      h.Role('slider'),
      h.Tabindex(0),
      h.AriaOrientation('horizontal'),
      h.OnKeyDownPreventDefault(trackKeyDownHandler(track)),
      ...stateAttributes,
    ]

    const hueThumbAttributes = [
      h.Id(thumbId(id, 'Hue')),
      h.AriaLabel('Hue'),
      h.AriaValuemin(0),
      h.AriaValuemax(DEGREES_PER_TURN),
      h.AriaValuenow(Math.round(color.hue)),
      h.AriaValuetext(`${Math.round(color.hue)} degrees`),
      ...trackThumbAttributes('Hue', hueFraction, colors.opaque),
    ]

    const alphaThumbAttributes = [
      h.Id(thumbId(id, 'Alpha')),
      h.AriaLabel('Opacity'),
      h.AriaValuemin(0),
      h.AriaValuemax(PERCENT),
      h.AriaValuenow(toPercent(color.alpha)),
      h.AriaValuetext(`${toPercent(color.alpha)} percent`),
      ...trackThumbAttributes('Alpha', color.alpha, colors.current),
    ]

    const formatGroup = h.submodel({
      slotId: model.formatGroup.id,
      model: model.formatGroup,
      view: FormatGroup.view,
      // NOTE: a selected option goes through `SelectedFormatOption`, which
      // carries the parent's colour, because rewriting the colour in the new
      // format needs it. The RadioGroup's other Messages need nothing more.
      toParentMessage: message =>
        RadioGroup.Message.match<Message>(message, {
          SelectedOption: option =>
            Message.SelectedFormatOption({ option, value }),
          FocusedOption: () => Message.GotFormatGroupMessage({ message }),
          CompletedFocusOption: () =>
            Message.GotFormatGroupMessage({ message }),
        }),
      viewInputs: {
        options: ColorFormat.literals,
        selectedValue: Option.some(selectedFormat),
        ariaLabel: 'Color format',
        orientation: 'Horizontal',
        toView: toFormatGroupView,
      },
    })

    const textInputAttributes = draftInputAttributes(
      {
        id: textInputId(id),
        ariaLabel: 'CSS color',
        value,
        draft: model.editState,
        onInput: draft => Message.UpdatedDraft({ draft }),
        onEnter: Message.PressedEnterInEditor({ value }),
        onEscape: Message.PressedEscapeInEditor(),
        onBlur: Message.BlurredEditor({ value }),
      },
      h,
    )

    return toView({
      attributes: {
        root: childAttributes([
          h.DataAttribute('color-picker-id', id),
          ...stateAttributes,
        ]),
        area: childAttributes(
          targetAttributes('Area', {
            [AREA_NEUTRAL_PROPERTY]: colors.areaNeutralGradient,
            [AREA_EDGE_PROPERTY]: colors.areaEdgeGradient,
          }),
        ),
        areaThumb: childAttributes(areaThumbAttributes),
        hueTrack: childAttributes(
          targetAttributes('Hue', {
            [TRACK_GRADIENT_PROPERTY]: colors.hueTrackGradient,
          }),
        ),
        hueThumb: childAttributes(hueThumbAttributes),
        alphaTrack: childAttributes(
          targetAttributes('Alpha', {
            [TRACK_GRADIENT_PROPERTY]: colors.alphaTrackGradient,
          }),
        ),
        alphaThumb: childAttributes(alphaThumbAttributes),
        textInput: childAttributes(textInputAttributes),
        error: childAttributes(draftErrorAttributes(textInputId(id), h)),
      },
      formatGroup,
      colors,
      fractions: {
        saturation,
        lightness: color.lightness,
        hue: hueFraction,
        alpha: color.alpha,
      },
      selectedFormat,
      isDragging,
      isEditing,
      isRejected,
    })
  },
)
