import { Array, Equal, Option, Predicate, Record } from 'effect'
import { modifyFields } from 'foldkit/struct'
import * as Update from 'foldkit/update'

import { RadioGroup } from '@foldkit/ui'

import * as ScrubSlider from '../scrubSlider/index.js'
import * as Timeline from '../timeline/index.js'
import {
  Transition,
  type TransitionMode,
  defaultTransitionForMode,
} from '../transition/index.js'
import {
  PARAMETERS,
  type Parameter,
  parameterValue,
  withParameter,
} from '../transition/parameters.js'
import { durationOf } from './geometry.js'
import { editorFieldId, modeGroupId } from './ids.js'
import { Message } from './message.js'
import {
  type EditTarget,
  EditorField,
  type EditorSlider,
  type Model,
} from './model.js'

// EDITOR FIELDS

type FieldRange = Readonly<{ min: number; max: number; step: number }>

type FieldSpec = Readonly<{ field: EditorField; range: FieldRange }>

const TIME_STEP = 0.01

/** The parameters the clip editor shows for a transition: the four Bézier
 *  points, a time spring's bounce, or a physics spring's constants. */
export const parametersOf = (
  transition: Transition,
): ReadonlyArray<Parameter> =>
  Transition.match<ReadonlyArray<Parameter>>(transition, {
    Easing: () => ['EaseX1', 'EaseY1', 'EaseX2', 'EaseY2'],
    TimeSpring: () => ['Bounce'],
    PhysicsSpring: () => ['Stiffness', 'Damping', 'Mass'],
  })

const isStartEditable = (span: Timeline.Span): boolean =>
  Timeline.Span.match(span, {
    Whole: () => true,
    Step: () => false,
    Track: () => true,
    TrackStep: () => false,
  })

/** Whether a span animates on a physics spring, whose bar length is
 *  derived. */
export const isPhysicsSpan = (
  clip: Timeline.Clip,
  span: Timeline.Span,
): boolean =>
  Option.exists(
    Timeline.spanTransition(clip, span),
    ({ _tag }) => _tag === 'PhysicsSpring',
  )

const numberIn = (
  values: Timeline.Values,
  prop: string,
): Option.Option<number> =>
  Option.filter(Record.get(values, prop), Predicate.isNumber)

const valueFieldSpecs = (
  values: Timeline.Values,
  counterparts: Timeline.Values,
  toField: (prop: string) => EditorField,
): ReadonlyArray<FieldSpec> =>
  Array.getSomes(
    Array.map(Record.keys(values), prop =>
      Option.map(numberIn(values, prop), value => ({
        field: toField(prop),
        range: Timeline.valueRange(prop, value, numberIn(counterparts, prop)),
      })),
    ),
  )

const fieldSpecsFor = (
  timeline: Timeline.Timeline,
  { key, span }: EditTarget,
): ReadonlyArray<FieldSpec> =>
  Option.match(Timeline.findClip(timeline, key), {
    onNone: () => [],
    onSome: ({ clip }) => {
      const duration = Timeline.durationOfTimeline(timeline)
      const maybeStartSpec: Option.Option<FieldSpec> = Option.liftPredicate(
        {
          field: EditorField.Start(),
          range: { min: 0, max: duration, step: TIME_STEP },
        },
        () => isStartEditable(span),
      )
      const maybeDurationSpec: Option.Option<FieldSpec> = Option.liftPredicate(
        {
          field: EditorField.Duration(),
          range: {
            min: Timeline.MIN_CLIP_DURATION,
            max: duration,
            step: TIME_STEP,
          },
        },
        () =>
          Option.isSome(Timeline.spanDuration(clip, span)) &&
          !isPhysicsSpan(clip, span),
      )
      const parameterSpecs = Array.map(
        Option.match(Timeline.spanTransition(clip, span), {
          onNone: (): ReadonlyArray<Parameter> => [],
          onSome: parametersOf,
        }),
        (parameter): FieldSpec => ({
          field: EditorField.Parameter({ parameter }),
          range: PARAMETERS[parameter],
        }),
      )
      const from = Timeline.spanFrom(clip, span)
      const to = Timeline.spanTo(clip, span)

      return [
        ...Array.fromOption(maybeStartSpec),
        ...Array.fromOption(maybeDurationSpec),
        ...parameterSpecs,
        ...valueFieldSpecs(from, to, prop => EditorField.From({ prop })),
        ...valueFieldSpecs(to, from, prop => EditorField.To({ prop })),
      ]
    },
  })

const editorSlidersFor = (
  model: Model,
  target: EditTarget,
): ReadonlyArray<EditorSlider> =>
  Array.map(fieldSpecsFor(model.timeline, target), ({ field, range }) => ({
    field,
    slider: ScrubSlider.init({
      id: editorFieldId(model.id, field),
      min: range.min,
      max: range.max,
      step: range.step,
    }),
  }))

