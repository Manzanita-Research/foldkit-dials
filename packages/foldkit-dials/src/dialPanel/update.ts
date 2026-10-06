import {
  Array,
  Number,
  Option,
  Predicate,
  Record,
  Schema,
  String,
  pipe,
} from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { Listbox, Popover, RadioGroup } from '@foldkit/ui'

import * as ColorField from '../colorField/index.js'
import {
  type Path,
  type ShortcutModifier,
  getAtPath,
  keyPath,
  setAtPath,
} from '../dial/index.js'
import * as DialPad from '../dialPad/index.js'
import * as ImagePicker from '../imagePicker/index.js'
import * as ScrubSlider from '../scrubSlider/index.js'
import {
  DEFAULT_TIME_SPRING,
  type Transition,
  isTransition,
} from '../transition/index.js'
import * as TransitionEditor from '../transitionEditor/index.js'
import {
  CopyValues,
  SavePersisted,
  WaitBeforePersist,
  WaitBeforeResetCopy,
} from './command.js'
import {
  type ControlSlot,
  SelectListbox,
  ToggleGroup,
  colorSlot,
  imageSlot,
  padSlot,
  selectSlot,
  sliderSlot,
  toggleSlot,
  transitionSlot,
} from './controls.js'
import { toDialSource } from './copy.js'
import { Message, OutMessage } from './message.js'
import {
  type CopyStatus,
  HeaderDrag,
  type Model,
  ShortcutPointer,
  type ToggleOption,
  isFolderOpen,
} from './model.js'
import {
  DRAG_PIXELS_PER_STEP,
  type SliderShortcutTarget,
  applyShortcutSteps,
  findShortcutTarget,
  interactionOf,
  isSliderTarget,
  scrollOnlyTargets,
} from './shortcuts.js'
import type { PanelSpec } from './spec.js'
import {
  BASE_VERSION_ID,
  Version,
  baseVersion,
  findVersion,
  nextVersionNumber,
  numberedVersion,
  removeVersion,
  writeVersionValues,
} from './versions.js'

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>
type Step = Update.StepWithOutMessage<Model, Message, OutMessage>
type PlainStep = Update.Step<Model, Message>

const HEADER_DRAG_THRESHOLD_PIXELS = 4

// PERSISTENCE

const PersistedPanel = Schema.Struct({
  activeVersionId: Schema.String,
  versions: Schema.Array(Version),
})
type PersistedPanel = typeof PersistedPanel.Type

const PersistedPanelJson = Schema.fromJsonString(
  Schema.toCodecJson(PersistedPanel),
)
const encodePersistedPanel = Schema.encodeSync(PersistedPanelJson)
const decodePersistedPanel = Schema.decodeUnknownOption(PersistedPanelJson)

/** Starts the wait before a save. Each wait carries the next
 *  `persistVersion`, so only the wait for the latest edit saves. */
const schedulePersist =
  (spec: PanelSpec): PlainStep =>
  model =>
    Option.match(spec.maybePersist, {
      onNone: () => ({ model }),
      onSome: () => {
        const version = Number.increment(model.persistVersion)
        return {
          model: modifyFields(model, { persistVersion: () => version }),
          commands: [WaitBeforePersist({ version })],
        }
      },
    })

const persistedPanelOf = (
  model: Model,
  values: unknown,
  isVersionsPersisted: boolean,
): PersistedPanel =>
  isVersionsPersisted
    ? { activeVersionId: model.activeVersionId, versions: model.versions }
    : { activeVersionId: BASE_VERSION_ID, versions: [baseVersion(values)] }

const savePersisted = (
  spec: PanelSpec,
  model: Model,
  values: unknown,
  version: number,
): UpdateReturn => {
  if (version !== model.persistVersion) {
    return { model }
  } else {
    return {
      model,
      commands: Array.fromOption(
        Option.map(spec.maybePersist, ({ key, storage, isVersionsPersisted }) =>
          SavePersisted({
            key,
            storage,
            json: encodePersistedPanel(
              persistedPanelOf(model, values, isVersionsPersisted),
            ),
          }),
        ),
      ),
    }
  }
}

