import { Option, Predicate, Record } from 'effect'
import { type Html } from 'foldkit/html'

import * as ColorField from '../../colorField/index.js'
import * as ColorPicker from '../../colorPicker/index.js'
import { type LeafControl, getAtPath, pathKey } from '../../dial/index.js'
import { segmented } from '../../internal/segmented.js'
import { themeAttribute } from '../../internal/theme.js'
import { Message } from '../message.js'
import { type Context } from './shared.js'

const COLOR_ANCHOR = { placement: 'left-start', gap: 8, padding: 8 } as const

const INVALID_COLOR_TEXT = 'Not a valid color'

const colorFormatGroupView = segmented(ColorPicker.colorFormatLabel, {
  group: 'dialkit-color-formats',
  option: 'dialkit-color-format',
})

const colorErrorView = (
  context: Context,
  attributes: ColorPicker.ColorPickerAttributes['error'],
): Html => {
  const { h } = context
  return h.span(
    [...attributes, h.Class('fkd-color-error')],
    [INVALID_COLOR_TEXT],
  )
}

const colorPickerView = (
  context: Context,
  render: ColorPicker.RenderInfo,
): Html => {
  const { h } = context
  const { attributes, colors, formatGroup, isRejected } = render
  return h.div(
    [...attributes.root, h.Class('fkd-color-picker')],
    [
      h.div(
        [
          ...attributes.area,
          h.Class('dialkit-color-plane fkd-color-plane'),
          h.Style({
            '--fkd-area-neutral': colors.areaNeutralGradient,
            '--fkd-area-edge': colors.areaEdgeGradient,
          }),
        ],
        [
          h.span([
            ...attributes.areaThumb,
            h.Class('dialkit-color-marker fkd-color-thumb'),
          ]),
        ],
      ),
      h.div(
        [h.Class('dialkit-color-tracks')],
        [
          h.div(
            [h.Class('dialkit-color-track-row')],
            [
              h.span([], ['Hue']),
              h.div(
                [
                  ...attributes.hueTrack,
                  h.Class('fkd-color-track'),
                  h.Style({ '--fkd-track': colors.hueTrackGradient }),
                ],
                [h.span([...attributes.hueThumb, h.Class('fkd-color-thumb')])],
              ),
            ],
          ),
          h.div(
            [h.Class('dialkit-color-track-row')],
            [
              h.span([], ['Opacity']),
              h.div(
                [
                  ...attributes.alphaTrack,
                  h.Class('fkd-color-track fkd-color-track-alpha'),
                  h.Style({ '--fkd-track': colors.alphaTrackGradient }),
                ],
                [
                  h.span([
                    ...attributes.alphaThumb,
                    h.Class('fkd-color-thumb'),
                  ]),
                ],
              ),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class('dialkit-labeled-control dialkit-color-format-row')],
        [
          h.span([h.Class('dialkit-labeled-control-label')], ['Format']),
          formatGroup,
        ],
      ),
      h.input([...attributes.textInput, h.Class('dialkit-color-css-input')]),
      ...(isRejected ? [colorErrorView(context, attributes.error)] : []),
    ],
  )
}

/** Renders a color field and its anchored picker. */
export const colorView = (context: Context, leaf: LeafControl): Html => {
  const { h, model, values, theme } = context
  const key = pathKey(leaf.path)
  const current = getAtPath(values, leaf.path)
  const value = Predicate.isString(current) ? current : ''

  return Option.match(Record.get(model.colors, key), {
    onNone: () => h.empty,
    onSome: colorModel =>
      h.submodel({
        slotId: `color-${key}`,
        model: colorModel,
        view: ColorField.view,
        toParentMessage: message =>
          Message.GotColorMessage({ dialId: key, message }),
        viewInputs: {
          value,
          label: leaf.label,
          anchor: COLOR_ANCHOR,
          toPickerView: render => colorPickerView(context, render),
          toFormatGroupView: colorFormatGroupView,
          toView: ({ attributes, picker, isOpen, isRejected }) =>
            h.div(
              [...attributes.root, h.Class('dialkit-color-control')],
              [
                h.span(
                  [...attributes.label, h.Class('dialkit-color-label')],
                  [leaf.label],
                ),
                h.div(
                  [h.Class('dialkit-color-inputs')],
                  [
                    h.input([
                      ...attributes.valueInput,
                      h.Class('dialkit-color-value'),
                    ]),
                    h.button([
                      ...attributes.swatch,
                      h.Class('dialkit-color-swatch'),
                      h.Style({ '--dial-color': value }),
                    ]),
                  ],
                ),
                ...(isRejected
                  ? [colorErrorView(context, attributes.error)]
                  : []),
                ...(isOpen
                  ? [
                      h.div([
                        ...attributes.backdrop,
                        h.Class('fkd-image-backdrop'),
                      ]),
                      h.div(
                        [
                          ...attributes.panel,
                          h.Class('dialkit-root dialkit-color-popover'),
                          h.DataAttribute('theme', themeAttribute(theme)),
                        ],
                        [picker],
                      ),
                    ]
                  : []),
              ],
            ),
        },
      }),
  })
}
