import { Array, Option } from 'effect'
import * as Scene from 'foldkit/scene'
import { describe, it } from 'vitest'

import { Popover, RadioGroup } from '@foldkit/ui'

import * as Timeline from '../timeline/index.js'
import { Transition } from '../transition/index.js'
import {
  BarHandle,
  BarRow,
  CopyTimeline,
  FocusBar,
  Message,
  ObserveRuler,
  WaitBeforeResetCopy,
  make,
  setVisible,
  update,
  view,
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

const Dock = make({ name: 'Hero', timeline, autoplay: false })
const paused = Dock.init()

const after = (model: Model, ...messages: ReadonlyArray<Message>): Model =>
  Array.reduce(
    messages,
    model,
    (current, message) => update(current, message).model,
  )

const measureRuler = Scene.Mount.resolve(
  ObserveRuler,
  Message.ResizedRuler({ width: 600 }),
)
// NOTE: the editor maps Popover's anchoring Mount to its own Message, and
// Scene feeds the resolved Message to the dock's update as given.
const anchorEditor = Scene.Mount.resolve<'AnchorPopover', Message>(
  Popover.AnchorPopover,
  Message.CompletedAnchorClipEditor(),
)
const focusModeOption = Scene.Command.resolve(
  RadioGroup.FocusOption,
  RadioGroup.Message.CompletedFocusOption(),
)

const button = (name: string) => Scene.role('button', { name })
const playhead = Scene.role('slider', { name: 'Timeline current time' })
const card = button('Card, starts at 0.4s, lasts 0.6s')
const editor = Scene.role('dialog', { name: 'Edit Card' })
const toGroup = Scene.role('group', { name: 'To' })
const toYSlider = Scene.within(toGroup, Scene.role('slider', { name: 'Y' }))
const status = Scene.role('status')

describe('DialTimeline', () => {
  describe('dock', () => {
    it('is a region named for its timeline', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.expect(Scene.role('region', { name: 'Hero timeline' })).toExist(),
      )
    })

    it('resizes from the keyboard on its top edge', () => {
      const handle = Scene.role('separator', { name: 'Resize timeline height' })

      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.Subscription.emit(Message.ResizedViewport({ height: 900 })),
        Scene.expect(handle).toHaveAttr('aria-valuenow', '400'),
        Scene.expect(handle).toHaveAttr('aria-valuemin', '120'),
        Scene.expect(handle).toHaveAttr('aria-valuemax', '876'),
        Scene.expect(handle).toHaveAttr('aria-valuetext', '400 pixels'),
        Scene.expect(handle).toHaveAttr('aria-controls', 'hero-dock'),
        Scene.expect(Scene.selector('#hero-dock')).toExist(),
        Scene.keydown(handle, 'ArrowUp'),
        Scene.expect(handle).toHaveAttr('aria-valuenow', '420'),
        Scene.keydown(handle, 'End'),
        Scene.expect(handle).toHaveAttr('aria-valuenow', '876'),
        Scene.keydown(handle, 'Home'),
        Scene.expect(handle).toHaveAttr('aria-valuenow', '120'),
      )
    })

    it('keeps its height within the viewport when the viewport shrinks', () => {
      const handle = Scene.role('separator', { name: 'Resize timeline height' })

      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.Subscription.emit(Message.ResizedViewport({ height: 900 })),
        Scene.keydown(handle, 'End'),
        Scene.Subscription.emit(Message.ResizedViewport({ height: 300 })),
        Scene.expect(handle).toHaveAttr('aria-valuemax', '276'),
        Scene.expect(handle).toHaveAttr('aria-valuenow', '276'),
      )
    })

    it('hides when not visible', () => {
      Scene.scene(
        { update, view },
        Scene.given(setVisible(paused, false).model),
        measureRuler,
        Scene.expect(
          Scene.selector('[data-dial-timeline-id="hero"]'),
        ).toHaveAttr('hidden', 'true'),
      )
    })
  })

  describe('toolbar', () => {
    it('labels the transport buttons and toggles playback', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.expect(button('Replay')).toExist(),
        Scene.click(button('Play')),
        Scene.expect(button('Pause')).toExist(),
        Scene.click(button('Pause')),
        Scene.expect(button('Play')).toExist(),
      )
    })

    it('copies the tuned timeline and announces that it copied', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.expect(status).toHaveText(''),
        Scene.click(button('Copy parameters')),
        Scene.Command.resolve(CopyTimeline, Message.SucceededCopyTimeline()),
        Scene.expect(button('Copied parameters')).toExist(),
        Scene.expect(status).toHaveText('Copied parameters'),
        Scene.Command.resolve(
          WaitBeforeResetCopy,
          Message.CompletedWaitBeforeResetCopy({ copyVersion: 1 }),
        ),
        Scene.expect(button('Copy parameters')).toExist(),
        Scene.expect(status).toHaveText(''),
      )
    })

    it('shows and announces a failed copy', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.click(button('Copy parameters')),
        Scene.Command.resolve(CopyTimeline, Message.FailedCopyTimeline()),
        Scene.expect(button('Copy failed')).toHaveAttr('data-copy-failed', ''),
        Scene.expect(status).toHaveText('Copy failed'),
        Scene.Command.resolve(
          WaitBeforeResetCopy,
          Message.CompletedWaitBeforeResetCopy({ copyVersion: 1 }),
        ),
        Scene.expect(button('Copy parameters')).toExist(),
      )
    })

    it('collapses to a scrubbable overview', () => {
      const chevron = button('Timeline')
      const overview = Scene.role('slider', { name: 'Timeline overview' })

      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.expect(chevron).toHaveAttr('aria-expanded', 'true'),
        Scene.expect(chevron).toHaveAttr('aria-controls', 'hero-body-panel'),
        Scene.expect(Scene.selector('#hero-body-panel')).toExist(),
        Scene.click(chevron),
        Scene.Mount.expectEnded(ObserveRuler),
        Scene.expect(chevron).toHaveAttr('aria-expanded', 'false'),
        Scene.expect(chevron).not.toHaveAttr('aria-controls'),
        Scene.expect(playhead).toBeAbsent(),
        Scene.expect(overview).toHaveAttr('aria-valuemax', '2'),
        Scene.keydown(overview, 'End'),
        Scene.expect(overview).toHaveAttr('aria-valuenow', '2'),
      )
    })
  })

  describe('playhead', () => {
    it('is a slider over the timeline that moves with the keyboard', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.expect(playhead).toHaveAttr('aria-valuemin', '0'),
        Scene.expect(playhead).toHaveAttr('aria-valuemax', '2'),
        Scene.expect(playhead).toHaveAttr('aria-valuenow', '0'),
        Scene.expect(playhead).toHaveAttr('tabIndex', '0'),
        Scene.keydown(playhead, 'ArrowRight'),
        Scene.expect(playhead).toHaveAttr('aria-valuenow', '0.1'),
        Scene.expect(playhead).toHaveAttr('aria-valuetext', '0.10 seconds'),
        Scene.keydown(playhead, 'End'),
        Scene.expect(playhead).toHaveAttr('aria-valuenow', '2'),
      )
    })

    it('keeps its value text still during playback', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.click(button('Play')),
        Scene.expect(playhead).toHaveAttr('aria-valuetext', 'Playing'),
        Scene.Subscription.emit(Message.TickedFrame({ deltaTime: 16 })),
        Scene.expect(playhead).toHaveAttr('aria-valuetext', 'Playing'),
        Scene.click(button('Pause')),
        Scene.expect(playhead).toHaveAttr('aria-valuetext', '0.02 seconds'),
      )
    })

    it('stays rendered when a key seeks outside the zoomed view', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.keydown(playhead, '+'),
        Scene.keydown(playhead, 'End'),
        Scene.expect(playhead).toHaveAttr('aria-valuenow', '2'),
        Scene.keydown(playhead, 'Home'),
        Scene.expect(playhead).toHaveAttr('aria-valuenow', '0'),
      )
    })

    it('zooms the lanes with the plus and zero keys', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.expect(Scene.text('00:01')).toExist(),
        Scene.keydown(playhead, '+'),
        Scene.keydown(playhead, '+'),
        Scene.expect(Scene.text('00:01')).toBeAbsent(),
        Scene.keydown(playhead, '0'),
        Scene.expect(Scene.text('00:01')).toExist(),
      )
    })

    it('labels the ruler in seconds', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.expect(Scene.text('00:01')).toExist(),
      )
    })
  })

  describe('bars', () => {
    it('labels each bar with its timing and its keys', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.expect(card).toHaveAttr('tabIndex', '0'),
        Scene.expect(card).toHaveAttr('aria-describedby', 'hero-keys-help'),
        Scene.expect(Scene.selector('#hero-keys-help')).toHaveText(
          'Left and Right arrows move the bar. Shift moves it farther. Enter opens it.',
        ),
        Scene.expect(button('Path, Step 2, 0.5s')).toExist(),
        Scene.expect(button('Bounce, starts at 1s, lasts ~0.42s')).toExist(),
      )
    })

    it('keeps a clip keyed help apart from the key description', () => {
      const helpDock = make({
        name: 'Hero',
        autoplay: false,
        timeline: Timeline.make({
          duration: 2,
          clips: {
            help: Timeline.clip({ at: 0, from: { x: 0 }, to: { x: 1 } }),
          },
        }),
      })

      Scene.scene(
        { update, view },
        Scene.given(helpDock.init()),
        measureRuler,
        Scene.expect(Scene.selector('#hero-bar-help')).toHaveAttr(
          'role',
          'button',
        ),
        Scene.expect(
          Scene.role('button', { name: /^Help, starts/ }),
        ).toHaveAttr('aria-describedby', 'hero-keys-help'),
      )
    })

    it('exposes the clip editor as a popup of the selected bar', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.expect(card).toHaveAttr('aria-haspopup', 'dialog'),
        Scene.expect(card).toHaveAttr('aria-expanded', 'false'),
        Scene.expect(card).not.toHaveAttr('aria-controls'),
        Scene.keydown(card, 'Enter'),
        anchorEditor,
        Scene.expect(card).toHaveAttr('aria-expanded', 'true'),
        Scene.expect(card).toHaveAttr('aria-controls', 'hero-editor'),
        Scene.expect(editor).toHaveId('hero-editor'),
      )
    })

    it('gives resize handles to time-based bars only', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.expect(
          Scene.within(card, Scene.selector('[data-edge="end"]')),
        ).toExist(),
        Scene.expect(
          Scene.within(
            button('Bounce, starts at 1s, lasts ~0.42s'),
            Scene.selector('[data-edge]'),
          ),
        ).toBeAbsent(),
        Scene.expect(
          Scene.within(
            Scene.role('group', { name: 'Path, starts at 0s, lasts 1s' }),
            Scene.selector('[data-boundary="0"]'),
          ),
        ).toExist(),
      )
    })

    it('nudges a bar with the arrow keys', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.keydown(card, 'ArrowRight', { shiftKey: true }),
        Scene.expect(button('Card, starts at 0.5s, lasts 0.6s')).toExist(),
      )
    })

    it('collapses a group of clips', () => {
      const layer = button('Layer')
      const float = button('Float, starts at 0s, lasts 0.6s, property tracks')

      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.expect(float).toExist(),
        Scene.expect(layer).toHaveAttr('aria-expanded', 'true'),
        Scene.expect(layer).toHaveAttr(
          'aria-controls',
          'hero-group-layer-panel',
        ),
        Scene.click(layer),
        Scene.expect(float).toBeAbsent(),
        Scene.expect(layer).toHaveAttr('aria-expanded', 'false'),
        Scene.expect(layer).not.toHaveAttr('aria-controls'),
      )
    })

    it('expands the property tracks of a props clip', () => {
      const properties = button('Float properties')

      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.expect(properties).toHaveAttr('aria-expanded', 'false'),
        Scene.click(properties),
        Scene.expect(properties).toHaveAttr('aria-expanded', 'true'),
        Scene.expect(properties).toHaveAttr(
          'aria-controls',
          'hero-tracks-layer.float-panel',
        ),
        Scene.expect(button('Float Y, starts at 0s, lasts 0.6s')).toExist(),
        Scene.expect(
          button('Float, starts at 0s, lasts 0.6s, property tracks'),
        ).toHaveAttr('aria-expanded', 'true'),
      )
    })

    it('marks only the dragged row, even when another row shares its id text', () => {
      const lookalikes = make({
        name: 'Hero',
        autoplay: false,
        timeline: Timeline.make({
          duration: 2,
          clips: {
            'a-track-b': Timeline.clip({ at: 0, from: { x: 0 }, to: { x: 1 } }),
            a: Timeline.tracks({ at: 1, props: { b: { from: 0, to: 1 } } }),
          },
        }),
      })
      const dragging = after(
        lookalikes.init(),
        Message.ResizedRuler({ width: 600 }),
        Message.ToggledTracks({ key: 'a', isOpen: true }),
        Message.PressedBar({
          row: BarRow.Clip({ key: 'a-track-b' }),
          handle: BarHandle.Body({ maybeStepIndex: Option.none() }),
          fraction: 0.1,
        }),
        Message.MovedLanePointer({ fraction: 0.2 }),
      )

      Scene.scene(
        { update, view },
        Scene.given(dragging),
        measureRuler,
        Scene.expect(
          Scene.role('button', { name: /^A-track-b, starts/ }),
        ).toHaveAttr('data-dragging', ''),
        Scene.expect(
          Scene.role('button', { name: /^A-track-b, starts/ }),
        ).toHaveId('hero-bar-a-track-b'),
        Scene.expect(
          Scene.role('button', { name: /^A B, starts/ }),
        ).not.toHaveAttr('data-dragging'),
        Scene.expect(Scene.role('button', { name: /^A B, starts/ })).toHaveId(
          'hero-bar-a/b',
        ),
      )
    })
  })

  describe('clip editor', () => {
    it('opens with Enter and edits values with ScrubSliders', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.keydown(card, 'Enter'),
        anchorEditor,
        Scene.expect(editor).toExist(),
        Scene.expect(card).toHaveAttr('data-selected', ''),
        Scene.expect(toYSlider).toHaveAttr('aria-valuenow', '0'),
        Scene.keydown(toYSlider, 'ArrowRight'),
        Scene.expect(toYSlider).toHaveAttr('aria-valuenow', '1'),
      )
    })

    it('edits a string value in a labelled text field', () => {
      const toColor = Scene.within(toGroup, Scene.label('Color'))

      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.keydown(card, 'Enter'),
        anchorEditor,
        Scene.expect(toColor).toHaveValue('#ffffff'),
        Scene.type(toColor, '#ff0000'),
        Scene.expect(toColor).toHaveValue('#ff0000'),
      )
    })

    it('closes on Escape and returns focus to the bar', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.keydown(card, 'Enter'),
        anchorEditor,
        Scene.Subscription.emit(Message.PressedEscapeInEditor()),
        Scene.Command.resolve(FocusBar, Message.CompletedFocusBar()),
        Scene.Mount.expectEnded(Popover.AnchorPopover),
        Scene.expect(editor).toBeAbsent(),
      )
    })

    it('closes when focus leaves it, without moving focus', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.keydown(card, 'Enter'),
        anchorEditor,
        Scene.Subscription.emit(Message.MovedFocusOutsideEditor()),
        Scene.Command.expectNone(),
        Scene.Mount.expectEnded(Popover.AnchorPopover),
        Scene.expect(editor).toBeAbsent(),
      )
    })

    it('closes from its close button', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.keydown(card, 'Enter'),
        anchorEditor,
        Scene.click(button('Close editor')),
        Scene.Command.resolve(FocusBar, Message.CompletedFocusBar()),
        Scene.Mount.expectEnded(Popover.AnchorPopover),
        Scene.expect(editor).toBeAbsent(),
      )
    })

    it('switches a transition to physics with a radio group, which derives the duration', () => {
      const transitionType = Scene.role('radiogroup', {
        name: 'Transition type',
      })
      const physics = Scene.within(
        transitionType,
        Scene.role('radio', { name: 'Physics' }),
      )

      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.keydown(card, 'Enter'),
        anchorEditor,
        Scene.expect(
          Scene.within(transitionType, Scene.role('radio', { name: 'Easing' })),
        ).toHaveAttr('aria-checked', 'true'),
        Scene.expect(Scene.role('slider', { name: 'Duration' })).toExist(),
        Scene.click(physics),
        focusModeOption,
        Scene.expect(physics).toHaveAttr('aria-checked', 'true'),
        Scene.expect(Scene.role('slider', { name: 'Duration' })).toBeAbsent(),
        Scene.expect(Scene.role('slider', { name: 'Stiffness' })).toExist(),
        Scene.expect(Scene.text('~0.42s')).toExist(),
      )
    })

    it('opens a step editor from a segment', () => {
      Scene.scene(
        { update, view },
        Scene.given(paused),
        measureRuler,
        Scene.keydown(button('Path, Step 2, 0.5s'), 'Enter'),
        anchorEditor,
        Scene.expect(
          Scene.role('dialog', { name: 'Edit Path Step 2' }),
        ).toExist(),
        Scene.expect(
          Scene.within(toGroup, Scene.role('slider', { name: 'X' })),
        ).toHaveAttr('aria-valuenow', '20'),
      )
    })
  })
})