const openEditor = (model: Model, target: EditTarget): Model =>
  modifyFields(model, {
    maybeEditor: () =>
      Option.some({
        target,
        sliders: editorSlidersFor(model, target),
        modeGroup: RadioGroup.init({ id: modeGroupId(model.id) }),
      }),
  })

/** Closes the clip editor. */
export const closeEditor = (model: Model): Model =>
  modifyFields(model, { maybeEditor: () => Option.none() })

/** Opens the clip editor on `target`, or closes it when it already edits
 *  `target`. */
export const toggleEditor = (model: Model, target: EditTarget): Model => {
  const isOpenOnTarget = Option.exists(model.maybeEditor, editor =>
    Equal.equals(editor.target, target),
  )

  if (isOpenOnTarget) {
    return closeEditor(model)
  } else {
    return openEditor(model, target)
  }
}

const refreshEditorSliders = (model: Model): Model =>
  modifyFields(model, {
    maybeEditor: Option.map(editor =>
      modifyFields(editor, {
        sliders: () => editorSlidersFor(model, editor.target),
      }),
    ),
  })

/** The current value of an editor field, read from the edited timeline. */
export const fieldValue = (
  timeline: Timeline.Timeline,
  { key, span }: EditTarget,
  field: EditorField,
): Option.Option<number> =>
  Option.flatMap(Timeline.findClip(timeline, key), ({ clip }) =>
    EditorField.match<Option.Option<number>>(field, {
      Start: () =>
        Timeline.Span.matchOrElse(
          span,
          {
            Whole: () => Option.some(clip.at),
            Track: ({ prop }) =>
              Option.map(Timeline.trackOf(clip, prop), ({ delay }) => delay),
          },
          () => Option.none(),
        ),
      Duration: () => Timeline.spanDuration(clip, span),
      Parameter: ({ parameter }) =>
        Option.flatMap(Timeline.spanTransition(clip, span), transition =>
          parameterValue(transition, parameter),
        ),
      From: ({ prop }) => numberIn(Timeline.spanFrom(clip, span), prop),
      To: ({ prop }) => numberIn(Timeline.spanTo(clip, span), prop),
    }),
  )

/** Finds a clip of the resolved timeline by key. */
export const staticClipOf = (
  timeline: Timeline.Timeline,
  key: string,
): Option.Option<Timeline.ClipStatic> =>
  Array.findFirst(
    Timeline.resolve(timeline).clips,
    clipStatic => clipStatic.key === key,
  )

/** Finds one resolved property track of a clip. */
export const trackStaticOf = (
  clipStatic: Timeline.ClipStatic,
  prop: string,
): Option.Option<Timeline.TrackStatic> =>
  Array.findFirst(clipStatic.tracks, ({ maybeProp }) =>
    Option.contains(maybeProp, prop),
  )

const editedClip = (
  clip: Timeline.Clip,
  clipStatic: Timeline.ClipStatic,
  timelineDuration: number,
  span: Timeline.Span,
  field: EditorField,
  value: Timeline.Value,
): Timeline.Clip => {
  const withNumber = (
    toClip: (numericValue: number) => Timeline.Clip,
  ): Timeline.Clip => (Predicate.isNumber(value) ? toClip(value) : clip)

  return EditorField.match<Timeline.Clip>(field, {
    Start: () =>
      withNumber(start =>
        Timeline.Span.matchOrElse(
          span,
          {
            Whole: () =>
              Timeline.setClipStart(
                clip,
                Timeline.clampClipMove(
                  start,
                  clipStatic.duration,
                  timelineDuration,
                ),
              ),
            Track: ({ prop }) =>
              Option.match(trackStaticOf(clipStatic, prop), {
                onNone: () => clip,
                onSome: track =>
                  Timeline.setTrackDelay(
                    clip,
                    prop,
                    Timeline.clampTrackDelay(
                      start,
                      clip.at,
                      track.duration,
                      timelineDuration,
                    ),
                  ),
              }),
          },
          () => clip,
        ),
      ),
    Duration: () =>
      withNumber(duration =>
        Timeline.setSpanDuration(
          clip,
          span,
          Math.max(Timeline.MIN_CLIP_DURATION, duration),
        ),
      ),
    Parameter: ({ parameter }) =>
      withNumber(parameterNumber =>
        Option.match(Timeline.spanTransition(clip, span), {
          onNone: () => clip,
          onSome: transition =>
            Timeline.setSpanTransition(
              clip,
              span,
              withParameter(transition, parameter, parameterNumber),
            ),
        }),
      ),
    From: ({ prop }) => Timeline.setSpanFrom(clip, span, prop, value),
    To: ({ prop }) => Timeline.setSpanTo(clip, span, prop, value),
  })
}

