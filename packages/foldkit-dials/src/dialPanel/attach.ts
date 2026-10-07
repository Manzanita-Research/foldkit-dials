import { Array, Option, Schema } from 'effect'
import { Update } from 'foldkit'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import * as Subscription from 'foldkit/subscription'

import type { DialFields } from '../dial/index.js'
import type { Panel } from './index.js'
import { Message as PanelMessage } from './message.js'
import type { Corner, Layout, Model as PanelModel, Theme } from './model.js'

// MESSAGE

/** The Messages `attach` adds to a program. Gesture frames, such as each
 *  pointer move of a slider drag, arrive as `GotDialPanelDragMessage`, so
 *  DevTools can leave them out of its history with `excludeFromHistory`. */
export const AttachMessage = defineMessageUnion({
  GotDialPanelMessage: { message: PanelMessage },
  GotDialPanelDragMessage: { message: PanelMessage },
})
export type AttachMessage = typeof AttachMessage.Type

const ATTACH_MESSAGE_TAGS: ReadonlyArray<string> = [
  'GotDialPanelMessage',
  'GotDialPanelDragMessage',
]

const isAttachMessage = (
  message: Readonly<{ _tag: string }>,
): message is AttachMessage => Array.contains(ATTACH_MESSAGE_TAGS, message._tag)

/** When the panel renders. `Development` shows it only under Vite's dev
 *  server, like Foldkit DevTools. `Never` leaves the program unchanged
 *  apart from its Model shape, and the dial values stay at their
 *  defaults. */
export const Show = Schema.Literals(['Development', 'Always', 'Never'])
export type Show = typeof Show.Type

/** The program parts `attach` wraps: what `Runtime.makeApplication` takes,
 *  plus the app's `Message` Schema. */
export type AttachableProgram<
  AppModel,
  AppMessage,
  InitArgs extends ReadonlyArray<unknown>,
> = Readonly<{
  Model: Schema.Codec<AppModel, unknown, unknown, unknown>
  Message: Schema.Codec<AppMessage, unknown, never, never>
  init: (...args: InitArgs) => Update.Return<AppModel, AppMessage>
  update: (
    model: AppModel,
    message: AppMessage,
  ) => Update.Return<AppModel, AppMessage>
  view: (model: AppModel, h: HtmlBuilder<AppMessage>) => Document
  subscriptions?: Subscription.Subscriptions<AppModel, AppMessage>
}>

/** How the panel connects to the app. `read` and `write` point at the app
 *  Model field that holds the tuned values, typed by the dial Schema.
 *  `onAction` turns an action dial's press into an app Message. */
export type AttachConfig<
  AppModel,
  AppMessage,
  Fields extends DialFields,
> = Readonly<{
  panel: Panel<Fields>
  read: (model: AppModel) => Schema.Struct<Fields>['Type']
  write: (model: AppModel, values: Schema.Struct<Fields>['Type']) => AppModel
  onAction?: (path: string) => AppMessage
  show?: Show
  theme?: Theme
  position?: Corner
  layout?: Exclude<Layout, 'Section'>
}>

const isShown = (show: Show): boolean => {
  if (show === 'Always') {
    return true
  } else if (show === 'Never') {
    return false
  } else {
    return !!import.meta.hot
  }
}

/** Adds a dial panel to a program in one call. The returned config goes
 *  straight to `Runtime.makeApplication`:
 *
 *  ```ts
 *  const program = DialPanel.attach(
 *    { Model, Message, init, update, view, subscriptions },
 *    {
 *      panel: CardDials,
 *      read: model => model.tuning,
 *      write: (model, tuning) => modifyFields(model, { tuning: () => tuning }),
 *    },
 *  )
 *  Runtime.run(Runtime.makeApplication({
 *    ...program,
 *    container: document.getElementById('root'),
 *    devTools: { Message: program.Message, excludeFromHistory: program.excludeFromHistory },
 *  }))
 *  ```
 *
 *  The app keeps its own Model, Messages, update, and view. Its tuning field
 *  stays the single source of the values: the panel reads it and writes
 *  edits back through `write`. The wrapper Model is `{ app, dials }`. */
// TODO: give `attach` an explicit return type. Inferred, it inlines the
// panel's whole Model schema, so dist/dialPanel/attach.d.ts is about 500 KB.
export const attach = <
  AppModel,
  AppMessage extends Readonly<{ _tag: string }>,
  InitArgs extends ReadonlyArray<unknown>,
  Fields extends DialFields,
