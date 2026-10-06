import {
  Array,
  Effect,
  Match,
  Option,
  Predicate,
  Record,
  Schema,
  String,
  pipe,
} from 'effect'

import { isColorString } from '../color/parse.js'
import {
  formatStepValue,
  roundToStepPrecision,
  snapAndClamp,
} from '../internal/range.js'
import { type CubicBezier, Transition } from '../transition/index.js'

// SHORTCUTS

/** How a held shortcut key adjusts a slider: scrolling, dragging, or moving
 *  the pointer. `ScrollOnly` needs no key. */
export const ShortcutInteraction = Schema.Literals([
  'Scroll',
  'Drag',
  'Move',
  'ScrollOnly',
])
export type ShortcutInteraction = typeof ShortcutInteraction.Type

/** The step a shortcut uses: the slider's own step (`Normal`), 1% of its
 *  range (`Fine`), or 10% of its range (`Coarse`). */
export const ShortcutMode = Schema.Literals(['Fine', 'Normal', 'Coarse'])
export type ShortcutMode = typeof ShortcutMode.Type

/** A modifier that must be held with a shortcut key. */
export const ShortcutModifier = Schema.Literals(['Alt', 'Shift', 'Meta'])
export type ShortcutModifier = typeof ShortcutModifier.Type

/** A keyboard shortcut assigned to a slider or toggle. */
export type Shortcut = Readonly<{
  key?: string
  modifier?: ShortcutModifier
  interaction?: ShortcutInteraction
  mode?: ShortcutMode
}>

// META

/** One choice in a select or image dial. */
export type DialOption = Readonly<{ value: string; label: string }>

/** One axis of a pad dial. */
export type PadAxis = Readonly<{
  min: number
  max: number
  step: number
  default: number
}>

/** The metadata a dial Schema carries in its `dial` annotation. The panel
 *  reads it to render the control. */
export type DialMeta =
  | Readonly<{
      _tag: 'Slider'
      min: number
      max: number
      step: number
      default: number
      maybeShortcut: Option.Option<Shortcut>
    }>
  | Readonly<{
      _tag: 'Toggle'
      default: boolean
      maybeShortcut: Option.Option<Shortcut>
    }>
  | Readonly<{ _tag: 'Text'; default: string; placeholder: string }>
  | Readonly<{
      _tag: 'Select'
      options: ReadonlyArray<DialOption>
      default: string
    }>
  | Readonly<{ _tag: 'Color'; default: string }>
  | Readonly<{
      _tag: 'Image'
      options: ReadonlyArray<OptionInput>
      default: string
    }>
  | Readonly<{
      _tag: 'Pad'
      x: PadAxis
      y: PadAxis
      labels: Readonly<{ x: string; y: string }>
    }>
  | Readonly<{ _tag: 'Transition'; default: Transition }>
  | Readonly<{ _tag: 'Action'; label: string }>
  | Readonly<{
      _tag: 'Folder'
      isCollapsed: boolean
      fields: Schema.Struct.Fields
    }>

declare module 'effect/Schema' {
  namespace Annotations {
    interface Annotations {
      readonly dial?: DialMeta | undefined
    }
  }
}

// LENIENT DECODING

const lenient = <S extends Schema.Top>(schema: S, defaultValue: S['Type']) => {
  const recovered = Schema.catchDecoding<S>(() =>
    Effect.succeed(Option.some(defaultValue)),
  )(schema)
  // NOTE: the default is a Type value on purpose. `withDecodingDefaultKey`
  // first decodes a stored value against the encoded side, which checks a
  // pad's or folder's fields without their own fallbacks. One bad field would
  // then replace or reject the whole group.
  return Schema.withDecodingDefaultTypeKey<typeof recovered>(
    Effect.succeed(defaultValue),
  )(recovered)
}

// SLIDER

const UNIT_RANGE_STEP = 0.01
const SMALL_RANGE_STEP = 0.1
const MEDIUM_RANGE_STEP = 1
const LARGE_RANGE_STEP = 10
const SMALL_RANGE_LIMIT = 10
const MEDIUM_RANGE_LIMIT = 100
const INFERRED_RANGE_FACTOR = 3

