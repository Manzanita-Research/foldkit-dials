import {
  Array,
  Function,
  Match,
  Number,
  Option,
  Predicate,
  Record,
  Schema,
  pipe,
} from 'effect'
import { defineTaggedUnion, taggedStruct } from 'foldkit/schema'
import { makeModifyFieldsFor, modifyFields } from 'foldkit/struct'

import { inferStep } from '../dial/index.js'
import { clamp } from '../internal/range.js'
import {
  Transition,
  cssDurationOf,
  durationOf,
  progressAt,
  springParams,
  springSettleDuration,
  toCssTimingFunction,
} from '../transition/index.js'

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

const NO_VALUES: Values = Record.empty()

/** The shortest bar an animated clip or step can have, in seconds. */
export const MIN_CLIP_DURATION = 0.05

const DEFAULT_SPRING_BOUNCE = 0.2
const DEFAULT_SPRING_SHAPE_DURATION = 0.3
const EMPTY_TIMELINE_DURATION = 1
const HUNDREDTHS = 100
const HUNDREDTH_DECIMALS = 2
const CEIL_TOLERANCE = 1e-4
const EXPORT_DECIMALS = 3
const CSS_DURATION_DECIMALS = 2
const MIDPOINT = 0.5
const SECONDS_PER_MINUTE = 60
const CLOCK_PAD_LENGTH = 2
const TENTHS_CLOCK_PAD_LENGTH = 4
const HEX_RADIX = 16
const HEX_PAIR_LENGTH = 2
const SHORT_HEX_MAX_DIGITS = 4
const RGB_CHANNEL_COUNT = 3
const OPAQUE_CHANNEL = 255
const HEX_COLOR_PATTERN =
  /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** The transition a clip with values but no `transition` uses: a time
 *  spring with bounce 0.2, whose bar defaults to that spring's settle time,
 *  as in DialKit. */
export const DEFAULT_TRANSITION: Transition = Transition.TimeSpring({
  visualDuration: springSettleDuration(
    springParams(
      Transition.TimeSpring({
        visualDuration: DEFAULT_SPRING_SHAPE_DURATION,
        bounce: DEFAULT_SPRING_BOUNCE,
      }),
    ),
  ),
  bounce: DEFAULT_SPRING_BOUNCE,
})

// TYPED CONFIG

declare const ShapeType: unique symbol

/** Carries the value shape of a clip, group, or timeline at the type level,
 *  so `valuesAt` returns typed `current` values. It never exists at
 *  runtime. */
export type WithShape<Shape> = Readonly<{ [ShapeType]?: Shape }>

type ShapeOf<T> = T extends WithShape<infer Shape> ? Shape : never

type PartialValues<V> = { readonly [K in keyof V]?: V[K] }

type Widen<T> = T extends number ? number : T extends string ? string : Value

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

// DURATION DEFAULTS

const isFiniteNumber = (value: number): boolean =>
  globalThis.Number.isFinite(value)

const sanitizeTime = (value: number): number =>
  isFiniteNumber(value) ? Math.max(0, value) : 0

const animatedDuration = (value: number): number =>
  Math.max(MIN_CLIP_DURATION, sanitizeTime(value))

const ceilToHundredths = (value: number): number =>
  Math.ceil(value * HUNDREDTHS - CEIL_TOLERANCE) / HUNDREDTHS

const roundToHundredths = (value: number): number =>
  Number.round(value, HUNDREDTH_DECIMALS)

const isPhysics = (transition: Transition): boolean =>
  transition._tag === 'PhysicsSpring'

const transitionDuration = (transition: Transition): number =>
  animatedDuration(durationOf(transition))

/** The bar length of an animated span. Physics springs always use their
 *  settle time. Otherwise an explicit duration wins, then the transition's
 *  own duration. */
export const barDuration = (
  maybeDuration: Option.Option<number>,
  transition: Transition,
): number => {
  if (isPhysics(transition)) {
    return transitionDuration(transition)
  } else {
    return Option.match(maybeDuration, {
      onNone: () => transitionDuration(transition),
      onSome: animatedDuration,
    })
  }
}

/** The transition as it runs over a bar: easings and time springs take the
 *  bar as their duration, and physics springs report their settle time and
 *  `isPhysics`, since their bar is derived and not resizable. */
export type EffectiveTransition = Readonly<{
  transition: Transition
  duration: number
  isPhysics: boolean
}>

/** Resolves a stored transition against its bar duration. */
export const effectiveTransition = (
  transition: Transition,
  duration: number,
): EffectiveTransition => {
  const safeDuration = Math.max(MIN_CLIP_DURATION, duration)

  return Transition.match<EffectiveTransition>(transition, {
    Easing: ({ ease }) => ({
      transition: Transition.Easing({ duration: safeDuration, ease }),
      duration: safeDuration,
      isPhysics: false,
    }),
    TimeSpring: ({ bounce }) => ({
      transition: Transition.TimeSpring({
        visualDuration: safeDuration,
        bounce,
      }),
      duration: safeDuration,
      isPhysics: false,
    }),
    PhysicsSpring: spring => ({
      transition: spring,
      duration: springSettleDuration(springParams(spring)),
      isPhysics: true,
    }),
  })
}

// NOTE: a partial record of `V`'s values is a `Values`, but TypeScript cannot
// relate a mapped type over a generic `V` to an index signature.
const toValues = <V extends Values>(values: PartialValues<V>): Values =>
  /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
  values as Values

const loopOf = (isLooping: boolean | undefined): ClipLoop =>
  isLooping === true ? 'Repeat' : 'Off'

// CONSTRUCTORS

/** A clip that animates `from` to `to` with one transition. Without
 *  `duration`, the bar uses the transition's duration or a spring's settle
 *  time. Without `transition`, it uses `DEFAULT_TRANSITION`. */
export const clip = <V extends Values>(input: ClipInput<V>): TweenClip<V> => {
  const transition = input.transition ?? DEFAULT_TRANSITION

  return Clip.Tween({
    at: Math.max(0, input.at),
    duration: barDuration(Option.fromNullishOr(input.duration), transition),
    from: input.from,
    to: toValues(input.to),
    transition,
    loop: loopOf(input.loop),
  })
}

/** A clip whose legs each animate from the previous state. Each leg
 *  inherits the clip's transition unless it sets its own. The clip's length
 *  is the sum of its legs. */
