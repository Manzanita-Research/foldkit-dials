import { Array, Match, Option, Record, Schema } from 'effect'
import { Subscription, Update } from 'foldkit'
import {
  BezierEditor,
  Color,
  ColorField,
  ColorPicker,
  Curve,
  Dial,
  DialPad,
  DialPanel,
  DialTimeline,
  ImagePicker,
  ScrubSlider,
  Timeline,
  Transition,
  TransitionEditor,
} from 'foldkit-dials'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { RadioGroup } from '@foldkit/ui'

import * as Interactions from '../interactions'

// PANEL DEFINITION

const image = (color: string): string =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" rx="12" fill="${color}"/></svg>`)}`

export const imageOptions = [
  { value: image('#6d5efc'), label: 'Violet' },
  { value: image('#10b981'), label: 'Mint' },
  { value: image('#f97316'), label: 'Apricot' },
]

export const PanelValues = Schema.Struct({
  title: Dial.text('A small tuning panel'),
  size: Dial.slider({ default: 24, min: 8, max: 64, step: 1 }),
  enabled: Dial.toggle(true),
  alignment: Dial.select(['Start', 'Center', 'End']),
  accent: Dial.color('#6d5efc'),
  position: Dial.pad({ x: [0, -1, 1, 0.1], y: [0, -1, 1, 0.1] }),
  artwork: Dial.image({ options: imageOptions }),
  motion: Dial.spring({ visualDuration: 0.5, bounce: 0.2 }),
  replay: Dial.action('Count action'),
  detail: Dial.folder(
    { opacity: Dial.slider({ default: 0.8, min: 0, max: 1, step: 0.1 }) },
    { isCollapsed: true },
  ),
})

export const ExamplePanel = DialPanel.make({
  id: 'gallery-panel',
  name: 'Gallery panel',
  schema: PanelValues,
  persist: false,
})

// TIMELINE DEFINITION

export const exampleTimeline = Timeline.make({
  duration: 3,
  clips: {
    dot: Timeline.sequence({
      at: 0,
      from: { x: 0, scale: 1 },
      transition: Transition.Transition.Easing({
        duration: 0.8,
        ease: [0.25, 0.1, 0.25, 1],
      }),
      steps: [
        { duration: 0.8, to: { x: 180, scale: 1.4 } },
        { duration: 0.8, to: { x: 0, scale: 1 } },
      ],
    }),
    fade: Timeline.clip({
      at: 0,
      duration: 0.8,
      from: { opacity: 0.3 },
      to: { opacity: 1 },
      transition: Transition.Transition.Easing({
        duration: 0.8,
        ease: [0.25, 0.1, 0.25, 1],
      }),
    }),
    cue: Timeline.marker({ at: 1.6 }),
  },
})

export const ExampleDock = DialTimeline.make({
  name: 'Gallery',
  autoplay: false,
  timeline: exampleTimeline,
  theme: 'Light',
  loop: false,
})

// MODEL

export const Page = Schema.Literals(['Controls', 'Panels', 'Timeline'])
export type Page = typeof Page.Type

export const Model = Schema.Struct({
  page: Page,
  amount: Schema.Number,
  slider: ScrubSlider.Model,
  position: DialPad.Value,
  pad: DialPad.Model,
  ease: Transition.CubicBezier,
  bezier: BezierEditor.Model,
  color: Schema.String,
  field: ColorField.Model,
  pickerColor: Schema.String,
  picker: ColorPicker.Model,
  artwork: Schema.String,
  image: ImagePicker.Model,
  motion: Transition.Transition,
  transition: TransitionEditor.Model,
  panelValues: PanelValues,
  panel: ExamplePanel.Model,
  layout: DialPanel.Layout,
  actionCount: Schema.Number,
  dock: ExampleDock.Model,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  GotSliderMessage: { message: ScrubSlider.Message },
  GotPadMessage: { message: DialPad.Message },
  GotBezierMessage: { message: BezierEditor.Message },
  GotFieldMessage: { message: ColorField.Message },
  GotPickerMessage: { message: ColorPicker.Message },
  GotImageMessage: { message: ImagePicker.Message },
  GotTransitionMessage: { message: TransitionEditor.Message },
  GotPanelMessage: { message: DialPanel.Message },
  GotDockMessage: { message: DialTimeline.Message },
  SelectedLayout: { layout: DialPanel.Layout },
})
export type Message = typeof Message.Type

// INIT

