import { Array, Match, Option, Predicate, pipe } from 'effect'

import {
  type Control,
  type DialMeta,
  type DialOption,
  type OptionInput,
  type Shortcut,
  formatLabel,
  getAtPath,
} from '../dial/index.js'
import { formatStepValue } from '../internal/range.js'
import { Transition, isTransition } from '../transition/index.js'

const INDENT = '  '
const MAX_FRACTION_DIGITS = 4
const DATA_URL_PREFIX = 'data:'

const formatNumber = (value: number): string =>
  Number(value.toFixed(MAX_FRACTION_DIGITS)).toString()

const quote = (text: string): string =>
  `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`

const formatStringValue = (value: unknown): string =>
  Predicate.isString(value) ? quote(value) : quote('')

const formatShortcut = (shortcut: Shortcut): string =>
  pipe(
    [
      Option.map(
        Option.fromNullishOr(shortcut.key),
        key => `key: ${quote(key)}`,
      ),
      Option.map(
        Option.fromNullishOr(shortcut.modifier),
        modifier => `modifier: ${quote(modifier)}`,
      ),
      Option.map(
        Option.fromNullishOr(shortcut.interaction),
        interaction => `interaction: ${quote(interaction)}`,
      ),
      Option.map(
        Option.fromNullishOr(shortcut.mode),
        mode => `mode: ${quote(mode)}`,
      ),
    ],
    Array.getSomes,
    Array.join(', '),
    fields => `{ ${fields} }`,
  )

const formatOption = ({ value, label }: DialOption): string =>
  label === formatLabel(value)
    ? quote(value)
    : `{ value: ${quote(value)}, label: ${quote(label)} }`

const formatOptions = (options: ReadonlyArray<DialOption>): string =>
  `[${Array.join(Array.map(options, formatOption), ', ')}]`

const formatImageOption = (option: OptionInput): string =>
  Predicate.isString(option)
    ? quote(option)
    : `{ value: ${quote(option.value)}, label: ${quote(option.label)} }`

const formatImageOptions = (options: ReadonlyArray<OptionInput>): string =>
  `[${Array.join(Array.map(options, formatImageOption), ', ')}]`

const formatImageDefault = (value: unknown): string =>
  Predicate.isString(value) && value.startsWith(DATA_URL_PREFIX)
    ? `'' /* uploaded image omitted */`
    : formatStringValue(value)

const formatTransition = (value: unknown, fallback: Transition): string => {
  const transition = isTransition(value) ? value : fallback
  return Transition.match<string>(transition, {
    TimeSpring: ({ visualDuration, bounce }) =>
      `Dial.spring({ visualDuration: ${formatNumber(visualDuration)}, bounce: ${formatNumber(bounce)} })`,
    PhysicsSpring: ({ stiffness, damping, mass }) =>
      `Dial.spring({ stiffness: ${formatNumber(stiffness)}, damping: ${formatNumber(damping)}, mass: ${formatNumber(mass)} })`,
    Easing: ({ duration, ease }) =>
      `Dial.easing({ duration: ${formatNumber(duration)}, ease: [${Array.join(Array.map(ease, formatNumber), ', ')}] })`,
  })
}

const numberOr = (value: unknown, fallback: number): number =>
  Predicate.isNumber(value) ? value : fallback

const formatLeaf = (
  meta: Exclude<DialMeta, { _tag: 'Folder' }>,
  value: unknown,
): string =>
  Match.value(meta).pipe(
    Match.withReturnType<string>(),
    Match.tagsExhaustive({
      Slider: slider => {
        const shortcut = Option.match(slider.maybeShortcut, {
          onNone: () => '',
          onSome: assigned => `, shortcut: ${formatShortcut(assigned)}`,
        })
        return `Dial.slider({ default: ${formatStepValue(numberOr(value, slider.default), slider.step)}, min: ${formatNumber(slider.min)}, max: ${formatNumber(slider.max)}, step: ${formatNumber(slider.step)}${shortcut} })`
      },
      Toggle: toggle => {
        const isOn = Predicate.isBoolean(value) ? value : toggle.default
        return Option.match(toggle.maybeShortcut, {
          onNone: () => `Dial.toggle(${isOn})`,
          onSome: assigned =>
            `Dial.toggle(${isOn}, { shortcut: ${formatShortcut(assigned)} })`,
        })
      },
      Text: text =>
        text.placeholder === ''
          ? `Dial.text(${formatStringValue(value)})`
          : `Dial.text(${formatStringValue(value)}, { placeholder: ${quote(text.placeholder)} })`,
      Select: select =>
        `Dial.select(${formatOptions(select.options)}, { default: ${formatStringValue(value)} })`,
      Color: () => `Dial.color(${formatStringValue(value)})`,
      Image: image =>
        `Dial.image({ options: ${formatImageOptions(image.options)}, default: ${formatImageDefault(value)} })`,
      Pad: pad => {
        const x = numberOr(getAtPath(value, ['x']), pad.x.default)
        const y = numberOr(getAtPath(value, ['y']), pad.y.default)
        return `Dial.pad({ x: [${formatNumber(x)}, ${formatNumber(pad.x.min)}, ${formatNumber(pad.x.max)}, ${formatNumber(pad.x.step)}], y: [${formatNumber(y)}, ${formatNumber(pad.y.min)}, ${formatNumber(pad.y.max)}, ${formatNumber(pad.y.step)}], labels: { x: ${quote(pad.labels.x)}, y: ${quote(pad.labels.y)} } })`
      },
      Transition: transition => formatTransition(value, transition.default),
      Action: action =>
        action.label === ''
          ? 'Dial.action()'
          : `Dial.action(${quote(action.label)})`,
    }),
  )

const lastKey = (control: Control): string =>
  Option.getOrElse(Array.last(control.path), () => '')

const formatFields = (
  controls: ReadonlyArray<Control>,
  values: unknown,
  depth: number,
): string => {
  const indent = INDENT.repeat(depth)
  return pipe(
    controls,
    Array.map(
      control =>
        `${indent}${lastKey(control)}: ${formatControl(control, values, depth)},`,
    ),
    Array.join('\n'),
  )
}

const formatControl = (
  control: Control,
  values: unknown,
  depth: number,
): string => {
  if (control._tag === 'Leaf') {
    return formatLeaf(control.meta, getAtPath(values, control.path))
  } else {
    const options = control.isCollapsed ? ', { isCollapsed: true }' : ''
    return `Dial.folder({\n${formatFields(control.children, values, depth + 1)}\n${INDENT.repeat(depth)}}${options})`
  }
}

/** The dial Schema rewritten with the current values as its defaults, ready
 *  to paste over the original `Schema.Struct`. This is what the panel's Copy
 *  button puts on the clipboard. */
export const toDialSource = (
  name: string,
  controls: ReadonlyArray<Control>,
  values: unknown,
): string =>
  Array.join(
    [
      `// ${name}: tuned with foldkit-dials. Paste over your dial Schema.`,
      'Schema.Struct({',
      formatFields(controls, values, 1),
      '})',
    ],
    '\n',
  )
