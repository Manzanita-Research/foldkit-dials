import { Array, Match, Option } from 'effect'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'
import { defineView } from 'foldkit/submodel'

import { Disclosure } from '@foldkit/ui'

import { themeAttribute } from '../../internal/theme.js'
import * as Timeline from '../../timeline/index.js'
import { findByAttribute, isLeftButton } from '../dom.js'
import {
  DOCK_VIEWPORT_MARGIN,
  MIN_DOCK_HEIGHT,
  type ViewWindow,
  maybeMaxDockHeightOf,
  viewWindowOf,
} from '../geometry.js'
import { barHelpId, bodyDisclosureId, dockId } from '../ids.js'
import { Message, type ResizeStep } from '../message.js'
import type { Model } from '../model.js'
import { editorView } from './editor.js'
import { headerView } from './header.js'
import { playheadView } from './playhead.js'
import { rowsView } from './rows.js'
import { rulerView } from './ruler.js'

// VIEW

const BAR_KEYBOARD_HELP =
  'Left and Right arrows move the bar. Shift moves it farther. Enter opens it.'

const bodyView = (
  model: Model,
  viewWindow: ViewWindow,
  clips: ReadonlyArray<Timeline.ClipStatic>,
  panelAttributes: ReadonlyArray<Attribute<Message>>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      ...panelAttributes,
      h.Class('dialkit-timeline-body'),
      h.DataAttribute('dial-timeline-body', model.id),
    ],
    [
      h.span([h.Id(barHelpId(model.id)), h.Hidden(true)], [BAR_KEYBOARD_HELP]),
      h.div(
        [h.Class('dialkit-timeline-grid')],
        [
          rulerView(model, viewWindow, h),
          ...rowsView(model, viewWindow, clips, h),
          ...playheadView(model, viewWindow, h),
        ],
      ),
    ],
  )

const handleResizeKeyDown = (key: string): Option.Option<Message> =>
  Option.map(
    Match.value(key).pipe(
      Match.withReturnType<ResizeStep>(),
      Match.when('ArrowUp', () => 'Grow'),
      Match.when('ArrowDown', () => 'Shrink'),
      Match.when('Home', () => 'Minimum'),
      Match.when('End', () => 'Maximum'),
      Match.option,
    ),
    step => Message.PressedResizeKey({ step }),
  )

const handleResizePointerDown =
  (model: Model) =>
  (
    _pointerType: string,
    button: number,
    _screenX: number,
    _screenY: number,
    _timeStamp: number,
    _clientX: number,
    clientY: number,
  ): Option.Option<Message> =>
    Option.map(Option.liftPredicate(button, isLeftButton), () =>
      Message.PressedResizeHandle({
        clientY,
        height: Option.match(
          findByAttribute('data-dial-timeline-dock', model.id),
          {
            onNone: () => model.dockHeight,
            onSome: dock => dock.getBoundingClientRect().height,
          },
        ),
      }),
    )

// NOTE: the resize handle is a hand-rolled window splitter. `@foldkit/ui`
// has no separator component, and its value is the dock height in pixels.
const resizeHandleView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div([
    h.Class('dialkit-timeline-resize-handle'),
    h.Role('separator'),
    h.AriaLabel('Resize timeline height'),
    h.AriaOrientation('horizontal'),
    h.AriaControls(dockId(model.id)),
    h.AriaValuenow(model.dockHeight),
    h.AriaValuemin(MIN_DOCK_HEIGHT),
    ...Array.fromOption(
      Option.map(maybeMaxDockHeightOf(model), h.AriaValuemax),
    ),
    h.AriaValuetext(`${model.dockHeight} pixels`),
    h.Tabindex(0),
    h.Title('Drag to resize timeline'),
    h.OnPointerDown(handleResizePointerDown(model)),
    h.OnKeyDownPreventDefault(handleResizeKeyDown),
  ])

/** Renders the dock with DialKit's `.dialkit-timeline*` class names, so
 *  DialKit's stylesheet skins it: a toolbar with transport and Copy, a
 *  ruler, one row per clip with draggable bars, a playhead, and a clip
 *  editor anchored to the selected bar. */
export const view = defineView<Model, Message>((model, h): Html => {
  const timelineStatic = Timeline.resolve(model.timeline)
  const viewWindow = viewWindowOf(model, timelineStatic.duration)
  const isEditorShown = model.isOpen && model.isVisible

  return h.div(
    [
      h.Class('dialkit-root dialkit-timeline'),
      h.DataAttribute('theme', themeAttribute(model.theme)),
      h.DataAttribute('dial-timeline-id', model.id),
      h.Role('region'),
      h.AriaLabel(`${model.name} timeline`),
      h.Hidden(!model.isVisible),
    ],
    [
      resizeHandleView(model, h),
      h.div(
        [
          h.Id(dockId(model.id)),
          h.Class('dialkit-timeline-dock'),
          h.DataAttribute('dial-timeline-dock', model.id),
          h.Style({
            'max-height': `min(${model.dockHeight}px, calc(100vh - ${DOCK_VIEWPORT_MARGIN}px))`,
          }),
        ],
        [
          Disclosure.view(
            {
              id: bodyDisclosureId(model.id),
              isOpen: model.isOpen,
              onToggle: isOpen => Message.ToggledOpen({ isOpen }),
              ariaLabel: 'Timeline',
              toView: ({ button, panel }) =>
                h.div(
                  [h.Class('dialkit-timeline-section')],
                  [
                    headerView(model, viewWindow, button, h),
                    ...(model.isOpen
                      ? [
                          bodyView(
                            model,
                            viewWindow,
                            timelineStatic.clips,
                            panel,
                            h,
                          ),
                        ]
                      : []),
                    ...(isEditorShown
                      ? Array.fromOption(
                          Option.flatMap(model.maybeEditor, editor =>
                            editorView(model, editor, h),
                          ),
                        )
                      : []),
                  ],
                ),
            },
            h,
          ),
        ],
      ),
    ],
  )
})
