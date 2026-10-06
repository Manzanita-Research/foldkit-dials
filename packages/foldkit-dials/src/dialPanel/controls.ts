import { modifyFields } from 'foldkit/struct'

import { Listbox, RadioGroup } from '@foldkit/ui'

import type * as ColorField from '../colorField/index.js'
import type * as DialPad from '../dialPad/index.js'
import type * as ImagePicker from '../imagePicker/index.js'
import type * as ScrubSlider from '../scrubSlider/index.js'
import type * as TransitionEditor from '../transitionEditor/index.js'
import { Message } from './message.js'
import type { Model, ToggleOption } from './model.js'

/** Module-scoped bundles, as the lint rule for selection factories asks. */
export const ToggleGroup = RadioGroup.create<ToggleOption>()
export const SelectListbox = Listbox.create<string>()

type Children<ChildModel> = Readonly<Record<string, ChildModel>>

/** Where the panel keeps one kind of child control: a Model record keyed by
 *  the dial's dotted path, and the Message that wraps the child's Messages.
 *  The update fold, the Subscription lift, and the view share it. */
export type ControlSlot<ChildModel, ChildMessage> = Readonly<{
  read: (model: Model) => Children<ChildModel>
  modify: (
    model: Model,
    transform: (children: Children<ChildModel>) => Children<ChildModel>,
  ) => Model
  toParentMessage: (dialId: string) => (message: ChildMessage) => Message
}>

/** The slider controls. */
export const sliderSlot: ControlSlot<ScrubSlider.Model, ScrubSlider.Message> = {
  read: ({ sliders }) => sliders,
  modify: (model, transform) => modifyFields(model, { sliders: transform }),
  toParentMessage: dialId => message =>
    Message.GotSliderMessage({ dialId, message }),
}

/** The toggle controls. */
export const toggleSlot: ControlSlot<RadioGroup.Model, RadioGroup.Message> = {
  read: ({ toggles }) => toggles,
  modify: (model, transform) => modifyFields(model, { toggles: transform }),
  toParentMessage: dialId => message =>
    Message.GotToggleMessage({ dialId, message }),
}

/** The select controls. */
export const selectSlot: ControlSlot<Listbox.Model, Listbox.Message> = {
  read: ({ selects }) => selects,
  modify: (model, transform) => modifyFields(model, { selects: transform }),
  toParentMessage: dialId => message =>
    Message.GotSelectMessage({ dialId, message }),
}

/** The image controls. */
export const imageSlot: ControlSlot<ImagePicker.Model, ImagePicker.Message> = {
  read: ({ images }) => images,
  modify: (model, transform) => modifyFields(model, { images: transform }),
  toParentMessage: dialId => message =>
    Message.GotImageMessage({ dialId, message }),
}

/** The colour controls. */
export const colorSlot: ControlSlot<ColorField.Model, ColorField.Message> = {
  read: ({ colors }) => colors,
  modify: (model, transform) => modifyFields(model, { colors: transform }),
  toParentMessage: dialId => message =>
    Message.GotColorMessage({ dialId, message }),
}

/** The pad controls. */
export const padSlot: ControlSlot<DialPad.Model, DialPad.Message> = {
  read: ({ pads }) => pads,
  modify: (model, transform) => modifyFields(model, { pads: transform }),
  toParentMessage: dialId => message =>
    Message.GotPadMessage({ dialId, message }),
}

/** The spring and easing controls. */
export const transitionSlot: ControlSlot<
  TransitionEditor.Model,
  TransitionEditor.Message
> = {
  read: ({ transitions }) => transitions,
  modify: (model, transform) => modifyFields(model, { transitions: transform }),
  toParentMessage: dialId => message =>
    Message.GotTransitionMessage({ dialId, message }),
}
