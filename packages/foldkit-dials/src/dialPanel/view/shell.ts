import { Array, Match, Option } from 'effect'
import { type Attribute, type Html, type HtmlBuilder } from 'foldkit/html'
import { defineView } from 'foldkit/submodel'

import { Disclosure } from '@foldkit/ui'

import { panelIcon } from '../../internal/icons.js'
import { themeAttribute } from '../../internal/theme.js'
import { Message } from '../message.js'
import { type Corner, type Layout, type Model, type Theme } from '../model.js'
import { PANEL_ID_ATTRIBUTE, type PanelSpec } from '../spec.js'
import { controlsView } from './controls.js'
import { type Context } from './shared.js'
import { compareBannerView, saveStatusView, toolbarView } from './toolbar.js'

// VIEW

/** Per-render view inputs for a panel. `values` is the parent-owned values
 *  record. `layout` defaults to `Floating`, `position` to `TopRight`, and
 *  `theme` to `System`. */
export type ViewInputs = Readonly<{
  values: unknown
  theme?: Theme
  position?: Corner
  layout?: Layout
}>

const PANEL_WIDTH = '280px'
const COLLAPSED_SIZE = '42px'
const PANEL_MAX_HEIGHT = 'calc(100dvh - 32px)'
const LEFT_MOUSE_BUTTON = 0

const positionAttribute = (corner: Corner): string =>
  Match.value(corner).pipe(
    Match.withReturnType<string>(),
    Match.when('TopRight', () => 'top-right'),
    Match.when('TopLeft', () => 'top-left'),
    Match.when('BottomRight', () => 'bottom-right'),
    Match.when('BottomLeft', () => 'bottom-left'),
    Match.exhaustive,
  )

// PANEL

const headerInteractionAttributes = (
  context: Context,
  layout: Layout,
): ReadonlyArray<Attribute<Message>> => {
  const { h } = context
  return layout === 'Floating'
    ? [
        h.OnPointerDown(
          (
            _pointerType,
            button,
            _screenX,
            _screenY,
            _timeStamp,
            clientX,
            clientY,
          ) =>
            Option.liftPredicate(
              Message.PressedPanelHeader({ clientX, clientY }),
              () => button === LEFT_MOUSE_BUTTON,
            ),
        ),
        h.OnKeyDownPreventDefault(key =>
          Option.liftPredicate(
            Message.ToggledPanelWithKeyboard({ isOpen: !context.model.isOpen }),
            () => key === 'Enter' || key === ' ',
          ),
        ),
      ]
    : []
}

const sectionView = (context: Context, layout: Layout): Html => {
  const { h, model, spec } = context
  const isRoot = layout !== 'Section'
  return Disclosure.view(
    {
      id: `${spec.id}-dials`,
      isOpen: model.isOpen,
      ariaLabel: spec.name,
      onToggle: isOpen => Message.ToggledPanel({ isOpen }),
      toView: ({ button, panel }) =>
        h.div(
          [
            h.Class(
              isRoot
                ? 'dialkit-folder dialkit-folder-root'
                : 'dialkit-folder dialkit-folder-section',
            ),
            h.DataAttribute('open', model.isOpen ? 'true' : 'false'),
            h.DataAttribute(PANEL_ID_ATTRIBUTE, spec.id),
            h.Role('region'),
            h.AriaLabel(spec.name),
          ],
          [
            h.div(
              [h.Class('dialkit-folder-header dialkit-panel-header')],
              [
                h.button(
                  [
                    ...Array.filter(
                      button,
                      attribute =>
                        layout !== 'Floating' ||
                        attribute._tag !== 'OnKeyDownPreventDefault',
                    ),
                    ...headerInteractionAttributes(context, layout),
                    h.Class('dialkit-folder-header-top'),
                  ],
                  [
                    h.span(
                      [h.Class('dialkit-folder-title-row')],
                      [
                        h.span(
                          [
                            h.Class(
                              isRoot
                                ? 'dialkit-folder-title dialkit-folder-title-root'
                                : 'dialkit-folder-title',
                            ),
                          ],
                          [spec.name],
                        ),
                      ],
                    ),
                    panelIcon(h),
                  ],
                ),
                ...(model.isOpen
                  ? [
                      toolbarView(context),
                      saveStatusView(context),
                      ...compareBannerView(context),
                    ]
                  : []),
              ],
            ),
            ...(model.isOpen
              ? [
                  h.div(
                    [...panel, h.Class('dialkit-folder-content')],
                    [
                      h.div(
                        [h.Class('dialkit-folder-inner')],
                        controlsView(context, spec.controls),
                      ),
                    ],
                  ),
                ]
              : []),
          ],
        ),
    },
    h,
  )
}