>(
  program: AttachableProgram<AppModel, AppMessage, InitArgs>,
  config: AttachConfig<AppModel, AppMessage, Fields>,
) => {
  type Message = AppMessage | AttachMessage
  const { panel } = config
  const isPanelShown = isShown(config.show ?? 'Development')

  const Model = Schema.Struct({ app: program.Model, dials: panel.Model })
  type Model = typeof Model.Type

  const Message = Schema.Union([program.Message, AttachMessage])

  const toParentMessage = (message: PanelMessage): AttachMessage =>
    panel.isContinuousMessage(message)
      ? AttachMessage.GotDialPanelDragMessage({ message })
      : AttachMessage.GotDialPanelMessage({ message })

  const toAppParentMessage = (message: AppMessage): Message => message

  const foldApp = Update.foldChild({
    update: program.update,
    read: (model: Model) => Option.some(model.app),
    write: (model, nextApp) => modifyFields(model, { app: () => nextApp }),
    toParentMessage: toAppParentMessage,
  })

  const foldPanelOutMessage = panel.OutMessage.match<
    Update.Step<Model, Message>
  >({
    ChangedValues:
      ({ values }) =>
      model => ({
        model: modifyFields(model, { app: app => config.write(app, values) }),
      }),
    ClickedAction:
      ({ path }) =>
      model =>
        Option.match(Option.fromNullishOr(config.onAction), {
          onNone: () => ({ model }),
          onSome: onAction => foldApp(model, onAction(path)),
        }),
  })

  const foldPanel = (model: Model, message: PanelMessage) =>
    Update.foldChild({
      update: (dials: PanelModel, panelMessage: PanelMessage) =>
        panel.update(dials, panelMessage, config.read(model.app)),
      read: (current: Model) => Option.some(current.dials),
      write: (current, nextDials) =>
        modifyFields(current, { dials: () => nextDials }),
      toParentMessage,
      foldOutMessage: foldPanelOutMessage,
    })(model, message)

  // NOTE: a hidden panel keeps its starting Model but runs no init Command,
  // so it never loads stored values into the app.
  const initPanel = (): Update.Return<PanelModel, PanelMessage> => {
    const panelInit = panel.init()
    return isPanelShown ? panelInit : { model: panelInit.model }
  }

  const init = (...args: InitArgs): Update.Return<Model, Message> => {
    const appInit = program.init(...args)
    const panelInit = Update.foldChildInit(initPanel(), {
      toParentModel: (dials): Model => ({ app: appInit.model, dials }),
      toParentMessage,
    })
    return {
      model: panelInit.model,
      commands: Array.appendAll(
        appInit.commands ?? [],
        panelInit.commands ?? [],
      ),
    }
  }

  const update = (
    model: Model,
    message: Message,
  ): Update.Return<Model, Message> =>
    isAttachMessage(message)
      ? AttachMessage.match<Update.Return<Model, Message>>(message, {
          GotDialPanelMessage: ({ message: panelMessage }) =>
            foldPanel(model, panelMessage),
          GotDialPanelDragMessage: ({ message: panelMessage }) =>
            foldPanel(model, panelMessage),
        })
      : foldApp(model, message)

  const panelView = (model: Model, h: HtmlBuilder<Message>): Html =>
    h.submodel({
      slotId: `foldkit-dials-${panel.id}`,
      model: model.dials,
      view: panel.view,
      toParentMessage,
      viewInputs: {
        values: config.read(model.app),
        ...(config.theme !== undefined ? { theme: config.theme } : {}),
        ...(config.position !== undefined ? { position: config.position } : {}),
        ...(config.layout !== undefined ? { layout: config.layout } : {}),
      },
    })

  const view = (model: Model, h: HtmlBuilder<Message>): Document => {
    // NOTE: the app view returns a whole Document, and its title is read
    // here, outside any `h.submodel` boundary, so the app view takes this
    // builder directly. App Messages are members of this wrapper's Message
    // union and dispatch unchanged, so the narrower type is safe.
    /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
    const appBuilder = h as unknown as HtmlBuilder<AppMessage>
    const appDocument = program.view(model.app, appBuilder)
    return isPanelShown
      ? {
          ...appDocument,
          body: h.div(
            [h.Style({ display: 'contents' })],
            [appDocument.body, panelView(model, h)],
          ),
        }
      : appDocument
  }

  const appSubscriptions = Subscription.lift(program.subscriptions ?? {})<
    Model,
    Message
  >({
    read: model => Option.some(model.app),
    toParentMessage: toAppParentMessage,
  })

  const dialsSubscriptions = isPanelShown
    ? Subscription.lift(panel.subscriptions)<Model, Message>({
        read: model => Option.some(model.dials),
        toParentMessage,
      })
    : {}

  return {
    Model,
    Message,
    init,
    update,
    view,
    subscriptions: Subscription.aggregate<Model, Message>()(
      appSubscriptions,
      dialsSubscriptions,
    ),
    excludeFromHistory: ['GotDialPanelDragMessage'],
  }
}
