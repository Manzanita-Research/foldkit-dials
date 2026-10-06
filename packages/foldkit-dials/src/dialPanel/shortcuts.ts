import { Array, Equal, Match, Option, String, pipe } from 'effect'

import {
  type DialMeta,
  type LeafControl,
  type Shortcut,
  type ShortcutInteraction,
  type ShortcutModifier,
  pathKey,
} from '../dial/index.js'
import { clamp, roundToStepPrecision } from '../internal/range.js'

type SliderMeta = Extract<DialMeta, { _tag: 'Slider' }>
type ToggleMeta = Extract<DialMeta, { _tag: 'Toggle' }>

/** A slider with an assigned shortcut. */
export type SliderShortcutTarget = Readonly<{
  _tag: 'Slider'
  key: string
  label: string
  meta: SliderMeta
  shortcut: Shortcut
}>

/** A dial with an assigned shortcut. */
export type ShortcutTarget =
  | SliderShortcutTarget
  | Readonly<{
      _tag: 'Toggle'
      key: string
      label: string
      meta: ToggleMeta
      shortcut: Shortcut
    }>

const FINE_FRACTION = 0.01
const COARSE_FRACTION = 0.1
const LETTER_CODE = /^Key([A-Z])$/
const DIGIT_CODE = /^Digit([0-9])$/
const LETTER_OR_DIGIT_KEY = /^[a-z0-9]$/i

/** Pixels of horizontal pointer travel per shortcut step, as in DialKit. */
export const DRAG_PIXELS_PER_STEP = 4

/** Every slider and toggle that has a shortcut, in panel order. */
export const shortcutTargetsOf = (
  leaves: ReadonlyArray<LeafControl>,
): ReadonlyArray<ShortcutTarget> =>
  pipe(leaves, Array.map(shortcutTargetOf), Array.getSomes)

const shortcutTargetOf = ({
  path,
  label,
  meta,
}: LeafControl): Option.Option<ShortcutTarget> =>
  Match.value(meta).pipe(
    Match.withReturnType<Option.Option<ShortcutTarget>>(),
    Match.tag('Slider', sliderMeta =>
      Option.map(sliderMeta.maybeShortcut, shortcut => ({
        _tag: 'Slider',
        key: pathKey(path),
        label,
        meta: sliderMeta,
        shortcut,
      })),
    ),
    Match.tag('Toggle', toggleMeta =>
      Option.map(toggleMeta.maybeShortcut, shortcut => ({
        _tag: 'Toggle',
        key: pathKey(path),
        label,
        meta: toggleMeta,
        shortcut,
      })),
    ),
    Match.orElse(() => Option.none()),
  )

/** Whether a shortcut target is a slider. */
export const isSliderTarget = (
  target: ShortcutTarget,
): target is SliderShortcutTarget => target._tag === 'Slider'

/** The interaction a slider shortcut uses, defaulting to `Scroll`. */
export const interactionOf = (shortcut: Shortcut): ShortcutInteraction =>
  shortcut.interaction ?? 'Scroll'

/** The modifier held with a keyboard event, checked in DialKit's order. */
export const modifierOf = (
  modifiers: Readonly<{ altKey: boolean; shiftKey: boolean; metaKey: boolean }>,
): Option.Option<ShortcutModifier> => {
  if (modifiers.altKey) {
    return Option.some('Alt')
  } else if (modifiers.shiftKey) {
    return Option.some('Shift')
  } else if (modifiers.metaKey) {
    return Option.some('Meta')
  } else {
    return Option.none()
  }
}

const codeKey = (code: string): Option.Option<string> =>
  pipe(
    Option.fromNullishOr(LETTER_CODE.exec(code) ?? DIGIT_CODE.exec(code)),
    Option.flatMap(match => Array.get(match, 1)),
  )

// NOTE: the typed `key` respects the user's layout, so it names the key on
// Dvorak or AZERTY. A held Alt or Shift can turn it into a symbol (Option+R
// gives `®` on macOS, Shift+1 gives `!`), and only then is the key read
// from `code`, the key's QWERTY position.
/** The lowercase shortcut key a keyboard event names: its typed `key`, or,
 *  when Alt or Shift turned that into a symbol, the letter or digit of its
 *  `code`. */
export const shortcutKeyOf = (
  event: Readonly<{
    code: string
    key: string
    altKey: boolean
    shiftKey: boolean
  }>,
): string => {
  const isKeyAltered =
    (event.altKey || event.shiftKey) && !LETTER_OR_DIGIT_KEY.test(event.key)
  return String.toLowerCase(
    isKeyAltered
      ? Option.getOrElse(codeKey(event.code), () => event.key)
      : event.key,
  )
}

