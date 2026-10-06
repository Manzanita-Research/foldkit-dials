import { Function, Option, Schema, String } from 'effect'
import { type ChildAttribute, type Html, childAttributes } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { type Reflect, defineView } from 'foldkit/submodel'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'

import { Popover, type RadioGroup } from '@foldkit/ui'

import type { ColorFormat } from '../color/index.js'
import * as ColorPicker from '../colorPicker/index.js'
import {
  ColorDraft,
  type InvalidDraftHandling,
  commitDraft,
  draftErrorAttributes,
  draftInputAttributes,
  isRejected as isDraftRejected,
} from '../internal/colorDraft.js'
import { focusLeavingMarked } from '../internal/focusOutside.js'

// MODEL

/** Schema for the ColorField's private interaction state: the embedded
 *  ColorPicker and Popover, and text typed into the value input. The value
 *  is a colour string owned by the parent and passed in through
 *  `ViewInputs.value`. */
export const Model = Schema.Struct({
  id: Schema.String,
  picker: ColorPicker.Model,
  popover: Popover.Model,
  editState: ColorDraft,
})
export type Model = typeof Model.Type

// MESSAGE

/** Union of all Messages the ColorField can produce. */
export const Message = defineMessageUnion({
  GotColorPickerMessage: { message: ColorPicker.Message },
  GotPopoverMessage: { message: Popover.Message },
  UpdatedDraft: { draft: Schema.String },
  PressedEnterInEditor: { value: Schema.String },
  PressedEscapeInEditor: {},
  BlurredEditor: { value: Schema.String },
  MovedFocusOutsideField: {},
})
export type Message = typeof Message.Type

export type UpdatedDraft = typeof Message.UpdatedDraft.Type
export type MovedFocusOutsideField = typeof Message.MovedFocusOutsideField.Type

// OUT MESSAGE

/** Union of OutMessages the ColorField can emit to its parent. */
export const OutMessage = defineMessageUnion({
  ChangedValue: { value: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

// INIT

/** Configuration for creating a ColorField Model with `init`. `value` is the
 *  parent's starting colour, which picks the format picker edits are written
 *  in. */
export type InitConfig = Readonly<{
  id: string
  value: string
}>

/** Creates an initial ColorField Model with a closed picker. The Popover
 *  hands focus to the content, so the selected format option takes focus
 *  when the picker opens. */
export const init = (config: InitConfig): Model => ({
  id: config.id,
  picker: ColorPicker.init({ id: `${config.id}-picker`, value: config.value }),
  popover: Popover.init({ id: `${config.id}-popover`, contentFocus: true }),
  editState: ColorDraft.Viewing(),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const readColorPicker = (model: Model): Option.Option<ColorPicker.Model> =>
  Option.some(model.picker)

const writeColorPicker = (model: Model, nextPicker: ColorPicker.Model): Model =>
  modifyFields(model, { picker: () => nextPicker })

const toGotColorPickerMessage = (message: ColorPicker.Message): Message =>
  Message.GotColorPickerMessage({ message })

const toColorFieldOutMessage = ColorPicker.OutMessage.match<OutMessage>({
  ChangedValue: ({ value }) => OutMessage.ChangedValue({ value }),
})

const foldColorPicker = Update.foldChild({
  update: ColorPicker.update,
  read: readColorPicker,
  write: writeColorPicker,
  toParentMessage: toGotColorPickerMessage,
  toParentOutMessage: toColorFieldOutMessage,
})

const foldColorPickerSubmitText = Update.foldChild({
  update: ColorPicker.submitText,
  read: readColorPicker,
  write: writeColorPicker,
  toParentMessage: toGotColorPickerMessage,
  toParentOutMessage: toColorFieldOutMessage,
})

const foldPopoverOutMessage = Popover.OutMessage.match<
  Update.Step<Model, Message>
>({
  Opened: () => model => ({ model }),
  Closed: () => model => ({
    model: modifyFields(model, { picker: ColorPicker.discardDraft }),
  }),
})

const readPopover = (model: Model): Option.Option<Popover.Model> =>
  Option.some(model.popover)

const writePopover = (model: Model, nextPopover: Popover.Model): Model =>
  modifyFields(model, { popover: () => nextPopover })

const toGotPopoverMessage = (message: Popover.Message): Message =>
  Message.GotPopoverMessage({ message })

const foldPopover = Update.foldChild({
  update: Popover.update,
  read: readPopover,
  write: writePopover,
  toParentMessage: toGotPopoverMessage,
  foldOutMessage: foldPopoverOutMessage,
})

const foldPopoverClose = Update.foldChildStep({
  update: Popover.close,
  read: readPopover,
  write: writePopover,
  toParentMessage: toGotPopoverMessage,
  foldOutMessage: foldPopoverOutMessage,
})

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
    onSome: text => foldColorPickerSubmitText(committed, { text, value }),
  })
}

/** Processes a ColorField Message and returns the next Model, optional
 *  Commands, and an optional `ChangedValue` OutMessage. Typed text and
 *  picker edits both report through `ChangedValue`. */
export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    GotColorPickerMessage: ({ message: pickerMessage }) =>
      foldColorPicker(model, pickerMessage),

    GotPopoverMessage: ({ message: popoverMessage }) =>
      foldPopover(model, popoverMessage),

    UpdatedDraft: ({ draft }) => ({
      model: modifyFields(model, {
        editState: () => ColorDraft.Editing({ draft }),
      }),
    }),

    PressedEnterInEditor: ({ value }) =>
      commitTypedText(model, value, 'Reject'),

    PressedEscapeInEditor: () => ({
      model: modifyFields(model, { editState: () => ColorDraft.Viewing() }),
    }),

    BlurredEditor: ({ value }) => commitTypedText(model, value, 'Discard'),

    MovedFocusOutsideField: () => foldPopoverClose(model),
  })