/** Restores stored versions. Their values decode leniently, Version 1 is
 *  added back when storage lacks it, and an unknown active id falls back to
 *  Version 1. */
const restorePersisted = (
  spec: PanelSpec,
  model: Model,
  persisted: PersistedPanel,
): UpdateReturn => {
  const stored = Array.map(persisted.versions, version =>
    modifyFields(version, { values: spec.decodeValues }),
  )
  const maybeStoredBase = findVersion(stored, BASE_VERSION_ID)
  const base = Option.getOrElse(maybeStoredBase, () =>
    baseVersion(spec.defaults),
  )
  const versions = Option.isSome(maybeStoredBase)
    ? stored
    : Array.prepend(stored, base)
  const active = Option.getOrElse(
    findVersion(versions, persisted.activeVersionId),
    () => base,
  )
  return {
    model: reflectColors(
      modifyFields(model, {
        versions: () => versions,
        activeVersionId: () => active.id,
      }),
      active.values,
    ),
    outMessage: OutMessage.ChangedValues({ values: active.values }),
  }
}

const loadPersisted = (
  spec: PanelSpec,
  model: Model,
  maybeJson: Option.Option<string>,
): UpdateReturn =>
  pipe(
    maybeJson,
    Option.flatMap(decodePersistedPanel),
    Option.filter(({ versions }) => Array.isReadonlyArrayNonEmpty(versions)),
    Option.match({
      onNone: () => ({ model }),
      onSome: persisted => restorePersisted(spec, model, persisted),
    }),
  )

// VALUES

const saveIntoActiveVersion =
  (spec: PanelSpec, nextValues: unknown): PlainStep =>
  model =>
    schedulePersist(spec)(
      modifyFields(model, {
        versions: versions =>
          writeVersionValues(versions, model.activeVersionId, nextValues),
      }),
    )

/** Writes one dial's value. The dial Schema decides: an edit it rejects
 *  leaves the Model and the values unchanged. */
const writeValue = (
  spec: PanelSpec,
  model: Model,
  values: unknown,
  path: Path,
  nextValue: unknown,
): UpdateReturn => {
  const nextValues = setAtPath(values, path, nextValue)
  if (spec.isValid(nextValues)) {
    return Update.withOutMessage(
      saveIntoActiveVersion(spec, nextValues)(model),
      OutMessage.ChangedValues({ values: nextValues }),
    )
  } else {
    return { model }
  }
}

/** Points every colour field at the colours in `values`, so edits after a
 *  version switch or reset keep each loaded colour's format. */
const reflectColors = (model: Model, values: unknown): Model =>
  modifyFields(model, {
    colors: Record.map((field, key) => {
      const color = getAtPath(values, keyPath(key))
      return Predicate.isString(color)
        ? ColorField.reflectValue(field, color)
        : field
    }),
  })

// CHILD CONTROLS

type ControlFold<ChildModel, ChildMessage, ChildOutMessage> = Readonly<{
  slot: ControlSlot<ChildModel, ChildMessage>
  update: (
    child: ChildModel,
    message: ChildMessage,
  ) => Update.ReturnWithOutMessage<ChildModel, ChildMessage, ChildOutMessage>
  toDialValue: (outMessage: ChildOutMessage) => unknown
}>

/** Folds a child control's Message into the panel. The child updates its
 *  record entry, and a value it reports becomes the panel's next values. */
