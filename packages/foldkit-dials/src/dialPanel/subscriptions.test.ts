import { Array, Effect, Fiber, Option, Record, Schema, Stream } from 'effect'
import { modifyFields } from 'foldkit/struct'
import * as Subscription from 'foldkit/subscription'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as Dial from '../dial/index.js'
import { make } from './index.js'
import { Message } from './message.js'
import { HeaderDrag } from './model.js'

const Tuning = Schema.Struct({
  radius: Dial.slider({
    default: 20,
    min: 0,
    max: 48,
    step: 1,
    shortcut: { key: 'r' },
  }),
  size: Dial.slider({
    default: 10,
    min: 0,
    max: 100,
    step: 1,
    shortcut: { key: 'r', modifier: 'Alt' },
  }),
  level: Dial.slider({
    default: 1,
    min: 0,
    max: 10,
    step: 1,
    shortcut: { key: '1', modifier: 'Shift' },
  }),
  zoom: Dial.slider({
    default: 1,
    min: 0,
    max: 4,
    shortcut: { interaction: 'ScrollOnly' },
  }),
  cover: Dial.image({ options: ['/a.png'] }),
  accent: Dial.color('#6d5efc'),
  glow: Dial.pad(),
  pop: Dial.spring({ visualDuration: 0.3, bounce: 0.2 }),
})

const card = make({ name: 'Card', schema: Tuning })
const hero = make({ name: 'Hero', schema: Tuning })

const collectMessages = (key: string, dependencies: unknown) => {
  const received: Array<Message> = []
  const subscription = Option.getOrThrow(Record.get(card.subscriptions, key))
  const fiber = Effect.runFork(
    Stream.runForEach(
      subscription.dependenciesToStream(dependencies, () => dependencies),
      message =>
        Effect.sync(() => {
          received.push(message)
        }),
    ),
  )
  return { received, fiber }
}

/** Runs `run` once the Subscription listens on `window` for every event
 *  type in `eventTypes`, then stops the Subscription. */
const listening = async (
  key: string,
  dependencies: unknown,
  eventTypes: ReadonlyArray<string>,
  run: (received: ReadonlyArray<Message>) => Promise<void>,
): Promise<void> => {
  const addListener = vi.spyOn(window, 'addEventListener')
  const { received, fiber } = collectMessages(key, dependencies)
  try {
    await vi.waitFor(() => {
      expect(
        Array.every(eventTypes, eventType =>
          Array.some(addListener.mock.calls, ([type]) => type === eventType),
        ),
      ).toBe(true)
    })
    await run(received)
  } finally {
    addListener.mockRestore()
    await Effect.runPromise(Fiber.interrupt(fiber))
  }
}

const dispatchKey = (
  type: 'keydown' | 'keyup',
  init: KeyboardEventInit,
): void => {
  window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }))
}

const dispatchWheel = (target: EventTarget, deltaY: number): WheelEvent => {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY,
  })
  target.dispatchEvent(event)
  return event
}

