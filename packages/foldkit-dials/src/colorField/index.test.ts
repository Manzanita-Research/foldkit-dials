import { Effect, Fiber, Stream } from 'effect'
import * as Story from 'foldkit/story'
import { describe, expect, it } from 'vitest'

import { Popover, RadioGroup } from '@foldkit/ui'

import * as ColorPicker from '../colorPicker/index.js'
import {
  Message,
  OutMessage,
  init,
  reflectValue,
  subscriptions,
  update,
} from './index.js'

const RED = '#ff0000'

const closedField = () => init({ id: 'accent', value: RED })

const openField = () =>
  update(
    closedField(),
    Message.GotPopoverMessage({ message: Popover.Message.RequestedOpen() }),
  ).model

const editing = (draft: string) =>
  update(closedField(), Message.UpdatedDraft({ draft })).model

describe('ColorField', () => {
  describe('init', () => {
    it('derives the picker and popover ids and starts closed', () => {
      const model = closedField()

      expect(model.picker.id).toBe('accent-picker')
      expect(model.picker.selectedFormat).toBe('Hex')
      expect(model.popover.id).toBe('accent-popover')
      expect(model.popover.isOpen).toBe(false)
      expect(model.popover.contentFocus).toBe(true)
      expect(model.editState._tag).toBe('Viewing')
    })
  })

  describe('picker', () => {
    it('reports picker edits as its own ChangedValue', () => {
      Story.story(
        update,
        Story.given(openField()),
        Story.message(
          Message.GotColorPickerMessage({
            message: ColorPicker.Message.SelectedFormatOption({
              option: RadioGroup.Message.SelectedOption({
                index: 1,
                value: 'Oklch',
              }),
              value: RED,
            }),
          }),
        ),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: 'oklch(0.628 0.2577 29.23)' }),
        ),
        Story.Command.resolve(
          RadioGroup.FocusOption,
          RadioGroup.Message.CompletedFocusOption(),
        ),
        Story.model(model => {
          expect(model.picker.selectedFormat).toBe('Oklch')
        }),
      )
    })

    it('routes picker Commands back through the picker', () => {
      Story.story(
        update,
        Story.given(openField()),
        Story.message(
          Message.GotColorPickerMessage({
            message: ColorPicker.Message.PressedPointer({
              target: 'Alpha',
              position: { horizontal: 0, vertical: 0 },
              value: RED,
            }),
          }),
        ),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: '#ff000000' })),
        Story.Command.resolve(
          ColorPicker.FocusThumb,
          ColorPicker.Message.CompletedFocusThumb(),
        ),
        Story.model(model => {
          expect(model.picker.dragState._tag).toBe('Dragging')
        }),
      )
    })
  })

  describe('popover', () => {
    it('opens without reporting a value', () => {
      Story.story(
        update,
        Story.given(closedField()),
        Story.message(
          Message.GotPopoverMessage({
            message: Popover.Message.RequestedOpen(),
          }),
        ),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.popover.isOpen).toBe(true)
        }),
      )
    })

    it('drops text typed into the picker when it closes', () => {
      const typedInPicker = update(
        openField(),
        Message.GotColorPickerMessage({
          message: ColorPicker.Message.UpdatedDraft({ draft: '#00' }),
        }),
      ).model

      Story.story(
        update,
        Story.given(typedInPicker),
        Story.message(
          Message.GotPopoverMessage({
            message: Popover.Message.RequestedClose(),
          }),
        ),
        Story.Command.resolve(
          Popover.FocusButton,
          Popover.Message.CompletedFocusButton(),
        ),
        Story.model(model => {
          expect(model.popover.isOpen).toBe(false)
          expect(model.picker.editState._tag).toBe('Viewing')
        }),
      )
    })
  })

  describe('focus outside', () => {
    it('closes, returns focus to the swatch, and drops picker text', () => {
      const typedInPicker = update(
        openField(),
        Message.GotColorPickerMessage({
          message: ColorPicker.Message.UpdatedDraft({ draft: '#0' }),
        }),
      ).model

      Story.story(
        update,
        Story.given(typedInPicker),
        Story.message(Message.MovedFocusOutsideField()),
        Story.expectNoOutMessage(),
        Story.Command.expectExact(
          Popover.FocusButton({ id: 'accent-popover' }),
        ),
        Story.Command.resolve(
          Popover.FocusButton,
          Popover.Message.CompletedFocusButton(),
        ),
        Story.model(model => {
          expect(model.popover.isOpen).toBe(false)
          expect(model.picker.editState._tag).toBe('Viewing')
        }),
      )
    })

    const waitForNextTurn = (): Promise<void> =>
      new Promise(resolve => setTimeout(resolve, 0))

    const focusIn = (element: Element): void => {
      element.dispatchEvent(
        new FocusEvent('focusin', { bubbles: true, composed: true }),
      )
    }

    const collectMessages = (isOpen: boolean) => {
      const received: Array<Message> = []
      const fiber = Effect.runFork(
        Stream.runForEach(
          subscriptions.focusOutside.dependenciesToStream({
            id: 'accent',
            isOpen,
          }),
          message =>
            Effect.sync(() => {
              received.push(message)
            }),
        ),
      )
      return { received, fiber }
    }

    const renderFieldAndOutsideButton = () => {
      const field = document.createElement('div')
      field.setAttribute('data-color-field-id', 'accent')
      const swatch = document.createElement('button')
      field.append(swatch)
      const panel = document.createElement('div')
      panel.setAttribute('data-color-field-id', 'accent')
      const thumb = document.createElement('span')
      thumb.tabIndex = 0
      panel.append(thumb)
      const outsideButton = document.createElement('button')
      document.body.append(field, panel, outsideButton)
      return { field, panel, swatch, thumb, outsideButton }
    }

    it('reports focus that lands outside the open field, and only that', async () => {
      const { field, panel, swatch, thumb, outsideButton } =
        renderFieldAndOutsideButton()
      const { received, fiber } = collectMessages(true)

      try {
        await waitForNextTurn()

        focusIn(thumb)
        focusIn(swatch)
        await waitForNextTurn()
        expect(received).toEqual([])

        focusIn(outsideButton)
        await waitForNextTurn()
        expect(received).toEqual([Message.MovedFocusOutsideField()])
      } finally {
        await Effect.runPromise(Fiber.interrupt(fiber))
        field.remove()
        panel.remove()
        outsideButton.remove()
      }
    })

    it('does not listen while the picker is closed', async () => {
      const { field, panel, outsideButton } = renderFieldAndOutsideButton()
      const { received, fiber } = collectMessages(false)

      try {
        await waitForNextTurn()

        focusIn(outsideButton)
        await waitForNextTurn()
        expect(received).toEqual([])
      } finally {
        await Effect.runPromise(Fiber.interrupt(fiber))
        field.remove()
        panel.remove()
        outsideButton.remove()
      }
    })
  })

  describe('value input', () => {
    it('commits a typed colour on Enter as typed and adopts its format', () => {
      Story.story(
        update,
        Story.given(editing('oklch(0.5 0.1 200)')),
        Story.message(Message.PressedEnterInEditor({ value: RED })),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: 'oklch(0.5 0.1 200)' }),
        ),
        Story.model(model => {
          expect(model.editState._tag).toBe('Viewing')
          expect(model.picker.selectedFormat).toBe('Oklch')
        }),
      )
    })

    it('commits on blur', () => {
      Story.story(
        update,
        Story.given(editing('rgb(0 0 255)')),
        Story.message(Message.BlurredEditor({ value: RED })),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: 'rgb(0 0 255)' }),
        ),
      )
    })

    it('keeps unparsable text on Enter and marks it rejected', () => {
      Story.story(
        update,
        Story.given(editing('crimson')),
        Story.message(Message.PressedEnterInEditor({ value: RED })),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.editState).toEqual({
            _tag: 'Rejected',
            draft: 'crimson',
          })
        }),
      )
    })

    it('discards unparsable text on blur', () => {
      Story.story(
        update,
        Story.given(editing('crimson')),
        Story.message(Message.BlurredEditor({ value: RED })),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.editState._tag).toBe('Viewing')
        }),
      )
    })

    it('cancels on Escape', () => {
      Story.story(
        update,
        Story.given(editing('#00ff00')),
        Story.message(Message.PressedEscapeInEditor()),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.editState._tag).toBe('Viewing')
        }),
      )
    })
  })

  describe('reflectValue', () => {
    it('adopts the format of a value set from outside', () => {
      expect(
        reflectValue('color(display-p3 1 0 0)')(closedField()).picker
          .selectedFormat,
      ).toBe('DisplayP3')
    })

    it('also takes the Model first', () => {
      expect(
        reflectValue(closedField(), 'oklch(0.5 0.1 20)').picker.selectedFormat,
      ).toBe('Oklch')
    })
  })
})