const foldControl = <ChildModel, ChildMessage, ChildOutMessage>(
  control: ControlFold<ChildModel, ChildMessage, ChildOutMessage>,
  spec: PanelSpec,
  values: unknown,
  dialId: string,
) =>
  Update.foldChild({
    update: control.update,
    read: (model: Model) => Record.get(control.slot.read(model), dialId),
    write: (model, nextChild) =>
      control.slot.modify(model, Record.set(dialId, nextChild)),
    toParentMessage: control.slot.toParentMessage(dialId),
    foldOutMessage:
      (outMessage: ChildOutMessage): Step =>
      model =>
        writeValue(
          spec,
          model,
          values,
          keyPath(dialId),
          control.toDialValue(outMessage),
        ),
  })

const sliderControl: ControlFold<
  ScrubSlider.Model,
  ScrubSlider.Message,
  ScrubSlider.OutMessage
> = {
  slot: sliderSlot,
  update: ScrubSlider.update,
  toDialValue: ScrubSlider.OutMessage.match<unknown>({
    ChangedValue: ({ value }) => value,
  }),
}

const toggleControl: ControlFold<
  RadioGroup.Model,
  RadioGroup.Message,
  RadioGroup.OutMessage<ToggleOption>
> = {
  slot: toggleSlot,
  update: ToggleGroup.update,
  toDialValue: RadioGroup.OutMessage.match<
    unknown,
    RadioGroup.OutMessage<ToggleOption>
  >({ Selected: ({ value }) => value === 'On' }),
}

const selectControl: ControlFold<
  Listbox.Model,
  Listbox.Message,
  Listbox.OutMessage<string>
> = {
  slot: selectSlot,
  update: SelectListbox.update,
  toDialValue: Listbox.OutMessage.match<unknown>({
    Selected: ({ value }) => value,
  }),
}

const imageControl: ControlFold<
  ImagePicker.Model,
  ImagePicker.Message,
  ImagePicker.OutMessage
> = {
  slot: imageSlot,
  update: ImagePicker.update,
  toDialValue: ImagePicker.OutMessage.match<unknown>({
    ChangedValue: ({ value }) => value,
  }),
}

const colorControl: ControlFold<
  ColorField.Model,
  ColorField.Message,
  ColorField.OutMessage
> = {
  slot: colorSlot,
  update: ColorField.update,
  toDialValue: ColorField.OutMessage.match<unknown>({
    ChangedValue: ({ value }) => value,
  }),
}

const padControl: ControlFold<
  DialPad.Model,
  DialPad.Message,
  DialPad.OutMessage
> = {
  slot: padSlot,
  update: DialPad.update,
  toDialValue: DialPad.OutMessage.match<unknown>({
    ChangedValue: ({ value }) => value,
  }),
}

const currentTransition = (values: unknown, dialId: string): Transition =>
  Option.getOrElse(
    Option.liftPredicate(getAtPath(values, keyPath(dialId)), isTransition),
    () => DEFAULT_TIME_SPRING,
  )

/** The spring and easing control. Its editor needs the dial's current
 *  value, so the fold is built per Message. */
const transitionControl = (
  values: unknown,
  dialId: string,
): ControlFold<
  TransitionEditor.Model,
  TransitionEditor.Message,
  TransitionEditor.OutMessage
> => ({
  slot: transitionSlot,
  update: (editor, message) =>
    TransitionEditor.update(editor, message, currentTransition(values, dialId)),
  toDialValue: TransitionEditor.OutMessage.match<unknown>({
    ChangedValue: ({ value }) => value,
  }),
})

// MENUS

const ignoreMenuOutMessage = Popover.OutMessage.match<PlainStep>({
  Opened: () => model => ({ model }),
  Closed: () => model => ({ model }),
})

const foldVersionMenu = Update.foldChild({
  update: Popover.update,
  read: (model: Model) => Option.some(model.versionMenu),
  write: (model, nextVersionMenu) =>
    modifyFields(model, { versionMenu: () => nextVersionMenu }),
  toParentMessage: message => Message.GotVersionMenuMessage({ message }),
  foldOutMessage: ignoreMenuOutMessage,
})

