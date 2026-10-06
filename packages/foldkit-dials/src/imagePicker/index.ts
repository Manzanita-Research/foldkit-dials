import {
  Array,
  Effect,
  Function,
  Match,
  Option,
  Predicate,
  Schema,
  String,
  pipe,
} from 'effect'
import * as Command from 'foldkit/command'
import * as Dom from 'foldkit/dom'
import * as File from 'foldkit/file'
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

import { FileDrop, Popover } from '@foldkit/ui'

import type { OptionInput } from '../dial/index.js'
import { focusLeavingMarked } from '../internal/focusOutside.js'
import { hasCommandModifier } from '../internal/keyboard.js'
import { clamp } from '../internal/range.js'
import { idSelector } from '../internal/selectors.js'

// MODEL

/** Why a file was not used: `TooLarge` is over 10 MB, `NotAnImage` has a
 *  MIME type outside `image/*`, and `Unreadable` could not be read or
 *  decoded. */
export const UploadFailure = Schema.Literals([
  'TooLarge',
  'NotAnImage',
  'Unreadable',
])
export type UploadFailure = typeof UploadFailure.Type

/** One image the picker offers: its URL and the label shown for it. */
export const ImageChoice = Schema.Struct({
  value: Schema.String,
  label: Schema.String,
})
export type ImageChoice = typeof ImageChoice.Type

const UploadState = defineTaggedUnion({
  Idle: {},
  Reading: { file: File.File },
  Failed: { failure: UploadFailure },
})

/** Schema for the ImagePicker's private interaction state. The selected URL
 *  is owned by the parent and passed in through `ViewInputs.value`. `uploads`
 *  keeps every uploaded image for the picker's lifetime, and
 *  `maybeFocusedIndex` is the roving-tabindex cursor: `None` means the tab
 *  stop follows the selection. */
export const Model = Schema.Struct({
  id: Schema.String,
  options: Schema.Array(ImageChoice),
  uploads: Schema.Array(ImageChoice),
  maybeFocusedIndex: Schema.Option(Schema.Number),
  uploadState: UploadState,
  popover: Popover.Model,
  fileDrop: FileDrop.Model,
})
export type Model = typeof Model.Type

// MESSAGE

/** Union of all Messages the ImagePicker can produce. */
export const Message = defineMessageUnion({
  GotPopoverMessage: { message: Popover.Message },
  GotFileDropMessage: { message: FileDrop.Message },
  SelectedImage: {
    index: Schema.Number,
    value: Schema.String,
    currentValue: Schema.String,
  },
  PressedKeyboardNavigation: { index: Schema.Number },
  ClickedRemove: {},
  MovedFocusOutsidePicker: {},
  SucceededReadImageFile: { file: File.File, dataUrl: Schema.String },
  FailedReadImageFile: { file: File.File, failure: UploadFailure },
  CompletedFocusImage: {},
})
export type Message = typeof Message.Type

export type SelectedImage = typeof Message.SelectedImage.Type
export type PressedKeyboardNavigation =
  typeof Message.PressedKeyboardNavigation.Type
export type ClickedRemove = typeof Message.ClickedRemove.Type
export type MovedFocusOutsidePicker =
  typeof Message.MovedFocusOutsidePicker.Type
export type SucceededReadImageFile = typeof Message.SucceededReadImageFile.Type
export type FailedReadImageFile = typeof Message.FailedReadImageFile.Type

// OUT MESSAGE

/** Union of OutMessages the ImagePicker can emit to its parent. Removing the
 *  image reports `ChangedValue({ value: '' })`. */
