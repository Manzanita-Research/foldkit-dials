import { Option, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Dial, DialPanel } from 'foldkit-dials'
import type { Document, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import type { View } from 'foldkit/submodel'
import * as Subscription from 'foldkit/subscription'

declare const expectType: <Value>(value: Value) => void

const Values = Schema.Struct({
  radius: Dial.slider({ default: 20, min: 0, max: 48 }),
  mode: Dial.select(['Compact', 'Expanded']),
  appearance: Dial.folder({ isVisible: Dial.toggle(true) }),
})
type Values = typeof Values.Type
const panel = DialPanel.make({ name: 'Card', schema: Values })
const panelModel = panel.init().model

expectType<DialPanel.Panel<typeof Values.fields>>(panel)
expectType<typeof Values>(panel.Values)
expectType<Values>(panel.defaults)
expectType<number>(panel.defaults.radius)
expectType<'Compact' | 'Expanded'>(panel.defaults.mode)
expectType<boolean>(panel.defaults.appearance.isVisible)
expectType<typeof DialPanel.Model>(panel.Model)
expectType<typeof DialPanel.Message>(panel.Message)
expectType<DialPanel.PanelOutMessage<typeof Values.fields>>(panel.OutMessage)
expectType<
  View<DialPanel.Model, DialPanel.Message, DialPanel.ViewInputs<Values>>
>(panel.view)
expectType<Subscription.Subscriptions<DialPanel.Model, DialPanel.Message>>(
  panel.subscriptions,
)
expectType<Option.Option<Readonly<{ name: string; values: Values }>>>(
  panel.comparison(panelModel),
)
expectType<string>(panel.activeVersionName(panelModel))
expectType<boolean>(
  panel.isContinuousMessage(DialPanel.Message.ToggledPanel({ isOpen: true })),
)

const changed = panel.OutMessage.ChangedValues({ values: panel.defaults })
expectType<Values>(changed.values)
expectType<string>(panel.OutMessage.ClickedAction({ path: 'replay' }).path)
const describeOut = panel.OutMessage.match<string>({
  ChangedValues: ({ values }) => values.mode,
  ClickedAction: ({ path }) => path,
})
expectType<string>(describeOut(changed))
const panelUpdate = panel.update(
  panelModel,
  DialPanel.Message.ClickedResetValues(),
  panel.defaults,
)
if (panelUpdate.outMessage?._tag === 'ChangedValues') {
  expectType<Values>(panelUpdate.outMessage.values)
}

// @ts-expect-error DialPanel requires a Struct Schema.
DialPanel.make({ name: 'Invalid', schema: Schema.String })
// @ts-expect-error A select's literal union survives make.
expectType<'Missing'>(panel.defaults.mode)
// @ts-expect-error ChangedValues requires the complete values record.
panel.OutMessage.ChangedValues({ values: { radius: 10 } })
panel.update(panelModel, DialPanel.Message.ClickedResetValues(), {
  ...panel.defaults,
  // @ts-expect-error A dial value must have its inferred type.
  radius: 'wide',
})
// @ts-expect-error OutMessage matching is exhaustive.
panel.OutMessage.match<string>({ ChangedValues: ({ values }) => values.mode })

const AppModel = Schema.Struct({ tuning: Values, count: Schema.Number })
type AppModel = typeof AppModel.Type
const AppMessage = defineMessageUnion({
  ClickedCard: {},
  RequestedReplay: { path: Schema.String },
})
type AppMessage = typeof AppMessage.Type
const app = {
  Model: AppModel,
  Message: AppMessage,
  init: (
    count: number,
    label?: string,
  ): Update.Return<AppModel, AppMessage> => ({
    model: { tuning: panel.defaults, count: count + (label?.length ?? 0) },
  }),
  update: (
    model: AppModel,
    _message: AppMessage,
  ): Update.Return<AppModel, AppMessage> => ({ model }),
  view: (_model: AppModel, h: HtmlBuilder<AppMessage>): Document => ({
    title: 'Card',
    body: h.div([]),
  }),
  subscriptions: Subscription.make<AppModel, AppMessage>()(() => ({})),
}
const config = {
  panel,
  read: (model: AppModel) => model.tuning,
  write: (model: AppModel, tuning: Values): AppModel => ({
    tuning,
    count: model.count,
  }),
  onAction: (path: string): AppMessage => AppMessage.RequestedReplay({ path }),
}
const attached = DialPanel.attach(app, {
  panel,
  read: model => {
    expectType<AppModel>(model)
    return model.tuning
  },
  write: (model, tuning) => {
    expectType<Values>(tuning)
    return { count: model.count, tuning }
  },
  onAction: path => AppMessage.RequestedReplay({ path }),
})
type AttachedMessage = AppMessage | DialPanel.AttachMessage
type AttachedModel = DialPanel.AttachModel<AppModel>
expectType<
  DialPanel.AttachBundle<AppModel, AppMessage, [count: number, label?: string]>
>(attached)
expectType<AppModel>(attached.init(2).model.app)
expectType<AttachedModel>(attached.init(2, 'Card').model)
expectType<AttachedMessage>(attached.Message.Type)
expectType<AttachedModel>(attached.Model.Type)
expectType<typeof DialPanel.Model>(attached.Model.fields.dials)
expectType<Subscription.Subscriptions<AttachedModel, AttachedMessage>>(
  attached.subscriptions,
)
expectType<(model: AttachedModel, h: HtmlBuilder<AttachedMessage>) => Document>(
  attached.view,
)
expectType<ReadonlyArray<string>>(attached.excludeFromHistory)
attached.update(attached.init(1).model, AppMessage.ClickedCard())
attached.update(
  attached.init(1).model,
  DialPanel.AttachMessage.GotDialPanelMessage({
    message: DialPanel.Message.ClickedResetValues(),
  }),
)
Schema.is(attached.Message)(AppMessage.ClickedCard())
Schema.decodeUnknownEffect(attached.Model)({})

declare const h: HtmlBuilder<AttachedMessage>
h.submodel({
  slotId: 'panel',
  model: panelModel,
  view: panel.view,
  viewInputs: { values: panel.defaults },
  toParentMessage: message =>
    DialPanel.AttachMessage.GotDialPanelMessage({ message }),
})
Subscription.lift(panel.subscriptions)<AttachedModel, AttachedMessage>({
  read: model => Option.some(model.dials),
  toParentMessage: message =>
    DialPanel.AttachMessage.GotDialPanelMessage({ message }),
})

// @ts-expect-error attach preserves the required init argument.
attached.init()
// @ts-expect-error attach preserves init argument types.
attached.init('two')
// @ts-expect-error attach preserves optional init argument types.
attached.init(2, false)
// @ts-expect-error Unknown app Messages are rejected.
attached.update(attached.init(1).model, { _tag: 'Missing' })
// @ts-expect-error read must return the panel's values.
DialPanel.attach(app, { ...config, read: model => model.count })
// @ts-expect-error write receives the panel's values, not a number.
DialPanel.attach(app, { ...config, write: (model, _values: number) => model })
// @ts-expect-error onAction must return an app Message.
DialPanel.attach(app, { ...config, onAction: () => ({ _tag: 'Missing' }) })

const empty = DialPanel.make({ name: 'Empty', schema: Schema.Struct({}) })
expectType<Readonly<{}>>(empty.defaults)
const noArgs = DialPanel.attach(
  { ...app, init: () => ({ model: { tuning: panel.defaults, count: 0 } }) },
  config,
)
expectType<AppModel>(noArgs.init().model.app)
Runtime.makeApplication({
  ...noArgs,
  container: document.createElement('div'),
  devTools: {
    Message: noArgs.Message,
    excludeFromHistory: noArgs.excludeFromHistory,
  },
})
// @ts-expect-error No-argument init stays a no-argument function.
noArgs.init(1)
