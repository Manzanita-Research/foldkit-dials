// NOTE: the parser is ported from DialKit's `parseColor` in `src/color.ts`
// (https://github.com/joshpuckett/dialkit, MIT License, Copyright (c) 2026
// Josh Puckett).

import { Array, Equal, Match, Number, Option, String, pipe } from 'effect'

import { PERCENT, clamp } from '../internal/range.js'
import {
  type Color,
  type ColorFormat,
  DEGREES_PER_TURN,
  type RgbChannels,
  colorFromRgb,
  wrapHue,
} from './index.js'

// PARSE

const TRANSPARENT_KEYWORD = 'transparent'
const TRANSPARENT: Color = { lightness: 0, chroma: 0, hue: 0, alpha: 0 }

const SHORT_HEX_PATTERN = /^#[\da-f]{3,4}$/
const HEX_BYTES_PATTERN =
  /^#(?<red>[\da-f]{2})(?<green>[\da-f]{2})(?<blue>[\da-f]{2})(?<alpha>[\da-f]{2})?$/
const COLOR_FUNCTION_PATTERN =
  /^(?<name>oklch|rgba?|hsla?|color)\((?<body>[^()]*)\)$/
const DISPLAY_P3_BODY_PATTERN = /^display-p3\s+(?<channels>.+)$/
const LEGACY_ARGUMENTS_PATTERN =
  /^(?<first>[^\s,/]+)\s*,\s*(?<second>[^\s,/]+)\s*,\s*(?<third>[^\s,/]+)(?:\s*,\s*(?<alpha>[^\s,/]+))?$/
const MODERN_ARGUMENTS_PATTERN =
  /^(?<first>[^\s,/]+)\s+(?<second>[^\s,/]+)\s+(?<third>[^\s,/]+)(?:\s*\/\s*(?<alpha>[^\s,/]+))?$/
