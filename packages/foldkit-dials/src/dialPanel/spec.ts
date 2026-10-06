import { Array, Option, Schema } from 'effect'

import {
  type Control,
  type DialFields,
  type LeafControl,
  controlsOf,
  defaults,
  leavesOf,
  pathKey,
} from '../dial/index.js'
import { slugify } from '../internal/slug.js'
import { type ShortcutTarget, shortcutTargetsOf } from './shortcuts.js'

/** Where persisted panels keep their versions. */
export const Storage = Schema.Literals(['Local', 'Session'])
export type Storage = typeof Storage.Type

/** Persistence settings. `key` defaults to `foldkit-dials:<id>`. With
 *  `isVersionsPersisted: false`, only the current values are saved. */
export type PersistConfig = Readonly<{
  key?: string
  storage?: Storage
  isVersionsPersisted?: boolean
}>

/** Resolved persistence settings. */
export type PersistSettings = Readonly<{
  key: string
  storage: Storage
  isVersionsPersisted: boolean
}>

/** Configuration for `make`. `id` defaults to the name in kebab case and
 *  prefixes every DOM id, Subscription key, and the storage key. `persist`
 *  saves versions to browser storage. `isCollapsedByDefault` starts the
 *  panel closed. */
export type MakeConfig<Fields extends DialFields> = Readonly<{
  name: string
  schema: Schema.Struct<Fields>
  id?: string
  persist?: boolean | PersistConfig
  isCollapsedByDefault?: boolean
}>

/** Everything the panel derives once from its dial Schema. */
export type PanelSpec = Readonly<{
  id: string
  name: string
  controls: ReadonlyArray<Control>
  leaves: ReadonlyArray<LeafControl>
  collapsedFolderKeys: ReadonlyArray<string>
  shortcutTargets: ReadonlyArray<ShortcutTarget>
  defaults: unknown
  isValid: (values: unknown) => boolean
  decodeValues: (values: unknown) => unknown
  maybePersist: Option.Option<PersistSettings>
  isCollapsedByDefault: boolean
}>

const resolvePersist = (
  id: string,
  persist: boolean | PersistConfig | undefined,
): Option.Option<PersistSettings> => {
  if (persist === undefined || persist === false) {
    return Option.none()
  } else {
    const config: PersistConfig = persist === true ? {} : persist
    return Option.some({
      key: config.key ?? `foldkit-dials:${id}`,
      storage: config.storage ?? 'Local',
      isVersionsPersisted: config.isVersionsPersisted ?? true,
    })
  }
}

const collapsedFolderKeysOf = (
  controls: ReadonlyArray<Control>,
): ReadonlyArray<string> =>
  Array.flatMap(controls, control =>
    control._tag === 'Folder'
      ? Array.appendAll(
          control.isCollapsed ? [pathKey(control.path)] : [],
          collapsedFolderKeysOf(control.children),
        )
      : [],
  )

/** Builds the panel spec from a dial Schema. */
export const makeSpec = <Fields extends DialFields>(
  config: MakeConfig<Fields>,
): PanelSpec => {
  const id = config.id ?? slugify(config.name)
  const controls = controlsOf(config.schema)
  const leaves = leavesOf(controls)
  const decode = Schema.decodeUnknownOption(config.schema)
  const startingValues = defaults(config.schema)

  return {
    id,
    name: config.name,
    controls,
    leaves,
    collapsedFolderKeys: collapsedFolderKeysOf(controls),
    shortcutTargets: shortcutTargetsOf(leaves),
    defaults: startingValues,
    isValid: Schema.is(config.schema),
    decodeValues: values =>
      Option.getOrElse(decode(values), () => startingValues),
    maybePersist: resolvePersist(id, config.persist),
    isCollapsedByDefault: config.isCollapsedByDefault ?? false,
  }
}

/** The data attribute on a panel's root that holds its id, so window
 *  listeners can tell events inside the panel. */
export const PANEL_ID_ATTRIBUTE = 'dial-panel-id'

/** The DOM id prefix for one control: `card-shadow-blur` for `shadow.blur`. */
export const controlId = (spec: PanelSpec, key: string): string =>
  `${spec.id}-${key.replaceAll('.', '-')}`
