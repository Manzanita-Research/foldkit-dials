import { Array, Number, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import * as Timeline from '../timeline/index.js'
import { staticClipOf, toggleEditor, trackStaticOf } from './editor.js'
import { BarHandle, BarRow, type Model } from './model.js'

// BAR EDITS

/** The sequence step a bar press names, if any. */
export const maybeStepIndexOf = (handle: BarHandle): Option.Option<number> =>
  BarHandle.match(handle, {
    Body: ({ maybeStepIndex }) => maybeStepIndex,
    StartEdge: () => Option.none(),
    EndEdge: () => Option.none(),
    Boundary: ({ index }) => Option.some(index),
  })

const stepDurations = (track: Timeline.TrackStatic): ReadonlyArray<number> =>
  Array.map(track.steps, ({ duration }) => duration)

const resizedStep = (
  track: Timeline.TrackStatic,
  index: number,
  delta: number,
  start: number,
  timelineDuration: number,
): number => {
  const durations = stepDurations(track)
  const stepDuration = Option.getOrElse(Array.get(durations, index), () => 0)
  const others = Number.sumAll(durations) - stepDuration
  return Timeline.clampStepResize(
    stepDuration + delta,
    start,
    others,
    timelineDuration,
  )
}

const firstStepDuration = (track: Timeline.TrackStatic): number =>
  Array.headNonEmpty(track.steps).duration

const draggedClipRow = (
  clip: Timeline.Clip,
  clipStatic: Timeline.ClipStatic,
  handle: BarHandle,
  delta: number,
  timelineDuration: number,
): Timeline.Clip => {
  const maybeSharedTrack = Array.head(clipStatic.tracks)
  const isSequence = clip._tag === 'Sequence'

  return BarHandle.match<Timeline.Clip>(handle, {
    Body: () =>
      Timeline.setClipStart(
        clip,
        Timeline.clampClipMove(
          clip.at + delta,
          clipStatic.duration,
          timelineDuration,
        ),
      ),
    EndEdge: () =>
      Timeline.setSpanDuration(
        clip,
        Timeline.Span.Whole(),
        Timeline.clampClipResizeEnd(
          clipStatic.duration + delta,
          clip.at,
          timelineDuration,
        ),
      ),
    StartEdge: () => {
      const firstDuration = isSequence
        ? Option.match(maybeSharedTrack, {
            onNone: () => clipStatic.duration,
            onSome: firstStepDuration,
          })
        : clipStatic.duration
      const next = Timeline.clampClipResizeStart(
        Math.max(clip.at + delta, 0),
        clip.at,
        firstDuration,
      )
      const span = isSequence
        ? Timeline.Span.Step({ index: 0 })
        : Timeline.Span.Whole()
      return Timeline.setSpanDuration(
        Timeline.setClipStart(clip, next.at),
        span,
        next.duration,
      )
    },
    Boundary: ({ index }) =>
      Option.match(maybeSharedTrack, {
        onNone: () => clip,
        onSome: track =>
          Timeline.setSpanDuration(
            clip,
            Timeline.Span.Step({ index }),
            resizedStep(track, index, delta, clip.at, timelineDuration),
          ),
      }),
  })
}

const draggedTrackRow = (
  clip: Timeline.Clip,
  track: Timeline.TrackStatic,
  prop: string,
  handle: BarHandle,
  delta: number,
  timelineDuration: number,
): Timeline.Clip => {
  const trackStart = clip.at + track.delay
  const isSequence = Option.exists(
    Timeline.trackOf(clip, prop),
    ({ _tag }) => _tag === 'Sequence',
  )

  return BarHandle.match<Timeline.Clip>(handle, {
    Body: () =>
      Timeline.setTrackDelay(
        clip,
        prop,
        Timeline.clampTrackDelay(
          trackStart + delta - clip.at,
          clip.at,
          track.duration,
          timelineDuration,
        ),
      ),
    EndEdge: () =>
      Timeline.setSpanDuration(
        clip,
        Timeline.Span.Track({ prop }),
        Timeline.clampClipResizeEnd(
          track.duration + delta,
          trackStart,
          timelineDuration,
        ),
      ),
    StartEdge: () => {
      const firstDuration = isSequence
        ? firstStepDuration(track)
        : track.duration
      const next = Timeline.clampClipResizeStart(
        Math.max(trackStart + delta, clip.at),
        trackStart,
        firstDuration,
      )
      const span = isSequence
        ? Timeline.Span.TrackStep({ prop, index: 0 })
        : Timeline.Span.Track({ prop })
      return Timeline.setSpanDuration(
        Timeline.setTrackDelay(clip, prop, next.at - clip.at),
        span,
        next.duration,
      )
    },
    Boundary: ({ index }) =>
      Timeline.setSpanDuration(
        clip,
        Timeline.Span.TrackStep({ prop, index }),
        resizedStep(track, index, delta, trackStart, timelineDuration),
      ),
  })
}

/** Applies a bar drag of `delta` seconds to the timeline as it was when the
 *  drag began. The body moves the bar, the edges and boundaries resize it,
 *  and every result is clamped inside the timeline. */
export const applyBarDrag = (
  origin: Timeline.Timeline,
  row: BarRow,
  handle: BarHandle,
  delta: number,
): Timeline.Timeline => {
  const timelineDuration = Timeline.durationOfTimeline(origin)

  return Option.match(staticClipOf(origin, row.key), {
    onNone: () => origin,
    onSome: clipStatic =>
      Timeline.modifyClip(row.key, clip =>
        BarRow.match<Timeline.Clip>(row, {
          Clip: () =>
            draggedClipRow(clip, clipStatic, handle, delta, timelineDuration),
          Track: ({ prop }) =>
            Option.match(trackStaticOf(clipStatic, prop), {
              onNone: () => clip,
              onSome: track =>
                draggedTrackRow(
                  clip,
                  track,
                  prop,
                  handle,
                  delta,
                  timelineDuration,
                ),
            }),
        }),
      )(origin),
  })
}

const isTracksClip = (timeline: Timeline.Timeline, key: string): boolean =>
  Option.exists(
    Timeline.findClip(timeline, key),
    ({ clip }) => clip._tag === 'Tracks',
  )

const toggleIn = (
  items: ReadonlyArray<string>,
  item: string,
): ReadonlyArray<string> =>
  Array.contains(items, item)
    ? Array.filter(items, existing => existing !== item)
    : Array.append(items, item)

/** Activates a bar. A props clip shows or hides its property tracks, and
 *  any other bar or segment toggles the clip editor. */
export const activateBar = (
  model: Model,
  row: BarRow,
  maybeStepIndex: Option.Option<number>,
): Model =>
  BarRow.match<Model>(row, {
    Clip: ({ key }) => {
      if (isTracksClip(model.timeline, key)) {
        return modifyFields(model, {
          expandedClips: items => toggleIn(items, key),
        })
      } else {
        return toggleEditor(model, {
          key,
          span: Option.match(maybeStepIndex, {
            onNone: () => Timeline.Span.Whole(),
            onSome: index => Timeline.Span.Step({ index }),
          }),
        })
      }
    },
    Track: ({ key, prop }) =>
      toggleEditor(model, {
        key,
        span: Option.match(maybeStepIndex, {
          onNone: () => Timeline.Span.Track({ prop }),
          onSome: index => Timeline.Span.TrackStep({ prop, index }),
        }),
      }),
  })
