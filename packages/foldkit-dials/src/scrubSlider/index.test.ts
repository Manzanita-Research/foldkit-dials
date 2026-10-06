import * as Story from 'foldkit/story'
import { describe, expect, it } from 'vitest'

import {
  FocusEditor,
  FocusSlider,
  Message,
  OutMessage,
  init,
  reflectRange,
  update,
} from './index.js'

const defaultInit = () => init({ id: 'radius', min: 0, max: 48, step: 1 })

const dragging = () =>
  update(defaultInit(), Message.PressedTrack({ value: 30.4, originValue: 20 }))
    .model

const editing = (draft: string) =>
  update(
    update(defaultInit(), Message.RequestedEdit({ value: 20 })).model,
    Message.UpdatedDraft({ draft }),
  ).model

describe('ScrubSlider', () => {
  describe('init', () => {
    it('starts Idle and Viewing with the configured range', () => {
      const model = defaultInit()

      expect(model.dragState._tag).toBe('Idle')
      expect(model.editState._tag).toBe('Viewing')
      expect([model.min, model.max, model.step]).toEqual([0, 48, 1])
    })
  })

  describe('pointer', () => {
    it('jumps to the pressed position, snapped to the step, and starts dragging', () => {
      Story.story(
        update,
        Story.given(defaultInit()),
        Story.message(Message.PressedTrack({ value: 30.4, originValue: 20 })),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: 30 })),
        Story.model(model => {
          expect(model.dragState._tag).toBe('Dragging')
        }),
      )
    })

    it('reports each pointer move while dragging, clamped to the range', () => {
      Story.story(
        update,
        Story.given(dragging()),
        Story.message(Message.MovedDragPointer({ value: 72 })),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: 48 })),
      )
    })

    it('ignores pointer moves when not dragging', () => {
      Story.story(
        update,
        Story.given(defaultInit()),
        Story.message(Message.MovedDragPointer({ value: 10 })),
        Story.expectNoOutMessage(),
      )
    })

    it('restores the value from before the drag on Escape', () => {
      Story.story(
        update,
        Story.given(dragging()),
        Story.message(Message.CancelledDrag()),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: 20 })),
        Story.model(model => {
          expect(model.dragState._tag).toBe('Idle')
        }),
      )
    })

    it('stops dragging on release without reporting a value', () => {
      Story.story(
        update,
        Story.given(dragging()),
        Story.message(Message.ReleasedDragPointer()),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.dragState._tag).toBe('Idle')
        }),
      )
    })
  })

  describe('keyboard', () => {
    it.each([
      ['StepIncrement', 21],
      ['StepDecrement', 19],
      ['PageIncrement', 30],
      ['PageDecrement', 10],
      ['Min', 0],
      ['Max', 48],
    ] as const)('%s moves the value to %d', (direction, expected) => {
      Story.story(
        update,
        Story.given(defaultInit()),
        Story.message(
          Message.PressedKeyboardNavigation({ direction, value: 20 }),
        ),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: expected })),
      )
    })

    it('reports nothing when the value cannot move further', () => {
      Story.story(
        update,
        Story.given(defaultInit()),
        Story.message(
          Message.PressedKeyboardNavigation({ direction: 'Max', value: 48 }),
        ),
        Story.expectNoOutMessage(),
      )
    })
  })

  describe('value editor', () => {
    it('opens with the formatted value and focuses the editor', () => {
      Story.story(
        update,
        Story.given(defaultInit()),
        Story.message(Message.RequestedEdit({ value: 20 })),
        Story.Command.expectExact(FocusEditor({ id: 'radius' })),
        Story.Command.resolve(FocusEditor, Message.CompletedFocusEditor()),
        Story.model(model => {
          expect(model.editState).toEqual({ _tag: 'Editing', draft: '20' })
        }),
      )
    })

    it('commits a typed value on Enter, clamped, and returns focus to the slider', () => {
      Story.story(
        update,
        Story.given(editing('99')),
        Story.message(Message.PressedEnterInEditor()),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: 48 })),
        Story.Command.resolve(FocusSlider, Message.CompletedFocusSlider()),
        Story.model(model => {
          expect(model.editState._tag).toBe('Viewing')
        }),
      )
    })

    it('commits on blur without moving focus', () => {
      Story.story(
        update,
        Story.given(editing('12.6')),
        Story.message(Message.BlurredEditor()),
        Story.Command.expectNone(),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: 13 })),
      )
    })

    it('discards text that is not a number', () => {
      Story.story(
        update,
        Story.given(editing('wide')),
        Story.message(Message.BlurredEditor()),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.editState._tag).toBe('Viewing')
        }),
      )
    })

    it('cancels on Escape and returns focus to the slider', () => {
      Story.story(
        update,
        Story.given(editing('30')),
        Story.message(Message.PressedEscapeInEditor()),
        Story.expectNoOutMessage(),
        Story.Command.resolve(FocusSlider, Message.CompletedFocusSlider()),
      )
    })
  })

  describe('reflectRange', () => {
    it('replaces the range', () => {
      const model = reflectRange({ min: -10, max: 10, step: 0.5 })(
        defaultInit(),
      )

      expect([model.min, model.max, model.step]).toEqual([-10, 10, 0.5])
    })

    it('also takes the Model first', () => {
      const model = reflectRange(defaultInit(), { min: 1, max: 2, step: 0.1 })

      expect([model.min, model.max, model.step]).toEqual([1, 2, 0.1])
    })
  })
})
