import { type Array, Record, Schema } from 'effect'
import { defineTaggedUnion, taggedStruct } from 'foldkit/schema'

import { Transition } from '../transition/index.js'

// NOTE: parsing, duration defaults, sampling, loop folding, and the edit
// clamps port DialKit's timeline-core (MIT, github.com/joshpuckett/dialkit).

// MODEL

/** A value a clip animates. Numbers interpolate, hex colours mix in RGB, and
 *  any other string switches at the midpoint. */
export const Value = Schema.Union([Schema.Number, Schema.String])
export type Value = typeof Value.Type

/** Animated values keyed by property name. */
export const Values = Schema.Record(Schema.String, Value)
export type Values = typeof Values.Type

/** Whether a clip plays once or repeats its cycle until the timeline ends. */
export const ClipLoop = Schema.Literals(['Off', 'Repeat'])
export type ClipLoop = typeof ClipLoop.Type

/** One leg of a sequence clip. Properties it leaves out of `to` hold their
 *  value from the previous leg. `duration` is the segment's bar length. */
export const Segment = Schema.Struct({
  duration: Schema.Number,
  to: Values,
  transition: Transition,
})
export type Segment = typeof Segment.Type

/** One leg of a property track that is a sequence. */
export const TrackSegment = Schema.Struct({
  duration: Schema.Number,
  to: Value,
  transition: Transition,
})
export type TrackSegment = typeof TrackSegment.Type

/** One property with its own timing inside a `Tracks` clip. `delay` offsets
 *  it from the clip's `at`. */
export const Track = defineTaggedUnion({
  Tween: {
    prop: Schema.String,
    delay: Schema.Number,
    duration: Schema.Number,
    from: Value,
    to: Value,
    transition: Transition,
  },
  Sequence: {
    prop: Schema.String,
    delay: Schema.Number,
    from: Value,
    steps: Schema.NonEmptyArray(TrackSegment),
  },
})
export type Track = typeof Track.Type

/** A clip with every default resolved: a timing `Marker`, a single-curve
 *  `Tween`, a `Sequence` of legs, or independent property `Tracks`. Every
 *  `duration` is the bar length the dock edits. Physics springs store their
 *  settle time, since their length is derived. */
export const Clip = defineTaggedUnion({
  Marker: { at: Schema.Number, duration: Schema.Number },
  Tween: {
    at: Schema.Number,
    duration: Schema.Number,
    from: Values,
    to: Values,
    transition: Transition,
    loop: ClipLoop,
  },
  Sequence: {
    at: Schema.Number,
    from: Values,
    steps: Schema.NonEmptyArray(Segment),
    loop: ClipLoop,
  },
  Tracks: {
    at: Schema.Number,
    tracks: Schema.Array(Track),
    loop: ClipLoop,
  },
})
export type Clip = typeof Clip.Type

/** A named clip in a timeline, with the group it belongs to, if any. */
export const TimelineClip = Schema.Struct({
  name: Schema.String,
  maybeGroup: Schema.Option(Schema.String),
  clip: Clip,
})
export type TimelineClip = typeof TimelineClip.Type

/** A parsed timeline: its clips in config order, and the shortest editing
 *  window. The window grows when clips extend past it. */
export const Timeline = Schema.Struct({
  minimumDuration: Schema.Number,
  clips: Schema.Array(TimelineClip),
})
export type Timeline = typeof Timeline.Type

/** One level of nesting that groups clips into a collapsible layer. */
export const Group = taggedStruct('Group', {
  clips: Schema.Record(Schema.String, Clip),
})
export type Group = typeof Group.Type

/** How the playhead loops: not at all, or back to `from` seconds. `from: 0`
 *  loops the whole timeline. */
export const TimelineLoop = defineTaggedUnion({
  Off: {},
  Repeat: { from: Schema.Number },
})
export type TimelineLoop = typeof TimelineLoop.Type

/** One editable span of a clip: the whole clip, a sequence step, a property
 *  track, or a step of a property track. */
export const Span = defineTaggedUnion({
  Whole: {},
  Step: { index: Schema.Number },
  Track: { prop: Schema.String },
  TrackStep: { prop: Schema.String, index: Schema.Number },
})
export type Span = typeof Span.Type

/** CSS `transition-duration` and `transition-timing-function` values for a
 *  single-curve clip. */
export const ClipCss = Schema.Struct({
  transitionDuration: Schema.String,
  transitionTimingFunction: Schema.String,
})
export type ClipCss = typeof ClipCss.Type

// NOTE: `started`, `active`, and `done` keep DialKit's clip-state names, not
// `is*`, so ported `clip.current` and `clip.active` code reads the same.
const clipTimingFields = {
  at: Schema.Number,
  duration: Schema.Number,
  loop: ClipLoop,
  started: Schema.Boolean,
  active: Schema.Boolean,
  done: Schema.Boolean,
  progress: Schema.Number,
}

const clipEndpointFields = {
  from: Values,
  to: Values,
  current: Values,
  animate: Values,
}

/** A clip's state at the playhead. `started`, `active`, and `done` place the
 *  playhead against the clip, `progress` runs 0 to 1 through the current
 *  cycle, `current` holds the values sampled at the playhead, and `animate`
 *  is `from` before the clip starts and `to` after. Tweens add their
 *  effective `transition` and `css`, and sequences add the `step` under the
 *  playhead. */
