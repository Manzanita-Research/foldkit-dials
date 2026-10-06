import { Match, Number, Option } from 'effect'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { clamp } from '../../internal/range.js'
import { isLeftButton } from '../dom.js'
import { TICK_TOLERANCE, type ViewWindow } from '../geometry.js'
import { Message, type PlayheadDirection, type ZoomStep } from '../message.js'
import type { Model } from '../model.js'
import { PERCENT_DECIMALS } from './shared.js'

// VIEW

const PLAYHEAD_FLAG_HALF_WIDTH_PIXELS = 26
const PLAYHEAD_FLAG_EDGE_OVERHANG_PIXELS = 1
const PLAYHEAD_EDGE_TOLERANCE_PIXELS = 0.5
const PLAYHEAD_FLAG_DECIMALS = 2

const navigate = (direction: PlayheadDirection): Message =>
  Message.PressedPlayheadNavigation({ direction })

const zoom = (step: ZoomStep): Message => Message.PressedZoomKey({ step })

const handlePlayheadKeyDown = (key: string): Option.Option<Message> =>
  Match.value(key).pipe(
    Match.withReturnType<Message>(),
    Match.whenOr('ArrowLeft', 'ArrowDown', () => navigate('StepBackward')),
    Match.whenOr('ArrowRight', 'ArrowUp', () => navigate('StepForward')),
    Match.when('PageDown', () => navigate('PageBackward')),
    Match.when('PageUp', () => navigate('PageForward')),
    Match.when('Home', () => navigate('Start')),
    Match.when('End', () => navigate('End')),
    Match.whenOr('+', '=', () => zoom('In')),
    Match.when('-', () => zoom('Out')),
    Match.when('0', () => zoom('Reset')),
    Match.option,
  )

// NOTE: the value text holds still during playback, so a screen reader on
// the focused playhead does not announce every frame.
const playheadValueText = (model: Model): string =>
  model.isPlaying
    ? 'Playing'
    : `${model.time.toFixed(PLAYHEAD_FLAG_DECIMALS)} seconds`

// NOTE: the playhead and the overview are hand-rolled sliders rather than
// `@foldkit/ui` Slider. They scrub a playhead that frame ticks also move, a
// press seeks inside the zoomed window, and the keys also zoom.
/** The slider role, value, and keys that the playhead and the overview
 *  share. */
export const timeAriaAttributes = (
  model: Model,
  duration: number,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Attribute<Message>> => [
  h.Role('slider'),
  h.Tabindex(0),
  h.AriaValuemin(0),
  h.AriaValuemax(duration),
  h.AriaValuenow(model.time),
  h.AriaValuetext(playheadValueText(model)),
  h.OnKeyDownPreventDefault(handlePlayheadKeyDown),
]

const playheadEdge = (flagOffset: number): string => {
  if (flagOffset > PLAYHEAD_EDGE_TOLERANCE_PIXELS) {
    return 'start'
  } else if (flagOffset < -PLAYHEAD_EDGE_TOLERANCE_PIXELS) {
    return 'end'
  } else {
    return 'center'
  }
}

const handlePlayheadPointerDown = (
  _pointerType: string,
  button: number,
): Option.Option<Message> =>
  Option.liftPredicate(Message.PressedPlayhead(), () => isLeftButton(button))

/** Renders the playhead while it is inside the visible window. */
export const playheadView = (
  model: Model,
  viewWindow: ViewWindow,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const viewEnd = viewWindow.start + viewWindow.visible
  const fraction =
    viewWindow.visible > 0
      ? (model.time - viewWindow.start) / viewWindow.visible
      : 0
  const positionPixels = fraction * model.rulerWidth
  const flagCenter = clamp(
    positionPixels,
    PLAYHEAD_FLAG_HALF_WIDTH_PIXELS - PLAYHEAD_FLAG_EDGE_OVERHANG_PIXELS,
    model.rulerWidth -
      PLAYHEAD_FLAG_HALF_WIDTH_PIXELS +
      PLAYHEAD_FLAG_EDGE_OVERHANG_PIXELS,
  )
  const flagOffset = model.rulerWidth > 0 ? flagCenter - positionPixels : 0
  const isInView =
    model.time >= viewWindow.start - TICK_TOLERANCE &&
    model.time <= viewEnd + TICK_TOLERANCE

  return isInView
    ? [
        h.div(
          [
            h.Class('dialkit-timeline-playhead-control'),
            h.DataAttribute('edge', playheadEdge(flagOffset)),
            h.AriaLabel('Timeline current time'),
            h.Title('Drag to scrub the timeline'),
            h.Style({
              left: `calc(var(--dial-timeline-label-w) + (100% - var(--dial-timeline-label-w)) * ${Number.round(fraction, PERCENT_DECIMALS)})`,
              '--dial-timeline-playhead-flag-offset': `${flagOffset}px`,
            }),
            ...timeAriaAttributes(model, viewWindow.duration, h),
            h.OnPointerDown(handlePlayheadPointerDown),
          ],
          [
            h.div([h.Class('dialkit-timeline-playhead-stem')]),
            h.div(
              [h.Class('dialkit-timeline-playhead-anchor')],
              [
                h.div(
                  [h.Class('dialkit-timeline-playhead-flag')],
                  [model.time.toFixed(PLAYHEAD_FLAG_DECIMALS)],
                ),
              ],
            ),
          ],
        ),
      ]
    : []
}
