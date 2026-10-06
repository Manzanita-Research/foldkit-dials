import { Option, Schema, String } from 'effect'
import { Runtime, Subscription, Update } from 'foldkit'
import { DialTimeline, Transition } from 'foldkit-dials'
import type { Document, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { Button } from '@foldkit/ui'

import { INTRO_DURATION_SECONDS, IntroDock } from './intro'
import { SpringState, isAtRest, restingAt, step } from './spring'
import { CardDials, CardTuning } from './tuning'

// MODEL

export const Model = Schema.Struct({
  tuning: CardTuning,
  isLifted: Schema.Boolean,
  isReducedMotion: Schema.Boolean,
  spring: SpringState,
  intro: IntroDock.Model,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedCard: {},
  RequestedReplay: {},
  TickedFrame: { deltaMs: Schema.Number },
  UpdatedReducedMotion: { isReducedMotion: Schema.Boolean },
  GotIntroMessage: { message: IntroDock.Message },
  GotIntroFrameMessage: { message: IntroDock.Message },
})
export type Message = typeof Message.Type

/** Routes the dock's playback frames and drag steps under their own tag, so
 *  DevTools can leave them out of history. */
const toIntroMessage = (message: typeof IntroDock.Message.Type): Message =>
  IntroDock.isContinuousMessage(message)
    ? Message.GotIntroFrameMessage({ message })
    : Message.GotIntroMessage({ message })

// INIT

const RESTING = 0
const LIFTED = 1

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: {
    tuning: CardDials.defaults,
    isLifted: false,
    isReducedMotion: false,
    spring: restingAt(RESTING),
    intro: IntroDock.init(),
  },
})

// UPDATE

const springOf = (tuning: CardTuning) =>
  Transition.springParams(
    tuning.pop._tag === 'Easing'
      ? Transition.Transition.TimeSpring({
          visualDuration: tuning.pop.duration,
          bounce: 0,
        })
      : tuning.pop,
  )

/** The spring heading for `target`: it animates there, or jumps there when
 *  the user prefers reduced motion. */
const springToward = (model: Model, target: number): SpringState =>
  model.isReducedMotion
    ? restingAt(target)
    : modifyFields(model.spring, { target: () => target })

const foldIntroOutMessage = IntroDock.OutMessage.match<
  Update.Step<Model, Message>
>({
  ChangedVisibility: () => model => ({ model }),
})

const introFold = {
  read: (model: Model) => Option.some(model.intro),
  write: (model: Model, nextIntro: Model['intro']) =>
    modifyFields(model, { intro: () => nextIntro }),
  toParentMessage: toIntroMessage,
  foldOutMessage: foldIntroOutMessage,
}

const foldIntro = Update.foldChild({ ...introFold, update: IntroDock.update })

/** Settles every animation when the user prefers reduced motion: the card
 *  rests where it is heading, and the intro jumps to its end. */
const reduceMotion = (model: Model): Update.Return<Model, Message> =>
  Update.combine(
    modifyFields(model, {
      isReducedMotion: () => true,
      spring: spring => restingAt(spring.target),
    }),
    [
      Update.foldChildStep({ ...introFold, update: DialTimeline.pause }),
      Update.foldChildStep({
        ...introFold,
        update: (intro: Model['intro']) =>
          DialTimeline.seek(intro, INTRO_DURATION_SECONDS),
      }),
    ],
  )

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedCard: () => ({
      model: modifyFields(model, {
        isLifted: isLifted => !isLifted,
        spring: () => springToward(model, model.isLifted ? RESTING : LIFTED),
      }),
    }),
    RequestedReplay: () => ({
      model: modifyFields(model, {
        isLifted: () => true,
        spring: () =>
          model.isReducedMotion
            ? restingAt(LIFTED)
            : modifyFields(restingAt(RESTING), { target: () => LIFTED }),
      }),
    }),
    TickedFrame: ({ deltaMs }) => ({
      model: modifyFields(model, {
        spring: spring => step(spring, springOf(model.tuning), deltaMs),
      }),
    }),
    UpdatedReducedMotion: ({ isReducedMotion }) =>
      isReducedMotion
        ? reduceMotion(model)
        : { model: modifyFields(model, { isReducedMotion: () => false }) },
    GotIntroMessage: ({ message: introMessage }) =>
      foldIntro(model, introMessage),
    GotIntroFrameMessage: ({ message: introMessage }) =>
      foldIntro(model, introMessage),
  })

// SUBSCRIPTION