export const OutMessage = defineMessageUnion({
  ChangedValue: { value: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

// CHOICES

const NO_IMAGE_LABEL = 'No image'
const UPLOADED_IMAGE_LABEL = 'Uploaded image'
const FALLBACK_IMAGE_LABEL = 'Image'

const isLocalImage = (value: string): boolean =>
  value.startsWith('data:') || value.startsWith('blob:')

const decodeFileName = (name: string): string =>
  pipe(
    name,
    Option.liftThrowable(decodeURIComponent),
    Option.getOrElse(() => name),
  )

/** The label DialKit shows for an image URL: the decoded file name, "Uploaded
 *  image" for a data or blob URL, and "No image" for the empty string. */
export const imageLabel = (value: string): string => {
  if (String.isEmpty(value)) {
    return NO_IMAGE_LABEL
  } else if (isLocalImage(value)) {
    return UPLOADED_IMAGE_LABEL
  } else {
    return pipe(
      value,
      String.split(/[?#]/),
      Array.headNonEmpty,
      String.split('/'),
      Array.findLast(String.isNonEmpty),
      Option.match({
        onNone: () => FALLBACK_IMAGE_LABEL,
        onSome: decodeFileName,
      }),
    )
  }
}

const toImageChoice = (input: OptionInput): ImageChoice =>
  Predicate.isString(input)
    ? { value: input, label: imageLabel(input) }
    : { value: input.value, label: input.label }

const isSameImage = (first: ImageChoice, second: ImageChoice): boolean =>
  first.value === second.value

/** The thumbnails the picker shows: the options, then the uploads, without
 *  duplicates or empty URLs. A value that is in neither list, such as one
 *  restored from a preset, is added last so it stays selectable. */
export const imageChoices = (
  options: ReadonlyArray<ImageChoice>,
  uploads: ReadonlyArray<ImageChoice>,
  value: string,
): ReadonlyArray<ImageChoice> => {
  const choices = pipe(
    options,
    Array.appendAll(uploads),
    Array.filter(choice => String.isNonEmpty(choice.value)),
    Array.dedupeWith(isSameImage),
  )
  const isListed =
    String.isEmpty(value) ||
    Array.some(choices, choice => choice.value === value)

  if (isListed) {
    return choices
  } else {
    return Array.append(choices, { value, label: imageLabel(value) })
  }
}

/** The status text DialKit shows for an upload failure. */
export const uploadFailureText = (failure: UploadFailure): string =>
  Match.value(failure).pipe(
    Match.withReturnType<string>(),
    Match.when('TooLarge', () => 'Choose an image smaller than 10 MB.'),
    Match.when(
      'NotAnImage',
      () => 'Choose an image file, such as PNG, JPG, WebP, GIF, or SVG.',
    ),
    Match.when(
      'Unreadable',
      () => 'This image could not be opened. Try another file.',
    ),
    Match.exhaustive,
  )

// INIT

/** Configuration for creating an ImagePicker Model with `init`. `options`
 *  are URLs or `{ value, label }` choices. A bare URL is labeled by its file
 *  name. */
export type InitConfig = Readonly<{
  id: string
  options?: ReadonlyArray<OptionInput>
}>

const popoverId = (id: string): string => `${id}-popover`

const fileInputId = (id: string): string => `${id}-file`

/** Creates an initial ImagePicker Model, closed and with no uploads. The
 *  value lives in the parent Model. */
export const init = (config: InitConfig): Model => ({
  id: config.id,
  options: Array.map(config.options ?? [], toImageChoice),
  uploads: [],
  maybeFocusedIndex: Option.none(),
  uploadState: UploadState.Idle(),
  popover: Popover.init({ id: popoverId(config.id), contentFocus: true }),
  fileDrop: FileDrop.init({ id: fileInputId(config.id) }),
})

// COMMAND

const BYTES_PER_MEGABYTE = 1024 * 1024
const MAX_UPLOAD_MEGABYTES = 10
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MEGABYTES * BYTES_PER_MEGABYTE
const IMAGE_MIME_PREFIX = 'image/'

const imageId = (id: string, index: number): string => `${id}-image-${index}`

const checkImageFile = (
  file: File.File,
): Effect.Effect<void, UploadFailure> => {
  if (File.size(file) > MAX_UPLOAD_BYTES) {
    return Effect.fail('TooLarge')
  } else if (!File.mimeType(file).startsWith(IMAGE_MIME_PREFIX)) {
    return Effect.fail('NotAnImage')
  } else {
    return Effect.void
  }
}

const readDataUrl = (file: File.File): Effect.Effect<string, UploadFailure> =>
  File.readAsDataUrl(file).pipe(
    Effect.mapError((): UploadFailure => 'Unreadable'),
  )

const checkImageDecodes = (
  dataUrl: string,
): Effect.Effect<void, UploadFailure> =>
  Effect.tryPromise({
    try: () => {
      const image = new Image()
      image.src = dataUrl
      return image.decode()
    },
    catch: (): UploadFailure => 'Unreadable',
  })

/** Reads a dropped or chosen file as a data URL, after checking that it is
 *  an image of at most 10 MB, and checks that the browser can decode it. The
 *  file never leaves the browser. */
export const ReadImageFile = Command.define('ReadImageFile', {
  args: { file: File.File },
  messages: [Message.SucceededReadImageFile, Message.FailedReadImageFile],
  execute: ({ file }) =>
    checkImageFile(file).pipe(
      Effect.andThen(readDataUrl(file)),
      Effect.tap(checkImageDecodes),
      Effect.map(dataUrl => Message.SucceededReadImageFile({ file, dataUrl })),
      Effect.catch(failure =>
        Effect.succeed(Message.FailedReadImageFile({ file, failure })),
      ),
    ),
})

/** Moves focus to the thumbnail at `index`. */
export const FocusImage = Command.define('FocusImage', {
  args: { id: Schema.String, index: Schema.Number },
  messages: [Message.CompletedFocusImage],
  execute: ({ id, index }) =>
    Dom.focus(idSelector(imageId(id, index))).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusImage()),
    ),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const resetInteraction = (model: Model): Model =>
  modifyFields(model, {
    maybeFocusedIndex: () => Option.none(),
    uploadState: () => UploadState.Idle(),
  })

// NOTE: closing keeps a file read going, so an upload the user chose still
// lands, and is selected, after the picker closes. Only a failure message is
// cleared. Remove resets the upload first, so it also cancels a read.
const resetOnClose = (model: Model): Model =>
  modifyFields(model, {
    maybeFocusedIndex: () => Option.none(),
    uploadState: uploadState =>
      UploadState.matchOrElse<typeof UploadState.Type>(
        uploadState,
        { Reading: () => uploadState },
        () => UploadState.Idle(),
      ),
  })

const readPopover = (model: Model): Option.Option<Popover.Model> =>
  Option.some(model.popover)

const writePopover = (model: Model, nextPopover: Popover.Model): Model =>
  modifyFields(model, { popover: () => nextPopover })

const toGotPopoverMessage = (message: Popover.Message): Message =>
  Message.GotPopoverMessage({ message })

const foldPopoverOutMessage = Popover.OutMessage.match<
  Update.Step<Model, Message>
>({
  Opened: () => model => ({ model }),
  Closed: () => model => ({ model: resetOnClose(model) }),
})

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

const startReading = (
  model: Model,
  file: File.File,
): Update.Return<Model, Message> =>
  UploadState.matchOrElse<Update.Return<Model, Message>>(
    model.uploadState,
    { Reading: () => ({ model }) },
    () => ({
      model: modifyFields(model, {
        uploadState: () => UploadState.Reading({ file }),
      }),
      commands: [ReadImageFile({ file })],
    }),
  )

const foldFileDropOutMessage = FileDrop.OutMessage.match<
  Update.Step<Model, Message>
>({
  ReceivedFiles:
    ({ files }) =>
    model =>
      startReading(model, Array.headNonEmpty(files)),
  RejectedNonFiles: () => model => ({ model }),
})

const foldFileDrop = Update.foldChild({
  update: FileDrop.update,
  read: (model: Model) => Option.some(model.fileDrop),
  write: (model, nextFileDrop) =>
    modifyFields(model, { fileDrop: () => nextFileDrop }),
  toParentMessage: message => Message.GotFileDropMessage({ message }),
  foldOutMessage: foldFileDropOutMessage,
})

const isReadingFile = (model: Model, file: File.File): boolean =>
  UploadState.matchOrElse<boolean>(
    model.uploadState,
    { Reading: reading => reading.file === file },
    () => false,
  )

const withChangedValue = (
  result: Update.Return<Model, Message>,
  currentValue: string,
  nextValue: string,
): UpdateReturn => {
  if (nextValue === currentValue) {
    return result
  } else {
    return Update.withOutMessage(
      result,
      OutMessage.ChangedValue({ value: nextValue }),
    )
  }
}

const completeUpload = (
  model: Model,
  file: File.File,
  dataUrl: string,
): UpdateReturn => {
  const nextUploads = pipe(
    model.uploads,
    Array.append({ value: dataUrl, label: File.name(file) }),
    Array.dedupeWith(isSameImage),
  )
  const maybeUploadIndex = Array.findFirstIndex(
    imageChoices(model.options, nextUploads, dataUrl),
    choice => choice.value === dataUrl,
  )

  const maybeFocusIndex = Option.filter(
    maybeUploadIndex,
    () => model.popover.isOpen,
  )

  return {
    model: modifyFields(resetInteraction(model), {
      uploads: () => nextUploads,
    }),
    commands: Array.fromOption(
      Option.map(maybeFocusIndex, index => FocusImage({ id: model.id, index })),
    ),
    outMessage: OutMessage.ChangedValue({ value: dataUrl }),
  }
}

/** Processes an ImagePicker Message and returns the next Model, optional
 *  Commands, and an optional `ChangedValue` OutMessage. The value lives in
 *  the parent, so Messages that need it carry it from the view. */
export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    GotPopoverMessage: ({ message: popoverMessage }) =>
      foldPopover(model, popoverMessage),

    GotFileDropMessage: ({ message: fileDropMessage }) =>
      foldFileDrop(model, fileDropMessage),

    SelectedImage: ({ index, value, currentValue }) =>
      withChangedValue(
        {
          model: resetInteraction(model),
          commands: [FocusImage({ id: model.id, index })],
        },
        currentValue,
        value,
      ),

    PressedKeyboardNavigation: ({ index }) => ({
      model: modifyFields(model, {
        maybeFocusedIndex: () => Option.some(index),
      }),
      commands: [FocusImage({ id: model.id, index })],
    }),

    ClickedRemove: () =>
      pipe(
        foldPopoverClose(resetInteraction(model)),
        Update.withOutMessage(OutMessage.ChangedValue({ value: '' })),
      ),

    MovedFocusOutsidePicker: () => foldPopoverClose(model),

    SucceededReadImageFile: ({ file, dataUrl }) => {
      if (isReadingFile(model, file)) {
        return completeUpload(model, file, dataUrl)
      } else {
        return { model }
      }
    },

    FailedReadImageFile: ({ file, failure }) => {
      if (isReadingFile(model, file)) {
        return {
          model: modifyFields(model, {
            uploadState: () => UploadState.Failed({ failure }),
          }),
        }
      } else {
        return { model }
      }
    },

    CompletedFocusImage: () => ({ model }),
  })

/** Replaces the picker's options, for an image dial whose options change at
 *  runtime. Uploads and the parent's value are kept. */
export const reflectOptions: Reflect<
  Model,
  ReadonlyArray<OptionInput>
> = Function.dual(
  2,
  (model: Model, options: ReadonlyArray<OptionInput>): Model =>
    modifyFields(model, {
      options: () => Array.map(options, toImageChoice),
    }),
)

// SUBSCRIPTION

const PICKER_ID_ATTRIBUTE = 'image-picker-id'

/** The ImagePicker's Subscriptions. `focusOutside` closes the open picker
 *  when focus lands on an element outside it, such as after Tab past the
 *  Upload control. Closing returns focus to the trigger, as Escape does. The
 *  Popover runs in `contentFocus` mode, so the picker owns this blur rule. */
export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  focusOutside: entry(
    { id: Schema.String, isOpen: Schema.Boolean },
    {
      modelToDependencies: model => ({
        id: model.id,
        isOpen: model.popover.isOpen,
      }),
      dependenciesToStream: ({ id, isOpen }) =>
        focusLeavingMarked({
          attribute: PICKER_ID_ATTRIBUTE,
          id,
          isOpen,
          message: Message.MovedFocusOutsidePicker(),
        }),
    },
  ),
}))

