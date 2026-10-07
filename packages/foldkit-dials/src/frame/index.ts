import { Effect, Queue, Schema, Stream } from 'effect'

/** Configuration for `animationFrame`. */
export type AnimationFrameConfig<Model, Message> = Readonly<{
  isActive: (model: Model) => boolean
  toMessage: (deltaTime: number) => Message
}>

// NOTE: Foldkit's own `Subscription.animationFrame` dispatches inside the
// browser's `requestAnimationFrame` callbacks. The runtime then asks for its
// render frame from inside that same callback phase, and a frame requested
// there runs one frame later. The next tick lands while that render is still
// pending and shares it, so the view updates on every other frame: 60 fps on
// a 120 Hz display, 30 fps on a 60 Hz one. Posting each tick as a task runs
// its update after the frame paints, so the runtime's render request lands in
// the very next frame and every frame renders once.
const makeFrameStream = <Message>(
  toMessage: (deltaTime: number) => Message,
): Stream.Stream<Message> =>
  Stream.callback<Message>(queue =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const channel = new MessageChannel()
        const state = { frameId: 0, lastTime: performance.now() }
        const tick = (now: number) => {
          const deltaTime = now - state.lastTime
          state.lastTime = now
          channel.port1.postMessage(deltaTime)
          state.frameId = requestAnimationFrame(tick)
        }
        channel.port2.onmessage = ({ data }: MessageEvent<number>) => {
          Queue.offerUnsafe(queue, toMessage(data))
        }
        state.frameId = requestAnimationFrame(tick)
        return { channel, state }
      }),
      ({ channel, state }) =>
        Effect.sync(() => {
          cancelAnimationFrame(state.frameId)
          channel.port1.close()
          channel.port2.close()
        }),
    ).pipe(Effect.flatMap(() => Effect.never)),
  )

/** A Subscription entry that emits a Message once per display frame while
 *  `isActive` holds, with the time since the previous frame in milliseconds.
 *  Use it like Foldkit's `Subscription.animationFrame`; unlike it, the view
 *  re-renders on every frame rather than every other one. */
export const animationFrame = <Model, Message>(
  config: AnimationFrameConfig<Model, Message>,
) => ({
  dependenciesSchema: Schema.Struct({ isActive: Schema.Boolean }),
  modelToDependencies: (model: Model) => ({
    isActive: config.isActive(model),
  }),
  dependenciesToStream: ({ isActive }: Readonly<{ isActive: boolean }>) =>
    Stream.when(
      makeFrameStream(config.toMessage),
      Effect.sync(() => isActive),
    ),
})