const foldShortcutsMenu = Update.foldChild({
  update: Popover.update,
  read: (model: Model) => Option.some(model.shortcutsMenu),
  write: (model, nextShortcutsMenu) =>
    modifyFields(model, { shortcutsMenu: () => nextShortcutsMenu }),
  toParentMessage: message => Message.GotShortcutsMenuMessage({ message }),
  foldOutMessage: ignoreMenuOutMessage,
})

const closeVersionMenu = Update.foldChildStep({
  update: Popover.close,
  read: (model: Model) => Option.some(model.versionMenu),
  write: (model, nextVersionMenu) =>
    modifyFields(model, { versionMenu: () => nextVersionMenu }),
  toParentMessage: message => Message.GotVersionMenuMessage({ message }),
  foldOutMessage: ignoreMenuOutMessage,
})

// VERSIONS

/** Makes a version active and reports its values. Ends a comparison with
 *  that version, since a version cannot be compared with itself. */
const switchToVersion = (
  spec: PanelSpec,
  model: Model,
  version: Version,
  leadingSteps: ReadonlyArray<PlainStep>,
): UpdateReturn => {
  // NOTE: hot reload keeps the Model, so a version can predate a change to
  // the dial Schema. Its values decode again before they reach the parent.
  const values = spec.decodeValues(version.values)
  return Update.withOutMessage(
    Update.combine(model, [
      ...leadingSteps,
      stepModel => ({
        model: modifyFields(reflectColors(stepModel, values), {
          activeVersionId: () => version.id,
          maybeComparedVersionId: Option.filter(
            comparedId => comparedId !== version.id,
          ),
        }),
      }),
      schedulePersist(spec),
    ]),
    OutMessage.ChangedValues({ values }),
  )
}

const saveVersion =
  (spec: PanelSpec, values: unknown): PlainStep =>
  model => {
    const version = numberedVersion(nextVersionNumber(model.versions), values)
    return schedulePersist(spec)(
      modifyFields(model, {
        versions: Array.append(version),
        activeVersionId: () => version.id,
      }),
    )
  }

const deleteVersion = (
  spec: PanelSpec,
  model: Model,
  versionId: string,
): UpdateReturn => {
  const deleted = modifyFields(model, {
    versions: versions => removeVersion(versions, versionId),
    maybeComparedVersionId: Option.filter(
      comparedId => comparedId !== versionId,
    ),
  })
  const isActiveDeleted =
    model.activeVersionId === versionId && versionId !== BASE_VERSION_ID
  if (isActiveDeleted) {
    const base = Option.getOrElse(
      findVersion(deleted.versions, BASE_VERSION_ID),
      () => baseVersion(spec.defaults),
    )
    return switchToVersion(spec, deleted, base, [])
  } else {
    return schedulePersist(spec)(deleted)
  }
}

// COPY

const showCopyStatus = (model: Model, copyStatus: CopyStatus): UpdateReturn => {
  const version = Number.increment(model.copyVersion)
  return {
    model: modifyFields(model, {
      copyStatus: () => copyStatus,
      copyVersion: () => version,
    }),
    commands: [WaitBeforeResetCopy({ version })],
  }
}

// SHORTCUTS

const heldSliderFor = (
  spec: PanelSpec,
  model: Model,
  interactions: ReadonlyArray<string>,
): Option.Option<SliderShortcutTarget> =>
  pipe(
    model.heldShortcutKeys,
    Array.map(key =>
      findShortcutTarget(
        spec.shortcutTargets,
        key,
        model.maybeShortcutModifier,
      ),
    ),
    Array.getSomes,
    Array.filter(isSliderTarget),
    Array.findFirst(target =>
      Array.contains(interactions, interactionOf(target.shortcut)),
    ),
  )

const stepSlider = (
  spec: PanelSpec,
  model: Model,
  values: unknown,
  target: SliderShortcutTarget,
  steps: number,
): UpdateReturn => {
  const current = getAtPath(values, keyPath(target.key))
  const value = Predicate.isNumber(current) ? current : target.meta.default
  return writeValue(
    spec,
    model,
    values,
    keyPath(target.key),
    applyShortcutSteps(value, target.meta, target.shortcut, steps),
  )
}