/** Renders a panel as DialKit's markup, so DialKit's stylesheet skins it.
 *  `Floating` and `Inline` wrap the panel in its own `dialkit-root`;
 *  `Section` renders only the panel, for `root` to group. */
export const makeView = (spec: PanelSpec) =>
  defineView<Model, Message, ViewInputs>((model, viewInputs, h): Html => {
    const layout = viewInputs.layout ?? 'Floating'
    const theme = viewInputs.theme ?? 'System'
    const context: Context = {
      spec,
      model,
      values: viewInputs.values,
      theme,
      h,
    }

    if (layout === 'Section') {
      return sectionView(context, layout)
    } else {
      const mode = layout === 'Inline' ? 'inline' : 'popover'
      return h.div(
        [
          h.Class('dialkit-root fkd-root'),
          h.DataAttribute('theme', themeAttribute(theme)),
          h.DataAttribute('mode', mode),
        ],
        [
          h.div(
            [
              h.Class('dialkit-panel'),
              h.DataAttribute('mode', mode),
              h.DataAttribute(
                'position',
                positionAttribute(viewInputs.position ?? 'TopRight'),
              ),
              h.Style({ translate: `${model.offset.x}px ${model.offset.y}px` }),
            ],
            [
              h.div(
                [h.Class('dialkit-panel-wrapper')],
                [
                  h.div(
                    [
                      h.Class('dialkit-panel-inner'),
                      h.DataAttribute(
                        'collapsed',
                        model.isOpen ? 'false' : 'true',
                      ),
                      h.Style(
                        model.isOpen
                          ? {
                              width: PANEL_WIDTH,
                              maxHeight: PANEL_MAX_HEIGHT,
                              overflow: 'hidden auto',
                            }
                          : {
                              width: COLLAPSED_SIZE,
                              height: COLLAPSED_SIZE,
                              overflow: 'hidden',
                            },
                      ),
                    ],
                    [sectionView(context, layout)],
                  ),
                ],
              ),
            ],
          ),
        ],
      )
    }
  })

/** Renders several panels in one DialKit window, as sections, the way a
 *  DialKit root shows every registered panel. Pass each panel's view built
 *  with `layout: 'Section'`. */
export const root = <ParentMessage>(
  config: Readonly<{
    sections: ReadonlyArray<Html>
    theme?: Theme
    position?: Corner
  }>,
  h: HtmlBuilder<ParentMessage>,
): Html =>
  h.div(
    [
      h.Class('dialkit-root fkd-root'),
      h.DataAttribute('theme', themeAttribute(config.theme ?? 'System')),
      h.DataAttribute('mode', 'popover'),
    ],
    [
      h.div(
        [
          h.Class('dialkit-panel'),
          h.DataAttribute('mode', 'popover'),
          h.DataAttribute(
            'position',
            positionAttribute(config.position ?? 'TopRight'),
          ),
          h.DataAttribute('multiple', 'true'),
        ],
        [
          h.div(
            [h.Class('dialkit-panel-wrapper')],
            [
              h.div(
                [
                  h.Class('dialkit-panel-inner'),
                  h.DataAttribute('collapsed', 'false'),
                  h.Style({
                    width: PANEL_WIDTH,
                    maxHeight: PANEL_MAX_HEIGHT,
                    overflow: 'hidden auto',
                  }),
                ],
                [...config.sections],
              ),
            ],
          ),
        ],
      ),
    ],
  )
