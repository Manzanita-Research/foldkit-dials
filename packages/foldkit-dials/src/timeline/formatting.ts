import { Match, Schema } from 'effect'

import { roundToHundredths } from './timing.js'

const SECONDS_PER_MINUTE = 60
const CLOCK_PAD_LENGTH = 2
const TENTHS_CLOCK_PAD_LENGTH = 4

// FORMATTING

/** How `formatClock` shows seconds: whole, or with tenths. */
export const ClockPrecision = Schema.Literals(['Seconds', 'Tenths'])
export type ClockPrecision = typeof ClockPrecision.Type

/** Formats seconds as `MM:SS`, or `MM:SS.T` with tenths. */
export const formatClock = (
  seconds: number,
  precision: ClockPrecision = 'Seconds',
): string => {
  const safeSeconds = Math.max(0, seconds)
  const minutes = Math.floor(safeSeconds / SECONDS_PER_MINUTE)
  const remainder = safeSeconds - minutes * SECONDS_PER_MINUTE
  const secondsText = Match.value(precision).pipe(
    Match.withReturnType<string>(),
    Match.when('Tenths', () =>
      remainder.toFixed(1).padStart(TENTHS_CLOCK_PAD_LENGTH, '0'),
    ),
    Match.when('Seconds', () =>
      `${Math.floor(remainder)}`.padStart(CLOCK_PAD_LENGTH, '0'),
    ),
    Match.exhaustive,
  )

  return `${`${minutes}`.padStart(CLOCK_PAD_LENGTH, '0')}:${secondsText}`
}

/** Formats seconds to the hundredth with an `s` suffix, as bars show
 *  durations. */
export const formatSeconds = (seconds: number): string =>
  `${roundToHundredths(seconds)}s`

/** Labels a sequence step by its position, as `Step 2`. */
export const formatStepLabel = (index: number): string => `Step ${index + 1}`