const axis = { min: -1, max: 1, step: 0.1, default: 0 }

export const init = (): Update.Return<Model, Message> =>
  Update.foldChildInit(ExamplePanel.init(), {
    toParentModel: panel => ({
      page: 'Controls',
      amount: 40,
      slider: ScrubSlider.init({
        id: 'gallery-amount',
        min: 0,
        max: 100,
        step: 1,
      }),
      position: { x: 0, y: 0 },
      pad: DialPad.init({ id: 'gallery-position', x: axis, y: axis }),
      ease: [0.25, 0.1, 0.25, 1],
      bezier: BezierEditor.init({ id: 'gallery-bezier' }),
      color: '#6d5efc',
      field: ColorField.init({ id: 'gallery-field', value: '#6d5efc' }),
      pickerColor: '#10b981',
      picker: ColorPicker.init({ id: 'gallery-picker', value: '#10b981' }),
      artwork: '',
      image: ImagePicker.init({ id: 'gallery-image', options: imageOptions }),
      motion: Transition.Transition.TimeSpring({
        visualDuration: 0.5,
        bounce: 0.2,
      }),
      transition: TransitionEditor.init({ id: 'gallery-transition' }),
      panelValues: ExamplePanel.defaults,
      panel,
      layout: 'Inline',
      actionCount: 0,
      dock: ExampleDock.init(),
    }),
    toParentMessage: message => Message.GotPanelMessage({ message }),
  })

// SLIDER UPDATE

const foldSlider = Update.foldChild({
  update: ScrubSlider.update,
  read: (model: Model) => Option.some(model.slider),
  write: (model, nextSlider) =>
    modifyFields(model, { slider: () => nextSlider }),
  toParentMessage: message => Message.GotSliderMessage({ message }),
  foldOutMessage: ScrubSlider.OutMessage.match<Update.Step<Model, Message>>({
    ChangedValue:
      ({ value }) =>
      model => ({
        model: modifyFields(model, { amount: () => value }),
      }),
  }),
})

// CHILD UPDATES

const foldPad = Update.foldChild({
  update: DialPad.update,
  read: (model: Model) => Option.some(model.pad),
  write: (model, nextPad) => modifyFields(model, { pad: () => nextPad }),
  toParentMessage: message => Message.GotPadMessage({ message }),
  foldOutMessage: DialPad.OutMessage.match<Update.Step<Model, Message>>({
    ChangedValue:
      ({ value }) =>
      model => ({ model: modifyFields(model, { position: () => value }) }),
  }),
})

const foldBezier = Update.foldChild({
  update: BezierEditor.update,
  read: (model: Model) => Option.some(model.bezier),
  write: (model, nextBezier) =>
    modifyFields(model, { bezier: () => nextBezier }),
  toParentMessage: message => Message.GotBezierMessage({ message }),
  foldOutMessage: BezierEditor.OutMessage.match<Update.Step<Model, Message>>({
    ChangedValue:
      ({ value }) =>
      model => ({ model: modifyFields(model, { ease: () => value }) }),
  }),
})

const foldField = Update.foldChild({
  update: ColorField.update,
  read: (model: Model) => Option.some(model.field),
  write: (model, nextField) => modifyFields(model, { field: () => nextField }),
  toParentMessage: message => Message.GotFieldMessage({ message }),
  foldOutMessage: ColorField.OutMessage.match<Update.Step<Model, Message>>({
    ChangedValue:
      ({ value }) =>
      model => ({ model: modifyFields(model, { color: () => value }) }),
  }),
})

const foldPicker = Update.foldChild({
  update: ColorPicker.update,
  read: (model: Model) => Option.some(model.picker),
  write: (model, nextPicker) =>
    modifyFields(model, { picker: () => nextPicker }),
  toParentMessage: message => Message.GotPickerMessage({ message }),
  foldOutMessage: ColorPicker.OutMessage.match<Update.Step<Model, Message>>({
    ChangedValue:
      ({ value }) =>
      model => ({ model: modifyFields(model, { pickerColor: () => value }) }),
  }),
})

const foldImage = Update.foldChild({
  update: ImagePicker.update,
  read: (model: Model) => Option.some(model.image),
  write: (model, nextImage) => modifyFields(model, { image: () => nextImage }),
  toParentMessage: message => Message.GotImageMessage({ message }),
  foldOutMessage: ImagePicker.OutMessage.match<Update.Step<Model, Message>>({
    ChangedValue:
      ({ value }) =>
      model => ({ model: modifyFields(model, { artwork: () => value }) }),
  }),
})