/** The step DialKit infers for a range: 0.01 up to 1, 0.1 up to 10, 1 up to
 *  100, and 10 above that. */
export const inferStep = (min: number, max: number): number => {
  const range = max - min
  if (range <= 1) {
    return UNIT_RANGE_STEP
  } else if (range <= SMALL_RANGE_LIMIT) {
    return SMALL_RANGE_STEP
  } else if (range <= MEDIUM_RANGE_LIMIT) {
    return MEDIUM_RANGE_STEP
  } else {
    return LARGE_RANGE_STEP
  }
}

/** Configuration for `slider`. `step` defaults to `inferStep(min, max)`. */
export type SliderConfig = Readonly<{
  default: number
  min: number
  max: number
  step?: number
  shortcut?: Shortcut | undefined
}>

/** A number dial with a range. Its Schema rejects values outside
 *  `[min, max]`, and decodes a missing or invalid stored value as the
 *  default. */
export const slider = (config: SliderConfig) => {
  const step = config.step ?? inferStep(config.min, config.max)
  const defaultValue = snapAndClamp(
    config.default,
    config.min,
    config.max,
    step,
  )
  return lenient(
    Schema.Number.check(
      Schema.isBetween({ minimum: config.min, maximum: config.max }),
    ),
    defaultValue,
  ).annotate({
    dial: {
      _tag: 'Slider',
      min: config.min,
      max: config.max,
      step,
      default: defaultValue,
      maybeShortcut: Option.fromNullishOr(config.shortcut),
    },
  })
}

const inferredMax = (value: number): number => {
  if (value < 0) {
    return -value * INFERRED_RANGE_FACTOR
  } else if (value <= 1) {
    return 1
  } else {
    return value * INFERRED_RANGE_FACTOR
  }
}

/** A slider whose range and step are inferred from its starting value, the
 *  way DialKit treats a bare number: 0 to 1 for a value up to 1, and 0 to
 *  three times the value above that. A negative value ranges from three
 *  times itself to its opposite. */
export const number = (
  value: number,
  options: { readonly shortcut?: Shortcut } = {},
) => {
  const isNegative = value < 0
  const min = isNegative ? value * INFERRED_RANGE_FACTOR : 0
  const step = isNegative
    ? MEDIUM_RANGE_STEP
    : inferStep(0, value <= 1 ? 1 : value)
  const max = roundToStepPrecision(inferredMax(value), step)
  return slider({
    default: value,
    min: roundToStepPrecision(min, step),
    max,
    step,
    shortcut: options.shortcut,
  })
}

// TOGGLE

/** A boolean dial, shown as an Off and On segmented control. */
export const toggle = (
  defaultValue: boolean,
  options: { readonly shortcut?: Shortcut } = {},
) =>
  lenient(Schema.Boolean, defaultValue).annotate({
    dial: {
      _tag: 'Toggle',
      default: defaultValue,
      maybeShortcut: Option.fromNullishOr(options.shortcut),
    },
  })

// TEXT

/** A free-text dial. The field grows up to five lines and then scrolls. */
export const text = (
  defaultValue: string,
  options: { readonly placeholder?: string } = {},
) =>
  lenient(Schema.String, defaultValue).annotate({
    dial: {
      _tag: 'Text',
      default: defaultValue,
      placeholder: options.placeholder ?? '',
    },
  })

// SELECT

/** A select or image choice: a bare string, or a value with a label. */
export type OptionInput = string | DialOption

type OptionValue<Input> = Input extends string
  ? Input
  : Input extends { readonly value: infer Value extends string }
    ? Value
    : never

const toDialOption = (input: OptionInput): DialOption =>
  Predicate.isString(input)
    ? { value: input, label: String.capitalize(input) }
    : input

/** A dial that picks one of `options`. Its value type is the union of the
 *  option values, and the default is the first option unless given. */
export const select = <
  const Options extends readonly [OptionInput, ...ReadonlyArray<OptionInput>],
