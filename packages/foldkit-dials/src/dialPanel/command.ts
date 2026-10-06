import { Duration, Effect, Match, Option, Schema } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { Command } from 'foldkit'

import { BrowserKeyValueStore } from '@effect/platform-browser'

import { Message } from './message.js'
import { Storage } from './spec.js'

// COMMAND

const COPY_CONFIRMATION_MILLISECONDS = 1500
const PERSIST_DEBOUNCE_MILLISECONDS = 400

const storageLayer = (storage: Storage) =>
  Match.value(storage).pipe(
    Match.when('Local', () => BrowserKeyValueStore.layerLocalStorage),
    Match.when('Session', () => BrowserKeyValueStore.layerSessionStorage),
    Match.exhaustive,
  )

/** Writes the tuned dial Schema source to the clipboard. Fails without
 *  clipboard access, such as on an insecure origin. */
export const CopyValues = Command.define('CopyValues', {
  args: { text: Schema.String },
  messages: [Message.SucceededCopyValues, Message.FailedCopyValues],
  execute: ({ text }) =>
    Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
      Effect.as(Message.SucceededCopyValues()),
      Effect.catch(() => Effect.succeed(Message.FailedCopyValues())),
    ),
})

/** Waits while the Copy button shows its result. `version` names this copy,
 *  so a later copy's result is not cut short by this wait. */
export const WaitBeforeResetCopy = Command.define('WaitBeforeResetCopy', {
  args: { version: Schema.Number },
  messages: [Message.CompletedWaitBeforeResetCopy],
  execute: ({ version }) =>
    Effect.sleep(Duration.millis(COPY_CONFIRMATION_MILLISECONDS)).pipe(
      Effect.as(Message.CompletedWaitBeforeResetCopy({ version })),
    ),
})

/** Reads the panel's persisted state. */
export const LoadPersisted = Command.define('LoadPersisted', {
  args: { key: Schema.String, storage: Storage },
  messages: [Message.CompletedLoadPersisted],
  execute: ({ key, storage }) =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore
      const maybeJson = yield* store.get(key)
      return Message.CompletedLoadPersisted({
        maybeJson: Option.fromNullishOr(maybeJson),
      })
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(
          Message.CompletedLoadPersisted({ maybeJson: Option.none() }),
        ),
      ),
      Effect.provide(storageLayer(storage)),
    ),
})

/** Waits before persisting. `version` names the edit that started the
 *  wait; only the wait for the latest edit saves, so a burst of edits such
 *  as a slider drag is written once. */
export const WaitBeforePersist = Command.define('WaitBeforePersist', {
  args: { version: Schema.Number },
  messages: [Message.CompletedWaitBeforePersist],
  execute: ({ version }) =>
    Effect.sleep(Duration.millis(PERSIST_DEBOUNCE_MILLISECONDS)).pipe(
      Effect.as(Message.CompletedWaitBeforePersist({ version })),
    ),
})

/** Writes the panel's persisted state. Fails when storage refuses the
 *  write, such as when uploaded images fill the quota. */
export const SavePersisted = Command.define('SavePersisted', {
  args: { key: Schema.String, storage: Storage, json: Schema.String },
  messages: [Message.SucceededSavePersisted, Message.FailedSavePersisted],
  execute: ({ key, storage, json }) =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore
      yield* store.set(key, json)
      return Message.SucceededSavePersisted()
    }).pipe(
      Effect.catch(() => Effect.succeed(Message.FailedSavePersisted())),
      Effect.provide(storageLayer(storage)),
    ),
})