// VIEW

const DEFAULT_COLUMNS = 3
const IMAGE_ACCEPT = 'image/*'

/** The DOM id of the trigger button, the embedded Popover's button. Use it
 *  to label the trigger from outside. */
export const triggerId = (id: string): string => Popover.buttonId(popoverId(id))

const navigationTarget = (
  key: string,
  index: number,
  count: number,
  columns: number,
): Option.Option<number> =>
  Option.map(
    Match.value(key).pipe(
      Match.withReturnType<number>(),
      Match.when('ArrowRight', () => index + 1),
      Match.when('ArrowLeft', () => index - 1),
      Match.when('ArrowDown', () => index + columns),
      Match.when('ArrowUp', () => index - columns),
      Match.when('Home', () => 0),
      Match.when('End', () => count - 1),
      Match.option,
    ),
    target => clamp(target, 0, count - 1),
  )

/** One thumbnail the consumer renders. Spread `option` onto a `button`. It
 *  carries the radio role and label, `aria-checked`, the roving tabindex, and
 *  the click and keyboard handlers. */
export type ChoiceInfo = Readonly<{
  value: string
  label: string
  index: number
  isSelected: boolean
  option: ReadonlyArray<ChildAttribute>
}>

/** Attribute groups the ImagePicker hands to the consumer's `toView`.
 *
 *  - `root`: a wrapper around the trigger. Focus inside it counts as inside
 *    the picker.
 *  - `trigger`: the button that opens the picker.
 *  - `backdrop`: rendered while `isVisible`. Clicking it closes the picker.
 *  - `panel`: the floating picker. It is also the drop zone for images.
 *  - `grid`: the radio group that holds the thumbnails.
 *  - `remove`: a button that clears the image. Hidden when there is none.
 *  - `upload`: a `label` that wraps the file input.
 *  - `fileInput`: a visually hidden `input` inside `upload`.
 *  - `status`: a live region for the upload failure text. */
