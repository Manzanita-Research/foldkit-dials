import { Effect, Fiber, Option, Stream } from 'effect'
import * as Story from 'foldkit/story'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FileDrop, Popover } from '@foldkit/ui'

import {
  FocusImage,
  Message,
  OutMessage,
  ReadImageFile,
  imageChoices,
  imageLabel,
  init,
  reflectOptions,
  subscriptions,
  update,
  uploadFailureText,
} from './index.js'

const COAST = '/images/coast.jpg'
const FOREST = '/images/forest.jpg'
const UPLOADED = 'data:image/png;base64,uploaded'
const OVERSIZED_BYTES = 10 * 1024 * 1024 + 1

const makeFile = (
  contents: BlobPart,
  name: string,
  type: string,
): globalThis.File => new globalThis.File([contents], name, { type })

const avatarFile = makeFile('png', 'avatar.png', 'image/png')

const defaultInit = () =>
  init({ id: 'cover', options: [{ value: COAST, label: 'Coast' }, FOREST] })

const opened = () =>
  update(
    defaultInit(),
    Message.GotPopoverMessage({ message: Popover.Message.RequestedOpen() }),
  ).model

const droppedFiles = (files: readonly [globalThis.File]) =>
  Message.GotFileDropMessage({
    message: FileDrop.Message.DroppedFiles({ files: [...files] }),
  })

const reading = (file: globalThis.File) =>
  update(opened(), droppedFiles([file])).model

const closedWhileReading = (file: globalThis.File) =>
  update(reading(file), Message.MovedFocusOutsidePicker()).model

