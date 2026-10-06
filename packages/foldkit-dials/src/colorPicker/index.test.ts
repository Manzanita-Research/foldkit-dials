import { Option } from 'effect'
import * as Story from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, it } from 'vitest'

import { RadioGroup } from '@foldkit/ui'

import { type ColorFormat, isInGamut } from '../color/index.js'
import { parseColor } from '../color/parse.js'
import {
  FocusThumb,
  Message,
  type Model,
  OutMessage,
  type PickerColor,
  areaGamut,
  discardDraft,
  init,
  pickerColorOf,
  reflectValue,
  submitText,
  update,
} from './index.js'

const RED = '#ff0000'
const BLUE = '#1e82f0'

const pickerFor = (value: string) => init({ id: 'accent', value })

const lastEditOf = (model: Model): PickerColor =>
  Option.match(model.maybeLastEdit, {
    onNone: () => {
      throw new Error('Expected the picker to remember its last edit')
    },
    onSome: ({ pickerColor }) => pickerColor,
  })

const writtenValueOf = (outMessage: OutMessage | undefined): string => {
  if (outMessage === undefined) {
    throw new Error('Expected a ChangedValue OutMessage')
  } else {
    return outMessage.value
  }
}

const draggingAlpha = () =>
  update(
    pickerFor(RED),
    Message.PressedPointer({
      target: 'Alpha',
      position: { horizontal: 0.5, vertical: 0.5 },
      value: RED,
    }),
  ).model

const editing = (draft: string) =>
  update(pickerFor(RED), Message.UpdatedDraft({ draft })).model

const FORMATS: ReadonlyArray<ColorFormat> = ['Hex', 'Oklch', 'DisplayP3']

const VALUE_IN_FORMAT: Readonly<Record<ColorFormat, string>> = {
  Hex: BLUE,
  Oklch: 'oklch(0.6 0.1 250)',
  DisplayP3: 'color(display-p3 0.2 0.5 0.9)',
}

const selectFormat = (format: ColorFormat, value: string) =>
  Message.SelectedFormatOption({
    option: RadioGroup.Message.SelectedOption({
      index: FORMATS.indexOf(format),
      value: format,
    }),
    value,
  })

const focusedFormat = Story.Command.resolve(
  RadioGroup.FocusOption,
  RadioGroup.Message.CompletedFocusOption(),
)