export type ImagePickerAttributes = Readonly<{
  root: ReadonlyArray<ChildAttribute>
  trigger: ReadonlyArray<ChildAttribute>
  backdrop: ReadonlyArray<ChildAttribute>
  panel: ReadonlyArray<ChildAttribute>
  grid: ReadonlyArray<ChildAttribute>
  remove: ReadonlyArray<ChildAttribute>
  upload: ReadonlyArray<ChildAttribute>
  fileInput: ReadonlyArray<ChildAttribute>
  status: ReadonlyArray<ChildAttribute>
}>

/** What the consumer's `toView` receives: the attribute groups, one entry
 *  per thumbnail, the label of the current image, and the state to render.
 *  Render the backdrop and panel only while `isVisible`. */
export type RenderInfo = Readonly<{
  attributes: ImagePickerAttributes
  choices: ReadonlyArray<ChoiceInfo>
  valueLabel: string
  isVisible: boolean
  isReading: boolean
  maybeUploadFailure: Option.Option<UploadFailure>
}>

/** Per-render view inputs passed to `view` through `h.submodel`'s
 *  `viewInputs`. */
export type ViewInputs = Readonly<{
  /** The selected image URL, read from the parent Model. `''` is no image. */
  value: string
  label: string
  anchor: Popover.AnchorConfig
  toView: (render: RenderInfo) => Html
  /** How many thumbnails sit in one row, for ArrowUp and ArrowDown.
   *  Defaults to 3, as in DialKit. */
  columns?: number
  isDisabled?: boolean
}>