export const subscriptions = Subscription.aggregate(
  Subscription.make<Model, Message>()(() => ({
    springFrame: Subscription.animationFrame<Model, Message>({
      isActive: model => !isAtRest(model.spring),
      toMessage: deltaMs => Message.TickedFrame({ deltaMs }),
    }),
    reducedMotion: Subscription.persistent(
      Subscription.fromMediaQuery({
        query: '(prefers-reduced-motion: reduce)',
        mapMatches: (isReducedMotion): Message =>
          Message.UpdatedReducedMotion({ isReducedMotion }),
      }),
    ),
  })),
  Subscription.lift(IntroDock.subscriptions)<Model, Message>({
    read: model => Option.some(model.intro),
    toParentMessage: toIntroMessage,
  }),
)

// VIEW

const SHADOW_COLOR_RGB = '15, 23, 42'
const SHADOW_BASE_OFFSET_PX = 6
const SHADOW_LIFT_OFFSET_PX = 22
const SHADOW_BASE_BLUR_FACTOR = 0.5
const LIFT_SCALE_GAIN = 0.04
const ART_RADIUS_INSET_PX = 14
const GLOW_CENTER_PERCENT = 50
const GLOW_HALF_RANGE_PERCENT = 50

const shadowOf = (tuning: CardTuning, progress: number): string =>
  tuning.hasShadow
    ? `0 ${SHADOW_BASE_OFFSET_PX + SHADOW_LIFT_OFFSET_PX * progress}px ${tuning.shadow.blur * (SHADOW_BASE_BLUR_FACTOR + progress)}px rgba(${SHADOW_COLOR_RGB}, ${tuning.shadow.opacity})`
    : 'none'

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const { tuning } = model
  const { card, sparkle, badge } = IntroDock.valuesOf(model.intro)
  const progress = model.spring.position
  const fade = `${Transition.cssDurationOf(tuning.fade)}s ${Transition.toCssTimingFunction(tuning.fade)}`
  return {
    title: 'foldkit-dials demo',
    body: h.main(
      [h.Class('demo')],
      [
        h.h1([h.Class('demo-title')], ['foldkit-dials demo']),
        Button.view(
          {
            onClick: Message.ClickedCard(),
            toView: ({ button }) =>
              h.button(
                [
                  ...button,
                  h.Class(
                    `demo-card demo-card--${String.toLowerCase(tuning.layout)}`,
                  ),
                  h.AriaPressed(model.isLifted ? 'true' : 'false'),
                  h.Style({
                    borderRadius: `${tuning.radius}px`,
                    boxShadow: shadowOf(tuning, progress),
                    opacity: `${card.current.opacity}`,
                    transform: `translateY(${card.current.y - tuning.lift * progress}px) scale(${1 + LIFT_SCALE_GAIN * progress})`,
                    transition: `border-radius ${fade}, background-color ${fade}`,
                    '--accent': tuning.accent,
                  }),
                ],
                [
                  h.span(
                    [
                      h.Class('demo-card__badge'),
                      h.Style({ transform: `scale(${badge.current.scale})` }),
                    ],
                    ['New'],
                  ),
                  h.div(
                    [
                      h.Class('demo-card__art'),
                      h.Style({
                        borderRadius: `${Math.max(0, tuning.radius - ART_RADIUS_INSET_PX)}px`,
                        backgroundImage:
                          tuning.cover === ''
                            ? 'none'
                            : `url("${tuning.cover}")`,
                        '--glow-x': `${GLOW_CENTER_PERCENT + tuning.glow.x * GLOW_HALF_RANGE_PERCENT}%`,
                        '--glow-y': `${GLOW_CENTER_PERCENT - tuning.glow.y * GLOW_HALF_RANGE_PERCENT}%`,
                      }),
                    ],
                    [
                      h.span(
                        [
                          h.Class('demo-card__sparkle'),
                          h.AriaHidden(true),
                          h.Style({
                            transform: `rotate(${sparkle.current.rotate}deg) scale(${sparkle.current.scale})`,
                          }),
                        ],
                        ['✦'],
                      ),
                    ],
                  ),
                  h.div(
                    [h.Class('demo-card__text')],
                    [
                      h.span([h.Class('demo-card__title')], [tuning.title]),
                      h.span(
                        [h.Class('demo-card__subtitle')],
                        [
                          model.isLifted
                            ? 'Lifted. Click to drop.'
                            : 'Click to lift.',
                        ],
                      ),
                    ],
                  ),
                ],
              ),
          },
          h,
        ),
        h.submodel({
          slotId: 'intro-dock',
          model: model.intro,
          view: IntroDock.view,
          toParentMessage: toIntroMessage,
        }),
      ],
    ),
  }
}
