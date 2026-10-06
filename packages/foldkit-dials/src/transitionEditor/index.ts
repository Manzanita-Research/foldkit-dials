import {
  Array,
  Equal,
  Match,
  Number,
  Option,
  Record,
  Schema,
  String,
  pipe,
} from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { defineView } from 'foldkit/submodel'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'

import { Input, RadioGroup } from '@foldkit/ui'

import * as BezierEditor from '../bezierEditor/index.js'
import * as Curve from '../curve/index.js'
import { editorKeyToMessage } from '../internal/keyboard.js'
import { formatStepValue } from '../internal/range.js'
import { segmented } from '../internal/segmented.js'
import { sliderRow } from '../internal/sliderRow.js'
import * as ScrubSlider from '../scrubSlider/index.js'
import {
  CubicBezier,
  DEFAULT_EASING,
  DEFAULT_PHYSICS_SPRING,
  DEFAULT_TIME_SPRING,
  Transition,
  TransitionMode,
} from '../transition/index.js'
import {
  MODE_LABELS,
  MODE_PARAMETERS,
  ModeParameter,
  parameterValue,
  parametersFor,
  withParameter,
} from '../transition/parameters.js'

// MODEL

const EaseDraft = defineTaggedUnion({
  Viewing: {},
  Editing: { draft: Schema.String },
})

/** Schema for the editor's interaction state. The transition is owned by the
 *  parent. `cache` keeps the last value of each mode, so switching modes and
 *  back restores the edits, as DialKit does. `sliders` holds one ScrubSlider
 *  for every parameter. */
export const Model = Schema.Struct({
  id: Schema.String,
  modeGroup: RadioGroup.Model,
  cache: Schema.Struct({
    easing: Transition.Easing,
    timeSpring: Transition.TimeSpring,
    physicsSpring: Transition.PhysicsSpring,
  }),
  sliders: Schema.Record(ModeParameter, ScrubSlider.Model),
  bezier: BezierEditor.Model,
  easeDraft: EaseDraft,
})
export type Model = typeof Model.Type

// MESSAGE

/** Union of all Messages the transition editor can produce. */
export const Message = defineMessageUnion({
  GotModeMessage: { message: RadioGroup.Message },
  GotSliderMessage: {
    parameterId: ModeParameter,
    message: ScrubSlider.Message,
  },
  GotBezierMessage: { message: BezierEditor.Message },
  UpdatedEaseDraft: { draft: Schema.String },
  PressedEnterInEaseInput: {},
  PressedEscapeInEaseInput: {},
  BlurredEaseInput: {},
})
export type Message = typeof Message.Type

// OUT MESSAGE

/** Union of OutMessages the editor emits. */
export const OutMessage = defineMessageUnion({
  ChangedValue: { value: Transition },
})
export type OutMessage = typeof OutMessage.Type

// INIT

/** Configuration for `init`. */
export type InitConfig = Readonly<{ id: string }>

const ModeGroup = RadioGroup.create<TransitionMode>()

/** Creates an initial editor Model. The cache starts at DialKit's defaults
 *  for each mode. */
