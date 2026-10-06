// NOTE: the colour maths is ported from DialKit's `src/color.ts`
// (https://github.com/joshpuckett/dialkit, MIT License, Copyright (c) 2026
// Josh Puckett). The matrices use the CSS Color 4 D65 reference white:
// https://www.w3.org/TR/css-color-4/#color-conversion-code

import { Array, Match, Number, Option, Schema, String, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { clamp } from '../internal/range.js'

// MODEL

/** A colour in OKLCH plus alpha, the canonical space for colour dials. OKLCH
 *  keeps lightness and hue apart from chroma, so a colour moves into a
 *  smaller gamut by lowering chroma alone, and the picker's controls move
 *  along perceptual axes. `lightness` and `alpha` run from 0 to 1, `chroma`
 *  from 0 upward, and `hue` from 0 to 360 degrees. */
export const Color = Schema.Struct({
  lightness: Schema.Number,
  chroma: Schema.Number,
  hue: Schema.Number,
  alpha: Schema.Number,
})
export type Color = typeof Color.Type

/** A colour in OKLab, the rectangular form of OKLCH. `a` runs from green to
 *  red and `b` from blue to yellow. */
export const Oklab = Schema.Struct({
  lightness: Schema.Number,
  a: Schema.Number,
  b: Schema.Number,
})
export type Oklab = typeof Oklab.Type

/** The red, green, and blue channels of an RGB colour. Each runs from 0 to 1
 *  while the colour is inside the gamut. */
export const RgbChannels = Schema.Tuple([
  Schema.Number,
  Schema.Number,
  Schema.Number,
])
export type RgbChannels = typeof RgbChannels.Type

/** An RGB colour space: sRGB, or the wider Display P3. */
export const Gamut = Schema.Literals(['Srgb', 'DisplayP3'])
export type Gamut = typeof Gamut.Type

/** The text format a colour dial writes: `#rrggbb` hex, `oklch(…)`, or
 *  `color(display-p3 …)`. */
export const ColorFormat = Schema.Literals(['Hex', 'Oklch', 'DisplayP3'])
export type ColorFormat = typeof ColorFormat.Type

// CONSTANTS

type Vector = readonly [number, number, number]
type Matrix = readonly [Vector, Vector, Vector]

const SRGB_TO_XYZ: Matrix = [
  [0.4123907993, 0.3575843394, 0.1804807884],
  [0.2126390059, 0.7151686788, 0.0721923154],
  [0.0193308187, 0.1191947798, 0.9505321522],
]
const DISPLAY_P3_TO_XYZ: Matrix = [
  [0.4865709486, 0.2656676932, 0.1982172852],
  [0.2289745641, 0.6917385218, 0.0792869141],
  [0, 0.0451133819, 1.0439443689],
]
const XYZ_TO_SRGB: Matrix = [
  [3.2409699419, -1.5373831776, -0.4986107603],
  [-0.9692436363, 1.8759675015, 0.0415550574],
  [0.0556300797, -0.2039769589, 1.0569715142],
]
const XYZ_TO_DISPLAY_P3: Matrix = [
  [2.4934969119, -0.9313836179, -0.4027107845],
  [-0.8294889696, 1.7626640603, 0.0236246858],
  [0.0358458302, -0.0761723893, 0.956884524],
]
const XYZ_TO_LMS: Matrix = [
  [0.819022438, 0.3619062601, -0.1288737815],
  [0.0329836539, 0.9292868616, 0.0361446664],
  [0.0481771894, 0.2642395318, 0.6335478285],
]
const LMS_TO_XYZ: Matrix = [
  [1.2268798734, -0.5578149966, 0.2813910502],
  [-0.0405757626, 1.1122868294, -0.0717110667],
  [-0.0763729497, -0.421493324, 1.5869240244],
]
const LMS_TO_OKLAB: Matrix = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
]
const OKLAB_TO_LMS: Matrix = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.291485548],
]

const SRGB_DECODE_THRESHOLD = 0.04045
const SRGB_ENCODE_THRESHOLD = 0.0031308
const SRGB_LINEAR_SLOPE = 12.92
const SRGB_GAMMA = 2.4
const SRGB_OFFSET = 0.055

/** Degrees in a full turn of the hue wheel. */
export const DEGREES_PER_TURN = 360

const RADIANS_PER_DEGREE = Math.PI / 180
const ACHROMATIC_CHROMA_THRESHOLD = 1e-7
const GAMUT_TOLERANCE = 0.00001
const GAMUT_SEARCH_STEPS = 20
const CHROMA_SEARCH_CEILING = 0.5

