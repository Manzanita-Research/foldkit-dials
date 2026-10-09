import { Schema, pipe } from 'effect'
import { Route } from 'foldkit'
import { defineRouteUnion, literal, slash } from 'foldkit/route'

// ROUTE

export const AppRoute = defineRouteUnion({
  Home: {},
  Controls: {},
  Panels: {},
  Timeline: {},
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const homeRoute = pipe(Route.root, Route.mapTo(AppRoute.Home))
export const controlsRoute = pipe(
  literal('gallery'),
  Route.mapTo(AppRoute.Controls),
)
export const panelsRoute = pipe(
  literal('gallery'),
  slash(literal('panels')),
  Route.mapTo(AppRoute.Panels),
)
export const timelineRoute = pipe(
  literal('gallery'),
  slash(literal('timeline')),
  Route.mapTo(AppRoute.Timeline),
)
export const routeFromUrl = Route.parseUrlWithFallback(
  Route.oneOf(panelsRoute, timelineRoute, controlsRoute, homeRoute),
  AppRoute.NotFound,
)
