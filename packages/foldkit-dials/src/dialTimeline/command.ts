import { Duration, Effect, Option, Queue, Schema, Stream } from 'effect'
import * as Command from 'foldkit/command'
import * as Dom from 'foldkit/dom'
import * as Mount from 'foldkit/mount'
import * as Subscription from 'foldkit/subscription'

import { idSelector } from '../internal/selectors.js'
import { fractionWithin, isLeftButton } from './dom.js'
import { Message } from './message.js'
import type { RulerGesture } from './model.js'

// COMMAND

const COPY_CONFIRMATION_MILLISECONDS = 1500

/** Writes the tuned timeline instruction to the clipboard. */
export const CopyTimeline = Command.define('CopyTimeline', {
  args: { text: Schema.String },
  messages: [Message.SucceededCopyTimeline, Message.FailedCopyTimeline],
  execute: ({ text }) =>
    Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
      Effect.as(Message.SucceededCopyTimeline()),
      Effect.catch(() => Effect.succeed(Message.FailedCopyTimeline())),
    ),
})

/** Waits while the Copy button shows that it copied or failed. The
 *  `copyVersion` lets the dock ignore a wait that a newer copy outlived. */
export const WaitBeforeResetCopy = Command.define('WaitBeforeResetCopy', {
  args: { copyVersion: Schema.Number },
  messages: [Message.CompletedWaitBeforeResetCopy],
  execute: ({ copyVersion }) =>
    Effect.sleep(Duration.millis(COPY_CONFIRMATION_MILLISECONDS)).pipe(
      Effect.as(Message.CompletedWaitBeforeResetCopy({ copyVersion })),
    ),
})

/** Returns focus to the bar or segment the clip editor was editing. */
export const FocusBar = Command.define('FocusBar', {
  args: { elementId: Schema.String },
  messages: [Message.CompletedFocusBar],
  execute: ({ elementId }) =>
    Dom.focus(idSelector(elementId)).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusBar()),
    ),
})

// MOUNT

/** Observes the ruler: its width, for tick spacing and drag thresholds, and
 *  presses with their modifier keys. Alt zooms and Shift resets the zoom. */
export const ObserveRuler = Mount.defineStream('ObserveRuler', {
  messages: [Message.ResizedRuler, Message.PressedRuler],
  execute: ({ element }) =>
    Stream.merge(
      Stream.callback<typeof Message.ResizedRuler.Type>(queue =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const observer = new ResizeObserver(() => {
              Queue.offerUnsafe(
                queue,
                Message.ResizedRuler({
                  width: element.getBoundingClientRect().width,
                }),
              )
            })
            observer.observe(element)
            return observer
          }),
          observer => Effect.sync(() => observer.disconnect()),
        ).pipe(Effect.flatMap(() => Effect.never)),
      ),
      Subscription.fromEventFilterMapPreventDefault({
        target: element,
        type: 'pointerdown',
        options: { passive: false },
        filterMapEvent: event =>
          Option.liftPredicate(
            Message.PressedRuler({
              fraction: fractionWithin(element, event.clientX),
              gesture: rulerGestureOf(event),
            }),
            () => isLeftButton(event.button),
          ),
      }),
    ),
})

const rulerGestureOf = (event: PointerEvent): RulerGesture => {
  if (event.altKey) {
    return 'Zoom'
  } else if (event.shiftKey) {
    return 'ResetAndSeek'
  } else {
    return 'Seek'
  }
}
