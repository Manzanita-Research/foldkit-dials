import { Option, Schema } from 'effect'
import { Runtime, Subscription, Update } from 'foldkit'
import { DialTimeline, Frame, Transition } from 'foldkit-dials'
import type { Document, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { Button } from '@foldkit/ui'
import { Var } from '@pleat/core'
import { css } from '@pleat/foldkit'

import { INTRO_DURATION_SECONDS, IntroDock } from './intro'
import { SpringState, isAtRest, restingAt, step } from './spring'
import * as Styles from './styles'
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

const foldIntroOutMessage = IntroDock.OutMessage.match<Update.Step<Model, Message>>({
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
    GotIntroMessage: ({ message: introMessage }) => foldIntro(model, introMessage),
    GotIntroFrameMessage: ({ message: introMessage }) => foldIntro(model, introMessage),
  })

// SUBSCRIPTION

export const subscriptions = Subscription.aggregate(
  Subscription.make<Model, Message>()(() => ({
    springFrame: Frame.animationFrame<Model, Message>({
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
    title: 'Foldkit Dials — Live tuning for Foldkit',
    body: h.main(
      [...css(Styles.demo)],
      [
        h.h1([...css(Styles.demoTitle)], ['Foldkit Dials']),
        h.p(
          [...css(Styles.pleatNote)],
          [
            'Styled with ',
            h.a(
              [
                h.Href('https://github.com/Manzanita-Research/pleat'),
                ...css(Styles.pleatLink),
              ],
              ['Pleat'],
            ),
            '. Optional, but encouraged for styling your Foldkit apps. Dials works with any CSS.',
          ],
        ),
        Button.view(
          {
            onClick: Message.ClickedCard(),
            toView: ({ button }) =>
              h.button(
                [
                  ...button,
                  h.AriaPressed(model.isLifted ? 'true' : 'false'),
                  ...css(
                    Styles.card({ layout: tuning.layout }),
                    Var.bind(Styles.live.radius, `${tuning.radius}px`),
                    Var.bind(Styles.live.shadow, shadowOf(tuning, progress)),
                    Var.bind(Styles.live.opacity, card.current.opacity),
                    Var.bind(
                      Styles.live.transform,
                      `translateY(${card.current.y - tuning.lift * progress}px) scale(${1 + LIFT_SCALE_GAIN * progress})`,
                    ),
                    Var.bind(
                      Styles.live.transition,
                      `border-radius ${fade}, background-color ${fade}`,
                    ),
                    Var.bind(Styles.live.accent, tuning.accent),
                  ),
                ],
                [
                  h.span(
                    [
                      ...css(
                        Styles.badge,
                        Var.bind(
                          Styles.live.badgeTransform,
                          `scale(${badge.current.scale})`,
                        ),
                      ),
                    ],
                    ['Live controls'],
                  ),
                  h.div(
                    [
                      ...css(
                        Styles.art({ layout: tuning.layout }),
                        Var.bind(
                          Styles.live.artRadius,
                          `${Math.max(0, tuning.radius - ART_RADIUS_INSET_PX)}px`,
                        ),
                        Var.bind(
                          Styles.live.cover,
                          tuning.cover === '' ? 'none' : `url("${tuning.cover}")`,
                        ),
                        Var.bind(
                          Styles.live.glowX,
                          `${GLOW_CENTER_PERCENT + tuning.glow.x * GLOW_HALF_RANGE_PERCENT}%`,
                        ),
                        Var.bind(
                          Styles.live.glowY,
                          `${GLOW_CENTER_PERCENT - tuning.glow.y * GLOW_HALF_RANGE_PERCENT}%`,
                        ),
                      ),
                    ],
                    [
                      h.span(
                        [
                          h.AriaHidden(true),
                          ...css(
                            Styles.sparkle,
                            Var.bind(
                              Styles.live.sparkleTransform,
                              `rotate(${sparkle.current.rotate}deg) scale(${sparkle.current.scale})`,
                            ),
                          ),
                        ],
                        ['✦'],
                      ),
                    ],
                  ),
                  h.div(
                    [...css(Styles.text)],
                    [
                      h.span([...css(Styles.title)], [tuning.title]),
                      h.span(
                        [...css(Styles.subtitle)],
                        ['Live tuning for Foldkit apps.'],
                      ),
                      h.span(
                        [...css(Styles.description)],
                        ['Dial in colors, spacing, and motion. Every edit is a Message, ready for DevTools and time travel.'],
                      ),
                      h.span(
                        [...css(Styles.hint)],
                        [model.isLifted ? 'Click to drop. Try the dials →' : 'Click to lift. Try the dials →'],
                      ),
                    ],
                  ),
                ],
              ),
          },
          h,
        ),
        h.div(
          [...css(Styles.links)],
          [
            h.code([], ['npm install foldkit-dials']),
            h.p(
              [...css(Styles.linkRow)],
              [
                h.a(
                  [h.Href('https://github.com/Manzanita-Research/foldkit-dials/tree/main/packages/foldkit-dials#readme'), ...css(Styles.pleatLink)],
                  ['Docs & source'],
                ),
                ' · ',
                h.a([h.Href('https://foldkit.dev'), ...css(Styles.pleatLink)], ['Built for Foldkit']),
              ],
            ),
          ],
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
