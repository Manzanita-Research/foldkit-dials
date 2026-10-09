import { Effect, Match, Option, Schema } from 'effect'
import { Command, Runtime, Subscription, Update } from 'foldkit'
import type { Document, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest, load, pushUrl } from 'foldkit/navigation'
import { modifyFields } from 'foldkit/struct'
import { Url, toString as urlToString } from 'foldkit/url'

import * as CardDemo from './cardDemo'
import * as Gallery from './gallery/examples'
import { view as galleryView } from './gallery/page'
import { AppRoute, controlsRoute, homeRoute, routeFromUrl } from './route'

// MODEL

export const Model = Schema.Struct({
  route: AppRoute,
  home: CardDemo.Model,
  gallery: Gallery.Model,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedNavigate: {},
  FailedNavigate: {},
  GotHomeMessage: { message: CardDemo.Message },
  GotHomeFrameMessage: { message: CardDemo.Message },
  GotGalleryMessage: { message: Gallery.Message },
  GotGalleryFrameMessage: { message: Gallery.Message },
})
export type Message = typeof Message.Type

const toHomeMessage = (message: typeof CardDemo.Message.Type): Message =>
  Match.value(message).pipe(
    Match.tag(
      'GotDialPanelDragMessage',
      'TickedFrame',
      'GotIntroFrameMessage',
      () => Message.GotHomeFrameMessage({ message }),
    ),
    Match.orElse(() => Message.GotHomeMessage({ message })),
  )

const toGalleryMessage = (message: Gallery.Message): Message =>
  Gallery.isContinuousMessage(message)
    ? Message.GotGalleryFrameMessage({ message })
    : Message.GotGalleryMessage({ message })

// INIT

const pageOf = (route: AppRoute): Gallery.Page =>
  AppRoute.match<Gallery.Page>(route, {
    Home: () => 'Controls',
    Controls: () => 'Controls',
    Panels: () => 'Panels',
    Timeline: () => 'Timeline',
    NotFound: () => 'Controls',
  })

export const init: Runtime.RoutingApplicationInit<Model, Message> = url => {
  const route = routeFromUrl(url)
  return Update.foldChildInits(
    { home: CardDemo.init(), gallery: Gallery.init() },
    {
      toParentModel: children => ({
        route,
        home: children.home,
        gallery: modifyFields(children.gallery, { page: () => pageOf(route) }),
      }),
      folds: {
        home: {
          toParentMessage: toHomeMessage,
        },
        gallery: {
          toParentMessage: toGalleryMessage,
        },
      },
    },
  )
}

// COMMAND

export const Navigate = Command.define('Navigate', {
  args: { request: UrlRequest },
  messages: [Message.CompletedNavigate, Message.FailedNavigate],
  execute: ({ request }) =>
    UrlRequest.match(request, {
      Internal: ({ url }) => pushUrl(urlToString(url)),
      External: ({ href }) => load(href),
    }).pipe(
      Effect.as(Message.CompletedNavigate()),
      Effect.catch(() => Effect.succeed(Message.FailedNavigate())),
    ),
})

// UPDATE

const foldHome = Update.foldChild({
  update: CardDemo.update,
  read: (model: Model) => Option.some(model.home),
  write: (model, nextHome) => modifyFields(model, { home: () => nextHome }),
  toParentMessage: toHomeMessage,
})

const foldGallery = Update.foldChild({
  update: Gallery.update,
  read: (model: Model) => Option.some(model.gallery),
  write: (model, nextGallery) =>
    modifyFields(model, { gallery: () => nextGallery }),
  toParentMessage: toGalleryMessage,
})

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedLink: ({ request }) => ({
      model,
      commands: [Navigate({ request })],
    }),
    CompletedNavigate: () => ({ model }),
    FailedNavigate: () => ({ model }),
    ChangedUrl: ({ url }) => {
      const route = routeFromUrl(url)
      return {
        model: modifyFields(model, {
          route: () => route,
          gallery: gallery =>
            modifyFields(Gallery.leave(gallery), { page: () => pageOf(route) }),
          home: home =>
            model.route._tag === 'Home' && route._tag !== 'Home'
              ? CardDemo.leave(home)
              : home,
        }),
      }
    },
    GotHomeMessage: ({ message }) => foldHome(model, message),
    GotHomeFrameMessage: ({ message }) => foldHome(model, message),
    GotGalleryMessage: ({ message }) => foldGallery(model, message),
    GotGalleryFrameMessage: ({ message }) => foldGallery(model, message),
  })

// SUBSCRIPTION

export const subscriptions = Subscription.aggregate(
  Subscription.lift(CardDemo.subscriptions)<Model, Message>({
    read: model =>
      model.route._tag === 'Home' ? Option.some(model.home) : Option.none(),
    toParentMessage: toHomeMessage,
  }),
  Subscription.lift(Gallery.subscriptions)<Model, Message>({
    read: model =>
      model.route._tag === 'Home' || model.route._tag === 'NotFound'
        ? Option.none()
        : Option.some(model.gallery),
    toParentMessage: toGalleryMessage,
  }),
)

// VIEW

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title:
    model.route._tag === 'Home'
      ? 'Foldkit Dials — Live tuning for Foldkit'
      : 'Control gallery · Foldkit Dials',
  body: AppRoute.match(model.route, {
    Home: () =>
      h.submodel({
        slotId: 'card-demo',
        model: model.home,
        view: CardDemo.view,
        toParentMessage: toHomeMessage,
      }),
    Controls: () =>
      h.submodel({
        slotId: 'control-gallery',
        model: model.gallery,
        view: galleryView,
        toParentMessage: toGalleryMessage,
      }),
    Panels: () =>
      h.submodel({
        slotId: 'control-gallery',
        model: model.gallery,
        view: galleryView,
        toParentMessage: toGalleryMessage,
      }),
    Timeline: () =>
      h.submodel({
        slotId: 'control-gallery',
        model: model.gallery,
        view: galleryView,
        toParentMessage: toGalleryMessage,
      }),
    NotFound: () =>
      h.main(
        [h.Class('gallery')],
        [
          h.h1([], ['Page not found']),
          h.a([h.Href(homeRoute())], ['Card demo']),
          ' · ',
          h.a([h.Href(controlsRoute())], ['Control gallery']),
        ],
      ),
  }),
})

export const routing = {
  onUrlRequest: (request: UrlRequest): Message =>
    Message.ClickedLink({ request }),
  onUrlChange: (url: Url): Message => Message.ChangedUrl({ url }),
}