>(
  options: Options,
  config: { readonly default?: OptionValue<Options[number]> } = {},
) => {
  const dialOptions = Array.map(options, toDialOption)
  // NOTE: mapping a non-empty tuple loses its literal element types, so the
  // option values are restated as the non-empty tuple `Schema.Literals` needs.
  /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
  const values = Array.map(
    dialOptions,
    ({ value }) => value,
  ) as unknown as readonly [
    OptionValue<Options[number]>,
    ...ReadonlyArray<OptionValue<Options[number]>>,
  ]
  const defaultValue = config.default ?? Array.headNonEmpty(values)
  return lenient(Schema.Literals(values), defaultValue).annotate({
    dial: { _tag: 'Select', options: dialOptions, default: defaultValue },
  })
}

// COLOR

/** A colour dial. Accepts hex (3, 4, 6 or 8 digits), `rgb()`, `hsl()`,
 *  `oklch()`, and `color(display-p3 …)` strings, and `transparent`. */
export const color = (defaultValue: string) =>
  lenient(
    Schema.String.check(
      Schema.makeFilter(isColorString, { expected: 'a CSS colour' }),
    ),
    defaultValue,
  ).annotate({ dial: { _tag: 'Color', default: defaultValue } })

// IMAGE

/** Configuration for `image`. With no `default`, the first option is
 *  selected, or the empty string when there are no options. */
export type ImageConfig = Readonly<{
  options?: ReadonlyArray<OptionInput>
  default?: string
}>

/** An image dial. Its value is an image URL, a data URL for an uploaded
 *  image, or the empty string when no image is chosen. */
export const image = (config: ImageConfig = {}) => {
  const options = config.options ?? []
  const defaultValue =
    config.default ??
    Option.match(Array.head(options), {
      onNone: () => '',
      onSome: option => toDialOption(option).value,
    })
  return lenient(Schema.String, defaultValue).annotate({
    dial: { _tag: 'Image', options, default: defaultValue },
  })
}

// PAD

/** One pad axis as `[default, min, max, step?]`. Without a step, the range
 *  is divided into 200 intervals. */
export type PadAxisInput = readonly [number, number, number, number?]

const PAD_AXIS_INTERVALS = 200
const DEFAULT_PAD_AXIS: PadAxisInput = [0, -1, 1, 0.01]

const toPadAxis = ([
  defaultValue,
  min,
  max,
  step = (max - min) / PAD_AXIS_INTERVALS,
]: PadAxisInput): PadAxis => ({
  min,
  max,
  step,
  default: snapAndClamp(defaultValue, min, max, step),
})

/** Configuration for `pad`. Each axis defaults to `[0, -1, 1, 0.01]`. */
export type PadConfig = Readonly<{
  x?: PadAxisInput
  y?: PadAxisInput
  labels?: Readonly<{ x?: string; y?: string }>
}>

const padAxisSchema = (axis: PadAxis) =>
  lenient(
    Schema.Number.check(
      Schema.isBetween({ minimum: axis.min, maximum: axis.max }),
    ),
    axis.default,
  )

/** A two-dimensional dial whose value is `{ x, y }`. X increases to the
 *  right and Y increases upward. */
export const pad = (config: PadConfig = {}) => {
  const x = toPadAxis(config.x ?? DEFAULT_PAD_AXIS)
  const y = toPadAxis(config.y ?? DEFAULT_PAD_AXIS)
  return lenient(Schema.Struct({ x: padAxisSchema(x), y: padAxisSchema(y) }), {
    x: x.default,
    y: y.default,
  }).annotate({
    dial: {
      _tag: 'Pad',
      x,
      y,
      labels: { x: config.labels?.x ?? 'X', y: config.labels?.y ?? 'Y' },
    },
  })
}

// TRANSITION

const transitionDial = (defaultValue: Transition) =>
  lenient(Transition, defaultValue).annotate({
    dial: { _tag: 'Transition', default: defaultValue },
  })

/** A spring dial. Pass `{ visualDuration, bounce }` for a time spring or
 *  `{ stiffness, damping, mass }` for a physics spring. The editor can switch
 *  to the other spring mode or to an easing, so the value is a
 *  `Transition`. */
