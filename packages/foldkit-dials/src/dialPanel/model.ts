import { Array, Match, Option, Record, Schema, pipe } from 'effect'
import type { Update } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'

import { Listbox, Popover, RadioGroup } from '@foldkit/ui'

import * as ColorField from '../colorField/index.js'
import { type LeafMeta, ShortcutModifier, pathKey } from '../dial/index.js'
import * as DialPad from '../dialPad/index.js'
import * as ImagePicker from '../imagePicker/index.js'
import * as ScrubSlider from '../scrubSlider/index.js'
import * as TransitionEditor from '../transitionEditor/index.js'
import { LoadPersisted } from './command.js'
import type { Message } from './message.js'
import { type PanelSpec, controlId } from './spec.js'
import {
  BASE_VERSION_ID,
  BASE_VERSION_NAME,
  Version,
  baseVersion,
  findVersion,
} from './versions.js'

// MODEL

/** The corner a floating panel docks to. */
export const Corner = Schema.Literals([
  'TopRight',
  'TopLeft',
  'BottomRight',
  'BottomLeft',
])
export type Corner = typeof Corner.Type

export { Theme } from '../internal/theme.js'

/** `Floating` docks the panel to a viewport corner. `Inline` renders it in
 *  the page flow. `Section` renders it without its own window, for
 *  `DialPanel.root` to group several panels. */
export const Layout = Schema.Literals(['Floating', 'Inline', 'Section'])
export type Layout = typeof Layout.Type

/** The toggle segments, Off then On. */
export const ToggleOption = Schema.Literals(['Off', 'On'])
export type ToggleOption = typeof ToggleOption.Type

const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number })

/** A press on a floating panel's header. A press that moves past the drag
 *  threshold drags the panel. `Dropped` follows a drag: the browser fires a
 *  click when the drag ends, and that click must not toggle the panel. */
export const HeaderDrag = defineTaggedUnion({
  Idle: {},
  Pressing: { pointer: Point, originOffset: Point },
  Dragging: { pointer: Point, originOffset: Point },
  Dropped: {},
})
export type HeaderDrag = typeof HeaderDrag.Type

/** Pointer tracking while a Drag or Move shortcut adjusts a slider. */
export const ShortcutPointer = defineTaggedUnion({
  Idle: {},
  Tracking: {
    lastX: Schema.Number,
    accumulatedPixels: Schema.Number,
    isButtonDown: Schema.Boolean,
  },
})

/** What the Copy button shows after a copy. */
export const CopyStatus = Schema.Literals(['Idle', 'Copied', 'Failed'])
export type CopyStatus = typeof CopyStatus.Type

/** Schema for a panel's state. The tuned values are owned by the parent and
 *  passed to `update` and `view`. The panel owns its versions, its open and
 *  drag state, and each control's interaction state. `persistVersion` and
 *  `copyVersion` count the waits started, so only the latest wait acts.
 *  `isSaveFailed` holds whether the last save to storage failed. */
export const Model = Schema.Struct({
  isOpen: Schema.Boolean,
  offset: Point,
  headerDrag: HeaderDrag,
  versions: Schema.Array(Version),
  activeVersionId: Schema.String,
  maybeComparedVersionId: Schema.Option(Schema.String),
  versionMenu: Popover.Model,
  shortcutsMenu: Popover.Model,
  copyStatus: CopyStatus,
  copyVersion: Schema.Number,
  persistVersion: Schema.Number,
  isSaveFailed: Schema.Boolean,
  toggledFolderKeys: Schema.Array(Schema.String),
  heldShortcutKeys: Schema.Array(Schema.String),
  maybeShortcutModifier: Schema.Option(ShortcutModifier),
  shortcutPointer: ShortcutPointer,
  sliders: Schema.Record(Schema.String, ScrubSlider.Model),
  toggles: Schema.Record(Schema.String, RadioGroup.Model),
  selects: Schema.Record(Schema.String, Listbox.Model),
  images: Schema.Record(Schema.String, ImagePicker.Model),
  colors: Schema.Record(Schema.String, ColorField.Model),
  pads: Schema.Record(Schema.String, DialPad.Model),
  transitions: Schema.Record(Schema.String, TransitionEditor.Model),
})
export type Model = typeof Model.Type