const foldTransition = (value: Transition.Transition) =>
  Update.foldChild({
    update: (
      child: TransitionEditor.Model,
      message: TransitionEditor.Message,
    ) => TransitionEditor.update(child, message, value),
    read: (model: Model) => Option.some(model.transition),
    write: (model, nextTransition) =>
      modifyFields(model, { transition: () => nextTransition }),
    toParentMessage: message => Message.GotTransitionMessage({ message }),
    foldOutMessage: TransitionEditor.OutMessage.match<
      Update.Step<Model, Message>
    >({
      ChangedValue:
        ({ value }) =>
        model => ({ model: modifyFields(model, { motion: () => value }) }),
    }),
  })

const foldPanel = (values: Model['panelValues']) =>
  Update.foldChild({
    update: (child: DialPanel.Model, message: DialPanel.Message) =>
      ExamplePanel.update(child, message, values),
    read: (model: Model) => Option.some(model.panel),
    write: (model, nextPanel) =>
      modifyFields(model, { panel: () => nextPanel }),
    toParentMessage: message => Message.GotPanelMessage({ message }),
    foldOutMessage: ExamplePanel.OutMessage.match<Update.Step<Model, Message>>({
      ChangedValues:
        ({ values }) =>
        model => ({
          model: modifyFields(model, { panelValues: () => values }),
        }),
      ClickedAction: () => model => ({
        model: modifyFields(model, { actionCount: count => count + 1 }),
      }),
    }),
  })

const foldDock = Update.foldChild({
  update: ExampleDock.update,
  read: (model: Model) => Option.some(model.dock),
  write: (model, nextDock) => modifyFields(model, { dock: () => nextDock }),
  toParentMessage: message => Message.GotDockMessage({ message }),
  foldOutMessage: ExampleDock.OutMessage.match<Update.Step<Model, Message>>({
    ChangedVisibility: () => model => ({ model }),
  }),
})

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    GotSliderMessage: ({ message }) => foldSlider(model, message),
    GotPadMessage: ({ message }) => foldPad(model, message),
    GotBezierMessage: ({ message }) => foldBezier(model, message),
    GotFieldMessage: ({ message }) => foldField(model, message),
    GotPickerMessage: ({ message }) => foldPicker(model, message),
    GotImageMessage: ({ message }) => foldImage(model, message),
    GotTransitionMessage: ({ message }) =>
      foldTransition(model.motion)(model, message),
    GotPanelMessage: ({ message }) =>
      foldPanel(model.panelValues)(model, message),
    GotDockMessage: ({ message }) => foldDock(model, message),
    SelectedLayout: ({ layout }) => ({
      model: modifyFields(model, { layout: () => layout }),
    }),
  })

export const leave = (model: Model): Model => {
  return modifyFields(model, {
    slider: Interactions.clearSlider,
    pad: Interactions.clearPad,
    bezier: Interactions.clearBezier,
    field: Interactions.clearField,
    picker: Interactions.clearPicker,
    image: Interactions.clearImage,
    transition: Interactions.clearTransition,
    panel: Interactions.clearPanel,
    dock: Interactions.clearDock,
  })
}

// SLIDER SUBSCRIPTION

const sliderSubscriptions = Subscription.lift(
  Record.mapKeys(ScrubSlider.subscriptions, name => `gallery-slider:${name}`),
)<Model, Message>({
  read: model =>
    model.page === 'Controls' ? Option.some(model.slider) : Option.none(),
  toParentMessage: message => Message.GotSliderMessage({ message }),
})

// SUBSCRIPTION

