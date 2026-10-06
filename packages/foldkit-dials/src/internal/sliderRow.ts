import { Array } from 'effect'
import { type Html, inertHtml } from 'foldkit/html'

import type { RenderInfo } from '../scrubSlider/index.js'

const HASHMARK_COUNT = 9
const HASHMARK_SPACING_PERCENT = 10

/** Configuration for `sliderRow`. */
export type SliderRowConfig = Readonly<{
  label: string
  /** Shows DialKit's tick marks behind the fill. */
  hasHashmarks?: boolean
  /** Elements after the label, such as a shortcut badge. */
  labelExtras?: ReadonlyArray<Html>
}>

const hashmarks = inertHtml.div(
  [inertHtml.Class('dialkit-slider-hashmarks')],
  Array.makeBy(HASHMARK_COUNT, index =>
    inertHtml.div([
      inertHtml.Class('dialkit-slider-hashmark'),
      inertHtml.Style({ left: `${(index + 1) * HASHMARK_SPACING_PERCENT}%` }),
    ]),
  ),
)

/** Renders a ScrubSlider as DialKit's slider row, for use as its `toView`.
 *  The value text and its editor render beside the track rather than inside
 *  it, so the track's slider role never contains a text field and a press on
 *  the value opens the editor without scrubbing. */
export const sliderRow =
  (config: SliderRowConfig) =>
  ({ attributes, formattedValue, isDragging, isEditing }: RenderInfo): Html =>
    inertHtml.div(
      [...attributes.root, inertHtml.Class('dialkit-slider-wrapper')],
      [
        inertHtml.div(
          [
            ...attributes.track,
            inertHtml.Class(
              isDragging
                ? 'dialkit-slider dialkit-slider-active'
                : 'dialkit-slider',
            ),
          ],
          [
            ...(config.hasHashmarks ? [hashmarks] : []),
            inertHtml.div([
              ...attributes.fill,
              inertHtml.Class('dialkit-slider-fill'),
            ]),
            inertHtml.div([
              ...attributes.handle,
              inertHtml.Class('dialkit-slider-handle fkd-slider-handle'),
            ]),
            inertHtml.span(
              [inertHtml.Class('dialkit-slider-label')],
              [
                inertHtml.span([...attributes.label], [config.label]),
                ...(config.labelExtras ?? []),
              ],
            ),
          ],
        ),
        isEditing
          ? inertHtml.input([
              ...attributes.editor,
              inertHtml.Class('dialkit-slider-input'),
            ])
          : inertHtml.span(
              [...attributes.value, inertHtml.Class('dialkit-slider-value')],
              [formattedValue],
            ),
      ],
    )
