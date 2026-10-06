import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { RadioGroup } from '@foldkit/ui'

import { Theme } from '../internal/theme.js'
import * as ScrubSlider from '../scrubSlider/index.js'
import * as Timeline from '../timeline/index.js'
import { Parameter } from '../transition/parameters.js'

// MODEL

export { Theme } from '../internal/theme.js'

/** A bar the pointer or keyboard acts on: a clip's own row, or one of its
 *  property tracks. */
export const BarRow = defineTaggedUnion({
  Clip: { key: Schema.String },
  Track: { key: Schema.String, prop: Schema.String },
})
export type BarRow = typeof BarRow.Type

/** The part of a bar a press landed on. `Body` carries the sequence step
 *  under the pointer, if any. */
export const BarHandle = defineTaggedUnion({
  Body: { maybeStepIndex: Schema.Option(Schema.Number) },
  StartEdge: {},
  EndEdge: {},
  Boundary: { index: Schema.Number },
})
export type BarHandle = typeof BarHandle.Type

/** What a ruler press does: seek, zoom (Alt), or reset the zoom and seek
 *  (Shift). */
export const RulerGesture = Schema.Literals(['Seek', 'Zoom', 'ResetAndSeek'])
export type RulerGesture = typeof RulerGesture.Type

/** The surface a scrub drag follows: the lanes or the collapsed overview. */
export const ScrubSurface = Schema.Literals(['Lanes', 'Overview'])
export type ScrubSurface = typeof ScrubSurface.Type

/** The pointer gesture in progress: a scrub, a zoom, a bar drag, or a
 *  dock resize. */
export const DragState = defineTaggedUnion({
  Idle: {},
  Scrubbing: { surface: ScrubSurface, isResumingOnRelease: Schema.Boolean },
  Zooming: {
    originFraction: Schema.Number,
    originZoom: Schema.Number,
    anchorFraction: Schema.Number,
    anchorTime: Schema.Number,
    isMoved: Schema.Boolean,
  },
  DraggingBar: {
    row: BarRow,
    handle: BarHandle,
    originFraction: Schema.Number,
    originTimeline: Timeline.Timeline,
    isMoved: Schema.Boolean,
  },
  ResizingDock: { originClientY: Schema.Number, originHeight: Schema.Number },
})

/** The span the clip editor edits. */
export const EditTarget = Schema.Struct({
  key: Schema.String,
  span: Timeline.Span,
})
export type EditTarget = typeof EditTarget.Type

/** One value the clip editor edits: the span's start (a clip's `at` or a
 *  track's delay), its duration, a transition parameter, or a from or to
 *  value. */
export const EditorField = defineTaggedUnion({
  Start: {},
  Duration: {},
  Parameter: { parameter: Parameter },
  From: { prop: Schema.String },
  To: { prop: Schema.String },
})
export type EditorField = typeof EditorField.Type

/** One editor field and the ScrubSlider that edits it. */
export const EditorSlider = Schema.Struct({
  field: EditorField,
  slider: ScrubSlider.Model,
})
export type EditorSlider = typeof EditorSlider.Type

/** The open clip editor: the span it edits, its sliders, and its
 *  transition-mode RadioGroup. */
export const Editor = Schema.Struct({
  target: EditTarget,
  sliders: Schema.Array(EditorSlider),
  modeGroup: RadioGroup.Model,
})
export type Editor = typeof Editor.Type

/** What the Copy button shows: nothing yet, a confirmation, or a failure. */
export const CopyState = defineTaggedUnion({
  Idle: {},
  Copied: {},
  Failed: {},
})
export type CopyState = typeof CopyState.Type

/** Schema for the dock. It owns the edited timeline, which is what Copy
 *  exports, and the transport: `time`, `isPlaying`, and `wraps`, the loop
 *  passes that keep looping clips phase-continuous. The rest is editor
 *  state: zoom and pan, the open clip editor, expanded rows, the dock
 *  height and the viewport height that bounds it, and visibility.
 *  `copyVersion` counts copies, so a stale confirmation wait cannot reset a
 *  newer one. */
export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  theme: Theme,
  timeline: Timeline.Timeline,
  loop: Timeline.TimelineLoop,
  time: Schema.Number,
  wraps: Schema.Number,
  isPlaying: Schema.Boolean,
  isVisible: Schema.Boolean,
  isOpen: Schema.Boolean,
  dockHeight: Schema.Number,
  maybeViewportHeight: Schema.Option(Schema.Number),
  zoom: Schema.Number,
  viewStart: Schema.Number,
  rulerWidth: Schema.Number,
  collapsedGroups: Schema.Array(Schema.String),
  expandedClips: Schema.Array(Schema.String),
  maybeEditor: Schema.Option(Editor),
  dragState: DragState,
  copyState: CopyState,
  copyVersion: Schema.Number,
})
export type Model = typeof Model.Type

// INIT

const DEFAULT_DOCK_HEIGHT = 400

/** Configuration for `make`. `id` defaults to the name in kebab case and
 *  prefixes every DOM id and Subscription key, so two docks can sit on one
 *  page. `autoplay` plays from 0 on init and defaults to `true`. `loop`
 *  wraps the playhead to 0 with `true`, or to `from` seconds, and defaults
 *  to `false`. */
export type MakeConfig<Entries> = Readonly<{
  name: string
  timeline: Timeline.TimelineOf<Entries>
  id?: string
  // NOTE: `autoplay` keeps DialKit's option name, so a ported config reads
  // the same. The Foldkit options below use `is*`.
  autoplay?: boolean
  loop?: boolean | Readonly<{ from: number }>
  theme?: Theme
  isVisible?: boolean
  isOpen?: boolean
}>

const timelineLoopOf = (
  loop: boolean | Readonly<{ from: number }> | undefined,
): Timeline.TimelineLoop => {
  if (loop === undefined || loop === false) {
    return Timeline.TimelineLoop.Off()
  } else if (loop === true) {
    return Timeline.TimelineLoop.Repeat({ from: 0 })
  } else {
    return Timeline.TimelineLoop.Repeat({ from: loop.from })
  }
}

/** Builds the dock's first Model from its `make` config and id. */
export const initModel = <Entries>(
  config: MakeConfig<Entries>,
  id: string,
): Model => ({
  id,
  name: config.name,
  theme: config.theme ?? 'System',
  timeline: config.timeline,
  loop: timelineLoopOf(config.loop),
  time: 0,
  wraps: 0,
  isPlaying:
    (config.autoplay ?? true) &&
    Timeline.durationOfTimeline(config.timeline) > 0,
  isVisible: config.isVisible ?? true,
  isOpen: config.isOpen ?? true,
  dockHeight: DEFAULT_DOCK_HEIGHT,
  maybeViewportHeight: Option.none(),
  zoom: 1,
  viewStart: 0,
  rulerWidth: 0,
  collapsedGroups: [],
  expandedClips: [],
  maybeEditor: Option.none(),
  dragState: DragState.Idle(),
  copyState: CopyState.Idle(),
  copyVersion: 0,
})