export const sequence = <V extends Values>(
  input: SequenceInput<V>,
): SequenceClip<V> => {
  const inheritedTransition = input.transition ?? DEFAULT_TRANSITION

  return Clip.Sequence({
    at: Math.max(0, input.at),
    from: input.from,
    steps: Array.map(input.steps, step => {
      const transition = step.transition ?? inheritedTransition
      return {
        duration: barDuration(Option.fromNullishOr(step.duration), transition),
        to: toValues(step.to),
        transition,
      }
    }),
    loop: loopOf(input.loop),
  })
}

const trackFromInput = (
  prop: string,
  input: TrackInput,
  inheritedTransition: Transition,
): Track => {
  const transition = input.transition ?? inheritedTransition
  const delay = sanitizeTime(input.delay ?? 0)

  return Option.match(Option.fromNullishOr(input.steps), {
    onNone: () =>
      Track.Tween({
        prop,
        delay,
        duration: barDuration(Option.fromNullishOr(input.duration), transition),
        from: input.from,
        to: input.to ?? input.from,
        transition,
      }),
    onSome: steps =>
      Track.Sequence({
        prop,
        delay,
        from: input.from,
        steps: Array.map(steps, step => {
          const stepTransition = step.transition ?? transition
          return {
            duration: barDuration(
              Option.fromNullishOr(step.duration),
              stepTransition,
            ),
            to: step.to,
            transition: stepTransition,
          }
        }),
      }),
  })
}

/** A clip whose properties animate with independent timing. Each track has
 *  its own values, transition, duration, and `delay` from the clip's `at`.
 *  When looping, each track repeats at its own period. */
export const tracks = <Props extends Readonly<Record<string, TrackInput>>>(
  input: TracksInput<Props>,
): TracksClip<{ readonly [K in keyof Props]: Widen<Props[K]['from']> }> => {
  const inheritedTransition = input.transition ?? DEFAULT_TRANSITION

  return Clip.Tracks({
    at: Math.max(0, input.at),
    tracks: Array.map(Record.toEntries(input.props), ([prop, track]) =>
      trackFromInput(prop, track, inheritedTransition),
    ),
    loop: loopOf(input.loop),
  })
}

/** A timing window with no animated values. A marker without `duration` is
 *  instant. */
export const marker = (input: MarkerInput): MarkerClip =>
  Clip.Marker({
    at: Math.max(0, input.at),
    duration: sanitizeTime(input.duration ?? 0),
  })

/** Groups clips into one collapsible layer. Their values nest under the
 *  group's name. */
export const group = <Clips extends Readonly<Record<string, Clip>>>(
  clips: Clips,
): GroupOf<Clips> => Group({ clips })

const timelineClipsOfEntry = (
  name: string,
  entry: Entry,
): ReadonlyArray<TimelineClip> => {
  if (entry._tag === 'Group') {
    return Array.map(Record.toEntries(entry.clips), ([childName, child]) => ({
      name: childName,
      maybeGroup: Option.some(name),
      clip: child,
    }))
  } else {
    return [{ name, maybeGroup: Option.none(), clip: entry }]
  }
}

const authoredDuration = (
  maybeDuration: Option.Option<number>,
  contentEnd: number,
): number =>
  Option.getOrElse(
    Option.filter(
      maybeDuration,
      duration => isFiniteNumber(duration) && duration > 0,
    ),
    () =>
      contentEnd > 0 ? ceilToHundredths(contentEnd) : EMPTY_TIMELINE_DURATION,
  )

/** Parses clips and groups into a `Timeline`. Clips keep config order, and a
 *  clip whose `at` is not finite is skipped. Without `duration`, the window
 *  ends where the content does, rounded up to the hundredth. */
export const make = <Entries extends Readonly<Record<string, Entry>>>(
  config: MakeConfig<Entries>,
): TimelineOf<Entries> => {
  const clips = pipe(
    Record.toEntries(config.clips),
    Array.flatMap(([name, entry]) => timelineClipsOfEntry(name, entry)),
    Array.filter(({ clip: { at } }) => isFiniteNumber(at)),
  )
  const contentEnd = pipe(
    clips,
    Array.map(({ clip: timelineClip }) => clipShapeOf(timelineClip)),
    Array.reduce(0, (end, shape) => Math.max(end, shape.at + shape.duration)),
  )

  return {
    minimumDuration: authoredDuration(
      Option.fromNullishOr(config.duration),
      contentEnd,
    ),
    clips,
  }
}

/** The path a clip's values live at: `name`, or `group.name` inside a
 *  group. */
export const clipKey = ({ name, maybeGroup }: TimelineClip): string =>
  Option.match(maybeGroup, {
    onNone: () => name,
    onSome: groupName => `${groupName}.${name}`,
  })

// STATIC PASS

/** One leg ready to sample: where it starts in its track's cycle, its
 *  effective duration and curve, the full state it starts from, and the
 *  properties it animates. */
export type StepStatic = Readonly<{
  offset: number
  duration: number
  isPhysics: boolean
  start: Values
  to: Values
  curve: Transition
}>

/** A chain of legs with its own cycle length and phase offset. A tween or
 *  sequence clip is one track over all its properties. A `Tracks` clip has
 *  one track per property. */
export type TrackStatic = Readonly<{
  maybeProp: Option.Option<string>
  delay: number
  duration: number
  steps: Array.NonEmptyReadonlyArray<StepStatic>
}>

/** A clip resolved for sampling and drawing. `duration` is the bar, one
 *  cycle for looping clips, and `end` is where the clip stops affecting
 *  values: `at + duration`, or the timeline end when it loops. */
export type ClipStatic = Readonly<{
  key: string
  name: string
  maybeGroup: Option.Option<string>
  clip: Clip
  at: number
  duration: number
  loop: ClipLoop
  end: number
  isPhysics: boolean
  tracks: ReadonlyArray<TrackStatic>
  props: ReadonlyArray<string>
  from: Values
  to: Values
}>

/** A timeline resolved for sampling: its effective duration and clips. */
export type TimelineStatic = Readonly<{
  duration: number
  clips: ReadonlyArray<ClipStatic>
}>

type ClipShape = Omit<ClipStatic, 'key' | 'name' | 'maybeGroup' | 'end'>

