import { Array, Effect, Fiber, Option, Record, Stream, pipe } from 'effect'
import * as Story from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import * as Subscription from 'foldkit/subscription'
import { describe, expect, it, vi } from 'vitest'

import { RadioGroup } from '@foldkit/ui'

import * as ScrubSlider from '../scrubSlider/index.js'
import * as Timeline from '../timeline/index.js'
import { Transition } from '../transition/index.js'
import {
  BarHandle,
  BarRow,
  CopyTimeline,
  EditorField,
  FocusBar,
  Message,
  OutMessage,
  WaitBeforeResetCopy,
  editorFieldId,
  fieldKey,
  isContinuousMessage,
  make,
  update,
  valuesOf,
} from './index.js'
import type { Model } from './index.js'

const easing = Transition.Easing({ duration: 0.5, ease: [0.65, 0, 0.35, 1] })

const timeline = Timeline.make({
  duration: 2,
  clips: {
    card: Timeline.clip({
      at: 0.4,
      duration: 0.6,
      from: { y: 24, color: '#000000' },
      to: { y: 0, color: '#ffffff' },
      transition: easing,
    }),
    path: Timeline.sequence({
      at: 0,
      from: { x: 0 },
      transition: easing,
      steps: [
        { duration: 0.5, to: { x: 10 } },
        { duration: 0.5, to: { x: 20 } },
      ],
    }),
    layer: Timeline.group({
      float: Timeline.tracks({
        at: 0,
        props: { y: { from: 0, to: 9, duration: 0.6, transition: easing } },
      }),
    }),
    bounce: Timeline.clip({
      at: 1,
      from: { scale: 0 },
      to: { scale: 1 },
      transition: Transition.PhysicsSpring({
        stiffness: 200,
        damping: 25,
        mass: 1,
      }),
    }),
  },
})

const RULER_WIDTH = 400

const Dock = make({ name: 'Hero', timeline, autoplay: false })

const measured = (model: Model): Model =>
  update(model, Message.ResizedRuler({ width: RULER_WIDTH })).model

const paused = (): Model => measured(Dock.init())

const after = (model: Model, ...messages: ReadonlyArray<Message>): Model =>
  Array.reduce(
    messages,
    model,
    (current, message) => update(current, message).model,
  )

const playing = (): Model => after(paused(), Message.RequestedPlay())

const clipOf = (model: Model, key: string): Timeline.Clip =>
  Option.getOrThrow(Timeline.findClip(model.timeline, key)).clip

const cardRow = BarRow.Clip({ key: 'card' })
const body = BarHandle.Body({ maybeStepIndex: Option.none() })

const pressCard = (fraction: number) =>
  Message.PressedBar({ row: cardRow, handle: body, fraction })

const editorFields = (model: Model): ReadonlyArray<string> =>
  Option.match(model.maybeEditor, {
    onNone: () => [],
    onSome: ({ sliders }) => Array.map(sliders, ({ field }) => fieldKey(field)),
  })

const withCardEditor = (): Model =>
  after(paused(), pressCard(0.3), Message.ReleasedDragPointer())

const VIEWPORT_HEIGHT = 900

const withViewport = (): Model =>
  after(paused(), Message.ResizedViewport({ height: VIEWPORT_HEIGHT }))