const CHANNEL_DECIMALS = 4
const HUE_DECIMALS = 2
const DISPLAY_P3_DECIMALS = 5
const BYTE_MAX = 255
const HEX_RADIX = 16
const HEX_BYTE_DIGITS = 2

// VECTOR MATH

const dot = ([first, second, third]: Vector, [x, y, z]: Vector): number =>
  first * x + second * y + third * z

const transform = ([first, second, third]: Matrix, vector: Vector): Vector => [
  dot(first, vector),
  dot(second, vector),
  dot(third, vector),
]

const mapVector = (
  [first, second, third]: Vector,
  toChannel: (channel: number) => number,
): Vector => [toChannel(first), toChannel(second), toChannel(third)]

const cube = (value: number): number => value ** 3

// TRANSFER FUNCTIONS

const linearize = (channel: number): number => {
  const magnitude = Math.abs(channel)
  if (magnitude <= SRGB_DECODE_THRESHOLD) {
    return channel / SRGB_LINEAR_SLOPE
  } else {
    return (
      Math.sign(channel) *
      ((magnitude + SRGB_OFFSET) / (1 + SRGB_OFFSET)) ** SRGB_GAMMA
    )
  }
}

const encode = (channel: number): number => {
  const magnitude = Math.abs(channel)
  if (magnitude <= SRGB_ENCODE_THRESHOLD) {
    return SRGB_LINEAR_SLOPE * channel
  } else {
    return (
      Math.sign(channel) *
      ((1 + SRGB_OFFSET) * magnitude ** (1 / SRGB_GAMMA) - SRGB_OFFSET)
    )
  }
}

const rgbToXyzMatrix = (gamut: Gamut): Matrix =>
  Match.value(gamut).pipe(
    Match.withReturnType<Matrix>(),
    Match.when('Srgb', () => SRGB_TO_XYZ),
    Match.when('DisplayP3', () => DISPLAY_P3_TO_XYZ),
    Match.exhaustive,
  )

const xyzToRgbMatrix = (gamut: Gamut): Matrix =>
  Match.value(gamut).pipe(
    Match.withReturnType<Matrix>(),
    Match.when('Srgb', () => XYZ_TO_SRGB),
    Match.when('DisplayP3', () => XYZ_TO_DISPLAY_P3),
    Match.exhaustive,
  )

// CONVERSION

/** Wraps an angle in degrees into `[0, 360)`. */
export const wrapHue = (hue: number): number =>
  ((hue % DEGREES_PER_TURN) + DEGREES_PER_TURN) % DEGREES_PER_TURN

/** Converts OKLab to a Color. Lightness and alpha are clamped to `[0, 1]`. A
 *  colour with almost no chroma becomes a neutral with chroma 0 and hue 0. */
export const colorFromOklab = (
  { lightness, a, b }: Oklab,
  alpha: number,
): Color => {
  const chroma = Math.hypot(a, b)
  const isAchromatic = chroma < ACHROMATIC_CHROMA_THRESHOLD

  return {
    lightness: clamp(lightness, 0, 1),
    chroma: isAchromatic ? 0 : chroma,
    hue: isAchromatic ? 0 : wrapHue(Math.atan2(b, a) / RADIANS_PER_DEGREE),
    alpha: clamp(alpha, 0, 1),
  }
}

/** Converts a Color to OKLab. Alpha is dropped. */
export const oklabFromColor = ({ lightness, chroma, hue }: Color): Oklab => ({
  lightness,
  a: chroma * Math.cos(hue * RADIANS_PER_DEGREE),
  b: chroma * Math.sin(hue * RADIANS_PER_DEGREE),
})

/** Converts gamma-encoded RGB channels in the given gamut to a Color. */
export const colorFromRgb = (
  channels: RgbChannels,
  alpha: number,
  gamut: Gamut,
): Color => {
  const xyz = transform(rgbToXyzMatrix(gamut), mapVector(channels, linearize))
  const lms = mapVector(transform(XYZ_TO_LMS, xyz), Math.cbrt)
  const [lightness, a, b] = transform(LMS_TO_OKLAB, lms)

  return colorFromOklab({ lightness, a, b }, alpha)
}

/** Converts a Color to gamma-encoded RGB channels in the given gamut. Alpha is
 *  dropped. Channels fall outside `[0, 1]` when the colour is outside the
 *  gamut; see {@link fitToGamut}. */
export const rgbFromColor = (color: Color, gamut: Gamut): RgbChannels => {
  const { lightness, a, b } = oklabFromColor(color)
  const lms = mapVector(transform(OKLAB_TO_LMS, [lightness, a, b]), cube)
  const xyz = transform(LMS_TO_XYZ, lms)

  return mapVector(transform(xyzToRgbMatrix(gamut), xyz), encode)
}

