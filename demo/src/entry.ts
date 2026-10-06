import 'foldkit-dials/styles.css'
import './styles.css'
import { Runtime } from 'foldkit'
import { DialPanel } from 'foldkit-dials'
import { modifyFields } from 'foldkit/struct'

import { Message, Model, init, subscriptions, update, view } from './main'
import { CardDials } from './tuning'

const program = DialPanel.attach(
  { Model, Message, init, update, view, subscriptions },
  {
    panel: CardDials,
    read: model => model.tuning,
    write: (model, tuning) => modifyFields(model, { tuning: () => tuning }),
    onAction: path =>
      path === 'replay' ? Message.RequestedReplay() : Message.ClickedCard(),
    theme: 'Light',
  },
)

Runtime.run(
  Runtime.makeApplication({
    ...program,
    container: document.getElementById('root'),
    devTools: {
      Message: program.Message,
      excludeFromHistory: [
        ...program.excludeFromHistory,
        'TickedFrame',
        'GotIntroFrameMessage',
      ],
      position: 'BottomLeft',
    },
  }),
)