export const subscriptions = Subscription.aggregate<Model, Message>()(
  sliderSubscriptions,
  Subscription.lift(
    Record.mapKeys(DialPad.subscriptions, name => `gallery-pad:${name}`),
  )<Model, Message>({
    read: model =>
      model.page === 'Controls' ? Option.some(model.pad) : Option.none(),
    toParentMessage: message => Message.GotPadMessage({ message }),
  }),
  Subscription.lift(
    Record.mapKeys(
      BezierEditor.subscriptions,
      name => `gallery-bezier:${name}`,
    ),
  )<Model, Message>({
    read: model =>
      model.page === 'Controls' ? Option.some(model.bezier) : Option.none(),
    toParentMessage: message => Message.GotBezierMessage({ message }),
  }),
  Subscription.lift(
    Record.mapKeys(ColorField.subscriptions, name => `gallery-field:${name}`),
  )<Model, Message>({
    read: model =>
      model.page === 'Controls' ? Option.some(model.field) : Option.none(),
    toParentMessage: message => Message.GotFieldMessage({ message }),
  }),
  Subscription.lift(
    Record.mapKeys(ColorPicker.subscriptions, name => `gallery-picker:${name}`),
  )<Model, Message>({
    read: model =>
      model.page === 'Controls' ? Option.some(model.picker) : Option.none(),
    toParentMessage: message => Message.GotPickerMessage({ message }),
  }),
  Subscription.lift(
    Record.mapKeys(ImagePicker.subscriptions, name => `gallery-image:${name}`),
  )<Model, Message>({
    read: model =>
      model.page === 'Controls' ? Option.some(model.image) : Option.none(),
    toParentMessage: message => Message.GotImageMessage({ message }),
  }),
  Subscription.lift(
    Record.mapKeys(
      TransitionEditor.subscriptions,
      name => `gallery-transition:${name}`,
    ),
  )<Model, Message>({
    read: model =>
      model.page === 'Controls' ? Option.some(model.transition) : Option.none(),
    toParentMessage: message => Message.GotTransitionMessage({ message }),
  }),
  Subscription.lift(
    Record.mapKeys(ExamplePanel.subscriptions, name => `gallery-panel:${name}`),
  )<Model, Message>({
    read: model =>
      model.page === 'Panels' ? Option.some(model.panel) : Option.none(),
    toParentMessage: message => Message.GotPanelMessage({ message }),
  }),
  Subscription.lift(
    Record.mapKeys(ExampleDock.subscriptions, name => `gallery-dock:${name}`),
  )<Model, Message>({
    read: model =>
      model.page === 'Timeline' ? Option.some(model.dock) : Option.none(),
    toParentMessage: message => Message.GotDockMessage({ message }),
  }),
)

// SLIDER VIEW

export const sliderView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'gallery-slider',
    model: model.slider,
    view: ScrubSlider.view,
    toParentMessage: message => Message.GotSliderMessage({ message }),
    viewInputs: {
      value: model.amount,
      label: 'Amount',
      toView: ({ attributes, formattedValue, isEditing }) =>
        h.div(
          [...attributes.root, h.Class('dialkit-slider-wrapper')],
          [
            h.div(
              [...attributes.track, h.Class('dialkit-slider')],
              [
                h.div([...attributes.fill, h.Class('dialkit-slider-fill')]),
                h.div([
                  ...attributes.handle,
                  h.Class('dialkit-slider-handle fkd-slider-handle'),
                ]),
                h.span(
                  [...attributes.label, h.Class('dialkit-slider-label')],
                  ['Amount'],
                ),
              ],
            ),
            isEditing
              ? h.input([...attributes.editor, h.Class('dialkit-slider-input')])
              : h.span(
                  [...attributes.value, h.Class('dialkit-slider-value')],
                  [formattedValue],
                ),
          ],
        ),
    },
  })

// PAD VIEW

export const padView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'gallery-pad',
    model: model.pad,
    view: DialPad.view,
    toParentMessage: message => Message.GotPadMessage({ message }),
    viewInputs: {
      value: model.position,
      label: 'Position',
      toView: ({ attributes, thumbPosition, instructions, formattedValue }) =>
        h.div(
          [...attributes.root, h.Class('dialkit-pad')],
          [
            h.div(
              [h.Class('dialkit-pad-caption')],
              [
                h.span(
                  [...attributes.label, h.Class('dialkit-pad-label')],
                  ['Position'],
                ),
                h.span([], [`${formattedValue.x}, ${formattedValue.y}`]),
              ],
            ),
            h.div(
              [...attributes.surface, h.Class('dialkit-pad-surface')],
              [
                h.div(
                  [...attributes.plane, h.Class('dialkit-pad-plane')],
                  [
                    h.span([h.Class('dialkit-pad-center')]),
                    h.span([
                      ...attributes.thumb,
                      h.Class('dialkit-pad-point'),
                      h.Style({
                        left: thumbPosition.left,
                        top: thumbPosition.top,
                      }),
                    ]),
                  ],
                ),
              ],
            ),
            h.span(
              [...attributes.instructions, h.Class('dialkit-pad-instructions')],
              [instructions],
            ),
          ],
        ),
    },
  })