describe('ColorPicker', () => {
  describe('init', () => {
    it.each([
      ['#a78bfa', 'Hex'],
      ['rgb(255 0 0)', 'Hex'],
      ['oklch(0.7 0.2 145)', 'Oklch'],
      ['color(display-p3 1 0 0)', 'DisplayP3'],
    ] as const)('starts %s in the %s format', (value, format) => {
      const model = pickerFor(value)

      expect(model.selectedFormat).toBe(format)
      expect(model.dragState._tag).toBe('Idle')
      expect(model.editState._tag).toBe('Viewing')
    })

    it.each([
      ['rgb(255 0 0)', /^#[\da-f]{8}$/],
      ['oklch(0.7 0.2 145)', /^oklch\(/],
      ['color(display-p3 1 0 0)', /^color\(display-p3 /],
    ] as const)('writes later edits to %s in its format', (value, written) => {
      const alphaKey = update(
        pickerFor(value),
        Message.PressedTrackKeyboardNavigation({
          track: 'Alpha',
          direction: 'StepDecrement',
          value,
        }),
      )

      expect(writtenValueOf(alphaKey.outMessage)).toMatch(written)
    })

    it('spans sRGB for hex and Display P3 otherwise', () => {
      expect(areaGamut('Hex')).toBe('Srgb')
      expect(areaGamut('Oklch')).toBe('DisplayP3')
      expect(areaGamut('DisplayP3')).toBe('DisplayP3')
    })
  })

  describe('pointer', () => {
    it('sets alpha from the track, starts dragging, and focuses the thumb', () => {
      Story.story(
        update,
        Story.given(pickerFor(RED)),
        Story.message(
          Message.PressedPointer({
            target: 'Alpha',
            position: { horizontal: 0.5, vertical: 0.5 },
            value: RED,
          }),
        ),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: '#ff000080' })),
        Story.Command.expectExact(
          FocusThumb({ id: 'accent', target: 'Alpha' }),
        ),
        Story.Command.resolve(FocusThumb, Message.CompletedFocusThumb()),
        Story.model(model => {
          expect(model.dragState).toMatchObject({
            _tag: 'Dragging',
            target: 'Alpha',
            originValue: RED,
          })
        }),
      )
    })

    it.each([
      [{ horizontal: 0.3, vertical: 0 }, '#ffffff'],
      [{ horizontal: 0.7, vertical: 1 }, '#000000'],
    ])(
      'maps the area so the top is white and the bottom is black',
      (position, expected) => {
        Story.story(
          update,
          Story.given(pickerFor(RED)),
          Story.message(
            Message.PressedPointer({ target: 'Area', position, value: RED }),
          ),
          Story.expectOutMessage(OutMessage.ChangedValue({ value: expected })),
          Story.Command.resolve(FocusThumb, Message.CompletedFocusThumb()),
        )
      },
    )

    it('sets the hue from the track and keeps lightness and saturation', () => {
      const model = pickerFor('oklch(0.7 0.1 120)')
      const before = pickerColorOf(model, 'oklch(0.7 0.1 120)')
      const huePress = update(
        model,
        Message.PressedPointer({
          target: 'Hue',
          position: { horizontal: 0.75, vertical: 0 },
          value: 'oklch(0.7 0.1 120)',
        }),
      )
      const after = lastEditOf(huePress.model)

      expect(after.color.hue).toBe(270)
      expect(after.color.lightness).toBe(0.7)
      expect(after.saturation).toBeCloseTo(before.saturation, 10)
      expect(writtenValueOf(huePress.outMessage)).toMatch(
        /^oklch\(0\.7 \S+ 270\)$/,
      )
    })

    it('reports each pointer move from the colour the drag started on', () => {
      Story.story(
        update,
        Story.given(draggingAlpha()),
        Story.message(
          Message.MovedDragPointer({
            position: { horizontal: 0.25, vertical: 0.9 },
          }),
        ),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: '#ff000040' })),
      )
    })

    it('ignores pointer moves when not dragging', () => {
      Story.story(
        update,
        Story.given(pickerFor(RED)),
        Story.message(
          Message.MovedDragPointer({
            position: { horizontal: 0.25, vertical: 0.9 },
          }),
        ),
        Story.expectNoOutMessage(),
      )
    })

    it('ignores a second press while dragging', () => {
      Story.story(
        update,
        Story.given(draggingAlpha()),
        Story.message(
          Message.PressedPointer({
            target: 'Area',
            position: { horizontal: 0, vertical: 0 },
            value: '#ff000080',
          }),
        ),
        Story.expectNoOutMessage(),
        Story.Command.expectNone(),
      )
    })

    it('restores the value from before the drag on Escape', () => {
      Story.story(
        update,
        Story.given(draggingAlpha()),
        Story.message(Message.CancelledDrag()),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: RED })),
        Story.model(model => {
          expect(model.dragState._tag).toBe('Idle')
          expect(lastEditOf(model).color.alpha).toBe(1)
        }),
      )
    })

    it('stops dragging on release without reporting a value', () => {
      Story.story(
        update,
        Story.given(draggingAlpha()),
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
      ['Up', 'Step', 'oklch(0.51 0 0)'],
      ['Down', 'Step', 'oklch(0.49 0 0)'],
      ['Up', 'Page', 'oklch(0.6 0 0)'],
    ] as const)(
      'moves the area thumb %s by a %s',
      (direction, stepSize, expected) => {
        Story.story(
          update,
          Story.given(pickerFor('oklch(0.5 0 0)')),
          Story.message(
            Message.PressedAreaKeyboardNavigation({
              direction,
              stepSize,
              value: 'oklch(0.5 0 0)',
            }),
          ),
          Story.expectOutMessage(OutMessage.ChangedValue({ value: expected })),
        )
      },
    )

    it('moves saturation right by a step', () => {
      const areaKey = update(
        pickerFor('oklch(0.5 0 0)'),
        Message.PressedAreaKeyboardNavigation({
          direction: 'Right',
          stepSize: 'Step',
          value: 'oklch(0.5 0 0)',
        }),
      )

      expect(lastEditOf(areaKey.model).saturation).toBeCloseTo(0.01, 10)
    })

    it.each([
      ['StepDecrement', '#ff0000fc'],
      ['PageDecrement', '#ff0000e6'],
      ['Min', '#ff000000'],
    ] as const)('%s moves alpha to %s', (direction, expected) => {
      Story.story(
        update,
        Story.given(pickerFor(RED)),
        Story.message(
          Message.PressedTrackKeyboardNavigation({
            track: 'Alpha',
            direction,
            value: RED,
          }),
        ),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: expected })),
      )
    })

    it('reports nothing when alpha cannot move further', () => {
      Story.story(
        update,
        Story.given(pickerFor(RED)),
        Story.message(
          Message.PressedTrackKeyboardNavigation({
            track: 'Alpha',
            direction: 'StepIncrement',
            value: RED,
          }),
        ),
        Story.expectNoOutMessage(),
      )
    })

    it('steps the hue by a degree, and by ten with Shift', () => {
      const value = 'oklch(0.7 0.1 120)'
      const hueAfter = (
        direction: 'StepIncrement' | 'PageDecrement' | 'Max',
      ): number =>
        lastEditOf(
          update(
            pickerFor(value),
            Message.PressedTrackKeyboardNavigation({
              track: 'Hue',
              direction,
              value,
            }),
          ).model,
        ).color.hue

      expect(hueAfter('StepIncrement')).toBe(121)
      expect(hueAfter('PageDecrement')).toBe(110)
      expect(hueAfter('Max')).toBe(360)
    })
  })

  describe('colour memory', () => {
    const whiteFromBlue = () =>
      update(
        pickerFor(BLUE),
        Message.PressedPointer({
          target: 'Area',
          position: { horizontal: 0.4, vertical: 0 },
          value: BLUE,
        }),
      ).model

    it('keeps the hue and area position through white', () => {
      const model = whiteFromBlue()
      const blueHue = Option.getOrThrow(parseColor(BLUE)).hue

      expect(pickerColorOf(model, '#ffffff')).toMatchObject({
        saturation: 0.4,
      })
      expect(pickerColorOf(model, '#ffffff').color.hue).toBeCloseTo(blueHue, 6)
    })

    it('keeps the previous hue for a neutral value set from outside', () => {
      const model = whiteFromBlue()
      const external = pickerColorOf(model, '#000000')

      expect(external.color.lightness).toBe(0)
      expect(external.color.hue).toBeCloseTo(
        Option.getOrThrow(parseColor(BLUE)).hue,
        6,
      )
    })

    it('reads a value set from outside as written', () => {
      const model = whiteFromBlue()

      expect(pickerColorOf(model, RED).color).toEqual(
        Option.getOrThrow(parseColor(RED)),
      )
    })
  })

  describe('format', () => {
    it('re-emits the value in the selected format and focuses the option', () => {
      Story.story(
        update,
        Story.given(pickerFor(RED)),
        Story.message(selectFormat('Oklch', RED)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: 'oklch(0.628 0.2577 29.23)' }),
        ),
        Story.Command.expectExact(
          RadioGroup.FocusOption({ id: 'accent-format', index: 1 }),
        ),
        focusedFormat,
        Story.model(model => {
          expect(model.selectedFormat).toBe('Oklch')
        }),
      )
    })

    it('reports nothing when the selected format writes the same text', () => {
      Story.story(
        update,
        Story.given(pickerFor(RED)),
        Story.message(selectFormat('Hex', RED)),
        Story.expectNoOutMessage(),
        focusedFormat,
      )
    })

    it('only records a format selected without the colour', () => {
      Story.story(
        update,
        Story.given(pickerFor(RED)),
        Story.message(
          Message.GotFormatGroupMessage({
            message: RadioGroup.Message.SelectedOption({
              index: 2,
              value: 'DisplayP3',
            }),
          }),
        ),
        Story.expectNoOutMessage(),
        focusedFormat,
        Story.model(model => {
          expect(model.selectedFormat).toBe('DisplayP3')
        }),
      )
    })

    it('reduces chroma, keeping lightness and hue, for a smaller gamut', () => {
      const wide = 'color(display-p3 1 0 0)'
      const formatClick = update(pickerFor(wide), selectFormat('Hex', wide))
      const before = Option.getOrThrow(parseColor(wide))
      const after = lastEditOf(formatClick.model).color

      expect(writtenValueOf(formatClick.outMessage)).toMatch(/^#[\da-f]{6}$/)
      expect(after.chroma).toBeLessThan(before.chroma)
      expect(isInGamut(after, 'Srgb')).toBe(true)
      expect([after.lightness, after.hue]).toEqual([
        before.lightness,
        before.hue,
      ])
    })

    it.each([
      ['Hex', 'Srgb'],
      ['Oklch', 'DisplayP3'],
      ['DisplayP3', 'DisplayP3'],
    ] as const)(
      'keeps a full-chroma area press in %s inside the %s gamut',
      (format, gamut) => {
        const value = VALUE_IN_FORMAT[format]
        const press = update(
          pickerFor(value),
          Message.PressedPointer({
            target: 'Area',
            position: { horizontal: 1, vertical: 0.4 },
            value,
          }),
        )
        const written = Option.getOrThrow(
          parseColor(writtenValueOf(press.outMessage)),
        )

        expect(areaGamut(format)).toBe(gamut)
        expect(isInGamut(written, gamut)).toBe(true)
        expect(written.chroma).toBeGreaterThan(0)
      },
    )
  })

  describe('text input', () => {
    it('commits typed RGB on Enter as typed and writes hex next', () => {
      Story.story(
        update,
        Story.given(editing(' rgb(0 128 255) ')),
        Story.message(Message.PressedEnterInEditor({ value: RED })),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: 'rgb(0 128 255)' }),
        ),
        Story.model(model => {
          expect(model.editState._tag).toBe('Viewing')
          expect(model.selectedFormat).toBe('Hex')
        }),
      )
    })

    it('switches to the format of typed OKLCH', () => {
      Story.story(
        update,
        Story.given(editing('oklch(0.5 0.1 200)')),
        Story.message(Message.BlurredEditor({ value: RED })),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: 'oklch(0.5 0.1 200)' }),
        ),
        Story.model(model => {
          expect(model.selectedFormat).toBe('Oklch')
        }),
      )
    })

    it('keeps unparsable text on Enter and marks it rejected', () => {
      Story.story(
        update,
        Story.given(editing('nope')),
        Story.message(Message.PressedEnterInEditor({ value: RED })),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.editState).toEqual({ _tag: 'Rejected', draft: 'nope' })
        }),
      )
    })

    it('discards unparsable text on blur', () => {
      Story.story(
        update,
        Story.given(editing('nope')),
        Story.message(Message.BlurredEditor({ value: RED })),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.editState._tag).toBe('Viewing')
        }),
      )
    })

    it('reports nothing when the typed text is the value', () => {
      Story.story(
        update,
        Story.given(editing(RED)),
        Story.message(Message.BlurredEditor({ value: RED })),
        Story.expectNoOutMessage(),
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

  describe('submitText', () => {
    it('ignores text that is not a colour', () => {
      const submission = submitText(pickerFor(RED), {
        text: 'var(--accent)',
        value: RED,
      })

      expect(submission.outMessage).toBeUndefined()
    })
  })

  describe('discardDraft', () => {
    it('drops the typed text', () => {
      expect(discardDraft(editing('#00')).editState._tag).toBe('Viewing')
    })
  })

  describe('reflectValue', () => {
    it('adopts the format of a value set from outside', () => {
      expect(
        reflectValue('oklch(0.5 0.1 20)')(pickerFor(RED)).selectedFormat,
      ).toBe('Oklch')
    })

    it('leaves the picker unchanged for the value it wrote', () => {
      const model = modifyFields(pickerFor(RED), {
        maybeLastEdit: () =>
          Option.some({
            value: 'rgb(255 0 0)',
            pickerColor: pickerColorOf(pickerFor(RED), RED),
          }),
      })

      expect(reflectValue('rgb(255 0 0)')(model)).toBe(model)
    })
  })
})