describe('ImagePicker', () => {
  describe('init', () => {
    it('starts closed with no uploads, labelling bare URLs by file name', () => {
      const model = defaultInit()

      expect(model.popover.isOpen).toBe(false)
      expect(model.uploads).toEqual([])
      expect(model.uploadState._tag).toBe('Idle')
      expect(model.options).toEqual([
        { value: COAST, label: 'Coast' },
        { value: FOREST, label: 'forest.jpg' },
      ])
    })
  })

  describe('choices', () => {
    it('lists options then uploads without duplicates, and keeps an unlisted value', () => {
      const upload = { value: UPLOADED, label: 'My avatar.png' }

      expect(
        imageChoices(
          [
            { value: COAST, label: 'Coast' },
            { value: COAST, label: 'coast.jpg' },
            { value: '', label: 'Empty' },
          ],
          [upload],
          '/custom.png',
        ),
      ).toEqual([
        { value: COAST, label: 'Coast' },
        upload,
        { value: '/custom.png', label: 'custom.png' },
      ])
      expect(imageChoices([], [upload], UPLOADED)).toEqual([upload])
      expect(imageChoices([], [], '')).toEqual([])
    })

    it('labels images the way DialKit does', () => {
      expect(imageLabel('/photos/My%20photo.jpg?width=400#preview')).toBe(
        'My photo.jpg',
      )
      expect(imageLabel('/invalid%name.png')).toBe('invalid%name.png')
      expect(imageLabel(UPLOADED)).toBe('Uploaded image')
      expect(imageLabel('')).toBe('No image')
    })

    it('replaces the options and keeps the uploads', () => {
      const model = reflectOptions(['/new.jpg'])(defaultInit())

      expect(model.options).toEqual([{ value: '/new.jpg', label: 'new.jpg' }])
    })

    it('also replaces the options with the Model first', () => {
      const model = reflectOptions(defaultInit(), [
        { value: '/new.jpg', label: 'New' },
      ])

      expect(model.options).toEqual([{ value: '/new.jpg', label: 'New' }])
    })
  })

  describe('select', () => {
    it('reports the chosen image and focuses its thumbnail', () => {
      Story.story(
        update,
        Story.given(opened()),
        Story.message(
          Message.SelectedImage({
            index: 1,
            value: FOREST,
            currentValue: COAST,
          }),
        ),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: FOREST })),
        Story.Command.expectExact(FocusImage({ id: 'cover', index: 1 })),
        Story.Command.resolve(FocusImage, Message.CompletedFocusImage()),
        Story.model(model => {
          expect(model.popover.isOpen).toBe(true)
        }),
      )
    })

    it('reports nothing when the image is already selected', () => {
      Story.story(
        update,
        Story.given(opened()),
        Story.message(
          Message.SelectedImage({
            index: 0,
            value: COAST,
            currentValue: COAST,
          }),
        ),
        Story.expectNoOutMessage(),
        Story.Command.resolve(FocusImage, Message.CompletedFocusImage()),
      )
    })
  })

  describe('remove', () => {
    it('reports an empty value, closes, and returns focus to the trigger', () => {
      Story.story(
        update,
        Story.given(opened()),
        Story.message(Message.ClickedRemove()),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: '' })),
        Story.Command.resolve(
          Popover.FocusButton,
          Popover.Message.CompletedFocusButton(),
        ),
        Story.model(model => {
          expect(model.popover.isOpen).toBe(false)
        }),
      )
    })
  })

  describe('keyboard', () => {
    it('moves the roving tab stop and focuses the thumbnail', () => {
      Story.story(
        update,
        Story.given(opened()),
        Story.message(Message.PressedKeyboardNavigation({ index: 1 })),
        Story.expectNoOutMessage(),
        Story.Command.expectExact(FocusImage({ id: 'cover', index: 1 })),
        Story.Command.resolve(FocusImage, Message.CompletedFocusImage()),
        Story.model(model => {
          expect(model.maybeFocusedIndex).toEqual(Option.some(1))
        }),
      )
    })

    it('closes on Escape, returns focus to the trigger, and resets the tab stop', () => {
      Story.story(
        update,
        Story.given(
          update(opened(), Message.PressedKeyboardNavigation({ index: 1 }))
            .model,
        ),
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
          expect(model.maybeFocusedIndex).toEqual(Option.none())
        }),
      )
    })

    it('closes when focus lands outside the picker', () => {
      Story.story(
        update,
        Story.given(opened()),
        Story.message(Message.MovedFocusOutsidePicker()),
        Story.Command.resolve(
          Popover.FocusButton,
          Popover.Message.CompletedFocusButton(),
        ),
        Story.model(model => {
          expect(model.popover.isOpen).toBe(false)
        }),
      )
    })
  })

  describe('upload', () => {
    it('reads a dropped image, keeps it as a choice, selects it, and focuses it', () => {
      Story.story(
        update,
        Story.given(opened()),
        Story.message(droppedFiles([avatarFile])),
        Story.Command.expectExact(ReadImageFile({ file: avatarFile })),
        Story.model(model => {
          expect(model.uploadState._tag).toBe('Reading')
        }),
        Story.Command.resolve(
          ReadImageFile,
          Message.SucceededReadImageFile({
            file: avatarFile,
            dataUrl: UPLOADED,
          }),
        ),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: UPLOADED })),
        Story.Command.expectExact(FocusImage({ id: 'cover', index: 2 })),
        Story.Command.resolve(FocusImage, Message.CompletedFocusImage()),
        Story.model(model => {
          expect(model.uploads).toEqual([
            { value: UPLOADED, label: 'avatar.png' },
          ])
          expect(model.uploadState._tag).toBe('Idle')
        }),
      )
    })

    it('keeps uploads after the picker closes', () => {
      Story.story(
        update,
        Story.given(opened()),
        Story.message(droppedFiles([avatarFile])),
        Story.Command.resolve(
          ReadImageFile,
          Message.SucceededReadImageFile({
            file: avatarFile,
            dataUrl: UPLOADED,
          }),
        ),
        Story.Command.resolve(FocusImage, Message.CompletedFocusImage()),
        Story.message(Message.MovedFocusOutsidePicker()),
        Story.Command.resolve(
          Popover.FocusButton,
          Popover.Message.CompletedFocusButton(),
        ),
        Story.model(model => {
          expect(model.popover.isOpen).toBe(false)
          expect(model.uploads).toEqual([
            { value: UPLOADED, label: 'avatar.png' },
          ])
        }),
      )
    })

    it('shows a too-large failure and reports nothing', () => {
      const oversizedFile = makeFile(
        new Uint8Array(OVERSIZED_BYTES),
        'huge.png',
        'image/png',
      )

      Story.story(
        update,
        Story.given(opened()),
        Story.message(droppedFiles([oversizedFile])),
        Story.Command.resolve(
          ReadImageFile,
          Message.FailedReadImageFile({
            file: oversizedFile,
            failure: 'TooLarge',
          }),
        ),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.uploadState).toEqual({
            _tag: 'Failed',
            failure: 'TooLarge',
          })
          expect(model.uploads).toEqual([])
        }),
      )
    })

    it('ignores another file while one is reading', () => {
      const otherFile = makeFile('png', 'other.png', 'image/png')

      Story.story(
        update,
        Story.given(reading(avatarFile)),
        Story.message(droppedFiles([otherFile])),
        Story.Command.expectNone(),
        Story.model(model => {
          expect(model.uploadState).toEqual({
            _tag: 'Reading',
            file: avatarFile,
          })
        }),
      )
    })

    it('drops a result for an earlier file while a newer one is reading', () => {
      const newerFile = makeFile('png', 'newer.png', 'image/png')

      Story.story(
        update,
        Story.given(reading(newerFile)),
        Story.message(
          Message.SucceededReadImageFile({
            file: avatarFile,
            dataUrl: UPLOADED,
          }),
        ),
        Story.expectNoOutMessage(),
        Story.Command.expectNone(),
        Story.model(model => {
          expect(model.uploads).toEqual([])
          expect(model.uploadState).toEqual({
            _tag: 'Reading',
            file: newerFile,
          })
        }),
      )
    })

    it('keeps reading after the picker closes, then selects the upload without moving focus', () => {
      Story.story(
        update,
        Story.given(reading(avatarFile)),
        Story.message(Message.MovedFocusOutsidePicker()),
        Story.Command.resolve(
          Popover.FocusButton,
          Popover.Message.CompletedFocusButton(),
        ),
        Story.model(model => {
          expect(model.popover.isOpen).toBe(false)
          expect(model.uploadState).toEqual({
            _tag: 'Reading',
            file: avatarFile,
          })
        }),
        Story.message(
          Message.SucceededReadImageFile({
            file: avatarFile,
            dataUrl: UPLOADED,
          }),
        ),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: UPLOADED })),
        Story.Command.expectNone(),
        Story.model(model => {
          expect(model.uploads).toEqual([
            { value: UPLOADED, label: 'avatar.png' },
          ])
          expect(model.uploadState._tag).toBe('Idle')
        }),
      )
    })

    it('cancels a read when Remove is clicked, so the image does not come back', () => {
      Story.story(
        update,
        Story.given(reading(avatarFile)),
        Story.message(Message.ClickedRemove()),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: '' })),
        Story.Command.resolve(
          Popover.FocusButton,
          Popover.Message.CompletedFocusButton(),
        ),
        Story.model(model => {
          expect(model.uploadState._tag).toBe('Idle')
        }),
        Story.message(
          Message.SucceededReadImageFile({
            file: avatarFile,
            dataUrl: UPLOADED,
          }),
        ),
        Story.expectNoOutMessage(),
        Story.Command.expectNone(),
        Story.model(model => {
          expect(model.uploads).toEqual([])
        }),
      )
    })

    it('shows a failure that finishes after the picker closes when it reopens', () => {
      Story.story(
        update,
        Story.given(closedWhileReading(avatarFile)),
        Story.message(
          Message.FailedReadImageFile({
            file: avatarFile,
            failure: 'Unreadable',
          }),
        ),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.uploadState).toEqual({
            _tag: 'Failed',
            failure: 'Unreadable',
          })
        }),
      )
    })

    it('clears a failure when the picker closes', () => {
      const failed = update(
        reading(avatarFile),
        Message.FailedReadImageFile({
          file: avatarFile,
          failure: 'NotAnImage',
        }),
      ).model

      Story.story(
        update,
        Story.given(failed),
        Story.message(Message.MovedFocusOutsidePicker()),
        Story.Command.resolve(
          Popover.FocusButton,
          Popover.Message.CompletedFocusButton(),
        ),
        Story.model(model => {
          expect(model.uploadState._tag).toBe('Idle')
        }),
      )
    })

    it.each([
      ['TooLarge', 'Choose an image smaller than 10 MB.'],
      [
        'NotAnImage',
        'Choose an image file, such as PNG, JPG, WebP, GIF, or SVG.',
      ],
      ['Unreadable', 'This image could not be opened. Try another file.'],
    ] as const)('explains a %s failure', (failure, text) => {
      expect(uploadFailureText(failure)).toBe(text)
    })

    it('drops a read that finishes after another image was selected', () => {
      Story.story(
        update,
        Story.given(reading(avatarFile)),
        Story.message(
          Message.SelectedImage({
            index: 1,
            value: FOREST,
            currentValue: COAST,
          }),
        ),
        Story.Command.resolve(FocusImage, Message.CompletedFocusImage()),
        Story.message(
          Message.SucceededReadImageFile({
            file: avatarFile,
            dataUrl: UPLOADED,
          }),
        ),
        Story.expectNoOutMessage(),
        Story.Command.expectNone(),
        Story.model(model => {
          expect(model.uploads).toEqual([])
        }),
      )
    })
  })

  describe('focusOutside', () => {
    const waitForNextTurn = (): Promise<void> =>
      new Promise(resolve => setTimeout(resolve, 0))

    const focusIn = (element: Element): void => {
      element.dispatchEvent(
        new FocusEvent('focusin', { bubbles: true, composed: true }),
      )
    }

    const collectMessages = (isOpen: boolean) => {
      const received: Array<Message> = []
      const stream = subscriptions.focusOutside.dependenciesToStream({
        id: 'cover',
        isOpen,
      })
      const fiber = Effect.runFork(
        Stream.runForEach(stream, message =>
          Effect.sync(() => {
            received.push(message)
          }),
        ),
      )
      return { received, fiber }
    }

    const renderPickerAndOutsideButton = () => {
      const picker = document.createElement('div')
      picker.setAttribute('data-image-picker-id', 'cover')
      const thumbnail = document.createElement('button')
      picker.append(thumbnail)
      const outsideButton = document.createElement('button')
      document.body.append(picker, outsideButton)
      return { picker, thumbnail, outsideButton }
    }

    it('reports focus that lands outside the open picker, and only that', async () => {
      const { picker, thumbnail, outsideButton } =
        renderPickerAndOutsideButton()
      const { received, fiber } = collectMessages(true)

      try {
        await waitForNextTurn()

        focusIn(thumbnail)
        await waitForNextTurn()
        expect(received).toEqual([])

        focusIn(outsideButton)
        await waitForNextTurn()
        expect(received).toEqual([Message.MovedFocusOutsidePicker()])
      } finally {
        await Effect.runPromise(Fiber.interrupt(fiber))
        picker.remove()
        outsideButton.remove()
      }
    })

    it('does not listen while the picker is closed', async () => {
      const { picker, outsideButton } = renderPickerAndOutsideButton()
      const { received, fiber } = collectMessages(false)

      try {
        await waitForNextTurn()

        focusIn(outsideButton)
        await waitForNextTurn()
        expect(received).toEqual([])
      } finally {
        await Effect.runPromise(Fiber.interrupt(fiber))
        picker.remove()
        outsideButton.remove()
      }
    })
  })

  describe('ReadImageFile', () => {
    const runReadImageFile = (file: globalThis.File) =>
      Effect.runPromise(ReadImageFile({ file }).effect)

    const ONE_PIXEL_PNG_BASE64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

    const onePixelPng = () =>
      makeFile(
        Uint8Array.from(atob(ONE_PIXEL_PNG_BASE64), character =>
          character.charCodeAt(0),
        ),
        'dot.png',
        'image/png',
      )

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('reads an image that decodes as a data URL', async () => {
      const file = onePixelPng()

      expect(await runReadImageFile(file)).toEqual(
        Message.SucceededReadImageFile({
          file,
          dataUrl: `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`,
        }),
      )
    })

    it('fails an image the browser cannot decode', async () => {
      vi.spyOn(globalThis.Image.prototype, 'decode').mockRejectedValue(
        new Error('The source image cannot be decoded.'),
      )
      const file = onePixelPng()

      expect(await runReadImageFile(file)).toEqual(
        Message.FailedReadImageFile({ file, failure: 'Unreadable' }),
      )
    })

    it('fails a file over 10 MB before reading it', async () => {
      const oversizedFile = makeFile(
        new Uint8Array(OVERSIZED_BYTES),
        'huge.png',
        'image/png',
      )

      expect(await runReadImageFile(oversizedFile)).toEqual(
        Message.FailedReadImageFile({
          file: oversizedFile,
          failure: 'TooLarge',
        }),
      )
    })

    it('fails a file that is not an image', async () => {
      const textFile = makeFile('notes', 'notes.txt', 'text/plain')

      expect(await runReadImageFile(textFile)).toEqual(
        Message.FailedReadImageFile({ file: textFile, failure: 'NotAnImage' }),
      )
    })
  })
})
