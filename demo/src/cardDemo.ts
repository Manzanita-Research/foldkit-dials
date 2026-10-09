import { DialPanel } from 'foldkit-dials'
import { modifyFields } from 'foldkit/struct'
import { defineView } from 'foldkit/submodel'

import { clearDock, clearPanel } from './interactions'
import * as Home from './main'
import { CardDials } from './tuning'

// HOME

const CardProgram = DialPanel.attach(
  {
    Model: Home.Model,
    Message: Home.Message,
    init: Home.init,
    update: Home.update,
    view: Home.view,
    subscriptions: Home.subscriptions,
  },
  {
    panel: CardDials,
    read: model => model.tuning,
    write: (model, tuning) => modifyFields(model, { tuning: () => tuning }),
    onAction: path =>
      path === 'replay'
        ? Home.Message.RequestedReplay()
        : Home.Message.ClickedCard(),
    theme: 'Light',
    show: 'Always',
  },
)

const cardView = defineView<
  typeof CardProgram.Model.Type,
  typeof CardProgram.Message.Type
>((model, h) => CardProgram.view(model, h).body)

export const Model = CardProgram.Model
export type Model = typeof Model.Type
export const Message = CardProgram.Message
export const init = CardProgram.init
export const update = CardProgram.update
export const subscriptions = CardProgram.subscriptions
export const view = cardView

export const leave = (model: Model): Model =>
  modifyFields(model, {
    dials: clearPanel,
    app: app => modifyFields(app, { intro: clearDock }),
  })
