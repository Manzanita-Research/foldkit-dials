import { Array, Number, Option, Schema, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

// MODEL

/** A saved set of dial values. Version 1 always exists and is the base the
 *  panel starts from, the way DialKit's versions work. Values are stored as
 *  plain data and read back through the dial Schema's lenient decoder, so a
 *  version saved before a dial was added or changed still loads. */
export const Version = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  values: Schema.Unknown,
})
export type Version = typeof Version.Type

const VERSION_ID_PREFIX = 'v'
const VERSION_NAME_PREFIX = 'Version '
const BASE_VERSION_NUMBER = 1

/** The id of the base version every panel starts with. */
export const BASE_VERSION_ID = `${VERSION_ID_PREFIX}${BASE_VERSION_NUMBER}`

/** The name of the base version. */
export const BASE_VERSION_NAME = `${VERSION_NAME_PREFIX}${BASE_VERSION_NUMBER}`

/** Creates version number `number` holding `values`: id `v3`, name
 *  `Version 3`. */
export const numberedVersion = (number: number, values: unknown): Version => ({
  id: `${VERSION_ID_PREFIX}${number}`,
  name: `${VERSION_NAME_PREFIX}${number}`,
  values,
})

/** Creates the base version from the starting values. */
export const baseVersion = (values: unknown): Version =>
  numberedVersion(BASE_VERSION_NUMBER, values)

/** Finds a version by id. */
export const findVersion = (
  versions: ReadonlyArray<Version>,
  versionId: string,
): Option.Option<Version> =>
  Array.findFirst(versions, version => version.id === versionId)

/** Replaces the values of one version. */
export const writeVersionValues = (
  versions: ReadonlyArray<Version>,
  versionId: string,
  values: unknown,
): ReadonlyArray<Version> =>
  Array.map(versions, version =>
    version.id === versionId
      ? modifyFields(version, { values: () => values })
      : version,
  )

/** Removes a saved version. The base version cannot be removed. */
export const removeVersion = (
  versions: ReadonlyArray<Version>,
  versionId: string,
): ReadonlyArray<Version> =>
  Array.filter(
    versions,
    version => version.id === BASE_VERSION_ID || version.id !== versionId,
  )

/** The number the next saved version takes: one more than the highest
 *  version number present, so a deleted number is never reused. */
export const nextVersionNumber = (versions: ReadonlyArray<Version>): number =>
  pipe(
    versions,
    Array.map(({ id }) => Number.parse(id.slice(VERSION_ID_PREFIX.length))),
    Array.getSomes,
    Array.filter(globalThis.Number.isFinite),
    Array.reduce(BASE_VERSION_NUMBER, Number.max),
    Number.increment,
  )
