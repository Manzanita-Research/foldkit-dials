import { Effect, Stream } from 'effect'

/** Stops text selection across the page while it runs. Merge it into a drag
 *  Subscription's Stream, as the @foldkit/ui Slider does. */
export const documentDragStyles = Stream.callback<never>(() =>
  Effect.acquireRelease(
    Effect.sync(() => {
      document.documentElement.style.setProperty('user-select', 'none')
      document.documentElement.style.setProperty('-webkit-user-select', 'none')
    }),
    () =>
      Effect.sync(() => {
        document.documentElement.style.removeProperty('user-select')
        document.documentElement.style.removeProperty('-webkit-user-select')
      }),
  ).pipe(Effect.flatMap(() => Effect.never)),
)