const chainSteps = (
  from: Values,
  legs: Array.NonEmptyReadonlyArray<
    Readonly<{ duration: number; to: Values; transition: Transition }>
  >,
): Readonly<{
  duration: number
  final: Values
  steps: Array.NonEmptyReadonlyArray<StepStatic>
}> => {
  const [state, steps] = Array.mapAccum(
    legs,
    { offset: 0, running: from },
    (accumulated, leg) => {
      const effective = effectiveTransition(leg.transition, leg.duration)
      const step: StepStatic = {
        offset: accumulated.offset,
        duration: effective.duration,
        isPhysics: effective.isPhysics,
        start: accumulated.running,
        to: leg.to,
        curve: effective.transition,
      }
      return [
        {
          offset: accumulated.offset + effective.duration,
          running: { ...accumulated.running, ...leg.to },
        },
        step,
      ]
    },
  )

  return { duration: state.offset, final: state.running, steps }
}

const singleProp = (prop: string, value: Value): Values =>
  Record.singleton(prop, value)

const trackStaticOf = (track: Track): TrackStatic =>
  Track.match<TrackStatic>(track, {
    Tween: ({ prop, delay, duration, from, to, transition }) => {
      const effective = effectiveTransition(transition, duration)
      return {
        maybeProp: Option.some(prop),
        delay,
        duration: effective.duration,
        steps: [
          {
            offset: 0,
            duration: effective.duration,
            isPhysics: effective.isPhysics,
            start: singleProp(prop, from),
            to: singleProp(prop, to),
            curve: effective.transition,
          },
        ],
      }
    },
    Sequence: ({ prop, delay, from, steps }) => {
      const chained = chainSteps(
        singleProp(prop, from),
        Array.map(steps, step => ({
          duration: step.duration,
          to: singleProp(prop, step.to),
          transition: step.transition,
        })),
      )
      return {
        maybeProp: Option.some(prop),
        delay,
        duration: chained.duration,
        steps: chained.steps,
      }
    },
  })

const propsOf = (from: Values, to: Values): ReadonlyArray<string> =>
  Array.union(Record.keys(from), Record.keys(to))

const loopWhenAnimated = (loop: ClipLoop, duration: number): ClipLoop =>
  duration > 0 ? loop : 'Off'

const clipShapeOf = (clip: Clip): ClipShape =>
  Clip.match<ClipShape>(clip, {
    Marker: ({ at, duration }) => ({
      clip,
      at,
      duration,
      loop: 'Off',
      isPhysics: false,
      tracks: [],
      props: [],
      from: NO_VALUES,
      to: NO_VALUES,
    }),
    Tween: ({ at, duration, from, to, transition, loop }) => {
      const effective = effectiveTransition(transition, duration)
      const final = { ...from, ...to }
      return {
        clip,
        at,
        duration: effective.duration,
        loop: loopWhenAnimated(loop, effective.duration),
        isPhysics: effective.isPhysics,
        tracks: [
          {
            maybeProp: Option.none(),
            delay: 0,
            duration: effective.duration,
            steps: [
              {
                offset: 0,
                duration: effective.duration,
                isPhysics: effective.isPhysics,
                start: from,
                to,
                curve: effective.transition,
              },
            ],
          },
        ],
        props: propsOf(from, to),
        from,
        to: final,
      }
    },
    Sequence: ({ at, from, steps, loop }) => {
      const chained = chainSteps(from, steps)
      return {
        clip,
        at,
        duration: chained.duration,
        loop: loopWhenAnimated(loop, chained.duration),
        isPhysics: false,
        tracks: [
          {
            maybeProp: Option.none(),
            delay: 0,
            duration: chained.duration,
            steps: chained.steps,
          },
        ],
        props: propsOf(from, chained.final),
        from,
        to: chained.final,
      }
    },
    Tracks: ({ at, tracks: clipTracks, loop }) => {
      const trackStatics = Array.map(clipTracks, trackStaticOf)
      const duration = Array.reduce(trackStatics, 0, (extent, track) =>
        Math.max(extent, track.delay + track.duration),
      )
      return {
        clip,
        at,
        duration,
        loop: loopWhenAnimated(loop, duration),
        isPhysics: false,
        tracks: trackStatics,
        props: Array.map(clipTracks, ({ prop }) => prop),
        from: Record.fromEntries(
          Array.map(clipTracks, track => [track.prop, track.from]),
        ),
        to: Record.fromEntries(
          Array.map(clipTracks, track => [track.prop, finalTrackValue(track)]),
        ),
      }
    },
  })

const finalTrackValue = (track: Track): Value =>
  Track.match<Value>(track, {
    Tween: ({ to }) => to,
    Sequence: ({ steps }) => Array.lastNonEmpty(steps).to,
  })

/** Resolves a timeline for sampling. The duration grows past the authored
 *  window when a clip ends after it, as an edited physics spring can, and
 *  looping clips then run to the new end. */
export const resolve = (timeline: Timeline): TimelineStatic => {
  const shapes = Array.map(timeline.clips, timelineClip => ({
    timelineClip,
    shape: clipShapeOf(timelineClip.clip),
  }))
  const contentEnd = Array.reduce(shapes, 0, (end, { shape }) =>
    Math.max(end, shape.at + shape.duration),
  )
  const duration =
    contentEnd > timeline.minimumDuration
      ? ceilToHundredths(contentEnd)
      : timeline.minimumDuration

  return {
    duration,
    clips: Array.map(shapes, ({ timelineClip, shape }) => ({
      ...shape,
      key: clipKey(timelineClip),
      name: timelineClip.name,
      maybeGroup: timelineClip.maybeGroup,
      end: shape.loop === 'Off' ? shape.at + shape.duration : duration,
    })),
  }
}

/** The timeline's effective duration in seconds. */
export const durationOfTimeline = (timeline: Timeline): number =>
  resolve(timeline).duration

// SAMPLING

const stepIndexAt = (
  steps: Array.NonEmptyReadonlyArray<StepStatic>,
  position: number,
): number =>
  pipe(
    steps,
    Array.findFirstIndex(step => position < step.offset + step.duration),
    Option.getOrElse(() => steps.length - 1),
  )

const stepAt = (
  steps: Array.NonEmptyReadonlyArray<StepStatic>,
  position: number,
): StepStatic =>
  pipe(
    Array.get(steps, stepIndexAt(steps, position)),
    Option.getOrElse(() => Array.lastNonEmpty(steps)),
  )