/** Renders a headless image picker: a trigger that opens a floating panel of
 *  thumbnails, with Remove, Upload, and drag and drop. The thumbnails are a
 *  radio group. Arrow keys move through them, Enter or Space selects, and
 *  Escape closes and returns focus to the trigger. */
export const view = defineView<Model, Message, ViewInputs>(
  (model, viewInputs, h): Html => {
    const {
      value,
      label,
      anchor,
      toView,
      columns = DEFAULT_COLUMNS,
      isDisabled = false,
    } = viewInputs
    const { id, maybeFocusedIndex } = model

    const choices = imageChoices(model.options, model.uploads, value)
    const choiceCount = Array.length(choices)
    const lowerCaseLabel = String.toLowerCase(label)
    const isReading = model.uploadState._tag === 'Reading'
    const maybeUploadFailure = UploadState.matchOrElse<
      Option.Option<UploadFailure>
    >(
      model.uploadState,
      { Failed: ({ failure }) => Option.some(failure) },
      () => Option.none(),
    )

    const maybeSelectedIndex = Array.findFirstIndex(
      choices,
      choice => choice.value === value,
    )
    const tabStopIndex = pipe(
      maybeFocusedIndex,
      Option.filter(index => index < choiceCount),
      Option.orElse(() => maybeSelectedIndex),
      Option.getOrElse(() => 0),
    )
    const valueLabel = pipe(
      maybeSelectedIndex,
      Option.flatMap(index => Array.get(choices, index)),
      Option.match({
        onNone: () => NO_IMAGE_LABEL,
        onSome: choice => choice.label,
      }),
    )

    const focusSelector = Array.match(choices, {
      onEmpty: () => idSelector(fileInputId(id)),
      onNonEmpty: () => idSelector(imageId(id, tabStopIndex)),
    })

    const handleImageKeyDown =
      (index: number, choiceValue: string) =>
      (key: string, modifiers: KeyboardModifiers): Option.Option<Message> => {
        if (hasCommandModifier(modifiers)) {
          return Option.none()
        } else if (key === 'Enter' || key === ' ') {
          return Option.some(
            Message.SelectedImage({
              index,
              value: choiceValue,
              currentValue: value,
            }),
          )
        } else {
          return Option.map(
            navigationTarget(key, index, choiceCount, columns),
            target => Message.PressedKeyboardNavigation({ index: target }),
          )
        }
      }

    // NOTE: the thumbnails are a radio group by hand rather than a
    // @foldkit/ui RadioGroup. RadioGroup moves along one axis and selects as
    // focus moves. The thumbnails are a grid: Up and Down move a whole row,
    // and the arrow keys only move focus, so browsing does not swap the image
    // until Enter, Space, or a click selects one.
    const choiceInfos = Array.map(choices, (choice, index): ChoiceInfo => {
      const isSelected = Option.contains(maybeSelectedIndex, index)
      return {
        value: choice.value,
        label: choice.label,
        index,
        isSelected,
        option: childAttributes([
          h.Id(imageId(id, index)),
          h.Type('button'),
          h.Role('radio'),
          h.AriaLabel(choice.label),
          h.Title(choice.label),
          h.AriaChecked(isSelected),
          h.Tabindex(index === tabStopIndex ? 0 : -1),
          ...(isSelected ? [h.DataAttribute('selected', '')] : []),
          h.OnClick(
            Message.SelectedImage({
              index,
              value: choice.value,
              currentValue: value,
            }),
          ),
          h.OnKeyDownPreventDefault(handleImageKeyDown(index, choice.value)),
        ]),
      }
    })

    const pickerIdAttribute = h.DataAttribute(PICKER_ID_ATTRIBUTE, id)

    const removeAttributes = [
      h.Type('button'),
      ...(String.isEmpty(value)
        ? [h.Hidden(true)]
        : [
            h.AriaLabel(`Remove ${lowerCaseLabel} image`),
            h.OnClick(Message.ClickedRemove()),
          ]),
    ]

    const readingAttributes = isReading
      ? [h.AriaDisabled(true), h.DataAttribute('reading', '')]
      : []

    return h.submodel({
      slotId: model.popover.id,
      model: model.popover,
      view: Popover.view,
      viewInputs: {
        anchor,
        isDisabled,
        focusSelector,
        ariaLabel: `Choose ${lowerCaseLabel} image: ${valueLabel}`,
        toView: popover =>
          h.submodel({
            slotId: model.fileDrop.id,
            model: model.fileDrop,
            view: FileDrop.view,
            viewInputs: {
              accept: [IMAGE_ACCEPT],
              toView: fileDrop =>
                toView({
                  attributes: {
                    root: childAttributes([
                      pickerIdAttribute,
                      ...(popover.isVisible
                        ? [h.DataAttribute('open', '')]
                        : []),
                      ...(isDisabled ? [h.DataAttribute('disabled', '')] : []),
                    ]),
                    trigger: [
                      ...popover.button,
                      ...childAttributes([h.AriaHasPopup('dialog')]),
                    ],
                    backdrop: popover.backdrop,
                    panel: [
                      ...popover.panel,
                      ...fileDrop.root,
                      ...childAttributes([
                        pickerIdAttribute,
                        h.Role('dialog'),
                        h.AriaLabel(`${label} image picker`),
                      ]),
                    ],
                    grid: childAttributes([
                      h.Role('radiogroup'),
                      h.AriaLabel('Available images'),
                      h.AriaBusy(isReading),
                    ]),
                    remove: childAttributes(removeAttributes),
                    upload: childAttributes(readingAttributes),
                    fileInput: [
                      ...fileDrop.input,
                      ...childAttributes(isReading ? [h.Disabled(true)] : []),
                    ],
                    status: childAttributes([h.Role('status')]),
                  },
                  choices: choiceInfos,
                  valueLabel,
                  isVisible: popover.isVisible,
                  isReading,
                  maybeUploadFailure,
                }),
            },
            toParentMessage: message => Message.GotFileDropMessage({ message }),
          }),
      },
      toParentMessage: toGotPopoverMessage,
    })
  },
)
