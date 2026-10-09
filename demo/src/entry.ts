import 'foldkit-dials/styles.css'
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
    // NOTE: the panel is the point of the demo, so the deployed build shows
    // it too; an app would keep the default and show it in development only.
    show: 'Always',
  },
)

Runtime.run(
  Runtime.makeApplication({
    ...program,
    container: document.getElementById('root'),
    // NOTE: DevTools ship in the deployed demo too: every dial edit showing up
    // as a Message, with time travel, is part of what it demonstrates.
    devTools: {
      show: 'Always',
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