export const spring = (
  config:
    | Readonly<{ visualDuration: number; bounce: number }>
    | Readonly<{ stiffness: number; damping: number; mass?: number }>,
) =>
  transitionDial(
    'stiffness' in config
      ? Transition.PhysicsSpring({
          stiffness: config.stiffness,
          damping: config.damping,
          mass: config.mass ?? 1,
        })
      : Transition.TimeSpring(config),
  )

const DEFAULT_EASE: CubicBezier = [0.25, 0.1, 0.25, 1]

/** An easing dial with a duration in seconds and a cubic Bézier curve. The
 *  editor can switch to a spring, so the value is a `Transition`. */
export const easing = (
  config: Readonly<{ duration: number; ease?: CubicBezier }>,
) =>
  transitionDial(
    Transition.Easing({
      duration: config.duration,
      ease: config.ease ?? DEFAULT_EASE,
    }),
  )

// ACTION

/** A button in the panel. It is not a value: pressing it makes the panel
 *  report `ClickedAction` with the action's path. */
export const action = (label?: string) =>
  Schema.optionalKey(
    Schema.Never.annotate({ dial: { _tag: 'Action', label: label ?? '' } }),
  )

// FOLDER

/** A collapsible group of dials. Its value is the record of its fields. A
 *  missing stored value, or one that is not a record, decodes as every
 *  field's default, and each field falls back on its own. Throws when a
 *  field's default does not satisfy its own dial Schema. */
export const folder = <const Fields extends DialFields>(
  fields: Fields,
  options: { readonly isCollapsed?: boolean } = {},
) => {
  const struct = Schema.Struct(fields)
  return lenient(struct, Schema.decodeUnknownSync(struct)({})).annotate({
    dial: {
      _tag: 'Folder',
      isCollapsed: options.isCollapsed ?? false,
      fields,
    },
  })
}

// READING A DIAL SCHEMA

/** The fields of a dial Schema. Every dial decodes and encodes without
 *  services, which lets the panel decode stored values for any dial Schema. */
export type DialFields = Readonly<
  Record<
    string,
    Schema.Top & {
      readonly DecodingServices: never
      readonly EncodingServices: never
    }
  >
>

/** A dial value's position in the values record, such as `['shadow', 'blur']`. */
export type Path = ReadonlyArray<string>

/** Joins a path with dots, the form DialKit uses: `shadow.blur`. */
export const pathKey = (path: Path): string => Array.join(path, '.')

/** Splits a dotted key back into a path. */
export const keyPath = (key: string): Path => key.split('.')

/** A dial leaf: any control except a folder. */
export type LeafMeta = Exclude<DialMeta, { _tag: 'Folder' }>

/** The control tree the panel renders, in declaration order. */
export type Control =
  | Readonly<{ _tag: 'Leaf'; path: Path; label: string; meta: LeafMeta }>
  | Readonly<{
      _tag: 'Folder'
      path: Path
      label: string
      isCollapsed: boolean
      children: ReadonlyArray<Control>
    }>

/** A leaf control. */
export type LeafControl = Extract<Control, { _tag: 'Leaf' }>

const CAMEL_CASE_BOUNDARY = /([a-z0-9])([A-Z])/g

/** Turns a camelCase key into words: `shadowBlur` becomes `Shadow Blur`. */
export const formatLabel = (key: string): string =>
  pipe(key, String.replace(CAMEL_CASE_BOUNDARY, '$1 $2'), String.capitalize)

const resolveDialMeta = (schema: Schema.Constraint): Option.Option<DialMeta> =>
  Option.fromNullishOr(Schema.resolveAnnotations(schema)?.dial)

const controlOf = (
  key: string,
  schema: Schema.Constraint,
  parentPath: Path,
): Option.Option<Control> => {
  const path = Array.append(parentPath, key)
  const maybeTitle = Option.fromNullishOr(
    Schema.resolveAnnotations(schema)?.title,
  )
  const label = Option.getOrElse(maybeTitle, () => formatLabel(key))

  return Option.map(resolveDialMeta(schema), (meta): Control =>
    meta._tag === 'Folder'
      ? {
          _tag: 'Folder',
          path,
          label,
          isCollapsed: meta.isCollapsed,
          children: controlsOfFields(meta.fields, path),
        }
      : {
          _tag: 'Leaf',
          path,
          label:
            meta._tag === 'Action' && meta.label !== '' ? meta.label : label,
          meta,
        },
  )
}