// BEZIER VIEW

export const bezierView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'gallery-bezier',
    model: model.bezier,
    view: BezierEditor.view,
    toParentMessage: message => Message.GotBezierMessage({ message }),
    viewInputs: {
      value: model.ease,
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

// COLOR MARKUP

export const formatGroupView = <M>(
  render: RadioGroup.RenderInfo<Color.ColorFormat>,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [...render.group, h.Class('dialkit-color-formats')],
    Array.map(render.options, option =>
      h.keyed('button')(
        option.value,
        [...option.option, h.Class('dialkit-color-format')],
        [ColorPicker.colorFormatLabel(option.value)],
      ),
    ),
  )

export const pickerMarkup = <M>(
  { attributes, colors, formatGroup, isRejected }: ColorPicker.RenderInfo,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [...attributes.root, h.Class('fkd-color-picker')],
    [
      h.div(
        [
          ...attributes.area,
          h.Class('dialkit-color-plane fkd-color-plane'),
          h.Style({
            '--fkd-area-neutral': colors.areaNeutralGradient,
            '--fkd-area-edge': colors.areaEdgeGradient,
          }),
        ],
        [
          h.span([
            ...attributes.areaThumb,
            h.Class('dialkit-color-marker fkd-color-thumb'),
          ]),
        ],
      ),
      h.div(
        [h.Class('dialkit-color-tracks')],
        [
          h.div(
            [h.Class('dialkit-color-track-row')],
            [
              h.span([], ['Hue']),
              h.div(
                [
                  ...attributes.hueTrack,
                  h.Class('fkd-color-track'),
                  h.Style({ '--fkd-track': colors.hueTrackGradient }),
                ],
                [h.span([...attributes.hueThumb, h.Class('fkd-color-thumb')])],
              ),
            ],
          ),
          h.div(
            [h.Class('dialkit-color-track-row')],
            [
              h.span([], ['Opacity']),
              h.div(
                [
                  ...attributes.alphaTrack,
                  h.Class('fkd-color-track fkd-color-track-alpha'),
                  h.Style({ '--fkd-track': colors.alphaTrackGradient }),
                ],
                [
                  h.span([
                    ...attributes.alphaThumb,
                    h.Class('fkd-color-thumb'),
                  ]),
                ],
              ),
            ],
          ),
        ],
      ),
      formatGroup,
      h.input([...attributes.textInput, h.Class('dialkit-color-css-input')]),
      isRejected
        ? h.span(
            [...attributes.error, h.Class('fkd-color-error')],
            ['Not a valid color'],
          )
        : h.empty,
    ],
  )

// COLOR FIELD VIEW

export const fieldView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'gallery-field',
    model: model.field,
    view: ColorField.view,
    toParentMessage: message => Message.GotFieldMessage({ message }),
    viewInputs: {
      value: model.color,
      label: 'Accent',
      anchor: { placement: 'bottom-start', gap: 8, padding: 8 },
      toPickerView: render => pickerMarkup(render, h),
      toFormatGroupView: render => formatGroupView(render, h),
      toView: ({ attributes, picker, isOpen, isRejected }) =>
        h.div(
          [...attributes.root, h.Class('dialkit-color-control')],
          [
            h.span(
              [...attributes.label, h.Class('dialkit-color-label')],
              ['Accent'],
            ),
            h.div(
              [h.Class('dialkit-color-inputs')],
              [
                h.input([
                  ...attributes.valueInput,
                  h.Class('dialkit-color-value'),
                ]),
                h.button([
                  ...attributes.swatch,
                  h.Class('dialkit-color-swatch'),
                  h.Style({ '--dial-color': model.color }),
                ]),
              ],
            ),
            isRejected
              ? h.span(
                  [...attributes.error, h.Class('fkd-color-error')],
                  ['Not a valid color'],
                )
              : h.empty,
            ...(isOpen
              ? [
                  h.div([
                    ...attributes.backdrop,
                    h.Class('fkd-image-backdrop'),
                  ]),
                  h.div(
                    [
                      ...attributes.panel,
                      h.Class('dialkit-root dialkit-color-popover'),
                      h.DataAttribute('theme', 'light'),
                    ],
                    [picker],
                  ),
                ]
              : []),
          ],
        ),
    },
  })

// COLOR PICKER VIEW