export const init = (config: InitConfig): Model => ({
  id: config.id,
  modeGroup: RadioGroup.init({ id: `${config.id}-mode` }),
  cache: {
    easing: DEFAULT_EASING,
    timeSpring: DEFAULT_TIME_SPRING,
    physicsSpring: DEFAULT_PHYSICS_SPRING,
  },
  sliders: Record.map(MODE_PARAMETERS, ({ min, max, step }, parameter) =>
    ScrubSlider.init({
      id: `${config.id}-${String.toLowerCase(parameter)}`,
      min,
      max,
      step,
    }),
  ),
  bezier: BezierEditor.init({ id: `${config.id}-bezier` }),
  easeDraft: EaseDraft.Viewing(),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>
type Step = Update.StepWithOutMessage<Model, Message, OutMessage>

const reportChange =
  (value: Transition, nextValue: Transition): Step =>
  model => {
    if (Equal.equals(value, nextValue)) {
      return { model }
    } else {
      return {
        model,
        outMessage: OutMessage.ChangedValue({ value: nextValue }),
      }
    }
  }

const cacheFor = (model: Model, mode: TransitionMode): Transition =>
  Match.value(mode).pipe(
    Match.withReturnType<Transition>(),
    Match.when('Easing', () => model.cache.easing),
    Match.when('TimeSpring', () => model.cache.timeSpring),
    Match.when('PhysicsSpring', () => model.cache.physicsSpring),
    Match.exhaustive,
  )

const cacheTransition = (model: Model, transition: Transition): Model =>
  Transition.match<Model>(transition, {
    Easing: easing =>
      modifyFields(model, {
        cache: cache => modifyFields(cache, { easing: () => easing }),
      }),
    TimeSpring: timeSpring =>
      modifyFields(model, {
        cache: cache => modifyFields(cache, { timeSpring: () => timeSpring }),
      }),
    PhysicsSpring: physicsSpring =>
      modifyFields(model, {
        cache: cache =>
          modifyFields(cache, { physicsSpring: () => physicsSpring }),
      }),
  })

const commitTransition =
  (value: Transition, nextValue: Transition): Step =>
  model =>
    reportChange(value, nextValue)(cacheTransition(model, nextValue))

const CSS_WRAPPER = /^\s*cubic-bezier\(|\)\s*$/g
const EASE_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i
const EASE_DISPLAY_DECIMALS = 3
const isUnitInterval = Number.between({ minimum: 0, maximum: 1 })
const clampEaseY = Number.clamp({ minimum: -1, maximum: 2 })

/** Parses typed Bézier coordinates such as `0.25, 0.1, 0.25, 1`, with or
 *  without a `cubic-bezier()` wrapper. As in DialKit, both X values must lie
 *  within 0 to 1, and the Y values are clamped to -1 to 2. */
export const parseEase = (text: string): Option.Option<CubicBezier> =>
  pipe(
    text.replace(CSS_WRAPPER, ''),
    String.split(','),
    Array.map(String.trim),
    Option.liftPredicate(Array.every(part => EASE_NUMBER.test(part))),
    Option.flatMap(parts => Option.all(Array.map(parts, Number.parse))),
    Option.flatMap(Schema.decodeUnknownOption(CubicBezier)),
    Option.filter(
      ([x1, y1, x2, y2]) =>
        isUnitInterval(x1) &&
        isUnitInterval(x2) &&
        globalThis.Number.isFinite(y1) &&
        globalThis.Number.isFinite(y2),
    ),
    Option.map(([x1, y1, x2, y2]): CubicBezier => [
      x1,
      clampEaseY(y1),
      x2,
      clampEaseY(y2),
    ]),
  )

/** Formats Bézier coordinates the way the Ease field shows them. */
export const formatEase = (ease: CubicBezier): string =>
  Array.join(
    Array.map(
      ease,
      coordinate => `${Number.round(coordinate, EASE_DISPLAY_DECIMALS)}`,
    ),
    ', ',
  )

const foldSliderOutMessage =
  (parameter: ModeParameter, value: Transition) =>
  (outMessage: ScrubSlider.OutMessage) =>
    ScrubSlider.OutMessage.match<Step>(outMessage, {
      ChangedValue: ({ value: parameterValue }) =>
        commitTransition(
          value,
          withParameter(value, parameter, parameterValue),
        ),
    })

const foldSlider = (parameter: ModeParameter, value: Transition) =>
  Update.foldChild({
    update: ScrubSlider.update,
    read: (model: Model) => Option.some(model.sliders[parameter]),
    write: (model, nextSlider) =>
      modifyFields(model, { sliders: Record.set(parameter, nextSlider) }),
    toParentMessage: message =>
      Message.GotSliderMessage({ parameterId: parameter, message }),
    foldOutMessage: foldSliderOutMessage(parameter, value),
  })

const foldModeOutMessage =
  (value: Transition) => (outMessage: RadioGroup.OutMessage<TransitionMode>) =>
    RadioGroup.OutMessage.match<Step, RadioGroup.OutMessage<TransitionMode>>(
      outMessage,
      {
        Selected:
          ({ value: mode }) =>
          model => {
            const cached = cacheTransition(model, value)
            return reportChange(value, cacheFor(cached, mode))(cached)
          },
      },
    )

const foldMode = (value: Transition) =>
  Update.foldChild({
    update: ModeGroup.update,
    read: (model: Model) => Option.some(model.modeGroup),
    write: (model, nextModeGroup) =>
      modifyFields(model, { modeGroup: () => nextModeGroup }),
    toParentMessage: message => Message.GotModeMessage({ message }),
    foldOutMessage: foldModeOutMessage(value),
  })

/** The easing to edit: the current value, or the last easing used. */
const easingOf = (value: Transition, model: Model): Model['cache']['easing'] =>
  value._tag === 'Easing' ? value : model.cache.easing

const withEase = (
  value: Transition,
  model: Model,
  ease: CubicBezier,
): Transition =>
  Transition.Easing({ duration: easingOf(value, model).duration, ease })

const foldBezierOutMessage =
  (value: Transition) => (outMessage: BezierEditor.OutMessage) =>
    BezierEditor.OutMessage.match<Step>(outMessage, {
      ChangedValue:
        ({ value: ease }) =>
        model =>
          commitTransition(value, withEase(value, model, ease))(model),
    })

const foldBezier = (value: Transition) =>
  Update.foldChild({
    update: BezierEditor.update,
    read: (model: Model) => Option.some(model.bezier),
    write: (model, nextBezier) =>
      modifyFields(model, { bezier: () => nextBezier }),
    toParentMessage: message => Message.GotBezierMessage({ message }),
    foldOutMessage: foldBezierOutMessage(value),
  })

const closeEaseInput = (model: Model): Model =>
  modifyFields(model, { easeDraft: () => EaseDraft.Viewing() })

const commitEaseDraft = (model: Model, value: Transition): UpdateReturn =>
  EaseDraft.match<UpdateReturn>(model.easeDraft, {
    Viewing: () => ({ model }),
    Editing: ({ draft }) =>
      Option.match(parseEase(draft), {
        onNone: () => ({ model: closeEaseInput(model) }),
        onSome: ease =>
          commitTransition(
            value,
            withEase(value, model, ease),
          )(closeEaseInput(model)),
      }),
  })

/** Processes an editor Message against the parent-owned transition `value`,
 *  reporting edits as `ChangedValue`. Typed Ease text is committed on Enter
 *  and on blur, and dropped on Escape or when it does not parse. */
export const update = (model: Model, message: Message, value: Transition) =>
  Message.match<UpdateReturn>(message, {
    GotModeMessage: ({ message: modeMessage }) =>
      foldMode(value)(model, modeMessage),
    GotSliderMessage: ({ parameterId, message: sliderMessage }) =>
      foldSlider(parameterId, value)(model, sliderMessage),
    GotBezierMessage: ({ message: bezierMessage }) =>
      foldBezier(value)(model, bezierMessage),
    UpdatedEaseDraft: ({ draft }) => ({
      model: modifyFields(model, {
        easeDraft: () => EaseDraft.Editing({ draft }),
      }),
    }),
    PressedEnterInEaseInput: () => commitEaseDraft(model, value),
    BlurredEaseInput: () => commitEaseDraft(model, value),
    PressedEscapeInEaseInput: () => ({ model: closeEaseInput(model) }),
  })

// SUBSCRIPTION

const sliderSubscriptions = Record.fromEntries(
  Array.flatMap(ModeParameter.literals, parameter =>
    Array.map(
      Record.toEntries(
        Subscription.lift(ScrubSlider.subscriptions)<Model, Message>({
          read: model => Option.some(model.sliders[parameter]),
          toParentMessage: message =>
            Message.GotSliderMessage({ parameterId: parameter, message }),
        }),
      ),
      ([name, subscription]) => [`${parameter}:${name}`, subscription] as const,
    ),
  ),
)

const bezierSubscriptions = Subscription.lift(BezierEditor.subscriptions)<
  Model,
  Message
>({
  read: model => Option.some(model.bezier),
  toParentMessage: message => Message.GotBezierMessage({ message }),
})

/** The editor's drag Subscriptions: every parameter slider and the Bézier
 *  handles. Lift them into the parent with `Subscription.lift`. */
export const subscriptions = Subscription.aggregate(
  sliderSubscriptions,
  bezierSubscriptions,
)

// VIEW

/** Per-render view inputs for `view`. */
export type ViewInputs = Readonly<{
  /** The current transition, read from the parent Model. */
  value: Transition
  label: string
}>

/** The DOM id of the Ease input. */
export const easeInputId = (id: string): string => `${id}-ease`

const parameterSlider = (
  model: Model,
  value: Transition,
  parameter: ModeParameter,
  h: HtmlBuilder<Message>,
): Html => {
  const spec = MODE_PARAMETERS[parameter]
  return Option.match(parameterValue(value, parameter), {
    onNone: () => h.empty,
    onSome: current =>
      h.submodel({
        slotId: `transition-${parameter}`,
        model: model.sliders[parameter],
        view: ScrubSlider.view,
        toParentMessage: message =>
          Message.GotSliderMessage({ parameterId: parameter, message }),
        viewInputs: {
          value: current,
          label: spec.label,
          formatValue: sliderValue => formatStepValue(sliderValue, spec.step),
          toView: sliderRow({ label: spec.label }),
        },
      }),
  })
}

const bezierView = (
  model: Model,
  ease: CubicBezier,
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: 'transition-bezier',
    model: model.bezier,
    view: BezierEditor.view,
    toParentMessage: message => Message.GotBezierMessage({ message }),
    viewInputs: {
      value: ease,
      toView: ({ attributes, instructions }) =>
        h.div(
          [...attributes.root, h.Class('dialkit-easing-viz')],
          [
            h.svg(
              [...attributes.svg],
              [
                h.line([
                  ...attributes.referenceLine,
                  h.Class('dialkit-easing-reference'),
                ]),
                h.line([
                  ...attributes.firstControlLine,
                  h.Class('dialkit-easing-tangent'),
                ]),
                h.line([
                  ...attributes.secondControlLine,
                  h.Class('dialkit-easing-tangent'),
                ]),
                h.path([...attributes.curve, h.Class('dialkit-easing-curve')]),
                h.circle([
                  ...attributes.startPoint,
                  h.Class('dialkit-easing-endpoint'),
                ]),
                h.circle([
                  ...attributes.endPoint,
                  h.Class('dialkit-easing-endpoint'),
                ]),
              ],
            ),
            h.button([
              ...attributes.firstHandle,
              h.Class('dialkit-easing-handle'),
            ]),
            h.button([
              ...attributes.secondHandle,
              h.Class('dialkit-easing-handle'),
            ]),
            h.span(
              [
                ...attributes.instructions,
                h.Class('dialkit-easing-instructions'),
              ],
              [instructions],
            ),
          ],
        ),
    },
  })

const easeInputView = (
  model: Model,
  ease: CubicBezier,
  h: HtmlBuilder<Message>,
): Html =>
  Input.view(
    {
      id: easeInputId(model.id),
      value: EaseDraft.match<string>(model.easeDraft, {
        Viewing: () => formatEase(ease),
        Editing: ({ draft }) => draft,
      }),
      onInput: draft => Message.UpdatedEaseDraft({ draft }),
      toView: ({ label, input }) =>
        h.div(
          [h.Class('dialkit-labeled-control')],
          [
            h.label(
              [...label, h.Class('dialkit-labeled-control-label')],
              ['Ease'],
            ),
            h.input([
              ...input,
              h.Class('dialkit-text-input fkd-ease-input'),
              h.Spellcheck(false),
              h.OnBlur(Message.BlurredEaseInput()),
              h.OnKeyDownPreventDefault(
                editorKeyToMessage<Message>(
                  Message.PressedEnterInEaseInput(),
                  Message.PressedEscapeInEaseInput(),
                ),
              ),
            ]),
          ],
        ),
    },
    h,
  )

/** Renders the editor body as DialKit's transition editor: the curve, the
 *  Easing, Time, and Physics switch, and the mode's parameters. The parent
 *  renders the folder around it. */
export const view = defineView<Model, Message, ViewInputs>(
  (model, viewInputs, h): Html => {
    const { value, label } = viewInputs
    const mode = value._tag
    return h.div(
      [h.Class('fkd-transition-editor')],
      [
        value._tag === 'Easing'
          ? bezierView(model, value.ease, h)
          : Curve.view(
              {
                transition: value,
                attributes: [h.Class('dialkit-spring-viz')],
              },
              h,
            ),
        h.div(
          [h.Class('dialkit-labeled-control')],
          [
            h.span([h.Class('dialkit-labeled-control-label')], ['Type']),
            h.submodel({
              slotId: 'transition-mode',
              model: model.modeGroup,
              view: ModeGroup.view,
              toParentMessage: message => Message.GotModeMessage({ message }),
              viewInputs: {
                options: TransitionMode.literals,
                selectedValue: Option.some(mode),
                ariaLabel: `${label} type`,
                orientation: 'Horizontal',
                toView: segmented<TransitionMode>(mode => MODE_LABELS[mode]),
              },
            }),
          ],
        ),
        ...(value._tag === 'Easing'
          ? [easeInputView(model, value.ease, h)]
          : []),
        ...Array.map(parametersFor(mode), parameter =>
          parameterSlider(model, value, parameter, h),
        ),
      ],
    )
  },
)