// GAMUT MAPPING

/** Whether a colour fits inside a gamut, within a small rounding tolerance. */
export const isInGamut = (color: Color, gamut: Gamut): boolean =>
  Array.every(
    rgbFromColor(color, gamut),
    channel => channel >= -GAMUT_TOLERANCE && channel <= 1 + GAMUT_TOLERANCE,
  )

type ChromaBounds = Readonly<{ inside: number; outside: number }>

/** Maps a colour into a gamut by reducing its chroma. Lightness, hue, and
 *  alpha are kept. A colour already inside the gamut is returned as is. */
export const fitToGamut = (color: Color, gamut: Gamut): Color => {
  if (isInGamut(color, gamut)) {
    return color
  } else {
    const { inside } = Array.reduce(
      Array.range(1, GAMUT_SEARCH_STEPS),
      { inside: 0, outside: color.chroma },
      ({ inside, outside }): ChromaBounds => {
        const middle = (inside + outside) / 2
        if (isInGamut(modifyFields(color, { chroma: () => middle }), gamut)) {
          return { inside: middle, outside }
        } else {
          return { inside, outside: middle }
        }
      },
    )

    return modifyFields(color, { chroma: () => inside })
  }
}

/** The most chroma a gamut allows at a lightness and hue. It is 0 at black
 *  and white. */
export const maxChroma = (
  lightness: number,
  hue: number,
  gamut: Gamut,
): number => {
  if (lightness <= 0 || lightness >= 1) {
    return 0
  } else {
    return fitToGamut(
      { lightness, chroma: CHROMA_SEARCH_CEILING, hue, alpha: 1 },
      gamut,
    ).chroma
  }
}

/** The gamut a format can write. OKLCH can write any colour, so it has
 *  none. */
export const gamutOfFormat = (format: ColorFormat): Option.Option<Gamut> =>
  Match.value(format).pipe(
    Match.withReturnType<Option.Option<Gamut>>(),
    Match.when('Hex', () => Option.some('Srgb')),
    Match.when('DisplayP3', () => Option.some('DisplayP3')),
    Match.when('Oklch', () => Option.none()),
    Match.exhaustive,
  )

/** Maps a colour into the gamut a format can write, so the colour matches
 *  what {@link formatColor} writes for it. */
export const fitToFormat = (color: Color, format: ColorFormat): Color =>
  Option.match(gamutOfFormat(format), {
    onNone: () => color,
    onSome: gamut => fitToGamut(color, gamut),
  })

// FORMAT

const toByte = (channel: number): number =>
  Math.round(clamp(channel, 0, 1) * BYTE_MAX)

const toHexByte = (byte: number): string =>
  pipe(byte.toString(HEX_RADIX), String.padStart(HEX_BYTE_DIGITS, '0'))

const alphaSuffix = (alpha: number): string =>
  alpha < 1 ? ` / ${Number.round(alpha, CHANNEL_DECIMALS)}` : ''

const formatHex = (color: Color): string => {
  const channels = rgbFromColor(fitToGamut(color, 'Srgb'), 'Srgb')
  const alphaBytes = color.alpha < 1 ? [toByte(color.alpha)] : []
  const digits = pipe(
    [...mapVector(channels, toByte), ...alphaBytes],
    Array.map(toHexByte),
    Array.join(''),
  )

  return `#${digits}`
}

const formatOklch = ({ lightness, chroma, hue, alpha }: Color): string =>
  `oklch(${Number.round(lightness, CHANNEL_DECIMALS)} ${Number.round(chroma, CHANNEL_DECIMALS)} ${Number.round(hue, HUE_DECIMALS)}${alphaSuffix(alpha)})`

const formatDisplayP3 = (color: Color): string => {
  const channels = pipe(
    rgbFromColor(fitToGamut(color, 'DisplayP3'), 'DisplayP3'),
    Array.map(
      channel => `${Number.round(clamp(channel, 0, 1), DISPLAY_P3_DECIMALS)}`,
    ),
    Array.join(' '),
  )

  return `color(display-p3 ${channels}${alphaSuffix(color.alpha)})`
}

/** Writes a colour as CSS text in a format. Hex and Display P3 first map the
 *  colour into their gamut by reducing chroma. Alpha is written only when it
 *  is below 1. */
export const formatColor = (color: Color, format: ColorFormat): string =>
  Match.value(format).pipe(
    Match.withReturnType<string>(),
    Match.when('Hex', () => formatHex(color)),
    Match.when('Oklch', () => formatOklch(color)),
    Match.when('DisplayP3', () => formatDisplayP3(color)),
    Match.exhaustive,
  )
