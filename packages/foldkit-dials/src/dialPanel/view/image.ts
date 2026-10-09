import { Array, Option, Predicate, Record, String } from 'effect'
import { type Html } from 'foldkit/html'

import { type LeafControl, getAtPath, pathKey } from '../../dial/index.js'
import * as ImagePicker from '../../imagePicker/index.js'
import { themeAttribute } from '../../internal/theme.js'
import { Message } from '../message.js'
import { type Context } from './shared.js'

const IMAGE_ANCHOR = { placement: 'left-start', gap: 8, padding: 8 } as const

const imageFrame = (
  context: Context,
  value: string,
  className: string,
): Html => {
  const { h } = context
  return h.span(
    [h.Class(`dialkit-image-frame ${className}`)],
    String.isEmpty(value)
      ? [h.span([h.Class('dialkit-image-fallback')], [])]
      : [
          h.img([
            h.Class('dialkit-image-img'),
            h.Src(value),
            h.Alt(''),
            h.Draggable(false),
          ]),
        ],
  )
}

const imageGridView = (
  context: Context,
  { attributes, choices }: ImagePicker.RenderInfo,
): Html => {
  const { h } = context
  return Array.match(choices, {
    onEmpty: () =>
      h.div(
        [h.Class('dialkit-image-empty')],
        ['Choose an image to get started.'],
      ),
    onNonEmpty: nonEmptyChoices =>
      h.div(
        [...attributes.grid, h.Class('dialkit-image-grid')],
        Array.map(nonEmptyChoices, choice =>
          h.keyed('button')(
            choice.value,
            [...choice.option, h.Class('dialkit-image-option')],
            [imageFrame(context, choice.value, 'dialkit-image-option-preview')],
          ),
        ),
      ),
  })
}

const imageUploadView = (
  context: Context,
  { attributes, isReading }: ImagePicker.RenderInfo,
): Html => {
  const { h } = context
  return h.label(
    [...attributes.upload, h.Class('dialkit-button dialkit-image-upload')],
    [
      h.span([], [isReading ? 'Reading image…' : 'Upload image']),
      h.input([...attributes.fileInput, h.Class('fkd-visually-hidden')]),
    ],
  )
}

const imagePopoverView = (
  context: Context,
  leaf: LeafControl,
  render: ImagePicker.RenderInfo,
): ReadonlyArray<Html> => {
  const { h, theme } = context
  const { attributes, maybeUploadFailure } = render
  return [
    h.div([...attributes.backdrop, h.Class('fkd-image-backdrop')]),
    h.div(
      [
        ...attributes.panel,
        h.Class('dialkit-root dialkit-image-popover'),
        h.DataAttribute('theme', themeAttribute(theme)),
      ],
      [
        h.div(
          [h.Class('dialkit-image-heading')],
          [
            h.span([h.Class('dialkit-image-title')], [leaf.label]),
            h.button(
              [...attributes.remove, h.Class('dialkit-image-clear')],
              ['Remove'],
            ),
          ],
        ),
        imageGridView(context, render),
        imageUploadView(context, render),
        h.div(
          [...attributes.status, h.Class('dialkit-image-status')],
          [
            Option.match(maybeUploadFailure, {
              onNone: () => '',
              onSome: ImagePicker.uploadFailureText,
            }),
          ],
        ),
      ],
    ),
  ]
}

/** Renders an image control and its anchored picker. */
export const imageView = (context: Context, leaf: LeafControl): Html => {
  const { h, model, values } = context
  const key = pathKey(leaf.path)
  const current = getAtPath(values, leaf.path)
  const value = Predicate.isString(current) ? current : ''

  return Option.match(Record.get(model.images, key), {
    onNone: () => h.empty,
    onSome: imageModel =>
      h.submodel({
        slotId: `image-${key}`,
        model: imageModel,
        view: ImagePicker.view,
        toParentMessage: message =>
          Message.GotImageMessage({ dialId: key, message }),
        viewInputs: {
          value,
          label: leaf.label,
          anchor: IMAGE_ANCHOR,
          toView: render =>
            h.div(
              [...render.attributes.root, h.Class('fkd-image-root')],
              [
                h.button(
                  [
                    ...render.attributes.trigger,
                    h.Class('dialkit-image-control'),
                  ],
                  [
                    h.span([h.Class('dialkit-image-label')], [leaf.label]),
                    h.span(
                      [h.Class('dialkit-image-value')],
                      [render.valueLabel],
                    ),
                    imageFrame(context, value, 'dialkit-image-thumbnail'),
                  ],
                ),
                ...(render.isVisible
                  ? imagePopoverView(context, leaf, render)
                  : []),
              ],
            ),
        },
      }),
  })
}