const NUMBER_PATTERN =
  /^(?<amount>[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(?<unit>%|deg|grad|rad|turn)?$/

const PERCENT_UNIT = '%'
const BYTE_MAX = 255
const HEX_RADIX = 16
const OKLCH_CHROMA_AT_FULL_PERCENT = 0.4
const DEGREES_PER_RADIAN = 180 / Math.PI
const DEGREES_PER_GRADIAN = 0.9

const HSL_DEGREES_PER_SECTOR = 30
const HSL_SECTOR_COUNT = 12
const HSL_RED_OFFSET = 0
const HSL_GREEN_OFFSET = 8
const HSL_BLUE_OFFSET = 4
const HSL_RAMP_START = 3
const HSL_RAMP_END = 9

type Groups = Readonly<Record<string, string | undefined>>

type FunctionArguments = Readonly<{
  channels: readonly [string, string, string]
  maybeAlpha: Option.Option<string>
  isLegacy: boolean
}>

type NumberToken = Readonly<{
  amount: number
  maybeUnit: Option.Option<string>
}>

const matchGroups =
  (pattern: RegExp) =>
  (text: string): Option.Option<Groups> =>
    pipe(
      text,
      String.match(pattern),
      Option.flatMap(match => Option.fromNullishOr(match.groups)),
    )

const parseNumberToken = (text: string): Option.Option<NumberToken> =>
  pipe(
    text,
    matchGroups(NUMBER_PATTERN),
    Option.flatMap(groups =>
      pipe(
        Option.fromNullishOr(groups.amount),
        Option.flatMap(Number.parse),
        Option.filter(globalThis.Number.isFinite),
        Option.map(amount => ({
          amount,
          maybeUnit: Option.fromNullishOr(groups.unit),
        })),
      ),
    ),
  )

const parseNumber = (
  text: string,
  percentReference: number,
): Option.Option<number> =>
  Option.flatMap(parseNumberToken(text), ({ amount, maybeUnit }) =>
    Option.match(maybeUnit, {
      onNone: () => Option.some(amount),
      onSome: unit =>
        Option.as(
          Option.liftPredicate(unit, Equal.equals(PERCENT_UNIT)),
          (amount * percentReference) / PERCENT,
        ),
    }),
  )

const parsePercentage = (text: string): Option.Option<number> =>
  Option.flatMap(parseNumberToken(text), ({ amount, maybeUnit }) =>
    pipe(
      maybeUnit,
      Option.filter(Equal.equals(PERCENT_UNIT)),
      Option.as(amount / PERCENT),
    ),
  )

const parseHue = (text: string): Option.Option<number> =>
  Option.flatMap(parseNumberToken(text), ({ amount, maybeUnit }) =>
    Option.match(maybeUnit, {
      onNone: () => Option.some(amount),
      onSome: unit =>
        Match.value(unit).pipe(
          Match.withReturnType<Option.Option<number>>(),
          Match.when('deg', () => Option.some(amount)),
          Match.when('rad', () => Option.some(amount * DEGREES_PER_RADIAN)),
          Match.when('turn', () => Option.some(amount * DEGREES_PER_TURN)),
          Match.when('grad', () => Option.some(amount * DEGREES_PER_GRADIAN)),
          Match.orElse(() => Option.none()),
        ),
    }),
  )

const parseAlpha = (maybeAlpha: Option.Option<string>): Option.Option<number> =>
  Option.match(maybeAlpha, {
    onNone: () => Option.some(1),
    onSome: text => parseNumber(text, 1),
  })

const argumentsFromGroups =
  (isLegacy: boolean) =>
  (groups: Groups): Option.Option<FunctionArguments> =>
    Option.map(
      Option.all([
        Option.fromNullishOr(groups.first),
        Option.fromNullishOr(groups.second),
        Option.fromNullishOr(groups.third),
      ]),
      channels => ({
        channels,
        maybeAlpha: Option.fromNullishOr(groups.alpha),
        isLegacy,
      }),
    )

const parseArguments = (body: string): Option.Option<FunctionArguments> => {
  const trimmed = String.trim(body)

  return pipe(
    trimmed,
    matchGroups(LEGACY_ARGUMENTS_PATTERN),
    Option.flatMap(argumentsFromGroups(true)),
    Option.orElse(() =>
      pipe(
        trimmed,
        matchGroups(MODERN_ARGUMENTS_PATTERN),
        Option.flatMap(argumentsFromGroups(false)),
      ),
    ),
  )
}

const isModern = ({ isLegacy }: FunctionArguments): boolean => !isLegacy

const isPercentage = String.endsWith(PERCENT_UNIT)

const hasConsistentPercentages = ({
  channels,
  isLegacy,
}: FunctionArguments): boolean =>
  !isLegacy ||
  Array.every(channels, isPercentage) ||
  !Array.some(channels, isPercentage)

const hslToRgb = (
  hue: number,
  saturation: number,
  lightness: number,
): RgbChannels => {
  const clampedLightness = clamp(lightness, 0, 1)
  const amplitude =
    clamp(saturation, 0, 1) * Math.min(clampedLightness, 1 - clampedLightness)
  const channel = (offset: number): number => {
    const sector =
      (offset + wrapHue(hue) / HSL_DEGREES_PER_SECTOR) % HSL_SECTOR_COUNT
    return (
      clampedLightness -
      amplitude *
        Math.max(
          -1,
          Math.min(sector - HSL_RAMP_START, HSL_RAMP_END - sector, 1),
        )
    )
  }

  return [
    channel(HSL_RED_OFFSET),
    channel(HSL_GREEN_OFFSET),
    channel(HSL_BLUE_OFFSET),
  ]
}

const parseOklch = (body: string): Option.Option<Color> =>
  pipe(
    parseArguments(body),
    Option.filter(isModern),
    Option.flatMap(({ channels: [lightness, chroma, hue], maybeAlpha }) =>
      Option.all([
        parseNumber(lightness, 1),
        parseNumber(chroma, OKLCH_CHROMA_AT_FULL_PERCENT),
        parseHue(hue),
        parseAlpha(maybeAlpha),
      ]),
    ),
    Option.map(([lightness, chroma, hue, alpha]) => ({
      lightness: clamp(lightness, 0, 1),
      chroma: Math.max(0, chroma),
      hue: wrapHue(hue),
      alpha: clamp(alpha, 0, 1),
    })),
  )

const parseRgb = (body: string): Option.Option<Color> =>
  pipe(
    parseArguments(body),
    Option.filter(hasConsistentPercentages),
    Option.flatMap(({ channels: [red, green, blue], maybeAlpha }) =>
      Option.all([
        parseNumber(red, BYTE_MAX),
        parseNumber(green, BYTE_MAX),
        parseNumber(blue, BYTE_MAX),
        parseAlpha(maybeAlpha),
      ]),
    ),
    Option.map(([red, green, blue, alpha]) =>
      colorFromRgb(
        [
          clamp(red / BYTE_MAX, 0, 1),
          clamp(green / BYTE_MAX, 0, 1),
          clamp(blue / BYTE_MAX, 0, 1),
        ],
        alpha,
        'Srgb',
      ),
    ),
  )

const parseHsl = (body: string): Option.Option<Color> =>
  pipe(
    parseArguments(body),
    Option.flatMap(({ channels: [hue, saturation, lightness], maybeAlpha }) =>
      Option.all([
        parseHue(hue),
        parsePercentage(saturation),
        parsePercentage(lightness),
        parseAlpha(maybeAlpha),
      ]),
    ),
    Option.map(([hue, saturation, lightness, alpha]) =>
      colorFromRgb(hslToRgb(hue, saturation, lightness), alpha, 'Srgb'),
    ),
  )

const parseDisplayP3 = (body: string): Option.Option<Color> =>
  pipe(
    String.trim(body),
    matchGroups(DISPLAY_P3_BODY_PATTERN),
    Option.flatMap(({ channels }) => Option.fromNullishOr(channels)),
    Option.flatMap(parseArguments),
    Option.filter(isModern),
    Option.flatMap(({ channels: [red, green, blue], maybeAlpha }) =>
      Option.all([
        parseNumber(red, 1),
        parseNumber(green, 1),
        parseNumber(blue, 1),
        parseAlpha(maybeAlpha),
      ]),
    ),
    Option.map(([red, green, blue, alpha]) =>
      colorFromRgb([red, green, blue], alpha, 'DisplayP3'),
    ),
  )

const parseColorFunction = (text: string): Option.Option<Color> =>
  pipe(
    text,
    matchGroups(COLOR_FUNCTION_PATTERN),
    Option.flatMap(({ name, body }) =>
      Option.all([Option.fromNullishOr(name), Option.fromNullishOr(body)]),
    ),
    Option.flatMap(([name, body]) =>
      Match.value(name).pipe(
        Match.withReturnType<Option.Option<Color>>(),
        Match.when('oklch', () => parseOklch(body)),
        Match.whenOr('rgb', 'rgba', () => parseRgb(body)),
        Match.whenOr('hsl', 'hsla', () => parseHsl(body)),
        Match.when('color', () => parseDisplayP3(body)),
        Match.orElse(() => Option.none()),
      ),
    ),
  )

const doubleHexDigits = (text: string): string => {
  const digits = pipe(
    text,
    String.slice(1),
    String.split(''),
    Array.map(digit => `${digit}${digit}`),
    Array.join(''),
  )

  return `#${digits}`
}

const parseHexByte = (digits: string): number =>
  globalThis.Number.parseInt(digits, HEX_RADIX) / BYTE_MAX

const parseHex = (text: string): Option.Option<Color> =>
  pipe(
    SHORT_HEX_PATTERN.test(text) ? doubleHexDigits(text) : text,
    matchGroups(HEX_BYTES_PATTERN),
    Option.flatMap(({ red, green, blue, alpha }) =>
      Option.map(
        Option.all([
          Option.fromNullishOr(red),
          Option.fromNullishOr(green),
          Option.fromNullishOr(blue),
        ]),
        ([redDigits, greenDigits, blueDigits]) =>
          colorFromRgb(
            [
              parseHexByte(redDigits),
              parseHexByte(greenDigits),
              parseHexByte(blueDigits),
            ],
            Option.match(Option.fromNullishOr(alpha), {
              onNone: () => 1,
              onSome: parseHexByte,
            }),
            'Srgb',
          ),
      ),
    ),
  )

/** Parses CSS colour text into a Color. Accepts hex with 3, 4, 6, or 8
 *  digits, `rgb()` and `rgba()`, `hsl()` and `hsla()`, `oklch()`,
 *  `color(display-p3 …)`, and `transparent`, with percentages, angle units,
 *  and alpha. Returns `None` for anything else, including named colours, CSS
 *  variables, relative colours, and `calc()`. */
export const parseColor = (value: string): Option.Option<Color> => {
  const text = pipe(value, String.trim, String.toLowerCase)

  if (text === TRANSPARENT_KEYWORD) {
    return Option.some(TRANSPARENT)
  } else {
    return Option.orElse(parseHex(text), () => parseColorFunction(text))
  }
}

/** Whether a string is a colour the colour dial accepts: exactly the text
 *  `parseColor` can read, so a dial's value always opens in the picker. */
export const isColorString = (value: string): boolean =>
  Option.isSome(parseColor(value))

const OKLCH_TEXT_PATTERN = /^oklch\(/i
const DISPLAY_P3_TEXT_PATTERN = /^color\(\s*display-p3\s/i

/** The format a colour picker keeps writing after it receives this text.
 *  `oklch()` stays OKLCH and `color(display-p3 …)` stays Display P3. Every
 *  other format, including RGB and HSL, continues as hex. */
export const colorFormatOf = (value: string): ColorFormat => {
  const trimmed = String.trim(value)

  if (OKLCH_TEXT_PATTERN.test(trimmed)) {
    return 'Oklch'
  } else if (DISPLAY_P3_TEXT_PATTERN.test(trimmed)) {
    return 'DisplayP3'
  } else {
    return 'Hex'
  }
}