// INIT

const childModels = <Child>(
  spec: PanelSpec,
  initChild: (meta: LeafMeta, id: string) => Option.Option<Child>,
): Readonly<Record<string, Child>> =>
  pipe(
    spec.leaves,
    Array.map(({ path, meta }) => {
      const key = pathKey(path)
      return Option.map(
        initChild(meta, controlId(spec, key)),
        child => [key, child] as const,
      )
    }),
    Array.getSomes,
    Record.fromEntries,
  )

/** The panel's starting Model: open unless collapsed by default, on Version 1
 *  holding the dial defaults. */
export const initModel = (spec: PanelSpec): Model => ({
  isOpen: !spec.isCollapsedByDefault,
  offset: { x: 0, y: 0 },
  headerDrag: HeaderDrag.Idle(),
  versions: [baseVersion(spec.defaults)],
  activeVersionId: BASE_VERSION_ID,
  maybeComparedVersionId: Option.none(),
  versionMenu: Popover.init({ id: `${spec.id}-versions` }),
  shortcutsMenu: Popover.init({ id: `${spec.id}-shortcuts` }),
  copyStatus: 'Idle',
  copyVersion: 0,
  persistVersion: 0,
  isSaveFailed: false,
  toggledFolderKeys: [],
  heldShortcutKeys: [],
  maybeShortcutModifier: Option.none(),
  shortcutPointer: ShortcutPointer.Idle(),
  sliders: childModels(spec, (meta, id) =>
    Match.value(meta).pipe(
      Match.tag('Slider', ({ min, max, step }) =>
        ScrubSlider.init({ id, min, max, step }),
      ),
      Match.option,
    ),
  ),
  toggles: childModels(spec, (meta, id) =>
    Match.value(meta).pipe(
      Match.tag('Toggle', () => RadioGroup.init({ id })),
      Match.option,
    ),
  ),
  selects: childModels(spec, (meta, id) =>
    Match.value(meta).pipe(
      Match.tag('Select', () => Listbox.init({ id })),
      Match.option,
    ),
  ),
  images: childModels(spec, (meta, id) =>
    Match.value(meta).pipe(
      Match.tag('Image', ({ options }) => ImagePicker.init({ id, options })),
      Match.option,
    ),
  ),
  colors: childModels(spec, (meta, id) =>
    Match.value(meta).pipe(
      Match.tag('Color', color =>
        ColorField.init({ id, value: color.default }),
      ),
      Match.option,
    ),
  ),
  pads: childModels(spec, (meta, id) =>
    Match.value(meta).pipe(
      Match.tag('Pad', ({ x, y }) => DialPad.init({ id, x, y })),
      Match.option,
    ),
  ),
  transitions: childModels(spec, (meta, id) =>
    Match.value(meta).pipe(
      Match.tag('Transition', () => TransitionEditor.init({ id })),
      Match.option,
    ),
  ),
})

/** The panel's `init` result: the starting Model, plus a Command that loads
 *  persisted versions when persistence is on. */
export const init = (spec: PanelSpec): Update.Return<Model, Message> => ({
  model: initModel(spec),
  commands: Array.fromOption(
    Option.map(spec.maybePersist, ({ key, storage }) =>
      LoadPersisted({ key, storage }),
    ),
  ),
})

// QUERIES

/** Whether a folder is open: its declared state, flipped when the user
 *  toggled it. */
export const isFolderOpen = (
  spec: PanelSpec,
  model: Model,
  key: string,
): boolean =>
  Array.contains(spec.collapsedFolderKeys, key) ===
  Array.contains(model.toggledFolderKeys, key)

/** The name of the active version. */
export const activeVersionName = (model: Model): string =>
  Option.match(findVersion(model.versions, model.activeVersionId), {
    onNone: () => BASE_VERSION_NAME,
    onSome: ({ name }) => name,
  })