/** The target a held key (and modifier) triggers, if any. Keys compare
 *  case-insensitively. */
export const findShortcutTarget = (
  targets: ReadonlyArray<ShortcutTarget>,
  key: string,
  maybeModifier: Option.Option<ShortcutModifier>,
): Option.Option<ShortcutTarget> =>
  Array.findFirst(
    targets,
    ({ shortcut }) =>
      Option.contains(
        Option.map(Option.fromNullishOr(shortcut.key), String.toLowerCase),
        String.toLowerCase(key),
      ) && Equal.equals(maybeModifier, Option.fromNullishOr(shortcut.modifier)),
  )

/** Whether a key is any target's shortcut key, with or without its
 *  modifier. */
export const isShortcutKey = (
  targets: ReadonlyArray<ShortcutTarget>,
  key: string,
): boolean =>
  Array.some(targets, ({ shortcut }) =>
    Option.contains(
      Option.map(Option.fromNullishOr(shortcut.key), String.toLowerCase),
      String.toLowerCase(key),
    ),
  )

/** Slider targets that react to scrolling with no key held. */
export const scrollOnlyTargets = (
  targets: ReadonlyArray<ShortcutTarget>,
): ReadonlyArray<SliderShortcutTarget> =>
  pipe(
    targets,
    Array.filter(isSliderTarget),
    Array.filter(target => interactionOf(target.shortcut) === 'ScrollOnly'),
  )

/** The step a shortcut moves a slider by: 1% of the range for `Fine`, 10%
 *  for `Coarse`, and the slider's own step for `Normal`. */
export const effectiveStep = (meta: SliderMeta, shortcut: Shortcut): number =>
  Match.value(shortcut.mode ?? 'Normal').pipe(
    Match.withReturnType<number>(),
    Match.when('Fine', () => (meta.max - meta.min) * FINE_FRACTION),
    Match.when('Coarse', () => (meta.max - meta.min) * COARSE_FRACTION),
    Match.when('Normal', () => meta.step),
    Match.exhaustive,
  )

/** Moves a slider value by `steps` shortcut steps, clamped to its range and
 *  rounded to the finer of the slider step and the shortcut step. */
export const applyShortcutSteps = (
  value: number,
  meta: SliderMeta,
  shortcut: Shortcut,
  steps: number,
): number => {
  const step = effectiveStep(meta, shortcut)
  const precisionStep = Math.min(step, meta.step)
  return roundToStepPrecision(
    clamp(value + steps * step, meta.min, meta.max),
    precisionStep,
  )
}

const modifierSymbol = (modifier: ShortcutModifier | undefined): string =>
  Match.value(modifier).pipe(
    Match.withReturnType<string>(),
    Match.when('Alt', () => '⌥'),
    Match.when('Shift', () => '⇧'),
    Match.when('Meta', () => '⌘'),
    Match.orElse(() => ''),
  )

/** The word DialKit shows for a slider shortcut's interaction. */
export const formatInteraction = (interaction: ShortcutInteraction): string =>
  Match.value(interaction).pipe(
    Match.withReturnType<string>(),
    Match.when('Drag', () => 'Drag'),
    Match.when('Move', () => 'Move'),
    Match.orElse(() => 'Scroll'),
  )

/** The word the shortcuts menu shows for how a target is used: `Press` for a
 *  toggle, and the interaction for a slider. */
export const formatTargetMode = (target: ShortcutTarget): string =>
  isSliderTarget(target)
    ? formatInteraction(interactionOf(target.shortcut))
    : 'Press'

/** The badge a shortcut shows on its control, such as `⌥R+Scroll`. */
export const formatShortcutBadge = (target: ShortcutTarget): string => {
  const { shortcut } = target
  const maybeKeyLabel = Option.map(
    Option.fromNullishOr(shortcut.key),
    key => `${modifierSymbol(shortcut.modifier)}${String.toUpperCase(key)}`,
  )
  if (isSliderTarget(target)) {
    const interactionLabel = formatInteraction(interactionOf(shortcut))
    return Option.match(maybeKeyLabel, {
      onNone: () => interactionLabel,
      onSome: label => `${label}+${interactionLabel}`,
    })
  } else {
    return Option.getOrElse(maybeKeyLabel, () => 'Press')
  }
}
