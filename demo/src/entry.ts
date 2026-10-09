import 'foldkit-dials/styles.css'
import { Runtime } from 'foldkit'

import {
  Message,
  Model,
  init,
  routing,
  subscriptions,
  update,
  view,
} from './app'

Runtime.run(
  Runtime.makeApplication({
    Model,
    init,
    update,
    view,
    subscriptions,
    container: document.getElementById('root'),
    routing,
    // NOTE: DevTools are part of the public demo, including deployed builds.
    devTools: {
      show: 'Always',
      Message,
      position: 'BottomLeft',
      excludeFromHistory: ['GotHomeFrameMessage', 'GotGalleryFrameMessage'],
    },
  }),
)
