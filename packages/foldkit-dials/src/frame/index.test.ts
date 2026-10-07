import { Effect, Fiber, Stream } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { animationFrame } from './index.js'

describe('Frame.animationFrame', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('delivers each frame after its animation-frame callback, not inside it', async () => {
    const frameCallbacks: Array<FrameRequestCallback> = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})

    const delivered: Array<number> = []
    const entry = animationFrame<null, number>({
      isActive: () => true,
      toMessage: deltaTime => {
        delivered.push(deltaTime)
        return deltaTime
      },
    })
    const fiber = Effect.runFork(
      Stream.runCollect(
        Stream.take(entry.dependenciesToStream({ isActive: true }), 2),
      ),
    )
    await vi.waitFor(() => {
      expect(frameCallbacks).toHaveLength(1)
    })

    const startedAt = performance.now()
    frameCallbacks[0]?.(startedAt + 16)
    expect(delivered).toEqual([])

    await vi.waitFor(() => {
      expect(delivered).toHaveLength(1)
    })

    frameCallbacks[1]?.(startedAt + 32)
    expect(delivered).toHaveLength(1)

    const frames = await Effect.runPromise(Fiber.join(fiber))
    expect(Array.from(frames)).toHaveLength(2)
    expect(delivered[1]).toBe(16)
  })

  it('emits nothing while inactive', () => {
    const entry = animationFrame<{ isPlaying: boolean }, number>({
      isActive: model => model.isPlaying,
      toMessage: deltaTime => deltaTime,
    })

    expect(entry.modelToDependencies({ isPlaying: false })).toEqual({
      isActive: false,
    })
  })
})