const holdShortcutKey = (
  spec: PanelSpec,
  model: Model,
  values: unknown,
  key: string,
  maybeModifier: Option.Option<ShortcutModifier>,
): UpdateReturn => {
  const normalizedKey = String.toLowerCase(key)
  const isAlreadyHeld = Array.contains(model.heldShortcutKeys, normalizedKey)
  const held = modifyFields(model, {
    heldShortcutKeys: keys => Array.union(keys, [normalizedKey]),
    maybeShortcutModifier: () => maybeModifier,
    shortcutPointer: pointer =>
      isAlreadyHeld ? pointer : ShortcutPointer.Idle(),
  })
  return pipe(
    findShortcutTarget(spec.shortcutTargets, normalizedKey, maybeModifier),
    Option.filter(target => target._tag === 'Toggle' && !isAlreadyHeld),
    Option.match({
      onNone: () => ({ model: held }),
      onSome: target =>
        writeValue(
          spec,
          held,
          values,
          keyPath(target.key),
          getAtPath(values, keyPath(target.key)) !== true,
        ),
    }),
  )
}

const trackShortcutPointer = (
  spec: PanelSpec,
  model: Model,
  values: unknown,
  clientX: number,
): UpdateReturn =>
  ShortcutPointer.match(model.shortcutPointer, {
    Idle: () => ({
      model: modifyFields(model, {
        shortcutPointer: () =>
          ShortcutPointer.Tracking({
            lastX: clientX,
            accumulatedPixels: 0,
            isButtonDown: false,
          }),
      }),
    }),
    Tracking: ({ lastX, accumulatedPixels, isButtonDown }) => {
      const interactions = isButtonDown ? ['Drag'] : ['Move']
      const travelled = accumulatedPixels + clientX - lastX
      const steps = Math.trunc(travelled / DRAG_PIXELS_PER_STEP)
      const tracked = modifyFields(model, {
        shortcutPointer: () =>
          ShortcutPointer.Tracking({
            lastX: clientX,
            accumulatedPixels: travelled - steps * DRAG_PIXELS_PER_STEP,
            isButtonDown,
          }),
      })
      return Option.match(
        Option.filter(
          heldSliderFor(spec, model, interactions),
          () => steps !== 0,
        ),
        {
          onNone: () => ({ model: tracked }),
          onSome: target => stepSlider(spec, tracked, values, target, steps),
        },
      )
    },
  })

// HEADER

const dragPanelHeader = (
  model: Model,
  clientX: number,
  clientY: number,
): Model =>
  HeaderDrag.match(model.headerDrag, {
    Idle: () => model,
    Dropped: () => model,
    Pressing: pressing =>
      Math.hypot(clientX - pressing.pointer.x, clientY - pressing.pointer.y) <
      HEADER_DRAG_THRESHOLD_PIXELS
        ? model
        : modifyFields(model, {
            headerDrag: () =>
              HeaderDrag.Dragging({
                pointer: pressing.pointer,
                originOffset: pressing.originOffset,
              }),
            offset: () => movedHeaderOffset(pressing, clientX, clientY),
          }),
    Dragging: dragging =>
      modifyFields(model, {
        offset: () => movedHeaderOffset(dragging, clientX, clientY),
      }),
  })

const movedHeaderOffset = (
  origin: Readonly<{
    pointer: Readonly<{ x: number; y: number }>
    originOffset: Readonly<{ x: number; y: number }>
  }>,
  clientX: number,
  clientY: number,
): Readonly<{ x: number; y: number }> => ({
  x: origin.originOffset.x + clientX - origin.pointer.x,
  y: origin.originOffset.y + clientY - origin.pointer.y,
})