export const pickerView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'gallery-picker',
    model: model.picker,
    view: ColorPicker.view,
    toParentMessage: message => Message.GotPickerMessage({ message }),
    viewInputs: {
      value: model.pickerColor,
      toView: render => pickerMarkup(render, h),
      toFormatGroupView: render => formatGroupView(render, h),
    },
  })

// IMAGE VIEW

export const imageView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'gallery-image',
    model: model.image,
    view: ImagePicker.view,
    toParentMessage: message => Message.GotImageMessage({ message }),
    viewInputs: {
      value: model.artwork,
      label: 'Artwork',
      anchor: { placement: 'bottom-start', gap: 8, padding: 8 },
      toView: ({
        attributes,
        choices,
        valueLabel,
        isVisible,
        isReading,
        maybeUploadFailure,
      }) =>
        h.div(
          [...attributes.root],
          [
            h.button(
              [...attributes.trigger, h.Class('dialkit-image-control')],
              [
                h.span([], ['Artwork']),
                h.span([h.Class('dialkit-image-value')], [valueLabel]),
              ],
            ),
            ...(isVisible
              ? [
                  h.div([
                    ...attributes.backdrop,
                    h.Class('fkd-image-backdrop'),
                  ]),
                  h.div(
                    [
                      ...attributes.panel,
                      h.Class('dialkit-root dialkit-image-popover'),
                      h.DataAttribute('theme', 'light'),
                    ],
                    [
                      h.div(
                        [...attributes.grid, h.Class('dialkit-image-grid')],
                        Array.map(choices, choice =>
                          h.keyed('button')(
                            choice.value,
                            [...choice.option, h.Class('dialkit-image-option')],
                            [
                              h.img([
                                h.Src(choice.value),
                                h.Alt(choice.label),
                                h.Class('dialkit-image-option-preview'),
                              ]),
                            ],
                          ),
                        ),
                      ),
                      h.button(
                        [...attributes.remove, h.Class('dialkit-button')],
                        ['Remove'],
                      ),
                      h.label(
                        [
                          ...attributes.upload,
                          h.Class('dialkit-button dialkit-image-upload'),
                        ],
                        [
                          isReading ? 'Reading image…' : 'Upload image',
                          h.input([
                            ...attributes.fileInput,
                            h.Class('fkd-visually-hidden'),
                          ]),
                        ],
                      ),
                      h.span(
                        [...attributes.status],
                        [
                          Option.match(maybeUploadFailure, {
                            onNone: () => '',
                            onSome: ImagePicker.uploadFailureText,
                          }),
                        ],
                      ),
                    ],
                  ),
                ]
              : []),
          ],
        ),
    },
  })

// TRANSITION VIEW

export const transitionView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'gallery-transition',
    model: model.transition,
    view: TransitionEditor.view,
    toParentMessage: message => Message.GotTransitionMessage({ message }),
    viewInputs: { value: model.motion, label: 'Motion' },
  })

// CURVE VIEW

export const curveView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Curve.view(
    { transition: model.motion, attributes: [h.Class('dialkit-spring-viz')] },
    h,
  )

// PANEL VIEW

export const panelView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const panel = h.submodel({
    slotId: 'gallery-panel',
    model: model.panel,
    view: ExamplePanel.view,
    toParentMessage: message => Message.GotPanelMessage({ message }),
    viewInputs: {
      values: model.panelValues,
      theme: 'Light',
      layout: model.layout,
    },
  })
  return model.layout === 'Section'
    ? DialPanel.root({ theme: 'Light', sections: [panel] }, h)
    : panel
}

// TIMELINE VIEW

export const timelineView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: 'gallery-timeline',
    model: model.dock,
    view: ExampleDock.view,
    toParentMessage: message => Message.GotDockMessage({ message }),
  })

export const timelineSource = (model: Model): string =>
  Timeline.toTimelineSource(model.dock.timeline)

// MESSAGE CLASSIFICATION

export const isContinuousMessage = (message: Message): boolean =>
  Match.value(message).pipe(
    Match.tag(
      'GotSliderMessage',
      'GotPadMessage',
      'GotBezierMessage',
      'GotPickerMessage',
      ({ message }) => message._tag === 'MovedDragPointer',
    ),
    Match.tag('GotPanelMessage', ({ message }) =>
      ExamplePanel.isContinuousMessage(message),
    ),
    Match.tag('GotDockMessage', ({ message }) =>
      ExampleDock.isContinuousMessage(message),
    ),
    Match.orElse(() => false),
  )
