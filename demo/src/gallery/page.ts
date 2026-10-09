import { Array, Match } from 'effect'
import { DialPanel } from 'foldkit-dials'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineView } from 'foldkit/submodel'

import { controlsRoute, homeRoute, panelsRoute, timelineRoute } from '../route'
import * as Examples from './examples'
import './styles.css'
import source from './examples.ts?raw'

// SOURCE

export const sourceSection = (name: string): string => {
  const after = source.split(`// ${name}\n`).at(1)
  return after?.split('\n// ').at(0)?.trim() ?? ''
}

const snippet = (name: string, h: HtmlBuilder<Examples.Message>): Html =>
  h.details(
    [h.Class('gallery-source')],
    [
      h.summary([], ['Usage · TypeScript']),
      h.pre([], [h.code([], [sourceSection(name)])]),
    ],
  )

const example = (
  id: string,
  title: string,
  description: string,
  keys: string,
  control: Html,
  sourceName: string,
  h: HtmlBuilder<Examples.Message>,
): Html =>
  h.section(
    [h.Id(id), h.Class('gallery-example'), h.AriaLabel(title)],
    [
      h.h2([], [title]),
      h.p([h.Class('gallery-description')], [description]),
      h.div(
        [
          h.Class('gallery-control dialkit-root'),
          h.DataAttribute('theme', 'light'),
          h.DataAttribute('mode', 'inline'),
        ],
        [control],
      ),
      h.p([h.Class('gallery-keys')], [keys]),
      snippet(sourceName, h),
    ],
  )

// CONTROLS VIEW