/** Writes one editor field's value into the clip the editor edits. */
export const applyEditorField = (
  model: Model,
  field: EditorField,
  value: Timeline.Value,
): Model =>
  Option.match(model.maybeEditor, {
    onNone: () => model,
    onSome: ({ target: { key, span } }) =>
      Option.match(staticClipOf(model.timeline, key), {
        onNone: () => model,
        onSome: clipStatic =>
          modifyFields(model, {
            timeline: Timeline.modifyClip(key, clip =>
              editedClip(
                clip,
                clipStatic,
                durationOf(model),
                span,
                field,
                value,
              ),
            ),
          }),
      }),
  })

const selectTransitionMode = (model: Model, mode: TransitionMode): Model =>
  Option.match(model.maybeEditor, {
    onNone: () => model,
    onSome: ({ target: { key, span } }) =>
      refreshEditorSliders(
        modifyFields(model, {
          timeline: Timeline.modifyClip(key, clip =>
            Option.match(Timeline.spanTransition(clip, span), {
              onNone: () => clip,
              onSome: transition =>
                transition._tag === mode
                  ? clip
                  : Timeline.setSpanTransition(
                      clip,
                      span,
                      defaultTransitionForMode(mode),
                    ),
            }),
          ),
        }),
      ),
  })

/** Finds the editor slider for a field. */
export const findEditorSlider = (
  model: Model,
  field: EditorField,
): Option.Option<EditorSlider> =>
  Option.flatMap(model.maybeEditor, editor =>
    Array.findFirst(editor.sliders, editorSlider =>
      Equal.equals(editorSlider.field, field),
    ),
  )

/** Finds the editor slider whose ScrubSlider has `sliderId`. */
export const findEditorSliderById = (
  model: Model,
  sliderId: string,
): Option.Option<EditorSlider> =>
  Option.flatMap(model.maybeEditor, editor =>
    Array.findFirst(editor.sliders, ({ slider }) => slider.id === sliderId),
  )

// NOTE: only one editor slider can drag at a time, so the lifted ScrubSlider
// Subscriptions follow whichever slider is dragging.
/** The editor slider being dragged, if any. */
export const draggingEditorSlider = (
  model: Model,
): Option.Option<EditorSlider> =>
  Option.flatMap(model.maybeEditor, editor =>
    Array.findFirst(editor.sliders, ({ slider }) =>
      ScrubSlider.isDragging(slider),
    ),
  )

const foldEditorSliderOutMessage = (field: EditorField) =>
  ScrubSlider.OutMessage.match<Update.Step<Model, Message>>({
    ChangedValue:
      ({ value }) =>
      model => ({ model: applyEditorField(model, field, value) }),
  })

/** Folds a ScrubSlider Message into its editor slider, and writes a
 *  changed value into the clip. */
export const foldEditorSlider = ({
  field,
  slider: { id: sliderId },
}: EditorSlider) =>
  Update.foldChild({
    update: ScrubSlider.update,
    read: (model: Model) =>
      Option.map(findEditorSlider(model, field), ({ slider }) => slider),
    write: (model, nextSlider) =>
      modifyFields(model, {
        maybeEditor: Option.map(editor =>
          modifyFields(editor, {
            sliders: Array.map(editorSlider =>
              Equal.equals(editorSlider.field, field)
                ? modifyFields(editorSlider, { slider: () => nextSlider })
                : editorSlider,
            ),
          }),
        ),
      }),
    toParentMessage: message => Message.GotSliderMessage({ sliderId, message }),
    foldOutMessage: foldEditorSliderOutMessage(field),
  })

/** The RadioGroup bundle behind the editor's Easing, Time, and Physics
 *  switch. */
export const ModeGroup: RadioGroup.Bundle<TransitionMode> =
  RadioGroup.create<TransitionMode>()

const foldModeOutMessage = (
  outMessage: RadioGroup.OutMessage<TransitionMode>,
): Update.Step<Model, Message> =>
  RadioGroup.OutMessage.match<
    Update.Step<Model, Message>,
    RadioGroup.OutMessage<TransitionMode>
  >(outMessage, {
    Selected:
      ({ value: mode }) =>
      model => ({ model: selectTransitionMode(model, mode) }),
  })

/** Folds a RadioGroup Message into the editor's mode switch, and swaps
 *  in the default transition of a newly selected mode. */
export const foldModeGroup = Update.foldChild({
  update: ModeGroup.update,
  read: (model: Model) =>
    Option.map(model.maybeEditor, ({ modeGroup }) => modeGroup),
  write: (model, nextModeGroup) =>
    modifyFields(model, {
      maybeEditor: Option.map(editor =>
        modifyFields(editor, { modeGroup: () => nextModeGroup }),
      ),
    }),
  toParentMessage: message => Message.GotModeMessage({ message }),
  foldOutMessage: foldModeOutMessage,
})