const releasedHeaderDrag = HeaderDrag.match<HeaderDrag>({
  Idle: () => HeaderDrag.Idle(),
  Pressing: () => HeaderDrag.Idle(),
  Dragging: () => HeaderDrag.Dropped(),
  Dropped: () => HeaderDrag.Dropped(),
})

/** Opens or closes the panel, unless this is the click that ends a header
 *  drag. */
const togglePanel = (model: Model, isOpen: boolean): Model =>
  model.headerDrag._tag === 'Dropped'
    ? modifyFields(model, { headerDrag: () => HeaderDrag.Idle() })
    : modifyFields(model, { isOpen: () => isOpen })

const toggleFolder = (
  spec: PanelSpec,
  model: Model,
  key: string,
  isOpen: boolean,
): Model =>
  isFolderOpen(spec, model, key) === isOpen
    ? model
    : modifyFields(model, {
        toggledFolderKeys: keys =>
          Array.contains(keys, key)
            ? Array.filter(keys, otherKey => otherKey !== key)
            : Array.append(keys, key),
      })

/** Processes a panel Message against the parent-owned `values`. Value edits
 *  return the whole next values record in a `ChangedValues` OutMessage. */
export const update =
  (spec: PanelSpec) => (model: Model, message: Message, values: unknown) =>
    Message.match<UpdateReturn>(message, {
      GotSliderMessage: ({ dialId, message: sliderMessage }) =>
        foldControl(sliderControl, spec, values, dialId)(model, sliderMessage),

      GotToggleMessage: ({ dialId, message: toggleMessage }) =>
        foldControl(toggleControl, spec, values, dialId)(model, toggleMessage),

      GotSelectMessage: ({ dialId, message: selectMessage }) =>
        foldControl(selectControl, spec, values, dialId)(model, selectMessage),

      GotImageMessage: ({ dialId, message: imageMessage }) =>
        foldControl(imageControl, spec, values, dialId)(model, imageMessage),

      GotColorMessage: ({ dialId, message: colorMessage }) =>
        foldControl(colorControl, spec, values, dialId)(model, colorMessage),

      GotPadMessage: ({ dialId, message: padMessage }) =>
        foldControl(padControl, spec, values, dialId)(model, padMessage),

      GotTransitionMessage: ({ dialId, message: editorMessage }) =>
        foldControl(
          transitionControl(values, dialId),
          spec,
          values,
          dialId,
        )(model, editorMessage),

      UpdatedText: ({ dialId, value }) =>
        writeValue(spec, model, values, keyPath(dialId), value),

      ClickedAction: ({ dialId }) => ({
        model,
        outMessage: OutMessage.ClickedAction({ path: dialId }),
      }),

      ToggledFolder: ({ dialId, isOpen }) => ({
        model: toggleFolder(spec, model, dialId, isOpen),
      }),

      ToggledPanel: ({ isOpen }) => ({ model: togglePanel(model, isOpen) }),

      PressedPanelHeader: ({ clientX, clientY }) => ({
        model: modifyFields(model, {
          headerDrag: () =>
            HeaderDrag.Pressing({
              pointer: { x: clientX, y: clientY },
              originOffset: model.offset,
            }),
        }),
      }),

      MovedPanelPointer: ({ clientX, clientY }) => ({
        model: dragPanelHeader(model, clientX, clientY),
      }),

      ReleasedPanelPointer: () => ({
        model: modifyFields(model, { headerDrag: releasedHeaderDrag }),
      }),

      GotVersionMenuMessage: ({ message: menuMessage }) =>
        foldVersionMenu(model, menuMessage),

      ClickedVersion: ({ versionId }) =>
        Option.match(findVersion(model.versions, versionId), {
          onNone: () => ({ model }),
          onSome: version =>
            switchToVersion(spec, model, version, [closeVersionMenu]),
        }),

      ClickedSaveVersion: () =>
        Update.combine(model, [closeVersionMenu, saveVersion(spec, values)]),

      ClickedDeleteVersion: ({ versionId }) =>
        deleteVersion(spec, model, versionId),

      ClickedCompareVersion: ({ versionId }) =>
        Update.combine(model, [
          closeVersionMenu,
          stepModel => ({
            model: modifyFields(stepModel, {
              maybeComparedVersionId: () => Option.some(versionId),
            }),
          }),
        ]),

      ClickedStopCompare: () => ({
        model: modifyFields(model, {
          maybeComparedVersionId: () => Option.none(),
        }),
      }),

      ClickedResetValues: () =>
        Update.withOutMessage(
          Update.combine(model, [
            closeVersionMenu,
            stepModel => ({ model: reflectColors(stepModel, spec.defaults) }),
            saveIntoActiveVersion(spec, spec.defaults),
          ]),
          OutMessage.ChangedValues({ values: spec.defaults }),
        ),

      ClickedCopyValues: () => ({
        model,
        commands: [
          CopyValues({ text: toDialSource(spec.name, spec.controls, values) }),
        ],
      }),

      SucceededCopyValues: () => showCopyStatus(model, 'Copied'),

      FailedCopyValues: () => showCopyStatus(model, 'Failed'),

      CompletedWaitBeforeResetCopy: ({ version }) => ({
        model:
          version === model.copyVersion
            ? modifyFields(model, { copyStatus: () => 'Idle' })
            : model,
      }),

      CompletedLoadPersisted: ({ maybeJson }) =>
        loadPersisted(spec, model, maybeJson),

      CompletedWaitBeforePersist: ({ version }) =>
        savePersisted(spec, model, values, version),

      SucceededSavePersisted: () => ({
        model: modifyFields(model, { isSaveFailed: () => false }),
      }),

      FailedSavePersisted: () => ({
        model: modifyFields(model, { isSaveFailed: () => true }),
      }),

      GotShortcutsMenuMessage: ({ message: menuMessage }) =>
        foldShortcutsMenu(model, menuMessage),

      PressedShortcutKey: ({ key, maybeModifier }) =>
        holdShortcutKey(spec, model, values, key, maybeModifier),

      ReleasedShortcutKey: ({ key }) => ({
        model: modifyFields(model, {
          heldShortcutKeys: Array.filter(
            heldKey => heldKey !== String.toLowerCase(key),
          ),
          shortcutPointer: () => ShortcutPointer.Idle(),
        }),
      }),

      BlurredWindow: () => ({
        model: modifyFields(model, {
          heldShortcutKeys: () => [],
          maybeShortcutModifier: () => Option.none(),
          shortcutPointer: () => ShortcutPointer.Idle(),
        }),
      }),

      ScrolledWithShortcut: ({ direction }) =>
        Option.match(
          Option.orElse(heldSliderFor(spec, model, ['Scroll']), () =>
            Array.head(scrollOnlyTargets(spec.shortcutTargets)),
          ),
          {
            onNone: () => ({ model }),
            onSome: target =>
              stepSlider(spec, model, values, target, direction),
          },
        ),

      PressedArrowWithShortcut: ({ direction }) =>
        Option.match(heldSliderFor(spec, model, ['Scroll', 'Drag', 'Move']), {
          onNone: () => ({ model }),
          onSome: target => stepSlider(spec, model, values, target, direction),
        }),

      PressedShortcutPointer: ({ clientX }) => ({
        model: modifyFields(model, {
          shortcutPointer: () =>
            ShortcutPointer.Tracking({
              lastX: clientX,
              accumulatedPixels: 0,
              isButtonDown: true,
            }),
        }),
      }),

      MovedShortcutPointer: ({ clientX }) =>
        trackShortcutPointer(spec, model, values, clientX),

      ReleasedShortcutPointer: () => ({
        model: modifyFields(model, {
          shortcutPointer: () => ShortcutPointer.Idle(),
        }),
      }),
    })
