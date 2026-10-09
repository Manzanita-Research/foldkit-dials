import { Schema } from 'effect'
import { Dial, DialPanel, ScrubSlider } from 'foldkit-dials'
import { inertHtml } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import * as Subscription from 'foldkit/subscription'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const javascript = import.meta.resolve('foldkit-dials')
const styles = import.meta.resolve('foldkit-dials/styles.css')
assert.match(javascript, /\/node_modules\/foldkit-dials\/dist\/index\.js$/)
assert.match(styles, /\/node_modules\/foldkit-dials\/dist\/styles\/dials\.css$/)
const css = readFileSync(new URL(styles), 'utf8')
assert.match(css, /\.dialkit-slider/)
assert.match(css, /DialKit/)

const Values = Schema.Struct({
  radius: Dial.slider({ default: 20, min: 0, max: 48 }),
})
const panel = DialPanel.make({ name: 'Installed', schema: Values })
assert.deepEqual(panel.defaults, { radius: 20 })
assert.equal(Schema.is(panel.Values)(panel.defaults), true)
const Message = defineMessageUnion({ ClickedCard: {} })
const app = {
  Model: Schema.Struct({ tuning: Values, count: Schema.Number }),
  Message,
  init: count => ({ model: { tuning: panel.defaults, count } }),
  update: model => ({ model }),
  view: () => ({ title: 'Installed consumer', body: inertHtml.div([]) }),
  subscriptions: Subscription.make()(() => ({})),
}
const attached = DialPanel.attach(app, {
  panel,
  read: model => model.tuning,
  write: (model, tuning) => ({ ...model, tuning }),
})
const initial = attached.init(3).model
assert.equal(initial.app.count, 3)
assert.deepEqual(initial.app.tuning, panel.defaults)
const edited = { ...initial, app: { ...initial.app, tuning: { radius: 33 } } }
const reset = attached.update(
  edited,
  DialPanel.AttachMessage.GotDialPanelMessage({
    message: DialPanel.Message.ClickedResetValues(),
  }),
)
assert.deepEqual(reset.model.app.tuning, panel.defaults)
assert.equal(reset.model.app.count, 3)
assert.equal(Schema.is(attached.Model)(reset.model), true)
assert.equal(Schema.is(attached.Message)(Message.ClickedCard()), true)
assert.equal(
  ScrubSlider.init({ id: 'installed', min: 0, max: 48, step: 1 }).id,
  'installed',
)
console.log(
  'Packed public JavaScript, make/attach behavior, and stylesheet export pass.',
)
