import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { Listbox, Popover, RadioGroup } from '@foldkit/ui'

import * as ColorField from '../colorField/index.js'
import { ShortcutModifier } from '../dial/index.js'
import * as DialPad from '../dialPad/index.js'
import * as ImagePicker from '../imagePicker/index.js'
import * as ScrubSlider from '../scrubSlider/index.js'
import * as TransitionEditor from '../transitionEditor/index.js'

// MESSAGE

/** Union of all Messages a dial panel can produce. Control Messages carry
 *  the dial's dotted path as `dialId`, such as `shadow.blur`. */
export const Message = defineMessageUnion({
  GotSliderMessage: { dialId: Schema.String, message: ScrubSlider.Message },
  GotToggleMessage: { dialId: Schema.String, message: RadioGroup.Message },
  GotSelectMessage: { dialId: Schema.String, message: Listbox.Message },
  GotImageMessage: { dialId: Schema.String, message: ImagePicker.Message },
  GotColorMessage: { dialId: Schema.String, message: ColorField.Message },
  GotPadMessage: { dialId: Schema.String, message: DialPad.Message },
  GotTransitionMessage: {
    dialId: Schema.String,
    message: TransitionEditor.Message,
  },
  UpdatedText: { dialId: Schema.String, value: Schema.String },
  ClickedAction: { dialId: Schema.String },
  ToggledFolder: { dialId: Schema.String, isOpen: Schema.Boolean },
  ToggledPanel: { isOpen: Schema.Boolean },
  PressedPanelHeader: { clientX: Schema.Number, clientY: Schema.Number },
  MovedPanelPointer: { clientX: Schema.Number, clientY: Schema.Number },
  ReleasedPanelPointer: {},
  GotVersionMenuMessage: { message: Popover.Message },
  ClickedVersion: { versionId: Schema.String },
  ClickedSaveVersion: {},
  ClickedDeleteVersion: { versionId: Schema.String },
  ClickedCompareVersion: { versionId: Schema.String },
  ClickedStopCompare: {},
  ClickedResetValues: {},
  ClickedCopyValues: {},
  SucceededCopyValues: {},
  FailedCopyValues: {},
  CompletedWaitBeforeResetCopy: { version: Schema.Number },
  CompletedLoadPersisted: { maybeJson: Schema.Option(Schema.String) },
  CompletedWaitBeforePersist: { version: Schema.Number },
  SucceededSavePersisted: {},
  FailedSavePersisted: {},
  GotShortcutsMenuMessage: { message: Popover.Message },
  PressedShortcutKey: {
    key: Schema.String,
    maybeModifier: Schema.Option(ShortcutModifier),
  },
  ReleasedShortcutKey: { key: Schema.String },
  BlurredWindow: {},
  ScrolledWithShortcut: { direction: Schema.Number },
  PressedArrowWithShortcut: { direction: Schema.Number },
  PressedShortcutPointer: { clientX: Schema.Number },
  MovedShortcutPointer: { clientX: Schema.Number },
  ReleasedShortcutPointer: {},
})
export type Message = typeof Message.Type

// OUT MESSAGE

/** The OutMessages the panel's internal update emits, with untyped values.
 *  `make` exposes them typed by the dial Schema. */
export const OutMessage = defineMessageUnion({
  ChangedValues: { values: Schema.Unknown },
  ClickedAction: { path: Schema.String },
})
export type OutMessage = typeof OutMessage.Type
