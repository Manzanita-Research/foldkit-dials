import * as Subscription from 'foldkit/subscription'

import { slugify } from '../internal/slug.js'
import * as Timeline from '../timeline/index.js'
import { Message, OutMessage } from './message.js'
import { type MakeConfig, Model, initModel } from './model.js'
import { isContinuousMessage, subscriptions } from './subscriptions.js'
import { sampleValues, update } from './update.js'
import { view } from './view/dock.js'

export {
  CopyTimeline,
  FocusBar,
  ObserveRuler,
  WaitBeforeResetCopy,
} from './command.js'
export {
  barId,
  editorFieldId,
  editorId,
  fieldKey,
  segmentId,
  spanElementId,
} from './ids.js'
export {
  Message,
  NudgeSize,
  OutMessage,
  PlayheadDirection,
  ResizeStep,
  ZoomStep,
} from './message.js'
export {
  BarHandle,
  BarRow,
  EditTarget,
  EditorField,
  Model,
  RulerGesture,
  Theme,
} from './model.js'
export type { MakeConfig } from './model.js'
export { isContinuousMessage, subscriptions } from './subscriptions.js'
export {
  pause,
  play,
  replay,
  seek,
  setVisible,
  transportOf,
  update,
  valuesOf,
} from './update.js'
export type { Transport } from './update.js'
export { view } from './view/dock.js'

// BUNDLE

/** What `make` returns: the dock's `id`, Schemas, `init`, `update`, `view`,
 *  and `subscriptions`, plus `valuesOf`, typed by the timeline config. */
export type Bundle<Entries> = Readonly<{
  id: string
  Model: typeof Model
  Message: typeof Message
  OutMessage: typeof OutMessage
  init: () => Model
  update: typeof update
  view: typeof view
  subscriptions: Subscription.Subscriptions<Model, Message>
  valuesOf: (model: Model) => Timeline.ValuesOf<Entries>
  isContinuousMessage: typeof isContinuousMessage
}>

/** Creates a timeline dock for one timeline. Embed it as a Submodel: store
 *  its Model, fold its Messages with `Update.foldChild`, render its `view`
 *  with `h.submodel`, lift its `subscriptions`, and read the sampled values
 *  with `valuesOf(model)`. */
export const make = <Entries>(config: MakeConfig<Entries>): Bundle<Entries> => {
  const id = config.id ?? slugify(config.name)

  return {
    id,
    Model,
    Message,
    OutMessage,
    init: () => initModel(config, id),
    update,
    view,
    subscriptions: subscriptions(id),
    valuesOf: sampleValues<Entries>,
    isContinuousMessage,
  }
}