const controlsOfFields = (
  fields: Schema.Struct.Fields,
  parentPath: Path,
): ReadonlyArray<Control> =>
  pipe(
    Record.toEntries(fields),
    Array.map(([key, schema]) => controlOf(key, schema, parentPath)),
    Array.getSomes,
  )

/** The control tree of a dial Schema, in declaration order. Fields without
 *  a `dial` annotation are skipped. */
export const controlsOf = (
  schema: Schema.Struct<Schema.Struct.Fields>,
): ReadonlyArray<Control> => controlsOfFields(schema.fields, [])

/** Every leaf control in the tree, depth first. */
export const leavesOf = (
  controls: ReadonlyArray<Control>,
): ReadonlyArray<LeafControl> =>
  Array.flatMap(controls, control =>
    control._tag === 'Leaf' ? [control] : leavesOf(control.children),
  )

/** Finds a leaf by its dotted key. */
export const findLeaf = (
  controls: ReadonlyArray<Control>,
  key: string,
): Option.Option<LeafControl> =>
  Array.findFirst(leavesOf(controls), leaf => pathKey(leaf.path) === key)

const defaultOfMeta = (meta: DialMeta): Option.Option<unknown> =>
  Match.value(meta).pipe(
    Match.withReturnType<Option.Option<unknown>>(),
    Match.tagsExhaustive({
      Slider: ({ default: value }) => Option.some(value),
      Toggle: ({ default: value }) => Option.some(value),
      Text: ({ default: value }) => Option.some(value),
      Select: ({ default: value }) => Option.some(value),
      Color: ({ default: value }) => Option.some(value),
      Image: ({ default: value }) => Option.some(value),
      Pad: ({ x, y }) => Option.some({ x: x.default, y: y.default }),
      Transition: ({ default: value }) => Option.some(value),
      Action: () => Option.none(),
      Folder: ({ fields }) => Option.some(defaultsOfFields(fields)),
    }),
  )

const defaultsOfFields = (
  fields: Schema.Struct.Fields,
): Record<string, unknown> =>
  pipe(
    Record.toEntries(fields),
    Array.map(([key, schema]) =>
      pipe(
        resolveDialMeta(schema),
        Option.flatMap(defaultOfMeta),
        Option.map(value => [key, value] as const),
      ),
    ),
    Array.getSomes,
    Record.fromEntries,
  )

/** The values a dial Schema starts with: every dial's default. Use these to
 *  ship without the panel. Throws when a default is outside its own dial's
 *  range, which is a mistake in the dial definition. */
export const defaults = <Fields extends Schema.Struct.Fields>(
  schema: Schema.Struct<Fields>,
): Schema.Struct<Fields>['Type'] => {
  const values = defaultsOfFields(schema.fields)
  if (Schema.is(schema)(values)) {
    return values
  } else {
    throw new Error(
      'A dial default does not satisfy its own dial Schema. Check each default against its range, options, or colour syntax.',
    )
  }
}

// PATHS

/** Reads the value at a path. */
export const getAtPath = (values: unknown, path: Path): unknown =>
  Array.reduce(path, values, (current: unknown, key) =>
    Predicate.isObject(current) ? current[key] : undefined,
  )

/** Returns a copy of `values` with the value at `path` replaced. */
export const setAtPath = (
  values: unknown,
  path: Path,
  next: unknown,
): unknown =>
  Array.match(path, {
    onEmpty: () => next,
    onNonEmpty: ([key, ...rest]) => {
      const record: Readonly<Record<string, unknown>> = Predicate.isObject(
        values,
      )
        ? values
        : {}
      return Record.set(
        record,
        key,
        setAtPath(getAtPath(record, [key]), rest, next),
      )
    },
  })

/** A slider value formatted with as many decimals as its step has. */
export const formatSliderValue = (
  value: number,
  meta: Extract<DialMeta, { _tag: 'Slider' }>,
): string => formatStepValue(value, meta.step)