/** Reflects a value the parent set from outside the field, such as a loaded
 *  preset, so later picker edits write that value's format. */
export const reflectValue: Reflect<Model, string> = Function.dual(
  2,
  (model: Model, value: string): Model =>
    modifyFields(model, { picker: ColorPicker.reflectValue(value) }),
)

// SUBSCRIPTION

const FIELD_ID_ATTRIBUTE = 'color-field-id'

const fieldSubscriptions = Subscription.make<Model, Message>()(entry => ({
  focusOutside: entry(
    { id: Schema.String, isOpen: Schema.Boolean },
    {
      modelToDependencies: model => ({
        id: model.id,
        isOpen: model.popover.isOpen,
      }),
      dependenciesToStream: ({ id, isOpen }) =>
        focusLeavingMarked({
          attribute: FIELD_ID_ATTRIBUTE,
          id,
          isOpen,
          message: Message.MovedFocusOutsideField(),
        }),
    },
  ),
}))

/** Builds the ColorField's Subscriptions: `focusOutside`, which closes the
 *  open picker when focus lands outside the field and returns focus to the
 *  swatch, as Escape does, and the embedded ColorPicker's drag
 *  Subscriptions, which find the picker through the supplied root. Use this
 *  when the field renders inside a Shadow DOM. The Popover runs in
 *  `contentFocus` mode, so the field owns this blur rule. */
export const subscriptionsForRoot = (
  getTrackRoot: () => Document | ShadowRoot,
) =>
  Subscription.aggregate(
    fieldSubscriptions,
    Subscription.lift(ColorPicker.subscriptionsForRoot(getTrackRoot))<
      Model,
      Message
    >({
      read: readColorPicker,
      toParentMessage: toGotColorPickerMessage,
    }),
  )

/** The ColorField's Subscriptions for a field in the main document. */
export const subscriptions = subscriptionsForRoot(() => document)

// VIEW

/** The DOM id of the value input. */
export const valueInputId = (id: string): string => `${id}-value`

const labelId = (id: string): string => `${id}-label`

/** Attribute groups the ColorField hands to the consumer's `toView`. `swatch`
 *  is the Popover trigger, and `panel` and `backdrop` are rendered only while
 *  `isOpen`. `error` is the message for a rejected `valueInput` draft. */
export type ColorFieldAttributes = Readonly<{
  root: ReadonlyArray<ChildAttribute>
  label: ReadonlyArray<ChildAttribute>
  valueInput: ReadonlyArray<ChildAttribute>
  error: ReadonlyArray<ChildAttribute>
  swatch: ReadonlyArray<ChildAttribute>
  panel: ReadonlyArray<ChildAttribute>
  backdrop: ReadonlyArray<ChildAttribute>
}>