const pressedR = Message.PressedShortcutKey({
  key: 'r',
  maybeModifier: Option.none(),
})

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('DialPanel subscriptions', () => {
  describe('header drag', () => {
    const plain = make({
      name: 'Plain',
      schema: Schema.Struct({ title: Dial.text('Hello') }),
    })
    const subscription = Option.getOrThrow(
      Record.get(plain.subscriptions, 'plain:panelHeaderDrag'),
    )
    const eventTypes = [
      'pointermove',
      'pointerup',
      'pointercancel',
      'keydown',
      'blur',
    ]

    it.each([HeaderDrag.Idle(), HeaderDrag.Dropped()])(
      'installs no listeners in $_tag',
      async headerDrag => {
        const dependencies = subscription.modelToDependencies(
          modifyFields(plain.init().model, { headerDrag: () => headerDrag }),
        )
        const addDocument = vi.spyOn(document, 'addEventListener')
        const addWindow = vi.spyOn(window, 'addEventListener')
        try {
          const messages = await Effect.runPromise(
            Stream.runCollect(
              subscription.dependenciesToStream(
                dependencies,
                () => dependencies,
              ),
            ),
          )
          expect(messages).toEqual([])
          expect(addDocument).not.toHaveBeenCalled()
          expect(addWindow).not.toHaveBeenCalled()
        } finally {
          addDocument.mockRestore()
          addWindow.mockRestore()
        }
      },
    )

    it.each([
      HeaderDrag.Pressing({
        pointer: { x: 10, y: 10 },
        originOffset: { x: 0, y: 0 },
      }),
      HeaderDrag.Dragging({
        pointer: { x: 10, y: 10 },
        originOffset: { x: 0, y: 0 },
      }),
    ])(
      'handles cancellation without shortcuts in $_tag and removes every listener',
      async headerDrag => {
        const dependencies = subscription.modelToDependencies(
          modifyFields(plain.init().model, { headerDrag: () => headerDrag }),
        )
        const received: Array<Message> = []
        const addDocument = vi.spyOn(document, 'addEventListener')
        const removeDocument = vi.spyOn(document, 'removeEventListener')
        const addWindow = vi.spyOn(window, 'addEventListener')
        const removeWindow = vi.spyOn(window, 'removeEventListener')
        const fiber = Effect.runFork(
          Stream.runForEach(
            subscription.dependenciesToStream(dependencies, () => dependencies),
            message =>
              Effect.sync(() => {
                received.push(message)
              }),
          ),
        )
        try {
          await vi.waitFor(() => {
            expect(
              eventTypes.every(type =>
                [...addDocument.mock.calls, ...addWindow.mock.calls].some(
                  ([name]) => name === type,
                ),
              ),
            ).toBe(true)
          })
          document.dispatchEvent(
            new PointerEvent('pointermove', { clientX: 60, clientY: 40 }),
          )
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
          document.dispatchEvent(new PointerEvent('pointercancel'))
          document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape' }),
          )
          window.dispatchEvent(new FocusEvent('blur'))
          document.dispatchEvent(new PointerEvent('pointerup'))
          await vi.waitFor(() => {
            expect(received).toHaveLength(5)
          })
          expect(received).toContainEqual(
            Message.MovedPanelPointer({ clientX: 60, clientY: 40 }),
          )
          expect(
            received.filter(message => message._tag === 'CancelledPanelDrag'),
          ).toHaveLength(3)
          expect(received).toContainEqual(Message.ReleasedPanelPointer())
        } finally {
          await Effect.runPromise(Fiber.interrupt(fiber))
          addDocument.mock.calls.forEach(([type, listener]) => {
            expect(
              removeDocument.mock.calls.some(
                ([removedType, removedListener]) =>
                  removedType === type && removedListener === listener,
              ),
            ).toBe(true)
          })
          addWindow.mock.calls.forEach(([type, listener]) => {
            expect(
              removeWindow.mock.calls.some(
                ([removedType, removedListener]) =>
                  removedType === type && removedListener === listener,
              ),
            ).toBe(true)
          })
          addDocument.mockRestore()
          removeDocument.mockRestore()
          addWindow.mockRestore()
          removeWindow.mockRestore()
        }
      },
    )
  })

  it('starts every key with the panel id', () => {
    const keys = Record.keys(card.subscriptions)

    expect(keys).toContain('card:panelHeaderDrag')
    expect(keys).toContain('card:shortcutKeys')
    expect(keys).toContain('card:slider:radius:dragPointer')
    expect(Array.every(keys, key => key.startsWith('card:'))).toBe(true)
  })

  it('lifts two panels into one program without a key collision', () => {
    const Parent = Schema.Struct({ card: card.Model, hero: hero.Model })
    type Parent = typeof Parent.Type

    const lifted = Subscription.aggregate<Parent, Message>()(
      Subscription.lift(card.subscriptions)<Parent, Message>({
        read: model => Option.some(model.card),
        toParentMessage: message => message,
      }),
      Subscription.lift(hero.subscriptions)<Parent, Message>({
        read: model => Option.some(model.hero),
        toParentMessage: message => message,
      }),
    )

    expect(Record.size(lifted)).toBe(
      Record.size(card.subscriptions) + Record.size(hero.subscriptions),
    )
  })

  describe('shortcut keys', () => {
    it('reports a shortcut key press', async () => {
      await listening('card:shortcutKeys', {}, ['keydown'], async received => {
        dispatchKey('keydown', { key: 'r', code: 'KeyR' })

        await vi.waitFor(() => {
          expect(received).toEqual([pressedR])
        })
      })
    })

    it('reads the typed key, so a plain shortcut works on a non-QWERTY layout', async () => {
      await listening('card:shortcutKeys', {}, ['keydown'], async received => {
        dispatchKey('keydown', { key: 'r', code: 'KeyO' })

        await vi.waitFor(() => {
          expect(received).toEqual([pressedR])
        })
      })
    })

    it.each([
      [
        'Option+R on macOS',
        { key: '®', code: 'KeyR', altKey: true },
        Message.PressedShortcutKey({
          key: 'r',
          maybeModifier: Option.some('Alt'),
        }),
        Message.ReleasedShortcutKey({ key: 'r' }),
      ],
      [
        'Shift+1',
        { key: '!', code: 'Digit1', shiftKey: true },
        Message.PressedShortcutKey({
          key: '1',
          maybeModifier: Option.some('Shift'),
        }),
        Message.ReleasedShortcutKey({ key: '1' }),
      ],
    ])(
      'reads the physical key when %s types a symbol',
      async (_name, init, pressed, released) => {
        await listening(
          'card:shortcutKeys',
          {},
          ['keydown', 'keyup'],
          async received => {
            dispatchKey('keydown', init)
            dispatchKey('keyup', init)

            await vi.waitFor(() => {
              expect(received).toHaveLength(2)
            })
            expect(received).toContainEqual(pressed)
            expect(received).toContainEqual(released)
          },
        )
      },
    )

    it('ignores shortcut keys while a text field has focus', async () => {
      const textarea = document.createElement('textarea')
      document.body.append(textarea)

      await listening('card:shortcutKeys', {}, ['keydown'], async received => {
        textarea.focus()
        dispatchKey('keydown', { key: 'r', code: 'KeyR' })
        textarea.blur()
        dispatchKey('keydown', { key: 'r', code: 'KeyR' })

        await vi.waitFor(() => {
          expect(received).toEqual([pressedR])
        })
      })
    })

    it('reports a window blur', async () => {
      await listening('card:shortcutKeys', {}, ['blur'], async received => {
        window.dispatchEvent(new FocusEvent('blur'))

        await vi.waitFor(() => {
          expect(received).toEqual([Message.BlurredWindow()])
        })
      })
    })
  })

  describe('wheel', () => {
    it('steps a held shortcut up for a scroll up and ignores a horizontal scroll', async () => {
      await listening(
        'card:shortcutHeld',
        { isHeld: true },
        ['wheel'],
        async received => {
          const horizontal = dispatchWheel(window, 0)
          const up = dispatchWheel(window, -40)

          await vi.waitFor(() => {
            expect(received).toEqual([
              Message.ScrolledWithShortcut({ direction: 1 }),
            ])
          })
          expect(horizontal.defaultPrevented).toBe(false)
          expect(up.defaultPrevented).toBe(true)
        },
      )
    })

    it('scrolls a ScrollOnly dial only for wheel events inside the panel', async () => {
      const panelRoot = document.createElement('div')
      panelRoot.setAttribute('data-dial-panel-id', 'card')
      const control = document.createElement('div')
      panelRoot.append(control)
      const page = document.createElement('div')
      document.body.append(panelRoot, page)

      await listening(
        'card:shortcutScrollOnly',
        { isHeld: false },
        ['wheel'],
        async received => {
          const outside = dispatchWheel(page, 40)
          const inside = dispatchWheel(control, 40)

          await vi.waitFor(() => {
            expect(received).toEqual([
              Message.ScrolledWithShortcut({ direction: -1 }),
            ])
          })
          expect(outside.defaultPrevented).toBe(false)
          expect(inside.defaultPrevented).toBe(true)
        },
      )
    })
  })
})