const controlsView = (
  model: Examples.Model,
  h: HtmlBuilder<Examples.Message>,
): Html =>
  h.div(
    [],
    [
      h.p(
        [h.Class('gallery-intro')],
        [
          'Each example owns its value in the parent Model. Interaction state lives in the child; ChangedValue OutMessages update the parent. Try Tab, the arrow keys and the mouse.',
        ],
      ),
      h.div(
        [h.Class('gallery-grid')],
        [
          example(
            'scrub-slider',
            'ScrubSlider',
            'A number you can drag or edit precisely.',
            '← → adjust · Home / End jump · Enter edits · Escape cancels',
            Examples.sliderView(model, h),
            'SLIDER VIEW',
            h,
          ),
          example(
            'dial-pad',
            'DialPad',
            'Two axes, one control. Position stays separate from the slider.',
            'Arrow keys adjust axes · Shift makes larger steps · Home resets',
            Examples.padView(model, h),
            'PAD VIEW',
            h,
          ),
          example(
            'bezier-editor',
            'BezierEditor',
            'Drag the handles to shape a cubic Bézier easing.',
            'Tab reaches each handle · Arrow keys adjust · Shift makes larger steps',
            Examples.bezierView(model, h),
            'BEZIER VIEW',
            h,
          ),
          example(
            'color-field',
            'ColorField',
            'Editable color text with an anchored ColorPicker.',
            'Enter commits text · Escape discards or closes · Swatch opens picker',
            Examples.fieldView(model, h),
            'COLOR FIELD VIEW',
            h,
          ),
          example(
            'color-picker',
            'ColorPicker',
            'A standalone picker with color, hue, opacity and format controls.',
            'Arrow keys adjust thumbs · Format options use roving focus',
            Examples.pickerView(model, h),
            'COLOR PICKER VIEW',
            h,
          ),
          example(
            'image-picker',
            'ImagePicker',
            'Choose a local sample, upload an image or remove the selection.',
            'Arrow keys browse thumbnails · Enter selects · Escape returns focus',
            Examples.imageView(model, h),
            'IMAGE VIEW',
            h,
          ),
          example(
            'transition-editor',
            'TransitionEditor',
            'Compare Easing, Time and Physics. The response curve follows the parent transition.',
            'Arrow keys change type and parameters · Enter edits parameter values',
            Examples.transitionView(model, h),
            'TRANSITION VIEW',
            h,
          ),
          example(
            'curve',
            'Curve',
            'A stateless SVG response curve for the same parent-owned transition.',
            'Change Motion type or its parameters to redraw this curve.',
            Examples.curveView(model, h),
            'CURVE VIEW',
            h,
          ),
        ],
      ),
      h.section(
        [h.Class('gallery-wiring'), h.AriaLabel('Parent wiring')],
        [
          h.h2([], ['Wire a headless control']),
          h.p(
            [],
            [
              'The snippets above come from the TypeScript that runs these examples. Here is the slider’s parent fold and subscription. Lift subscriptions alongside the view so pointer movement and cancellation reach the child.',
            ],
          ),
          snippet('SLIDER UPDATE', h),
          snippet('SLIDER SUBSCRIPTION', h),
          h.details(
            [h.Class('gallery-source')],
            [
              h.summary([], ['Parent Model and Messages']),
              h.pre(
                [],
                [
                  h.code(
                    [],
                    [
                      sourceSection('MODEL') +
                        '\n\n' +
                        sourceSection('MESSAGE'),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  )

// PANELS VIEW

const panelsView = (
  model: Examples.Model,
  h: HtmlBuilder<Examples.Message>,
): Html =>
  h.div(
    [],
    [
      h.p(
        [h.Class('gallery-intro')],
        [
          'A Schema defines the panel. Text, slider, toggle, select, color, pad, image, transition, action and folder controls share parent-owned values. Gallery edits stay separate from the card demo and are not persisted.',
        ],
      ),
      h.div(
        [
          h.Class('gallery-layouts'),
          h.Role('group'),
          h.AriaLabel('Panel layout'),
        ],
        Array.map(DialPanel.Layout.literals, layout =>
          h.keyed('button')(
            layout,
            [
              h.Type('button'),
              h.OnClick(Examples.Message.SelectedLayout({ layout })),
              h.AriaPressed(model.layout === layout ? 'true' : 'false'),
            ],
            [layout],
          ),
        ),
      ),
      h.p(
        [h.Class('gallery-keys')],
        [
          'Inline stays in the page. Floating has a draggable header. Section uses DialPanel.root as its shared floating shell.',
        ],
      ),
      h.div(
        [h.Class('gallery-panel-area')],
        [
          Examples.panelView(model, h),
          h.div(
            [h.Class('gallery-panel-result')],
            [
              h.h2([], ['Parent values']),
              h.p([], [model.panelValues.title]),
              h.p(
                [],
                [
                  `Size ${model.panelValues.size} · ${model.panelValues.alignment} · ${model.panelValues.enabled ? 'Enabled' : 'Disabled'}`,
                ],
              ),
              h.p(
                [h.Role('status')],
                [`Actions received: ${model.actionCount}`],
              ),
              h.pre(
                [],
                [h.code([], [JSON.stringify(model.panelValues, null, 2)])],
              ),
            ],
          ),
        ],
      ),
      snippet('PANEL DEFINITION', h),
      snippet('PANEL VIEW', h),
    ],
  )

// TIMELINE VIEW

const timelinePageView = (
  model: Examples.Model,
  h: HtmlBuilder<Examples.Message>,
): Html => {
  const { dot, fade } = Examples.ExampleDock.valuesOf(model.dock)
  return h.div(
    [h.Class('gallery-timeline-page')],
    [
      h.p(
        [h.Class('gallery-intro')],
        [
          'A separate timeline for exploring playback, seeking and clip editing. Select a bar to edit it; the original card entrance keeps its own timeline.',
        ],
      ),
      h.div(
        [
          h.Class('gallery-timeline-preview'),
          h.AriaLabel('Timeline animation preview'),
        ],
        [
          h.span([
            h.Class('gallery-dot'),
            h.Style({
              transform: `translateX(${dot.current.x}px) scale(${dot.current.scale})`,
              opacity: `${fade.current.opacity}`,
            }),
          ]),
        ],
      ),
      h.p(
        [h.Class('gallery-keys')],
        [
          'Playhead: ← → seek, Home / End jump · Bar: Enter opens editor, arrows nudge · Escape closes editor',
        ],
      ),
      snippet('TIMELINE DEFINITION', h),
      snippet('TIMELINE VIEW', h),
      h.details(
        [h.Class('gallery-source')],
        [
          h.summary([], ['Typed source · reflects your timeline edits']),
          h.pre([], [h.code([], [Examples.timelineSource(model)])]),
        ],
      ),
      Examples.timelineView(model, h),
    ],
  )
}

// VIEW

export const view = defineView<Examples.Model, Examples.Message>((model, h) =>
  h.main(
    [h.Class('gallery')],
    [
      h.header(
        [],
        [
          h.a([h.Href(homeRoute()), h.Class('gallery-back')], ['← Card demo']),
          h.h1([], ['Control gallery']),
          h.p(
            [h.Class('gallery-subtitle')],
            ['Live controls, small examples, ordinary Foldkit.'],
          ),
          h.nav(
            [h.AriaLabel('Gallery pages'), h.Class('gallery-tabs')],
            [
              h.a(
                [
                  h.Href(controlsRoute()),
                  h.AriaCurrent(model.page === 'Controls' ? 'page' : 'false'),
                ],
                ['Controls'],
              ),
              h.a(
                [
                  h.Href(panelsRoute()),
                  h.AriaCurrent(model.page === 'Panels' ? 'page' : 'false'),
                ],
                ['Panels'],
              ),
              h.a(
                [
                  h.Href(timelineRoute()),
                  h.AriaCurrent(model.page === 'Timeline' ? 'page' : 'false'),
                ],
                ['Timeline'],
              ),
            ],
          ),
        ],
      ),
      Match.value(model.page).pipe(
        Match.when('Controls', () => controlsView(model, h)),
        Match.when('Panels', () => panelsView(model, h)),
        Match.when('Timeline', () => timelinePageView(model, h)),
        Match.exhaustive,
      ),
    ],
  ),
)