const mixHexColors = (
  from: string,
  to: string,
  progress: number,
): Option.Option<string> =>
  Option.map(
    Option.all([parseHexChannels(from), parseHexChannels(to)]),
    ([fromChannels, toChannels]) => {
      const amount = clamp(progress, 0, 1)
      const mixed = Array.map(
        Array.zip(fromChannels, toChannels),
        ([start, end]) => Math.round(start + (end - start) * amount),
      )
      const isOpaque = Option.contains(Array.last(mixed), OPAQUE_CHANNEL)
      const visibleChannels = isOpaque
        ? Array.take(mixed, RGB_CHANNEL_COUNT)
        : mixed
      return `#${Array.join(Array.map(visibleChannels, hexPair), '')}`
    },
  )

const hexPair = (channel: number): string =>
  channel.toString(HEX_RADIX).padStart(HEX_PAIR_LENGTH, '0')

const parseHexChannels = (
  color: string,
): Option.Option<ReadonlyArray<number>> => {
  if (!HEX_COLOR_PATTERN.test(color)) {
    return Option.none()
  }

  const digits = color.slice(1)
  const expanded =
    digits.length <= SHORT_HEX_MAX_DIGITS
      ? Array.join(
          Array.map(digits.split(''), digit => `${digit}${digit}`),
          '',
        )
      : digits
  const channels = Array.makeBy(expanded.length / HEX_PAIR_LENGTH, index =>
    globalThis.Number.parseInt(
      expanded.slice(index * HEX_PAIR_LENGTH, (index + 1) * HEX_PAIR_LENGTH),
      HEX_RADIX,
    ),
  )

  return Option.some(
    channels.length === RGB_CHANNEL_COUNT
      ? [...channels, OPAQUE_CHANNEL]
      : channels,
  )
}

/** Mixes two values at eased progress `progress`. Numbers interpolate and
 *  may overshoot, hex colours mix in clamped RGB, and anything else switches
 *  at the midpoint. */
export const interpolate = (
  from: Value,
  to: Value,
  progress: number,
): Value => {
  const switched = progress < MIDPOINT ? from : to

  if (Predicate.isNumber(from) && Predicate.isNumber(to)) {
    return from + (to - from) * progress
  } else if (Predicate.isString(from) && Predicate.isString(to)) {
    return Option.getOrElse(mixHexColors(from, to, progress), () => switched)
  } else {
    return switched
  }
}

const valueAtPosition = (
  steps: Array.NonEmptyReadonlyArray<StepStatic>,
  prop: string,
  position: number,
): Option.Option<Value> => {
  const step = stepAt(steps, position)
  const maybeStart = Record.get(step.start, prop)

  return Option.match(Record.get(step.to, prop), {
    onNone: () => maybeStart,
    onSome: target => {
      const progress = progressAt(
        step.curve,
        Math.max(0, position - step.offset),
      )
      return Option.match(maybeStart, {
        onNone: () => Option.liftPredicate(target, () => progress >= MIDPOINT),
        onSome: start => Option.some(interpolate(start, target, progress)),
      })
    },
  })
}

type Phase = Readonly<{
  isStarted: boolean
  isLooping: boolean
  phaseElapsed: number
}>

const trackValue = (
  track: TrackStatic,
  prop: string,
  { isStarted, isLooping, phaseElapsed }: Phase,
): Option.Option<Value> => {
  const maybeStartValue = Record.get(
    Array.headNonEmpty(track.steps).start,
    prop,
  )
  const trackPhase = phaseElapsed - track.delay

  if (!isStarted || trackPhase <= 0) {
    return maybeStartValue
  } else {
    const position =
      isLooping && track.duration > 0 ? trackPhase % track.duration : trackPhase
    return valueAtPosition(track.steps, prop, position)
  }
}

const currentValues = (clip: ClipStatic, phase: Phase): Values =>
  pipe(
    clip.tracks,
    Array.flatMap(track =>
      Array.map(
        Option.match(track.maybeProp, {
          onNone: () => clip.props,
          onSome: Array.of,
        }),
        prop =>
          Option.map(
            trackValue(track, prop, phase),
            (value): readonly [string, Value] => [prop, value],
          ),
      ),
    ),
    Array.getSomes,
    Record.fromEntries,
  )

const progressOf = (
  duration: number,
  position: number,
  isStarted: boolean,
): number => {
  if (duration > 0) {
    return clamp(position / duration, 0, 1)
  } else if (isStarted) {
    return 1
  } else {
    return 0
  }
}

/** Samples one clip. `time` is the playhead. `cycleTime` is continuous time
 *  across timeline loop wraps, so looping clips keep their phase when the
 *  playhead wraps. Pass `time` for both to get the first-pass state, which
 *  is what seeking shows. */
export const sampleClip = (
  clip: ClipStatic,
  time: number,
  cycleTime: number,
): ClipValues => {
  const isLooping = clip.loop === 'Repeat' && clip.duration > 0
  const isStarted = time >= clip.at || (isLooping && cycleTime > time)
  const isDone = time >= clip.end
  const phaseElapsed = isLooping ? cycleTime - clip.at : time - clip.at
  const basePosition = isStarted
    ? foldCycle(Math.max(0, phaseElapsed), clip.duration, isLooping)
    : 0
  const phase: Phase = { isStarted, isLooping, phaseElapsed }
  const timing = {
    at: clip.at,
    duration: clip.duration,
    loop: clip.loop,
    started: isStarted,
    active: isStarted && !isDone,
    done: isDone,
    progress: progressOf(clip.duration, basePosition, isStarted),
  }
  const endpoints = () => ({
    from: clip.from,
    to: clip.to,
    current: currentValues(clip, phase),
    animate: isStarted ? clip.to : clip.from,
  })

  return Clip.match<ClipValues>(clip.clip, {
    Marker: () => ClipValues.Marker(timing),
    Tween: ({ transition, duration }) => {
      const effective = effectiveTransition(transition, duration)
      return ClipValues.Tween({
        ...timing,
        ...endpoints(),
        transition: effective.transition,
        css: cssOf(effective.transition),
      })
    },
    Sequence: () =>
      ClipValues.Sequence({
        ...timing,
        ...endpoints(),
        step: pipe(
          Array.head(clip.tracks),
          Option.filter(() => isStarted),
          Option.match({
            onNone: () => 0,
            onSome: ({ steps }) => stepIndexAt(steps, basePosition),
          }),
        ),
      }),
    Tracks: () => ClipValues.Tracks({ ...timing, ...endpoints() }),
  })
}

