import { Number, Option, String, pipe } from 'effect'

/** One hundred percent, for converting between fractions and percentages. */
export const PERCENT = 100

const PERCENTAGE_DECIMALS = 2

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

export const fractionOfValue = (
  value: number,
  min: number,
  max: number,
): number => {
  if (max <= min) {
    return 0
  } else {
    return clamp((value - min) / (max - min), 0, 1)
  }
}

export const valueOfFraction = (
  fraction: number,
  min: number,
  max: number,
): number => min + clamp(fraction, 0, 1) * (max - min)

export const percentageFromFraction = (fraction: number): string =>
  `${Number.round(fraction * PERCENT, PERCENTAGE_DECIMALS)}%`

const MAX_DECIMALS = 12

const fixedText = (value: number): string =>
  value.toFixed(MAX_DECIMALS).replace(/0+$/, '')

export const stepDecimals = (step: number): number => {
  const text = fixedText(step)
  return pipe(
    text,
    String.indexOf('.'),
    Option.match({
      onNone: () => 0,
      onSome: dotIndex => text.length - dotIndex - 1,
    }),
  )
}

export const roundToStepPrecision = (
  value: number,
  step: number,
  min = 0,
): number =>
  globalThis.Number(
    value.toFixed(Math.max(stepDecimals(step), stepDecimals(min))),
  )

export const snapAndClamp = (
  value: number,
  min: number,
  max: number,
  step: number,
): number => {
  const snapped = min + Math.round((value - min) / step) * step
  return roundToStepPrecision(clamp(snapped, min, max), step, min)
}

export const formatStepValue = (value: number, step: number): string =>
  value.toFixed(stepDecimals(step))
