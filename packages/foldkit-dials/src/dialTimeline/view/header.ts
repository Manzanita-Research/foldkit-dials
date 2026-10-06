import { Option, pipe } from 'effect'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import {
  ICON_CHECK,
  ICON_CLIPBOARD,
  ICON_CLOSE,
  ICON_PAUSE,
  ICON_PLAY,
  ICON_REPLAY,
  fillIcon,
  strokeIcon,
} from '../../internal/icons.js'
import * as Timeline from '../../timeline/index.js'
import { findOverview, fractionWithin, isLeftButton } from '../dom.js'
import type { ViewWindow } from '../geometry.js'
import { Message } from '../message.js'
import { CopyState, type Model } from '../model.js'
import { timeAriaAttributes } from './playhead.js'
import { chevronIcon, iconButton, percent } from './shared.js'

// VIEW

const ZOOMED_VIEWPORT_FRACTION = 0.99999

const handleOverviewPointerDown =
  (id: string) =>
  (
    _pointerType: string,
    button: number,
    _screenX: number,
    _screenY: number,
    _timeStamp: number,
    clientX: number,
  ): Option.Option<Message> =>
    pipe(
      Option.liftPredicate(button, isLeftButton),
      Option.flatMap(() => findOverview(id)),
      Option.map(overview =>
        Message.PressedOverview({
          fraction: fractionWithin(overview, clientX),
        }),
      ),
    )

const overviewView = (
  model: Model,
  viewWindow: ViewWindow,
  h: HtmlBuilder<Message>,
): Html => {
  const { duration } = viewWindow
  const viewportFraction = duration > 0 ? viewWindow.visible / duration : 1
  const startFraction = duration > 0 ? viewWindow.start / duration : 0
  const playheadFraction = duration > 0 ? model.time / duration : 0

  return h.div(
    [
      h.Class('dialkit-timeline-overview'),
      h.DataAttribute('dial-timeline-overview', model.id),
      h.AriaLabel('Timeline overview'),
      h.Title('Drag to scrub the full timeline'),
      ...timeAriaAttributes(model, duration, h),
      h.OnPointerDown(handleOverviewPointerDown(model.id)),
    ],
    [
      h.div([
        h.Class('dialkit-timeline-overview-viewport'),
        ...(viewportFraction < ZOOMED_VIEWPORT_FRACTION
          ? [h.DataAttribute('zoomed', '')]
          : []),
        h.Style({
          left: percent(startFraction),
          width: percent(viewportFraction),
        }),
      ]),
      h.div([
        h.Class('dialkit-timeline-overview-progress'),
        h.Style({ width: percent(playheadFraction) }),
      ]),
      h.div([
        h.Class('dialkit-timeline-overview-playhead'),
        h.Style({ left: percent(playheadFraction) }),
      ]),
    ],
  )
}

const copyLabel = (copyState: CopyState): string =>
  CopyState.match(copyState, {
    Idle: () => 'Copy parameters',
    Copied: () => 'Copied parameters',
    Failed: () => 'Copy failed',
  })

const copyStatusText = (copyState: CopyState): string =>
  CopyState.match(copyState, {
    Idle: () => '',
    Copied: () => 'Copied parameters',
    Failed: () => 'Copy failed',
  })

const copyIcon = (copyState: CopyState, h: HtmlBuilder<Message>): Html =>
  CopyState.match(copyState, {
    Idle: () => strokeIcon(ICON_CLIPBOARD, '', h),
    Copied: () => strokeIcon(ICON_CHECK, '', h),
    Failed: () => strokeIcon(ICON_CLOSE, '', h),
  })

const actionsView = (
  model: Model,
  chevronAttributes: ReadonlyArray<Attribute<Message>>,
  h: HtmlBuilder<Message>,
): Html => {
  const playLabel = model.isPlaying ? 'Pause' : 'Play'
  const copyText = copyLabel(model.copyState)

  return h.div(
    [h.Class('dialkit-timeline-actions')],
    [
      iconButton(h, {
        className: 'dialkit-toolbar-add',
        label: playLabel,
        icon: fillIcon(model.isPlaying ? ICON_PAUSE : ICON_PLAY, h),
        onClick: model.isPlaying
          ? Message.RequestedPause()
          : Message.RequestedPlay(),
      }),
      iconButton(h, {
        className: 'dialkit-toolbar-add',
        label: 'Replay',
        icon: fillIcon(ICON_REPLAY, h),
        onClick: Message.RequestedReplay(),
      }),
      iconButton(h, {
        className: 'dialkit-toolbar-add dialkit-toolbar-primary',
        label: copyText,
        icon: copyIcon(model.copyState, h),
        onClick: Message.ClickedCopyTimeline(),
        attributes:
          model.copyState._tag === 'Failed'
            ? [h.DataAttribute('copy-failed', '')]
            : [],
      }),
      h.span(
        [h.Class('fkd-visually-hidden'), h.Role('status')],
        [copyStatusText(model.copyState)],
      ),
      h.button(
        [
          ...chevronAttributes,
          h.Class('dialkit-timeline-chevron'),
          h.Title(model.isOpen ? 'Collapse timeline' : 'Expand timeline'),
        ],
        [chevronIcon(h)],
      ),
    ],
  )
}

/** Renders the dock's header: its name, the clock, the overview while
 *  collapsed, and the actions. */
export const headerView = (
  model: Model,
  viewWindow: ViewWindow,
  chevronAttributes: ReadonlyArray<Attribute<Message>>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Class('dialkit-timeline-header'),
      ...(model.isOpen ? [h.DataAttribute('open', '')] : []),
    ],
    [
      h.div(
        [h.Class('dialkit-timeline-identity')],
        [
          h.span([h.Class('dialkit-timeline-title')], [model.name]),
          h.span(
            [h.Class('dialkit-timeline-time')],
            [Timeline.formatClock(model.time, 'Tenths')],
          ),
        ],
      ),
      ...(model.isOpen ? [] : [overviewView(model, viewWindow, h)]),
      actionsView(model, chevronAttributes, h),
    ],
  )