const foldCycle = (
  elapsed: number,
  duration: number,
  isLooping: boolean,
): number => (isLooping ? elapsed % duration : elapsed)

/** CSS transition values for an effective transition: its duration in
 *  seconds and its timing function. */
export const cssOf = (transition: Transition): ClipCss => ({
  transitionDuration: `${Number.round(cssDurationOf(transition), CSS_DURATION_DECIMALS)}s`,
  transitionTimingFunction: toCssTimingFunction(transition),
})

/** One sampled clip with the names it is reported under. */
export type SampledClip = Readonly<{
  key: string
  name: string
  maybeGroup: Option.Option<string>
  values: ClipValues
}>

/** Samples every clip of a resolved timeline. */
export const sampleTimeline = (
  timelineStatic: TimelineStatic,
  time: number,
  cycleTime: number,
): ReadonlyArray<SampledClip> =>
  Array.map(timelineStatic.clips, clipStatic => ({
    key: clipStatic.key,
    name: clipStatic.name,
    maybeGroup: clipStatic.maybeGroup,
    values: sampleClip(clipStatic, time, cycleTime),
  }))

type NamedClip = Readonly<{ name: string; maybeGroup: Option.Option<string> }>

const groupNamesOf = (items: ReadonlyArray<NamedClip>): ReadonlyArray<string> =>
  Array.dedupe(Array.getSomes(Array.map(items, ({ maybeGroup }) => maybeGroup)))

/** Keys each item by its name, with grouped items nested under their
 *  group's name. `wrapGroup` shapes the record of one group. Ungrouped
 *  items come first, then groups in order of appearance. */
const nestByGroup = <Item extends NamedClip>(
  items: ReadonlyArray<Item>,
  toValue: (item: Item) => unknown,
  wrapGroup: (clips: Readonly<Record<string, unknown>>) => unknown,
): Readonly<Record<string, unknown>> => {
  const entryOf = (item: Item): readonly [string, unknown] => [
    item.name,
    toValue(item),
  ]
  const ungrouped = pipe(
    items,
    Array.filter(({ maybeGroup }) => Option.isNone(maybeGroup)),
    Array.map(entryOf),
  )
  const grouped = Array.map(
    groupNamesOf(items),
    (groupName): readonly [string, unknown] => [
      groupName,
      wrapGroup(
        pipe(
          items,
          Array.filter(({ maybeGroup }) =>
            Option.contains(maybeGroup, groupName),
          ),
          Array.map(entryOf),
          Record.fromEntries,
        ),
      ),
    ],
  )

  return Record.fromEntries([...ungrouped, ...grouped])
}

/** Samples a timeline at `time` and returns each clip's values under its
 *  config name, with grouped clips nested under their group. `cycleTime`
 *  defaults to `time`, the first-pass state. */
export const valuesAt = <Entries>(
  timeline: TimelineOf<Entries>,
  time: number,
  cycleTime: number = time,
): ValuesOf<Entries> =>
  // NOTE: this is the one place the runtime record meets the config's
  // type-level shape. The record is built from the same clips the shape
  // describes, so the keys and variants match by construction.
  /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
  nestByGroup(
    sampleTimeline(resolve(timeline), time, cycleTime),
    ({ values }) => values,
    Function.identity,
  ) as ValuesOf<Entries>

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

// EDIT CLAMPS

/** Clamps a moved clip start so the whole bar stays inside the timeline. */
export const clampClipMove = (
  at: number,
  duration: number,
  timelineDuration: number,
): number =>
  clamp(roundToHundredths(at), 0, Math.max(0, timelineDuration - duration))

/** Clamps a duration dragged from the end edge. */
export const clampClipResizeEnd = (
  duration: number,
  at: number,
  timelineDuration: number,
): number =>
  clamp(roundToHundredths(duration), MIN_CLIP_DURATION, timelineDuration - at)

/** Clamps a start dragged from the start edge. The end stays put, so the
 *  duration takes up the difference. */
export const clampClipResizeStart = (
  nextAt: number,
  at: number,
  duration: number,
): Readonly<{ at: number; duration: number }> => {
  const clampedAt = clamp(
    roundToHundredths(nextAt),
    0,
    at + duration - MIN_CLIP_DURATION,
  )
  return {
    at: clampedAt,
    duration: roundToHundredths(at + duration - clampedAt),
  }
}

/** Clamps one leg of a sequence. The other legs keep their length, and the
 *  whole bar must still fit the timeline. */
export const clampStepResize = (
  duration: number,
  at: number,
  otherStepsTotal: number,
  timelineDuration: number,
): number =>
  clamp(
    roundToHundredths(duration),
    MIN_CLIP_DURATION,
    Math.max(MIN_CLIP_DURATION, timelineDuration - at - otherStepsTotal),
  )

/** Clamps a property track's delay so the track stays inside the
 *  timeline. */
export const clampTrackDelay = (
  delay: number,
  at: number,
  trackDuration: number,
  timelineDuration: number,
): number =>
  clamp(
    roundToHundredths(delay),
    0,
    Math.max(0, roundToHundredths(timelineDuration - at - trackDuration)),
  )

// EDITING

/** Finds a clip by its key. */
export const findClip = (
  timeline: Timeline,
  key: string,
): Option.Option<TimelineClip> =>
  Array.findFirst(timeline.clips, timelineClip => clipKey(timelineClip) === key)

/** Replaces the clip with `key` by applying `updateClip`. */
export const modifyClip =
  (key: string, updateClip: (clip: Clip) => Clip) =>
  (timeline: Timeline): Timeline =>
    modifyFields(timeline, {
      clips: Array.map(timelineClip =>
        clipKey(timelineClip) === key
          ? modifyFields(timelineClip, { clip: updateClip })
          : timelineClip,
      ),
    })

const modifyIndex =
  <A>(index: number, updateItem: (item: A) => A) =>
  (items: Array.NonEmptyReadonlyArray<A>): Array.NonEmptyReadonlyArray<A> =>
    Array.map(items, (item, itemIndex) =>
      itemIndex === index ? updateItem(item) : item,
    )

