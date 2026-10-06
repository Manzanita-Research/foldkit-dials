import { Option, Schema, pipe } from 'effect'
import type { Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { type DialFields, defaults as dialDefaults } from '../dial/index.js'
import { Message } from './message.js'
import { Model, activeVersionName, init as initPanel } from './model.js'
import { type MakeConfig, makeSpec } from './spec.js'
import {
  isContinuousMessage,
  subscriptions as panelSubscriptions,
} from './subscriptions.js'
import { update as panelUpdate } from './update.js'
import { findVersion } from './versions.js'
import { type ViewInputs as PanelViewInputs, makeView } from './view.js'

export type { MakeConfig } from './spec.js'

/** Per-render view inputs for a panel built by `make`: the parent-owned
 *  values, plus layout options. */
export type ViewInputs<Values> = Omit<PanelViewInputs, 'values'> &
  Readonly<{ values: Values }>

/** Builds a tuning panel for a dial Schema. Returns a Submodel bundle, like
 *  `@foldkit/ui`'s `create` factories:
 *
 *  - `Model`, `Message`, and a values-typed `OutMessage`.
 *  - `init()`, which loads persisted versions when `persist` is on.
 *  - `update(model, message, values)`, which takes the parent-owned values
 *    and reports edits as `OutMessage.ChangedValues({ values })`.
 *  - `view`, for `h.submodel` with `ViewInputs<Values>`.
 *  - `subscriptions`, for `Subscription.lift`. Their keys start with the
 *    panel id, so several panels can be lifted together.
 *  - `defaults`, the values to ship without the panel. */
export const make = <Fields extends DialFields>(config: MakeConfig<Fields>) => {
  type Values = Schema.Struct<Fields>['Type']
  const spec = makeSpec(config)
  const defaults: Values = dialDefaults(config.schema)
  const decode = Schema.decodeUnknownOption(config.schema)
  const internalUpdate = panelUpdate(spec)

  /** OutMessages this panel emits, with values typed by its dial Schema. */
  const OutMessage = defineMessageUnion({
    ChangedValues: { values: config.schema },
    ClickedAction: { path: Schema.String },
  })
  type OutMessage = typeof OutMessage.Type
  type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

  const init = (): Update.Return<Model, Message> => initPanel(spec)

  const update = (
    model: Model,
    message: Message,
    values: Values,
  ): UpdateReturn =>
    // NOTE: the internal update reports only values the dial Schema accepted
    // (`isValid`) or produced (`decodeValues`, `defaults`), so its untyped
    // `ChangedValues` holds `Values`. The types cannot carry that, as in
    // `@foldkit/ui`'s `RadioGroup.create`.
    /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
    internalUpdate(model, message, values) as UpdateReturn

  /** The version being compared with, and its values, while a comparison
   *  is on. */
  const comparison = (
    model: Model,
  ): Option.Option<Readonly<{ name: string; values: Values }>> =>
    pipe(
      model.maybeComparedVersionId,
      Option.flatMap(versionId => findVersion(model.versions, versionId)),
      Option.map(version => ({
        name: version.name,
        values: Option.getOrElse(decode(version.values), () => defaults),
      })),
    )

  return {
    id: spec.id,
    name: spec.name,
    Values: config.schema,
    defaults,
    controls: spec.controls,
    Model,
    Message,
    OutMessage,
    init,
    update,
    view: makeView(spec),
    subscriptions: panelSubscriptions(spec),
    comparison,
    activeVersionName,
    isContinuousMessage,
  }
}

/** A panel bundle built by `make`. */
export type Panel<Fields extends DialFields> = ReturnType<typeof make<Fields>>
