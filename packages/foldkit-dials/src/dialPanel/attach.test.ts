import { Array, Record, Schema } from 'effect'
import type { Update } from 'foldkit'
import type { Document, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import * as Scene from 'foldkit/scene'
import * as Story from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import * as Subscription from 'foldkit/subscription'
import { describe, expect, it } from 'vitest'

import * as Dial from '../dial/index.js'
import * as ScrubSlider from '../scrubSlider/index.js'
import { AttachMessage, type Show, attach } from './attach.js'
import { SavePersisted, WaitBeforePersist } from './command.js'
import { make } from './index.js'
import { Message as PanelMessage } from './message.js'

const Tuning = Schema.Struct({
  radius: Dial.slider({ default: 20, min: 0, max: 48, step: 1 }),
  replay: Dial.action('Replay'),
})

const CardDials = make({ name: 'Card', schema: Tuning, persist: true })

const Model = Schema.Struct({ tuning: Tuning, clicks: Schema.Number })
type Model = typeof Model.Type

const Message = defineMessageUnion({
  ClickedCard: {},
  RequestedReplay: {},
  TickedClock: {},
})
type Message = typeof Message.Type

const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedCard: () => ({
      model: modifyFields(model, { clicks: count => count + 1 }),
    }),
    RequestedReplay: () => ({
      model: modifyFields(model, { clicks: () => -1 }),
    }),
    TickedClock: () => ({ model }),
  })

const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'Card',
  body: h.button(
    [h.OnClick(Message.ClickedCard())],
    [String(model.tuning.radius)],
  ),
})

const subscriptions = Subscription.make<Model, Message>()(() => ({
  clock: Subscription.persistent(
    Subscription.fromEvent({
      target: window,
      type: 'focus',
      mapEvent: (): Message => Message.TickedClock(),
    }),
  ),
}))

const attachWith = (show?: Show) =>
  attach(
    {
      Model,
      Message,
      init: () => ({ model: { tuning: CardDials.defaults, clicks: 0 } }),
      update,
      view,
      subscriptions,
    },
    {
      panel: CardDials,
      read: model => model.tuning,
      write: (model, tuning) => modifyFields(model, { tuning: () => tuning }),
      onAction: path =>
        path === 'replay' ? Message.RequestedReplay() : Message.ClickedCard(),
      ...(show === undefined ? {} : { show }),
    },
  )

const program = attachWith('Always')
const started = program.init().model

const commandNames = (
  commands: ReadonlyArray<Readonly<{ name: string }>> | undefined,
): ReadonlyArray<string> => Array.map(commands ?? [], ({ name }) => name)

const stepRadius = (direction: 'StepIncrement' | 'Max') =>
  PanelMessage.GotSliderMessage({
    dialId: 'radius',
    message: ScrubSlider.Message.PressedKeyboardNavigation({
      direction,
      value: 20,
    }),
  })

describe('DialPanel.attach', () => {
  it('nests the app Model beside the panel Model, and loads persisted versions', () => {
    const programInit = program.init()

    expect(programInit.model).toEqual({
      app: { tuning: CardDials.defaults, clicks: 0 },
      dials: CardDials.init().model,
    })
    expect(commandNames(programInit.commands)).toEqual(['LoadPersisted'])
  })

  it('passes app Messages to the app update unchanged', () => {
    Story.story(
      program.update,
      Story.given(started),
      Story.message(Message.ClickedCard()),
      Story.model(model => {
        expect(model.app.clicks).toBe(1)
      }),
    )
  })

  it('writes panel edits into the app tuning field', () => {
    Story.story(
      program.update,
      Story.given(started),
      Story.message(
        AttachMessage.GotDialPanelMessage({ message: stepRadius('Max') }),
      ),
      Story.model(model => {
        expect(model.app.tuning.radius).toBe(48)
      }),
      Story.Command.resolve(
        WaitBeforePersist,
        PanelMessage.CompletedWaitBeforePersist({ version: 1 }),
      ),
      Story.Command.resolve(
        SavePersisted,
        PanelMessage.SucceededSavePersisted(),
      ),
    )
  })

  it('turns an action dial into the app Message from onAction', () => {
    Story.story(
      program.update,
      Story.given(started),
      Story.message(
        AttachMessage.GotDialPanelMessage({
          message: PanelMessage.ClickedAction({ dialId: 'replay' }),
        }),
      ),
      Story.model(model => {
        expect(model.app.clicks).toBe(-1)
      }),
    )
  })

  it('routes gesture frames under their own tag so DevTools can exclude them', () => {
    expect(program.excludeFromHistory).toEqual(['GotDialPanelDragMessage'])
    expect(
      CardDials.isContinuousMessage(
        PanelMessage.GotSliderMessage({
          dialId: 'radius',
          message: ScrubSlider.Message.MovedDragPointer({ value: 3 }),
        }),
      ),
    ).toBe(true)
    expect(CardDials.isContinuousMessage(stepRadius('Max'))).toBe(false)
  })

  it('accepts app and attach Messages with the combined Message Schema', () => {
    const isMessage = Schema.is(program.Message)

    expect(isMessage(Message.ClickedCard())).toBe(true)
    expect(
      isMessage(
        AttachMessage.GotDialPanelMessage({ message: stepRadius('Max') }),
      ),
    ).toBe(true)
    expect(isMessage({ _tag: 'Unknown' })).toBe(false)
  })

  it('aggregates the app and panel Subscriptions', () => {
    const keys = Record.keys(program.subscriptions)

    expect(keys).toContain('clock')
    expect(keys).toContain('card:panelHeaderDrag')
  })

  it('renders the app view with the panel beside it', () => {
    Scene.scene(
      { update: program.update, view: program.view },
      Scene.given(started),
      Scene.expect(Scene.role('button', { name: '20' })).toExist(),
      Scene.expect(Scene.role('region', { name: 'Card' })).toExist(),
      Scene.keydown(Scene.role('slider', { name: 'Radius' }), 'ArrowRight'),
      Scene.expect(Scene.role('button', { name: '21' })).toExist(),
      Scene.Command.resolve(
        WaitBeforePersist,
        PanelMessage.CompletedWaitBeforePersist({ version: 1 }),
      ),
      Scene.Command.resolve(
        SavePersisted,
        PanelMessage.SucceededSavePersisted(),
      ),
    )
  })

  describe('with show: Never', () => {
    const hidden = attachWith('Never')

    it('renders the app unchanged', () => {
      Scene.scene(
        { update: hidden.update, view: hidden.view },
        Scene.given(hidden.init().model),
        Scene.expect(Scene.role('button', { name: '20' })).toExist(),
        Scene.expect(Scene.role('region', { name: 'Card' })).toBeAbsent(),
        Scene.expect(Scene.role('slider', { name: 'Radius' })).toBeAbsent(),
      )
    })

    it('loads nothing and keeps only the app Subscriptions', () => {
      expect(commandNames(hidden.init().commands)).toEqual([])
      expect(Record.keys(hidden.subscriptions)).toEqual(['clock'])
    })
  })

  it('shows the panel by default under a Vite runtime with hot reload, as vitest is', () => {
    const byDefault = attachWith()

    expect(commandNames(byDefault.init().commands)).toEqual(['LoadPersisted'])
    Scene.scene(
      { update: byDefault.update, view: byDefault.view },
      Scene.given(byDefault.init().model),
      Scene.expect(Scene.role('region', { name: 'Card' })).toExist(),
    )
  })
})