export const ClipValues = defineTaggedUnion({
  Marker: clipTimingFields,
  Tween: {
    ...clipTimingFields,
    ...clipEndpointFields,
    transition: Transition,
    css: ClipCss,
  },
  Sequence: {
    ...clipTimingFields,
    ...clipEndpointFields,
    step: Schema.Number,
  },
  Tracks: { ...clipTimingFields, ...clipEndpointFields },
})
export type ClipValues = typeof ClipValues.Type

// CONSTANTS

/** Shared empty endpoints for spans without animated values. */
export const NO_VALUES: Values = Record.empty()

// TYPED CONFIG

declare const ShapeType: unique symbol

/** Carries the value shape of a clip, group, or timeline at the type level,
 *  so `valuesAt` returns typed `current` values. It never exists at
 *  runtime. */
export type WithShape<Shape> = Readonly<{ [ShapeType]?: Shape }>

type ShapeOf<T> = T extends WithShape<infer Shape> ? Shape : never

/** The authored subset of a clip's animated values. */
export type PartialValues<V> = { readonly [K in keyof V]?: V[K] }

/** Widens authored literal endpoints to their sampled value types. */
export type Widen<T> = T extends number
  ? number
  : T extends string
    ? string
    : Value

/** A `Tween` clip that remembers the property shape of its `from`. */
export type TweenClip<V extends Values = Values> = typeof Clip.Tween.Type &
  WithShape<V>

/** A `Sequence` clip that remembers the property shape of its `from`. */
export type SequenceClip<V extends Values = Values> =
  typeof Clip.Sequence.Type & WithShape<V>

/** A `Tracks` clip that remembers the value type of each track. */
export type TracksClip<V extends Values = Values> = typeof Clip.Tracks.Type &
  WithShape<V>

/** A `Marker` clip. Markers carry timing and no values. */
export type MarkerClip = typeof Clip.Marker.Type

/** A group that remembers the clips it holds. */
export type GroupOf<Clips> = Group & WithShape<Clips>

/** A timeline that remembers its entries, so its values are typed. */
export type TimelineOf<Entries> = Timeline & WithShape<Entries>

/** Configuration for `clip`: a single transition from `from` to `to`. */
export type ClipInput<V extends Values> = Readonly<{
  at: number
  duration?: number
  from: V
  to: NoInfer<PartialValues<V>>
  transition?: Transition
  loop?: boolean
}>

/** One leg of a `sequence`. */
export type StepInput<V extends Values> = Readonly<{
  duration?: number
  to: PartialValues<V>
  transition?: Transition
}>

/** Configuration for `sequence`: legs that animate from the previous state.
 *  Declare every animated property in `from`. */
export type SequenceInput<V extends Values> = Readonly<{
  at: number
  from: V
  steps: NoInfer<Array.NonEmptyReadonlyArray<StepInput<V>>>
  transition?: Transition
  loop?: boolean
}>

/** One leg of a property track that is a sequence. */
export type TrackStepInput = Readonly<{
  duration?: number
  to: Value
  transition?: Transition
}>

/** One property track of a `tracks` clip. Give it `to` for one transition,
 *  or `steps` for a sequence. */
export type TrackInput = Readonly<{
  from: Value
  to?: Value
  steps?: Array.NonEmptyReadonlyArray<TrackStepInput>
  duration?: number
  delay?: number
  transition?: Transition
}>

/** Configuration for `tracks`: properties with independent timing. */
export type TracksInput<Props extends Readonly<Record<string, TrackInput>>> =
  Readonly<{
    at: number
    props: Props
    transition?: Transition
    loop?: boolean
  }>

/** Configuration for `marker`: a timing window with no animated values. */
export type MarkerInput = Readonly<{ at: number; duration?: number }>

/** A top-level timeline entry: a clip or a group of clips. */
export type Entry = Clip | Group

/** Configuration for `make`. `duration` sets the shortest editing window;
 *  without it the timeline fits its content. */
export type MakeConfig<Entries> = Readonly<{
  duration?: number
  clips: Entries
}>

type TypedEndpoints<ValuesType, V> = Omit<
  ValuesType,
  'from' | 'to' | 'current' | 'animate'
> &
  Readonly<{ from: V; to: V; current: V; animate: V }>

type ResolvedShape<Shape> = [Shape] extends [never] ? Values : Shape

/** The sampled values of one clip, typed by the clip's config. */
export type ClipValuesOf<C> =
  C extends Readonly<{ _tag: 'Tween' }>
    ? TypedEndpoints<typeof ClipValues.Tween.Type, ResolvedShape<ShapeOf<C>>>
    : C extends Readonly<{ _tag: 'Sequence' }>
      ? TypedEndpoints<
          typeof ClipValues.Sequence.Type,
          ResolvedShape<ShapeOf<C>>
        >
      : C extends Readonly<{ _tag: 'Tracks' }>
        ? TypedEndpoints<
            typeof ClipValues.Tracks.Type,
            ResolvedShape<ShapeOf<C>>
          >
        : typeof ClipValues.Marker.Type

/** The sampled values of a whole timeline: one entry per clip, with grouped
 *  clips nested under their group's name. */
export type ValuesOf<Entries> = {
  readonly [K in keyof Entries]: Entries[K] extends Readonly<{ _tag: 'Group' }>
    ? {
        readonly [Name in keyof ShapeOf<Entries[K]>]: ClipValuesOf<
          ShapeOf<Entries[K]>[Name]
        >
      }
    : ClipValuesOf<Entries[K]>
}