describe('DialTimeline', () => {
  describe('init', () => {
    it('starts paused at 0 when autoplay is off', () => {
      const model = Dock.init()

      expect([model.time, model.isPlaying]).toEqual([0, false])
    })

    it('plays on init by default', () => {
      expect(make({ name: 'Hero', timeline }).init().isPlaying).toBe(true)
    })

    it('does not autoplay a timeline with no duration', () => {
      const empty = make({
        name: 'Empty',
        timeline: { minimumDuration: 0, clips: [] },
      })

      expect(empty.init().isPlaying).toBe(false)
    })

    it('derives its id from the name unless one is given', () => {
      expect(make({ name: 'Hero Card', timeline }).init().id).toBe('hero-card')
      expect(make({ name: 'Hero', timeline, id: 'intro' }).init().id).toBe(
        'intro',
      )
    })
  })

  describe('playback', () => {
    it('advances time by each frame while playing', () => {
      Story.story(
        update,
        Story.given(playing()),
        Story.message(Message.TickedFrame({ deltaTime: 16 })),
        Story.model(model => {
          expect(model.time).toBeCloseTo(0.016)
        }),
      )
    })

    it('caps a long frame, such as the first after a hidden tab', () => {
      Story.story(
        update,
        Story.given(playing()),
        Story.message(Message.TickedFrame({ deltaTime: 5000 })),
        Story.model(model => {
          expect(model.time).toBeCloseTo(0.1)
        }),
      )
    })

    it('ignores frames while paused', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(Message.TickedFrame({ deltaTime: 16 })),
        Story.model(model => {
          expect(model.time).toBe(0)
        }),
      )
    })

    it('stops at the end without a loop', () => {
      Story.story(
        update,
        Story.given(after(playing(), Message.RequestedSeek({ time: 1.95 }))),
        Story.message(Message.TickedFrame({ deltaTime: 100 })),
        Story.model(model => {
          expect([model.time, model.isPlaying]).toEqual([2, false])
        }),
      )
    })

    it('wraps to the start when looping', () => {
      const looping = make({ name: 'Hero', timeline, loop: true }).init()

      Story.story(
        update,
        Story.given(after(looping, Message.RequestedSeek({ time: 1.95 }))),
        Story.message(Message.TickedFrame({ deltaTime: 100 })),
        Story.model(model => {
          expect(model.time).toBeCloseTo(0.05)
          expect([model.wraps, model.isPlaying]).toEqual([1, true])
        }),
      )
    })

    it('wraps to the loop start with loop from', () => {
      const looping = make({
        name: 'Hero',
        timeline,
        loop: { from: 1 },
      }).init()

      Story.story(
        update,
        Story.given(after(looping, Message.RequestedSeek({ time: 1.95 }))),
        Story.message(Message.TickedFrame({ deltaTime: 100 })),
        Story.model(model => {
          expect(model.time).toBeCloseTo(1.05)
        }),
      )
    })

    it('restarts from 0 when play is pressed at the end', () => {
      Story.story(
        update,
        Story.given(after(paused(), Message.RequestedSeek({ time: 2 }))),
        Story.message(Message.RequestedPlay()),
        Story.model(model => {
          expect([model.time, model.isPlaying]).toEqual([0, true])
        }),
      )
    })

    it('replays from 0', () => {
      Story.story(
        update,
        Story.given(after(paused(), Message.RequestedSeek({ time: 1.2 }))),
        Story.message(Message.RequestedReplay()),
        Story.model(model => {
          expect([model.time, model.isPlaying]).toEqual([0, true])
        }),
      )
    })

    it('stops instead of advancing a timeline with no duration', () => {
      const empty = make({
        name: 'Empty',
        timeline: { minimumDuration: 0, clips: [] },
        autoplay: false,
      })

      Story.story(
        update,
        Story.given(after(empty.init(), Message.RequestedPlay())),
        Story.model(model => {
          expect(model.isPlaying).toBe(false)
        }),
      )
    })

    it('clamps a seek to the timeline', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(Message.RequestedSeek({ time: 5 })),
        Story.model(model => {
          expect(model.time).toBe(2)
        }),
      )
    })
  })

  describe('ruler and playhead', () => {
    it('pauses while scrubbing the ruler and resumes afterwards', () => {
      Story.story(
        update,
        Story.given(playing()),
        Story.message(
          Message.PressedRuler({ fraction: 0.25, gesture: 'Seek' }),
        ),
        Story.model(model => {
          expect([model.time, model.isPlaying]).toEqual([0.5, false])
        }),
        Story.message(Message.MovedLanePointer({ fraction: 0.5 })),
        Story.model(model => {
          expect(model.time).toBe(1)
        }),
        Story.message(Message.ReleasedDragPointer()),
        Story.model(model => {
          expect([model.isPlaying, model.dragState._tag]).toEqual([
            true,
            'Idle',
          ])
        }),
      )
    })

    it('stays paused after a scrub that started paused', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(Message.PressedPlayhead()),
        Story.message(Message.MovedLanePointer({ fraction: 0.75 })),
        Story.message(Message.ReleasedDragPointer()),
        Story.model(model => {
          expect([model.time, model.isPlaying]).toEqual([1.5, false])
        }),
      )
    })

    it('resumes when a scrub is cancelled', () => {
      Story.story(
        update,
        Story.given(playing()),
        Story.message(Message.PressedPlayhead()),
        Story.message(Message.CancelledDrag()),
        Story.model(model => {
          expect(model.isPlaying).toBe(true)
        }),
      )
    })

    it('zooms around the pressed point with an Alt-drag', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(Message.PressedRuler({ fraction: 0.5, gesture: 'Zoom' })),
        Story.message(
          Message.MovedLanePointer({ fraction: 0.5 + 180 / RULER_WIDTH }),
        ),
        Story.model(model => {
          expect(model.zoom).toBeCloseTo(Math.E)
          expect(model.viewStart).toBeCloseTo(1 - 0.5 * (2 / Math.E))
          expect(model.time).toBe(0)
        }),
      )
    })

    it('resets the zoom and seeks with a Shift-drag', () => {
      const zoomed = after(
        paused(),
        Message.PressedRuler({ fraction: 0.5, gesture: 'Zoom' }),
        Message.MovedLanePointer({ fraction: 0.9 }),
        Message.ReleasedDragPointer(),
      )

      Story.story(
        update,
        Story.given(zoomed),
        Story.message(
          Message.PressedRuler({ fraction: 0.5, gesture: 'ResetAndSeek' }),
        ),
        Story.model(model => {
          expect([model.zoom, model.viewStart, model.time]).toEqual([1, 0, 1])
        }),
      )
    })

    it('pans horizontally while zoomed', () => {
      const zoomed = after(
        paused(),
        Message.PressedRuler({ fraction: 0, gesture: 'Zoom' }),
        Message.MovedLanePointer({ fraction: 180 / RULER_WIDTH }),
        Message.ReleasedDragPointer(),
      )
      const visible = 2 / zoomed.zoom

      Story.story(
        update,
        Story.given(zoomed),
        Story.message(Message.ScrolledLanes({ deltaFraction: 0.5 })),
        Story.model(model => {
          expect(model.viewStart).toBeCloseTo(zoomed.viewStart + 0.5 * visible)
        }),
      )
    })

    it('moves the playhead with the keyboard', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(
          Message.PressedPlayheadNavigation({ direction: 'StepForward' }),
        ),
        Story.model(model => {
          expect(model.time).toBeCloseTo(0.1)
        }),
        Story.message(Message.PressedPlayheadNavigation({ direction: 'End' })),
        Story.model(model => {
          expect(model.time).toBe(2)
        }),
      )
    })

    it('scrolls a zoomed view so a keyboard seek stays in view', () => {
      const visible = 2 / 1.5

      Story.story(
        update,
        Story.given(after(paused(), Message.PressedZoomKey({ step: 'In' }))),
        Story.model(model => {
          expect(model.viewStart).toBe(0)
        }),
        Story.message(
          Message.PressedPlayheadNavigation({ direction: 'StepForward' }),
        ),
        Story.model(model => {
          expect(model.viewStart).toBe(0)
        }),
        Story.message(Message.PressedPlayheadNavigation({ direction: 'End' })),
        Story.model(model => {
          expect(model.time).toBe(2)
          expect(model.viewStart).toBeCloseTo(2 - visible)
        }),
        Story.message(
          Message.PressedPlayheadNavigation({ direction: 'StepBackward' }),
        ),
        Story.model(model => {
          expect(model.viewStart).toBeCloseTo(2 - visible)
        }),
        Story.message(Message.RequestedSeek({ time: 0.7 })),
        Story.message(
          Message.PressedPlayheadNavigation({ direction: 'StepBackward' }),
        ),
        Story.model(model => {
          expect(model.viewStart).toBeCloseTo(0.6)
        }),
        Story.message(
          Message.PressedPlayheadNavigation({ direction: 'Start' }),
        ),
        Story.model(model => {
          expect([model.time, model.viewStart]).toEqual([0, 0])
        }),
      )
    })

    it('zooms around the playhead with the keyboard', () => {
      Story.story(
        update,
        Story.given(after(paused(), Message.RequestedSeek({ time: 1 }))),
        Story.message(Message.PressedZoomKey({ step: 'In' })),
        Story.model(model => {
          expect(model.zoom).toBeCloseTo(1.5)
          expect(model.viewStart + 2 / model.zoom / 2).toBeCloseTo(1)
        }),
        Story.message(Message.PressedZoomKey({ step: 'Out' })),
        Story.model(model => {
          expect(model.zoom).toBeCloseTo(1)
        }),
        Story.message(Message.PressedZoomKey({ step: 'Out' })),
        Story.model(model => {
          expect(model.zoom).toBe(1)
        }),
        Story.message(Message.PressedZoomKey({ step: 'In' })),
        Story.message(Message.PressedZoomKey({ step: 'Reset' })),
        Story.model(model => {
          expect([model.zoom, model.viewStart]).toEqual([1, 0])
        }),
      )
    })
  })

  describe('bars', () => {
    it('moves a clip by dragging its body', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(pressCard(0.3)),
        Story.message(Message.MovedLanePointer({ fraction: 0.4 })),
        Story.model(model => {
          expect(clipOf(model, 'card').at).toBeCloseTo(0.6)
        }),
      )
    })

    it('ignores movement under the drag threshold', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(pressCard(0.3)),
        Story.message(Message.MovedLanePointer({ fraction: 0.305 })),
        Story.model(model => {
          expect(clipOf(model, 'card').at).toBe(0.4)
        }),
      )
    })

    it('resizes a clip from its end edge', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(
          Message.PressedBar({
            row: cardRow,
            handle: BarHandle.EndEdge(),
            fraction: 0.5,
          }),
        ),
        Story.message(Message.MovedLanePointer({ fraction: 0.55 })),
        Story.model(model => {
          expect(clipOf(model, 'card')).toMatchObject({
            at: 0.4,
            duration: 0.7,
          })
        }),
      )
    })

    it('resizes a clip from its start edge, keeping its end', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(
          Message.PressedBar({
            row: cardRow,
            handle: BarHandle.StartEdge(),
            fraction: 0.2,
          }),
        ),
        Story.message(Message.MovedLanePointer({ fraction: 0.25 })),
        Story.model(model => {
          expect(clipOf(model, 'card')).toMatchObject({
            at: 0.5,
            duration: 0.5,
          })
        }),
      )
    })

    it('resizes a sequence step from its boundary', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(
          Message.PressedBar({
            row: BarRow.Clip({ key: 'path' }),
            handle: BarHandle.Boundary({ index: 0 }),
            fraction: 0.25,
          }),
        ),
        Story.message(Message.MovedLanePointer({ fraction: 0.3 })),
        Story.model(model => {
          expect(
            Timeline.spanDuration(
              clipOf(model, 'path'),
              Timeline.Span.Step({ index: 0 }),
            ),
          ).toEqual(Option.some(0.6))
        }),
      )
    })

    it('moves a property track by changing its delay', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(
          Message.PressedBar({
            row: BarRow.Track({ key: 'layer.float', prop: 'y' }),
            handle: body,
            fraction: 0.1,
          }),
        ),
        Story.message(Message.MovedLanePointer({ fraction: 0.2 })),
        Story.model(model => {
          expect(
            Option.map(
              Timeline.trackOf(clipOf(model, 'layer.float'), 'y'),
              ({ delay }) => delay,
            ),
          ).toEqual(Option.some(0.2))
        }),
      )
    })

    it('restores the bar when the drag is cancelled', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(pressCard(0.3)),
        Story.message(Message.MovedLanePointer({ fraction: 0.5 })),
        Story.message(Message.CancelledDrag()),
        Story.model(model => {
          expect(clipOf(model, 'card').at).toBe(0.4)
        }),
      )
    })

    it('nudges a bar with the keyboard', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(
          Message.PressedBarNudge({
            row: cardRow,
            direction: 'Later',
            size: 'Fine',
          }),
        ),
        Story.model(model => {
          expect(clipOf(model, 'card').at).toBeCloseTo(0.41)
        }),
        Story.message(
          Message.PressedBarNudge({
            row: cardRow,
            direction: 'Earlier',
            size: 'Coarse',
          }),
        ),
        Story.model(model => {
          expect(clipOf(model, 'card').at).toBeCloseTo(0.31)
        }),
      )
    })
  })

  describe('clip editor', () => {
    it('opens on a click that does not move the bar', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(pressCard(0.3)),
        Story.message(Message.ReleasedDragPointer()),
        Story.model(model => {
          expect(Option.map(model.maybeEditor, ({ target }) => target)).toEqual(
            Option.some({ key: 'card', span: Timeline.Span.Whole() }),
          )
          expect(editorFields(model)).toEqual([
            'start',
            'duration',
            'easex1',
            'easey1',
            'easex2',
            'easey2',
            'from-y',
            'to-y',
          ])
        }),
      )
    })

    it('opens a step editor from a segment', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(
          Message.PressedEnterOnBar({
            row: BarRow.Clip({ key: 'path' }),
            maybeStepIndex: Option.some(1),
          }),
        ),
        Story.model(model => {
          expect(
            Option.map(model.maybeEditor, ({ target }) => target.span),
          ).toEqual(Option.some(Timeline.Span.Step({ index: 1 })))
          expect(editorFields(model)).toContain('to-x')
          expect(editorFields(model)).not.toContain('from-x')
        }),
      )
    })

    it('toggles the property tracks of a props clip instead of opening an editor', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(
          Message.PressedEnterOnBar({
            row: BarRow.Clip({ key: 'layer.float' }),
            maybeStepIndex: Option.none(),
          }),
        ),
        Story.model(model => {
          expect(model.expandedClips).toEqual(['layer.float'])
          expect(Option.isNone(model.maybeEditor)).toBe(true)
        }),
      )
    })

    it('closes when the same bar is clicked again', () => {
      Story.story(
        update,
        Story.given(withCardEditor()),
        Story.message(pressCard(0.3)),
        Story.message(Message.ReleasedDragPointer()),
        Story.model(model => {
          expect(Option.isNone(model.maybeEditor)).toBe(true)
        }),
      )
    })

    it('closes when a drag moves the bar', () => {
      Story.story(
        update,
        Story.given(withCardEditor()),
        Story.message(pressCard(0.3)),
        Story.message(Message.MovedLanePointer({ fraction: 0.4 })),
        Story.model(model => {
          expect(Option.isNone(model.maybeEditor)).toBe(true)
        }),
      )
    })

    it('edits a to value through its ScrubSlider', () => {
      Story.story(
        update,
        Story.given(withCardEditor()),
        Story.message(
          Message.GotSliderMessage({
            sliderId: editorFieldId('hero', EditorField.To({ prop: 'y' })),
            message: ScrubSlider.Message.PressedKeyboardNavigation({
              direction: 'StepIncrement',
              value: 0,
            }),
          }),
        ),
        Story.model(model => {
          expect(
            Timeline.spanTo(clipOf(model, 'card'), Timeline.Span.Whole()),
          ).toEqual({
            y: 1,
            color: '#ffffff',
          })
        }),
      )
    })

    it('edits the start through its ScrubSlider', () => {
      Story.story(
        update,
        Story.given(withCardEditor()),
        Story.message(
          Message.GotSliderMessage({
            sliderId: editorFieldId('hero', EditorField.Start()),
            message: ScrubSlider.Message.PressedKeyboardNavigation({
              direction: 'StepIncrement',
              value: 0.4,
            }),
          }),
        ),
        Story.model(model => {
          expect(clipOf(model, 'card').at).toBeCloseTo(0.41)
        }),
      )
    })

    it('routes pointer drags to whichever editor slider is dragging', () => {
      Story.story(
        update,
        Story.given(withCardEditor()),
        Story.message(
          Message.GotSliderMessage({
            sliderId: editorFieldId('hero', EditorField.To({ prop: 'y' })),
            message: ScrubSlider.Message.PressedTrack({
              value: 50,
              originValue: 0,
            }),
          }),
        ),
        Story.message(
          Message.GotDraggingSliderMessage({
            message: ScrubSlider.Message.MovedDragPointer({ value: 30 }),
          }),
        ),
        Story.model(model => {
          expect(
            Timeline.spanTo(clipOf(model, 'card'), Timeline.Span.Whole()),
          ).toMatchObject({
            y: 30,
          })
        }),
        Story.message(
          Message.GotDraggingSliderMessage({
            message: ScrubSlider.Message.CancelledDrag(),
          }),
        ),
        Story.model(model => {
          expect(
            Timeline.spanTo(clipOf(model, 'card'), Timeline.Span.Whole()),
          ).toMatchObject({
            y: 0,
          })
        }),
      )
    })

    it('switches the transition mode and rebuilds the sliders', () => {
      Story.story(
        update,
        Story.given(withCardEditor()),
        Story.message(
          Message.GotModeMessage({
            message: RadioGroup.Message.SelectedOption({
              index: 2,
              value: 'PhysicsSpring',
            }),
          }),
        ),
        Story.Command.resolve(
          RadioGroup.FocusOption,
          RadioGroup.Message.CompletedFocusOption(),
        ),
        Story.model(model => {
          const card = clipOf(model, 'card')
          expect(Timeline.spanTransition(card, Timeline.Span.Whole())).toEqual(
            Option.some(
              Transition.PhysicsSpring({
                stiffness: 200,
                damping: 25,
                mass: 1,
              }),
            ),
          )
          expect(Timeline.spanDuration(card, Timeline.Span.Whole())).toEqual(
            Option.some(0.42),
          )
          expect(editorFields(model)).toEqual([
            'start',
            'stiffness',
            'damping',
            'mass',
            'from-y',
            'to-y',
          ])
        }),
      )
    })

    it('edits a string value as text', () => {
      Story.story(
        update,
        Story.given(withCardEditor()),
        Story.message(
          Message.UpdatedEditorText({
            field: EditorField.To({ prop: 'color' }),
            value: '#ff0000',
          }),
        ),
        Story.model(model => {
          expect(
            Timeline.spanTo(clipOf(model, 'card'), Timeline.Span.Whole()),
          ).toMatchObject({
            color: '#ff0000',
          })
        }),
      )
    })

    it('returns focus to the bar when closed from the editor', () => {
      Story.story(
        update,
        Story.given(withCardEditor()),
        Story.message(Message.PressedEscapeInEditor()),
        Story.Command.expectExact(FocusBar({ elementId: 'hero-bar-card' })),
        Story.Command.resolve(FocusBar, Message.CompletedFocusBar()),
        Story.model(model => {
          expect(Option.isNone(model.maybeEditor)).toBe(true)
        }),
      )
    })

    it('closes and leaves focus where it landed when focus leaves it', () => {
      Story.story(
        update,
        Story.given(withCardEditor()),
        Story.message(Message.MovedFocusOutsideEditor()),
        Story.Command.expectNone(),
        Story.model(model => {
          expect(Option.isNone(model.maybeEditor)).toBe(true)
        }),
      )
    })

    it('closes without moving focus on a press outside', () => {
      Story.story(
        update,
        Story.given(withCardEditor()),
        Story.message(Message.PressedOutsideEditor()),
        Story.Command.expectNone(),
        Story.model(model => {
          expect(Option.isNone(model.maybeEditor)).toBe(true)
        }),
      )
    })
  })

  describe('copy', () => {
    const edited = (): Model =>
      after(
        paused(),
        pressCard(0.3),
        Message.MovedLanePointer({ fraction: 0.4 }),
      )

    it('writes the tuned timeline and briefly shows that it copied', () => {
      Story.story(
        update,
        Story.given(edited()),
        Story.message(Message.ClickedCopyTimeline()),
        Story.Command.expectExact(
          CopyTimeline({
            text: Timeline.copyInstruction('Hero', edited().timeline),
          }),
        ),
        Story.Command.resolve(CopyTimeline, Message.SucceededCopyTimeline()),
        Story.Command.expectExact(WaitBeforeResetCopy({ copyVersion: 1 })),
        Story.model(model => {
          expect(model.copyState._tag).toBe('Copied')
        }),
        Story.Command.resolve(
          WaitBeforeResetCopy,
          Message.CompletedWaitBeforeResetCopy({ copyVersion: 1 }),
        ),
        Story.model(model => {
          expect(model.copyState._tag).toBe('Idle')
        }),
      )
    })

    it('briefly shows that a copy failed', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(Message.ClickedCopyTimeline()),
        Story.Command.resolve(CopyTimeline, Message.FailedCopyTimeline()),
        Story.Command.expectExact(WaitBeforeResetCopy({ copyVersion: 1 })),
        Story.model(model => {
          expect(model.copyState._tag).toBe('Failed')
        }),
        Story.Command.resolve(
          WaitBeforeResetCopy,
          Message.CompletedWaitBeforeResetCopy({ copyVersion: 1 }),
        ),
        Story.model(model => {
          expect(model.copyState._tag).toBe('Idle')
        }),
      )
    })

    it('keeps a newer confirmation when an older wait ends', () => {
      Story.story(
        update,
        Story.given(
          after(
            paused(),
            Message.SucceededCopyTimeline(),
            Message.SucceededCopyTimeline(),
          ),
        ),
        Story.message(Message.CompletedWaitBeforeResetCopy({ copyVersion: 1 })),
        Story.model(model => {
          expect([model.copyState._tag, model.copyVersion]).toEqual([
            'Copied',
            2,
          ])
        }),
        Story.message(Message.CompletedWaitBeforeResetCopy({ copyVersion: 2 })),
        Story.model(model => {
          expect(model.copyState._tag).toBe('Idle')
        }),
      )
    })

    it('exports the edited timing', () => {
      expect(Timeline.copyInstruction('Hero', edited().timeline)).toContain(
        '"at": 0.6',
      )
    })
  })

  describe('dock', () => {
    it('reports visibility changes and closes the editor when hidden', () => {
      Story.story(
        update,
        Story.given(withCardEditor()),
        Story.message(Message.RequestedVisibility({ isVisible: false })),
        Story.expectOutMessage(
          OutMessage.ChangedVisibility({ isVisible: false }),
        ),
        Story.model(model => {
          expect(Option.isNone(model.maybeEditor)).toBe(true)
        }),
        Story.message(Message.RequestedVisibility({ isVisible: false })),
        Story.expectNoOutMessage(),
      )
    })

    it('keeps playing while hidden', () => {
      Story.story(
        update,
        Story.given(playing()),
        Story.message(Message.RequestedVisibility({ isVisible: false })),
        Story.expectOutMessage(
          OutMessage.ChangedVisibility({ isVisible: false }),
        ),
        Story.message(Message.TickedFrame({ deltaTime: 50 })),
        Story.model(model => {
          expect(model.time).toBeCloseTo(0.05)
        }),
      )
    })

    it('resizes by dragging its top edge, within the viewport', () => {
      Story.story(
        update,
        Story.given(withViewport()),
        Story.message(
          Message.PressedResizeHandle({ clientY: 500, height: 300 }),
        ),
        Story.message(Message.MovedResizePointer({ clientY: 400 })),
        Story.model(model => {
          expect(model.dockHeight).toBe(400)
        }),
        Story.message(Message.MovedResizePointer({ clientY: -800 })),
        Story.model(model => {
          expect(model.dockHeight).toBe(876)
        }),
        Story.message(Message.CancelledDrag()),
        Story.model(model => {
          expect(model.dockHeight).toBe(300)
        }),
      )
    })

    it('shrinks to fit when the viewport shrinks', () => {
      Story.story(
        update,
        Story.given(
          after(withViewport(), Message.PressedResizeKey({ step: 'Maximum' })),
        ),
        Story.message(Message.ResizedViewport({ height: 500 })),
        Story.model(model => {
          expect(model.dockHeight).toBe(476)
        }),
        Story.message(Message.ResizedViewport({ height: 900 })),
        Story.model(model => {
          expect(model.dockHeight).toBe(476)
        }),
      )
    })

    it('resizes from the keyboard, between its smallest and largest heights', () => {
      Story.story(
        update,
        Story.given(withViewport()),
        Story.message(Message.PressedResizeKey({ step: 'Grow' })),
        Story.model(model => {
          expect(model.dockHeight).toBe(420)
        }),
        Story.message(Message.PressedResizeKey({ step: 'Maximum' })),
        Story.model(model => {
          expect(model.dockHeight).toBe(876)
        }),
        Story.message(Message.PressedResizeKey({ step: 'Grow' })),
        Story.model(model => {
          expect(model.dockHeight).toBe(876)
        }),
        Story.message(Message.PressedResizeKey({ step: 'Minimum' })),
        Story.model(model => {
          expect(model.dockHeight).toBe(120)
        }),
        Story.message(Message.PressedResizeKey({ step: 'Shrink' })),
        Story.model(model => {
          expect(model.dockHeight).toBe(120)
        }),
      )
    })

    it('collapses and closes the editor', () => {
      Story.story(
        update,
        Story.given(withCardEditor()),
        Story.message(Message.ToggledOpen({ isOpen: false })),
        Story.model(model => {
          expect(model.isOpen).toBe(false)
          expect(Option.isNone(model.maybeEditor)).toBe(true)
        }),
        Story.message(Message.ToggledOpen({ isOpen: true })),
        Story.model(model => {
          expect(model.isOpen).toBe(true)
        }),
      )
    })

    it('collapses and expands a group', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(Message.ToggledGroup({ group: 'layer', isOpen: false })),
        Story.model(model => {
          expect(model.collapsedGroups).toEqual(['layer'])
        }),
        Story.message(Message.ToggledGroup({ group: 'layer', isOpen: false })),
        Story.model(model => {
          expect(model.collapsedGroups).toEqual(['layer'])
        }),
        Story.message(Message.ToggledGroup({ group: 'layer', isOpen: true })),
        Story.model(model => {
          expect(model.collapsedGroups).toEqual([])
        }),
      )
    })

    it('shows and hides the property tracks of a props clip', () => {
      Story.story(
        update,
        Story.given(paused()),
        Story.message(
          Message.ToggledTracks({ key: 'layer.float', isOpen: true }),
        ),
        Story.model(model => {
          expect(model.expandedClips).toEqual(['layer.float'])
        }),
        Story.message(
          Message.ToggledTracks({ key: 'layer.float', isOpen: false }),
        ),
        Story.model(model => {
          expect(model.expandedClips).toEqual([])
        }),
      )
    })
  })

  describe('subscriptions', () => {
    it('prefixes every key with the dock id, so two docks aggregate', () => {
      const first = make({ name: 'First', timeline })
      const second = make({ name: 'Second', timeline })
      const lifted = (dock: typeof first) =>
        Subscription.lift(dock.subscriptions)<Model, Message>({
          read: Option.some,
          toParentMessage: message => message,
        })
      const both = Subscription.aggregate(lifted(first), lifted(second))

      expect(Record.keys(both)).toContain('first:frame')
      expect(Record.keys(both)).toContain('second:frame')
      expect(
        Array.every(Record.keys(first.subscriptions), key =>
          key.startsWith('first:'),
        ),
      ).toBe(true)
    })

    describe('editor dismissal', () => {
      const waitForNextTurn = (): Promise<void> =>
        new Promise(resolve => setTimeout(resolve, 0))

      const focusIn = (element: Element): void => {
        element.dispatchEvent(
          new FocusEvent('focusin', { bubbles: true, composed: true }),
        )
      }

      const collectMessages = () => {
        const received: Array<Message> = []
        const editorDismiss = Option.getOrThrow(
          Record.get(Dock.subscriptions, 'hero:editorDismiss'),
        )
        const dependencies = { isEditorOpen: true, id: 'hero' }
        const fiber = Effect.runFork(
          Stream.runForEach(
            editorDismiss.dependenciesToStream(
              dependencies,
              () => dependencies,
            ),
            message =>
              Effect.sync(() => {
                received.push(message)
              }),
          ),
        )
        return { received, fiber }
      }

      const renderDockParts = () => {
        const editor = document.createElement('div')
        editor.setAttribute('data-dial-timeline-editor', 'hero')
        const editorControl = document.createElement('button')
        editor.append(editorControl)
        const bar = document.createElement('div')
        bar.setAttribute('data-dial-timeline-bar', 'hero')
        const outsideButton = document.createElement('button')
        document.body.append(editor, bar, outsideButton)
        return { editor, editorControl, bar, outsideButton }
      }

      it('reports focus that lands outside the editor and its bars', async () => {
        const { editor, editorControl, bar, outsideButton } = renderDockParts()
        const { received, fiber } = collectMessages()

        // NOTE: the listeners attach a few turns after the fiber starts, so
        // each attempt focuses inside, then outside, in one synchronous
        // block. Only the outside focus may produce a Message.
        try {
          await vi.waitFor(async () => {
            received.splice(0)
            focusIn(editorControl)
            focusIn(bar)
            focusIn(outsideButton)
            await waitForNextTurn()
            await waitForNextTurn()
            expect(received).toEqual([Message.MovedFocusOutsideEditor()])
          })
        } finally {
          await Effect.runPromise(Fiber.interrupt(fiber))
          editor.remove()
          bar.remove()
          outsideButton.remove()
        }
      })
    })
  })

  describe('valuesOf', () => {
    const repeatingTimeline = Timeline.make({
      duration: 2,
      clips: {
        intro: Timeline.clip({
          at: 0,
          duration: 0.5,
          from: { opacity: 0 },
          to: { opacity: 1 },
          transition: easing,
        }),
        layer: Timeline.group({
          path: Timeline.sequence({
            at: 0.1,
            loop: true,
            from: { x: 0, color: '#000000', label: 'start' },
            transition: easing,
            steps: [
              { duration: 0.4, to: { x: 10, color: '#ffffff', label: 'end' } },
              { duration: 0.6, to: { x: 0 } },
            ],
          }),
          float: Timeline.tracks({
            at: 0.2,
            loop: true,
            props: {
              y: {
                from: -9,
                delay: 0.1,
                transition: easing,
                steps: [
                  { duration: 0.3, to: 9 },
                  { duration: 0.7, to: -9 },
                ],
              },
              scale: {
                from: 0,
                to: 1,
                delay: 0.3,
                transition: Transition.PhysicsSpring({
                  stiffness: 200,
                  damping: 25,
                  mass: 1,
                }),
              },
            },
          }),
        }),
        bounce: Timeline.clip({
          at: 1,
          loop: true,
          from: { scale: 0 },
          to: { scale: 1 },
          transition: Transition.PhysicsSpring({
            stiffness: 200,
            damping: 25,
            mass: 1,
          }),
        }),
        cue: Timeline.marker({ at: 1.5, duration: 0.2 }),
      },
    })

    const expectSampledValues = (model: Model) => {
      const duration = Timeline.durationOfTimeline(model.timeline)
      const cycleTime = Timeline.cycleTimeOf(
        model.time,
        model.wraps,
        duration,
        model.loop,
      )
      const expected = Timeline.valuesAt(model.timeline, model.time, cycleTime)
      expect(valuesOf(model)).toEqual(expected)
      return expected
    }

    it('samples grouped sequences and delayed physics tracks across whole and region wraps', () => {
      Array.forEach([false, true, { from: 1 }, { from: 20 }], loop => {
        const dock = make({
          name: 'Repeating',
          timeline: repeatingTimeline,
          loop,
        })
        const beforeWrap = modifyFields(dock.init(), {
          time: () => 1.95,
          wraps: () => 2,
        })
        const wrapped = update(
          beforeWrap,
          Message.TickedFrame({ deltaTime: 100 }),
        ).model
        expect(dock.valuesOf(wrapped)).toEqual(expectSampledValues(wrapped))
        if (wrapped.time >= 0.5) {
          expect(dock.valuesOf(wrapped).intro.current.opacity).toBe(1)
        } else {
          expect(dock.valuesOf(wrapped).intro.current.opacity).toBeLessThan(1)
        }
        expect(Object.keys(dock.valuesOf(wrapped))).toEqual([
          'intro',
          'bounce',
          'cue',
          'layer',
        ])
        expect(Object.keys(dock.valuesOf(wrapped).layer)).toEqual([
          'path',
          'float',
        ])
      })
    })

    it('uses an edited physics duration for cycle time and restores old snapshots between instances', () => {
      const dock = make({
        name: 'Repeating',
        timeline: repeatingTimeline,
        loop: { from: 0.5 },
      })
      const original = modifyFields(dock.init(), {
        time: () => 1.4,
        wraps: () => 3,
      })
      const originalValues = dock.valuesOf(original)
      const nextTimeline = pipe(
        repeatingTimeline,
        Timeline.modifyClip('bounce', clip =>
          Timeline.setSpanTransition(
            clip,
            Timeline.Span.Whole(),
            Transition.PhysicsSpring({ stiffness: 100, damping: 2, mass: 1 }),
          ),
        ),
        Timeline.modifyClip('layer.path', clip =>
          Timeline.setSpanDuration(clip, Timeline.Span.Step({ index: 0 }), 0.8),
        ),
        Timeline.modifyClip('layer.float', clip =>
          Timeline.setTrackDelay(clip, 'scale', 0.8),
        ),
      )
      const edited = modifyFields(original, { timeline: () => nextTimeline })
      const otherDock = make({
        name: 'Other',
        timeline: repeatingTimeline,
        loop: true,
      })
      const other = modifyFields(otherDock.init(), { time: () => 0.4 })
      const otherValues = otherDock.valuesOf(other)

      expect(Timeline.durationOfTimeline(nextTimeline)).toBeGreaterThan(
        repeatingTimeline.minimumDuration,
      )
      expect(dock.valuesOf(edited)).toEqual(expectSampledValues(edited))
      expect(dock.valuesOf(edited)).not.toEqual(originalValues)
      const duration = Timeline.durationOfTimeline(nextTimeline)
      const nearEnd = modifyFields(edited, { time: () => duration - 0.05 })
      const wrapped = update(
        nearEnd,
        Message.TickedFrame({ deltaTime: 100 }),
      ).model
      expect(wrapped.wraps).toBe(4)
      expect(dock.valuesOf(wrapped)).toEqual(expectSampledValues(wrapped))
      expect(otherDock.valuesOf(other)).toEqual(otherValues)
      expect(dock.valuesOf(original)).toEqual(originalValues)
      expect(dock.valuesOf(edited)).toEqual(expectSampledValues(edited))
    })

    it('samples every clip at the playhead, typed by the config', () => {
      const values = Dock.valuesOf(
        after(paused(), Message.RequestedSeek({ time: 0.7 })),
      )

      expect(values.card.progress).toBeCloseTo(0.5)
      expect(values.card.current.y).toBeLessThan(24)
      expect(values.path.step).toBe(1)
      expect(values.layer.float.current.y).toBe(9)
      expect(values.bounce.started).toBe(false)
    })

    it('follows timing edits', () => {
      const moved = after(
        paused(),
        Message.RequestedSeek({ time: 0.5 }),
        pressCard(0.3),
        Message.MovedLanePointer({ fraction: 0.4 }),
      )

      expect(Dock.valuesOf(moved).card.started).toBe(false)
    })
  })

  describe('isContinuousMessage', () => {
    it('marks frames and drag steps, not presses or releases', () => {
      expect(isContinuousMessage(Message.TickedFrame({ deltaTime: 16 }))).toBe(
        true,
      )
      expect(
        isContinuousMessage(
          Message.GotDraggingSliderMessage({
            message: ScrubSlider.Message.MovedDragPointer({ value: 3 }),
          }),
        ),
      ).toBe(true)
      expect(
        isContinuousMessage(
          Message.GotDraggingSliderMessage({
            message: ScrubSlider.Message.ReleasedDragPointer(),
          }),
        ),
      ).toBe(false)
      expect(
        isContinuousMessage(Message.ResizedViewport({ height: 900 })),
      ).toBe(true)
      expect(isContinuousMessage(Message.RequestedPlay())).toBe(false)
    })
  })
})
