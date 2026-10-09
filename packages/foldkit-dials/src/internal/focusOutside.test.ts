import { Effect, Fiber, Stream } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { focusLeavingMarked } from './focusOutside.js'

// SUBSCRIPTION

const listen = async (
  isOpen: boolean,
  run: (received: ReadonlyArray<string>) => Promise<void>,
): Promise<void> => {
  const received: Array<string> = []
  const addListener = vi.spyOn(document, 'addEventListener')
  const removeListener = vi.spyOn(document, 'removeEventListener')
  const fiber = Effect.runFork(
    Stream.runForEach(
      focusLeavingMarked({
        attribute: 'picker',
        id: 'sample',
        isOpen,
        message: 'Outside',
      }),
      message =>
        Effect.sync(() => {
          received.push(message)
        }),
    ),
  )
  try {
    if (isOpen) {
      await vi.waitFor(() =>
        expect(addListener).toHaveBeenCalledWith(
          'focusin',
          expect.any(Function),
          undefined,
        ),
      )
    } else {
      await Effect.runPromise(Fiber.join(fiber))
    }
    await run(received)
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber))
    if (isOpen) {
      expect(removeListener).toHaveBeenCalledWith(
        'focusin',
        expect.any(Function),
        undefined,
      )
    }
  }
}

const elements = () => {
  const root = document.createElement('div')
  root.dataset.picker = 'sample'
  const inside = document.createElement('button')
  root.append(inside)
  const portal = document.createElement('div')
  portal.dataset.picker = 'sample'
  const portalButton = document.createElement('button')
  portal.append(portalButton)
  const outside = document.createElement('button')
  document.body.append(root, portal, outside)
  return { inside, portalButton, outside }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('picker focus subscriptions', () => {
  it('keeps internal and portalled focus open and emits only for outside focus after native dispatch', async () => {
    const { inside, portalButton, outside } = elements()
    await listen(true, async received => {
      const event = new FocusEvent('focusin', { bubbles: true, composed: true })
      // happy-dom retains the path; reproduce the browser's dispatch lifetime.
      const composedPath = event.composedPath.bind(event)
      let dispatching = true
      vi.spyOn(event, 'composedPath').mockImplementation(() =>
        dispatching ? composedPath() : [],
      )
      inside.dispatchEvent(event)
      dispatching = false
      expect(event.composedPath()).toEqual([])
      portalButton.focus()
      outside.focus()
      await vi.waitFor(() => expect(received).toEqual(['Outside']))
    })
  })

  it('recognizes marked ancestors through a shadow root', async () => {
    const { inside, outside } = elements()
    const host = document.createElement('div')
    host.dataset.picker = 'sample'
    const shadow = host.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    shadow.append(button)
    document.body.append(host)
    await listen(true, async received => {
      inside.focus()
      button.dispatchEvent(
        new FocusEvent('focusin', { bubbles: true, composed: true }),
      )
      outside.focus()
      await vi.waitFor(() => expect(received).toEqual(['Outside']))
    })
  })

  it('does not listen while the picker is closed', async () => {
    const { outside } = elements()
    await listen(false, async received => {
      outside.focus()
      expect(received).toEqual([])
      expect(document.addEventListener).not.toHaveBeenCalled()
    })
  })
})