const modifyTrack = (prop: string, updateTrack: (track: Track) => Track) =>
  Array.map((track: Track) =>
    track.prop === prop ? updateTrack(track) : track,
  )

/** Finds a property track of a `Tracks` clip. */
export const trackOf = (clip: Clip, prop: string): Option.Option<Track> =>
  Clip.matchOrElse(
    clip,
    {
      Tracks: ({ tracks: clipTracks }) =>
        Array.findFirst(clipTracks, track => track.prop === prop),
    },
    () => Option.none(),
  )

/** Moves a clip to start at `at`. */
export const setClipStart = (clip: Clip, at: number): Clip =>
  modifyFields(clip, { at: () => at })

/** Sets the delay of a property track. */
export const setTrackDelay = (clip: Clip, prop: string, delay: number): Clip =>
  Clip.matchOrElse(
    clip,
    {
      Tracks: tracksClip =>
        modifyFields(tracksClip, {
          tracks: modifyTrack(prop, track =>
            modifyFields(track, { delay: () => delay }),
          ),
        }),
    },
    () => clip,
  )

const stepDurationAt = <A extends Readonly<{ duration: number }>>(
  steps: Array.NonEmptyReadonlyArray<A>,
  index: number,
): Option.Option<number> =>
  Option.map(Array.get(steps, index), ({ duration }) => duration)

/** The stored bar duration of a span. A sequence or `Tracks` clip as a
 *  whole has none, since its length comes from its parts. */
export const spanDuration = (clip: Clip, span: Span): Option.Option<number> =>
  Span.match<Option.Option<number>>(span, {
    Whole: () =>
      Clip.matchOrElse(
        clip,
        {
          Marker: ({ duration }) => Option.some(duration),
          Tween: ({ duration }) => Option.some(duration),
        },
        () => Option.none(),
      ),
    Step: ({ index }) =>
      Clip.matchOrElse(
        clip,
        { Sequence: ({ steps }) => stepDurationAt(steps, index) },
        () => Option.none(),
      ),
    Track: ({ prop }) =>
      Option.flatMap(trackOf(clip, prop), track =>
        Track.match<Option.Option<number>>(track, {
          Tween: ({ duration }) => Option.some(duration),
          Sequence: () => Option.none(),
        }),
      ),
    TrackStep: ({ prop, index }) =>
      Option.flatMap(trackOf(clip, prop), track =>
        Track.match<Option.Option<number>>(track, {
          Tween: () => Option.none(),
          Sequence: ({ steps }) => stepDurationAt(steps, index),
        }),
      ),
  })

type Timed = Readonly<{ duration: number }>

const modifyTimedFields = makeModifyFieldsFor<Timed>()

const withDuration =
  (duration: number) =>
  <A extends Timed>(item: A): A =>
    modifyTimedFields(item, { duration: () => duration })

/** Sets the stored bar duration of a span. */
export const setSpanDuration = (
  clip: Clip,
  span: Span,
  duration: number,
): Clip =>
  Span.match<Clip>(span, {
    Whole: () =>
      Clip.matchOrElse(
        clip,
        {
          Marker: withDuration(duration),
          Tween: withDuration(duration),
        },
        () => clip,
      ),
    Step: ({ index }) =>
      Clip.matchOrElse(
        clip,
        {
          Sequence: sequenceClip =>
            modifyFields(sequenceClip, {
              steps: modifyIndex(index, withDuration(duration)),
            }),
        },
        () => clip,
      ),
    Track: ({ prop }) =>
      modifyTracksClip(clip, prop, track =>
        Track.matchOrElse(
          track,
          { Tween: withDuration(duration) },
          () => track,
        ),
      ),
    TrackStep: ({ prop, index }) =>
      modifyTracksClip(clip, prop, track =>
        Track.matchOrElse(
          track,
          {
            Sequence: trackSequence =>
              modifyFields(trackSequence, {
                steps: modifyIndex(index, withDuration(duration)),
              }),
          },
          () => track,
        ),
      ),
  })

const modifyTracksClip = (
  clip: Clip,
  prop: string,
  updateTrack: (track: Track) => Track,
): Clip =>
  Clip.matchOrElse(
    clip,
    {
      Tracks: tracksClip =>
        modifyFields(tracksClip, { tracks: modifyTrack(prop, updateTrack) }),
    },
    () => clip,
  )

/** The stored transition of a span, for spans that animate on one curve. */
export const spanTransition = (
  clip: Clip,
  span: Span,
): Option.Option<Transition> =>
  Span.match<Option.Option<Transition>>(span, {
    Whole: () =>
      Clip.matchOrElse(
        clip,
        { Tween: ({ transition }) => Option.some(transition) },
        () => Option.none(),
      ),
    Step: ({ index }) =>
      Clip.matchOrElse(
        clip,
        {
          Sequence: ({ steps }) =>
            Option.map(Array.get(steps, index), ({ transition }) => transition),
        },
        () => Option.none(),
      ),
    Track: ({ prop }) =>
      Option.flatMap(trackOf(clip, prop), track =>
        Track.match<Option.Option<Transition>>(track, {
          Tween: ({ transition }) => Option.some(transition),
          Sequence: () => Option.none(),
        }),
      ),
    TrackStep: ({ prop, index }) =>
      Option.flatMap(trackOf(clip, prop), track =>
        Track.match<Option.Option<Transition>>(track, {
          Tween: () => Option.none(),
          Sequence: ({ steps }) =>
            Option.map(Array.get(steps, index), ({ transition }) => transition),
        }),
      ),
  })

type Transitioned = Readonly<{ duration: number; transition: Transition }>

const modifyTransitionedFields = makeModifyFieldsFor<Transitioned>()

const withTransition =
  (transition: Transition) =>
  <A extends Transitioned>(item: A): A =>
    modifyTransitionedFields(item, {
      transition: () => transition,
      duration: duration =>
        isPhysics(transition) ? transitionDuration(transition) : duration,
    })

/** Sets the transition of a span. A physics spring also sets the span's
 *  bar to its settle time, since that length is derived. */
