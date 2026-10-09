import { clamp } from '../internal/range.js'
import { TimelineLoop } from './model.js'
import { isFiniteNumber } from './timing.js'

// LOOPING

/** The length of the span the playhead repeats: the whole timeline, or the
 *  part after `loopStart`. A start at or past the end falls back to the
 *  whole timeline. */
export const loopSpan = (duration: number, loopStart: number): number => {
  if (!isFiniteNumber(duration) || duration <= 0) {
    return 0
  }

  const start = clamp(isFiniteNumber(loopStart) ? loopStart : 0, 0, duration)
  return duration - start > 0 ? duration - start : duration
}

/** A playhead folded back into the loop, with the number of spans crossed. */
export type FoldedTime = Readonly<{ time: number; wraps: number }>

/** Folds a playhead that ran past the end back into the loop region and
 *  counts the spans crossed, so `wraps * span + time` never jumps. */
export const foldLoopTime = (
  time: number,
  duration: number,
  loopStart: number,
): FoldedTime => {
  if (!isFiniteNumber(time) || !isFiniteNumber(duration) || duration <= 0) {
    return { time: 0, wraps: 0 }
  } else if (time < duration) {
    return { time, wraps: 0 }
  } else {
    const span = loopSpan(duration, loopStart)
    const base = duration - span
    const overshoot = time - base
    return {
      time: base + (overshoot % span),
      wraps: Math.floor(overshoot / span),
    }
  }
}

/** The start of a timeline loop, or 0 when it does not loop. */
export const loopStartOf = (loop: TimelineLoop): number =>
  TimelineLoop.match(loop, {
    Off: () => 0,
    Repeat: ({ from }) => (isFiniteNumber(from) ? Math.max(0, from) : 0),
  })

/** Continuous time across loop wraps, for `sampleClip`'s `cycleTime`. */
export const cycleTimeOf = (
  time: number,
  wraps: number,
  duration: number,
  loop: TimelineLoop,
): number => {
  const span = loopSpan(duration, loopStartOf(loop))
  return (span > 0 ? wraps * span : 0) + time
}