/** What the consumer's `toView` receives: the attribute groups, the rendered
 *  ColorPicker to place inside the panel, and the interaction state for
 *  styling. `picker` is empty while the panel is closed. Render `error`, with
 *  text such as "Not a valid color", only while `isRejected`. */
export type RenderInfo = Readonly<{
  attributes: ColorFieldAttributes
  picker: Html
  isOpen: boolean
  isEditing: boolean
  isRejected: boolean
}>

/** Per-render view inputs passed to `view` through `h.submodel`'s
 *  `viewInputs`. */
export type ViewInputs = Readonly<{
  /** The current colour string, read from the parent Model. */
  value: string
  label: string
  /** Where the Popover places the panel relative to the swatch. */
  anchor: Popover.AnchorConfig
  toView: (render: RenderInfo) => Html
  /** Renders the ColorPicker inside the panel. */
  toPickerView: (render: ColorPicker.RenderInfo) => Html
  /** Renders the ColorPicker's format options. See
   *  `ColorPicker.ViewInputs`. */
  toFormatGroupView: (render: RadioGroup.RenderInfo<ColorFormat>) => Html
  getTrackRoot?: () => Document | ShadowRoot
}>

/** Renders a headless colour field: a label, a text input for the value, and
 *  a swatch button that opens a Popover holding a ColorPicker. Composes the
 *  ColorPicker and Popover, as `@foldkit/ui`'s DatePicker composes Calendar
 *  and Popover. */
export const view = defineView<Model, Message, ViewInputs>(
  (model, viewInputs, h): Html => {
    const {
      value,
      label,
      anchor,
      toView,
      toPickerView,
      toFormatGroupView,
      getTrackRoot,
    } = viewInputs
    const { id, picker } = model
    const isEditing = model.editState._tag !== 'Viewing'
    const isRejected = isDraftRejected(model.editState)

    const valueInputAttributes = [
      ...draftInputAttributes(
        {
          id: valueInputId(id),
          ariaLabel: `${label} color value`,
          value,
          draft: model.editState,
          onInput: draft => Message.UpdatedDraft({ draft }),
          onEnter: Message.PressedEnterInEditor({ value }),
          onEscape: Message.PressedEscapeInEditor(),
          onBlur: Message.BlurredEditor({ value }),
        },
        h,
      ),
      h.Title(value),
    ]

    const renderPicker = (): Html =>
      h.submodel({
        slotId: picker.id,
        model: picker,
        view: ColorPicker.view,
        viewInputs: {
          value,
          toView: toPickerView,
          toFormatGroupView,
          ...(getTrackRoot !== undefined && { getTrackRoot }),
        },
        toParentMessage: toGotColorPickerMessage,
      })

    return h.submodel({
      slotId: model.popover.id,
      model: model.popover,
      view: Popover.view,
      viewInputs: {
        anchor,
        ariaLabel: `Pick ${String.toLowerCase(label)} color`,
        focusSelector: ColorPicker.selectedFormatSelector(picker.id),
        toView: ({ button, panel, backdrop, isVisible }) =>
          toView({
            attributes: {
              root: childAttributes([
                h.DataAttribute(FIELD_ID_ATTRIBUTE, id),
                ...(isVisible ? [h.DataAttribute('open', '')] : []),
              ]),
              label: childAttributes([h.Id(labelId(id))]),
              valueInput: childAttributes(valueInputAttributes),
              error: childAttributes(draftErrorAttributes(valueInputId(id), h)),
              swatch: [
                ...button,
                ...childAttributes([h.AriaHasPopup('dialog')]),
              ],
              panel: [
                ...panel,
                ...childAttributes([
                  h.DataAttribute(FIELD_ID_ATTRIBUTE, id),
                  h.Role('dialog'),
                  h.AriaLabel(`${label} color picker`),
                ]),
              ],
              backdrop,
            },
            picker: isVisible ? renderPicker() : h.empty,
            isOpen: isVisible,
            isEditing,
            isRejected,
          }),
      },
      toParentMessage: toGotPopoverMessage,
    })
  },
)