export const setSpanTransition = (
  clip: Clip,
  span: Span,
  transition: Transition,
): Clip =>
  Span.match<Clip>(span, {
    Whole: () =>
      Clip.matchOrElse(clip, { Tween: withTransition(transition) }, () => clip),
    Step: ({ index }) =>
      Clip.matchOrElse(
        clip,
        {
          Sequence: sequenceClip =>
            modifyFields(sequenceClip, {
              steps: modifyIndex(index, withTransition(transition)),
            }),
        },
        () => clip,
      ),
    Track: ({ prop }) =>
      modifyTracksClip(clip, prop, track =>
        Track.matchOrElse(
          track,
          { Tween: withTransition(transition) },
          () => track,
        ),
      ),
    TrackStep: ({ prop, index }) =>
      modifyTracksClip(clip, prop, track =>
        Track.matchOrElse(
          track,
          {
            Sequence: trackSequence =>
              modifyFields(trackSequence, {
                steps: modifyIndex(index, withTransition(transition)),
              }),
          },
          () => track,
        ),
      ),
  })

const isFirstStep = (index: number): boolean => index === 0

/** The starting values a span edits: a clip's `from`, which the first step
 *  of a sequence also shows, or a track's `from`. */
export const spanFrom = (clip: Clip, span: Span): Values => {
  const clipFrom = Clip.matchOrElse(
    clip,
    {
      Tween: ({ from }) => from,
      Sequence: ({ from }) => from,
    },
    () => NO_VALUES,
  )
  const trackFrom = (prop: string): Values =>
    Option.match(trackOf(clip, prop), {
      onNone: () => NO_VALUES,
      onSome: track => singleProp(prop, track.from),
    })

  return Span.match<Values>(span, {
    Whole: () => clipFrom,
    Step: ({ index }) => (isFirstStep(index) ? clipFrom : NO_VALUES),
    Track: ({ prop }) => trackFrom(prop),
    TrackStep: ({ prop, index }) =>
      isFirstStep(index) ? trackFrom(prop) : NO_VALUES,
  })
}

/** Sets one starting value of a span. */
export const setSpanFrom = (
  clip: Clip,
  span: Span,
  prop: string,
  value: Value,
): Clip => {
  const setClipFrom = (): Clip =>
    Clip.matchOrElse(
      clip,
      {
        Tween: tween => modifyFields(tween, { from: Record.set(prop, value) }),
        Sequence: sequenceClip =>
          modifyFields(sequenceClip, { from: Record.set(prop, value) }),
      },
      () => clip,
    )
  const setTrackFrom = (trackProp: string): Clip =>
    modifyTracksClip(clip, trackProp, track =>
      modifyFields(track, { from: () => value }),
    )

  return Span.match<Clip>(span, {
    Whole: setClipFrom,
    Step: setClipFrom,
    Track: ({ prop: trackProp }) => setTrackFrom(trackProp),
    TrackStep: ({ prop: trackProp }) => setTrackFrom(trackProp),
  })
}

/** The target values a span edits: a tween's `to`, a step's `to`, or a
 *  track's `to`. */
export const spanTo = (clip: Clip, span: Span): Values =>
  Span.match<Values>(span, {
    Whole: () =>
      Clip.matchOrElse(clip, { Tween: ({ to }) => to }, () => NO_VALUES),
    Step: ({ index }) =>
      Clip.matchOrElse(
        clip,
        {
          Sequence: ({ steps }) =>
            Option.match(Array.get(steps, index), {
              onNone: () => NO_VALUES,
              onSome: ({ to }) => to,
            }),
        },
        () => NO_VALUES,
      ),
    Track: ({ prop }) =>
      Option.match(trackOf(clip, prop), {
        onNone: () => NO_VALUES,
        onSome: track =>
          Track.match<Values>(track, {
            Tween: ({ to }) => singleProp(prop, to),
            Sequence: () => NO_VALUES,
          }),
      }),
    TrackStep: ({ prop, index }) =>
      Option.match(trackOf(clip, prop), {
        onNone: () => NO_VALUES,
        onSome: track =>
          Track.match<Values>(track, {
            Tween: () => NO_VALUES,
            Sequence: ({ steps }) =>
              Option.match(Array.get(steps, index), {
                onNone: () => NO_VALUES,
                onSome: ({ to }) => singleProp(prop, to),
              }),
          }),
      }),
  })

/** Sets one target value of a span. */
export const setSpanTo = (
  clip: Clip,
  span: Span,
  prop: string,
  value: Value,
): Clip =>
  Span.match<Clip>(span, {
    Whole: () =>
      Clip.matchOrElse(
        clip,
        {
          Tween: tween => modifyFields(tween, { to: Record.set(prop, value) }),
        },
        () => clip,
      ),
    Step: ({ index }) =>
      Clip.matchOrElse(
        clip,
        {
          Sequence: sequenceClip =>
            modifyFields(sequenceClip, {
              steps: modifyIndex(index, (step: Segment) =>
                modifyFields(step, { to: Record.set(prop, value) }),
              ),
            }),
        },
        () => clip,
      ),
    Track: ({ prop: trackProp }) =>
      modifyTracksClip(clip, trackProp, track =>
        Track.matchOrElse(
          track,
          { Tween: tween => modifyFields(tween, { to: () => value }) },
          () => track,
        ),
      ),
    TrackStep: ({ prop: trackProp, index }) =>
      modifyTracksClip(clip, trackProp, track =>
        Track.matchOrElse(
          track,
          {
            Sequence: trackSequence =>
              modifyFields(trackSequence, {
                steps: modifyIndex(index, (step: TrackSegment) =>
                  modifyFields(step, { to: () => value }),
                ),
              }),
          },
          () => track,
        ),
      ),
  })

// VALUE RANGES

/** A slider range for a from or to value. */
export type ValueRange = Readonly<{ min: number; max: number; step: number }>

const VALUE_RANGE_PRESETS: ReadonlyArray<
  Readonly<{ pattern: RegExp; range: ValueRange }>
> = [
  {
    pattern: /^(x|y|z|tx|ty|offsetx|offsety|translatex|translatey)$/i,
    range: { min: -100, max: 100, step: 1 },
  },
  { pattern: /rotat|angle|skew/i, range: { min: -180, max: 180, step: 1 } },
  { pattern: /^scale/i, range: { min: 0, max: 2, step: 0.01 } },
  { pattern: /opacity|alpha/i, range: { min: 0, max: 1, step: 0.01 } },
  { pattern: /blur|radius|spread/i, range: { min: 0, max: 100, step: 1 } },
]

