import { Option, Record } from 'effect'
import {
  BezierEditor,
  ColorField,
  ColorPicker,
  DialPad,
  DialPanel,
  DialTimeline,
  ImagePicker,
  ScrubSlider,
  TransitionEditor,
} from 'foldkit-dials'
import { modifyFields } from 'foldkit/struct'

import { Listbox, Popover } from '@foldkit/ui'

// ROUTE EXIT

// NOTE: hidden pages miss pointer/key releases. End gestures without applying
// cancellation OutMessages, which would roll values back to their drag origin.
const idle = (): Readonly<{ _tag: 'Idle' }> => ({ _tag: 'Idle' })
const viewing = (): Readonly<{ _tag: 'Viewing' }> => ({ _tag: 'Viewing' })

export const clearSlider = (model: ScrubSlider.Model): ScrubSlider.Model =>
  modifyFields(model, { dragState: idle, editState: viewing })

export const clearPad = (model: DialPad.Model): DialPad.Model =>
  modifyFields(model, { dragState: idle })

export const clearBezier = (model: BezierEditor.Model): BezierEditor.Model =>
  modifyFields(model, { dragState: idle })

export const clearPicker = (model: ColorPicker.Model): ColorPicker.Model =>
  modifyFields(ColorPicker.discardDraft(model), { dragState: idle })

const closePopover = (model: Popover.Model): Popover.Model =>
  modifyFields(model, {
    isOpen: () => false,
    maybeLastButtonPointerType: () => Option.none(),
  })

const closeSelect = (model: Listbox.Model): Listbox.Model =>
  modifyFields(model, {
    isOpen: () => false,
    maybeActiveItemIndex: () => Option.none(),
    searchQuery: () => '',
    maybeLastPointerPosition: () => Option.none(),
    maybeLastButtonPointerType: () => Option.none(),
  })

export const clearField = (model: ColorField.Model): ColorField.Model =>
  modifyFields(model, {
    picker: clearPicker,
    popover: closePopover,
    editState: viewing,
  })

export const clearImage = (model: ImagePicker.Model): ImagePicker.Model =>
  modifyFields(model, {
    popover: closePopover,
    maybeFocusedIndex: () => Option.none(),
    fileDrop: fileDrop => modifyFields(fileDrop, { isDragOver: () => false }),
    // NOTE: retain uploads and any pending read's file identity. Completion
    // stays guarded by the existing uploadState even while the picker is closed.
  })

export const clearTransition = (
  model: TransitionEditor.Model,
): TransitionEditor.Model =>
  modifyFields(model, {
    sliders: sliders => Record.map(sliders, clearSlider),
    bezier: clearBezier,
    easeDraft: viewing,
  })

export const clearPanel = (model: DialPanel.Model): DialPanel.Model =>
  modifyFields(model, {
    headerDrag: idle,
    heldShortcutKeys: () => [],
    maybeShortcutModifier: () => Option.none(),
    shortcutPointer: idle,
    versionMenu: closePopover,
    shortcutsMenu: closePopover,
    sliders: sliders => Record.map(sliders, clearSlider),
    selects: selects => Record.map(selects, closeSelect),
    images: images => Record.map(images, clearImage),
    colors: colors => Record.map(colors, clearField),
    pads: pads => Record.map(pads, clearPad),
    transitions: transitions => Record.map(transitions, clearTransition),
  })

export const clearDock = (model: DialTimeline.Model): DialTimeline.Model =>
  modifyFields(model, {
    isPlaying: () => false,
    dragState: idle,
    maybeEditor: () => Option.none(),
  })