const UNIT_RANGE: ValueRange = { min: 0, max: 1, step: 0.01 }
const FALLBACK_RANGE_MULTIPLIER = 2

/** A slider range for a property, sized by common property names (position,
 *  rotation, scale, opacity, blur) and expanded to include both endpoints. */
export const valueRange = (
  prop: string,
  value: number,
  maybeCounterpart: Option.Option<number>,
): ValueRange => {
  const counterpart = Option.getOrElse(maybeCounterpart, () => value)
  const low = Math.min(value, counterpart)
  const high = Math.max(value, counterpart)

  return pipe(
    VALUE_RANGE_PRESETS,
    Array.findFirst(({ pattern }) => pattern.test(prop)),
    Option.match({
      onSome: ({ range }) => ({
        min: Math.min(range.min, low),
        max: Math.max(range.max, high),
        step: range.step,
      }),
      onNone: () => {
        if (low >= 0 && high <= 1) {
          return UNIT_RANGE
        } else {
          const extent = Math.max(Math.abs(low), Math.abs(high), 1)
          const min = low < 0 ? -extent * FALLBACK_RANGE_MULTIPLIER : 0
          const max = Math.max(extent * FALLBACK_RANGE_MULTIPLIER, high)
          return { min, max, step: inferStep(min, max) }
        }
      },
    }),
  )
}

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

// EXPORT

const roundForExport = (value: number): number =>
  Number.round(value, EXPORT_DECIMALS)

const exportValues = (values: Values): Readonly<Record<string, Value>> =>
  Record.map(values, value =>
    Predicate.isNumber(value) ? roundForExport(value) : value,
  )

const exportTransition = (
  transition: Transition,
  duration: number,
): Readonly<Record<string, unknown>> =>
  Transition.match<Readonly<Record<string, unknown>>>(
    effectiveTransition(transition, duration).transition,
    {
      Easing: ({ duration: easingDuration, ease }) => ({
        _tag: 'Easing',
        duration: roundForExport(easingDuration),
        ease: Array.map(ease, roundForExport),
      }),
      TimeSpring: ({ visualDuration, bounce }) => ({
        _tag: 'TimeSpring',
        visualDuration: roundForExport(visualDuration),
        bounce: roundForExport(bounce),
      }),
      PhysicsSpring: ({ stiffness, damping, mass }) => ({
        _tag: 'PhysicsSpring',
        stiffness: roundForExport(stiffness),
        damping: roundForExport(damping),
        mass: roundForExport(mass),
      }),
    },
  )

const exportDuration = (transition: Transition, duration: number): number =>
  roundForExport(effectiveTransition(transition, duration).duration)

const exportLoop = (loop: ClipLoop): Readonly<Record<string, unknown>> =>
  loop === 'Repeat' ? { loop: true } : {}

const exportTrack = (track: Track): Readonly<Record<string, unknown>> => {
  const delay = track.delay > 0 ? { delay: roundForExport(track.delay) } : {}

  return Track.match<Readonly<Record<string, unknown>>>(track, {
    Tween: ({ from, to, duration, transition }) => ({
      from,
      to,
      duration: exportDuration(transition, duration),
      ...delay,
      transition: exportTransition(transition, duration),
    }),
    Sequence: ({ from, steps }) => ({
      from,
      ...delay,
      steps: Array.map(steps, step => ({
        duration: exportDuration(step.transition, step.duration),
        to: step.to,
        transition: exportTransition(step.transition, step.duration),
      })),
    }),
  })
}

const exportClip = (clip: Clip): Readonly<Record<string, unknown>> =>
  Clip.match<Readonly<Record<string, unknown>>>(clip, {
    Marker: ({ at, duration }) => ({
      kind: 'marker',
      at: roundForExport(at),
      duration: roundForExport(duration),
    }),
    Tween: ({ at, duration, from, to, transition, loop }) => ({
      kind: 'clip',
      at: roundForExport(at),
      duration: exportDuration(transition, duration),
      from: exportValues(from),
      to: exportValues(to),
      transition: exportTransition(transition, duration),
      ...exportLoop(loop),
    }),
    Sequence: ({ at, from, steps, loop }) => ({
      kind: 'sequence',
      at: roundForExport(at),
      from: exportValues(from),
      steps: Array.map(steps, step => ({
        duration: exportDuration(step.transition, step.duration),
        to: exportValues(step.to),
        transition: exportTransition(step.transition, step.duration),
      })),
      ...exportLoop(loop),
    }),
    Tracks: ({ at, tracks: clipTracks, loop }) => ({
      kind: 'tracks',
      at: roundForExport(at),
      props: Record.fromEntries(
        Array.map(clipTracks, track => [track.prop, exportTrack(track)]),
      ),
      ...exportLoop(loop),
    }),
  })

/** The tuned timeline as plain data in the shape of `make`'s config. Each
 *  clip records which constructor builds it under `kind`, and every
 *  duration and transition is the effective one. */
export const exportConfig = (
  timeline: Timeline,
): Readonly<Record<string, unknown>> => ({
  duration: roundForExport(resolve(timeline).duration),
  clips: nestByGroup(
    timeline.clips,
    ({ clip: timelineClip }) => exportClip(timelineClip),
    clips => ({ kind: 'group', clips }),
  ),
})

const JSON_INDENT = 2

/** The instruction Copy writes to the clipboard: the tuned config as JSON,
 *  and a production handoff note, as DialKit's Copy does. */
export const copyInstruction = (name: string, timeline: Timeline): string => {
  const json = JSON.stringify(exportConfig(timeline), null, JSON_INDENT)

  return `Update the Timeline.make configuration for "${name}" with these values:

\`\`\`json
${json}
\`\`\`

Each clip's \`kind\` names the constructor that builds it: Timeline.clip, Timeline.sequence, Timeline.tracks, Timeline.marker, or Timeline.group. Apply these values as the new defaults. Keep the existing \`clip.current\` bindings while this timeline is being authored; do not convert the animation or remove the dock yet.

Add this comment immediately above the Timeline.make call as a production handoff note:

\`\`\`ts
// TODO(production): the dock's clip.current values are the scrubbable authoring preview.
// Replace them with equivalent real animations using the tuned timeline
// timings and transitions, then remove Timeline.make and the DialTimeline dock.
\`\`\``
}
