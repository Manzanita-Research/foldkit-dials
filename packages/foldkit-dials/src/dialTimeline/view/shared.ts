import { Array, Number } from 'effect'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { Button } from '@foldkit/ui'

import { ICON_CHEVRON, strokeIcon } from '../../internal/icons.js'
import { PERCENT } from '../../internal/range.js'
import type { Message } from '../message.js'

// VIEW

/** Decimals kept in percentage positions, so bars line up at any zoom. */
export const PERCENT_DECIMALS = 4
const CHEVRON_STROKE_WIDTH = '2.5'

/** Formats a fraction as a CSS percentage. */
export const percent = (fraction: number): string =>
  `${Number.round(fraction * PERCENT, PERCENT_DECIMALS)}%`

/** `count` consecutive indices, starting at `first`. */
export const indicesFrom = (
  first: number,
  count: number,
): ReadonlyArray<number> =>
  count > 0 ? Array.makeBy(count, offset => first + offset) : []

/** The chevron the dock's toggles rotate. */
export const chevronIcon = (h: HtmlBuilder<Message>): Html =>
  strokeIcon(ICON_CHEVRON, '', h, CHEVRON_STROKE_WIDTH)

/** An icon-only toolbar button, through @foldkit/ui Button. The label names
 *  it for assistive technology and shows as its tooltip. */
export const iconButton = (
  h: HtmlBuilder<Message>,
  config: Readonly<{
    className: string
    label: string
    icon: Html
    onClick: Message
    attributes?: ReadonlyArray<Attribute<Message>>
  }>,
): Html =>
  Button.view(
    {
      onClick: config.onClick,
      toView: ({ button }) =>
        h.button(
          [
            ...button,
            h.Class(config.className),
            h.AriaLabel(config.label),
            h.Title(config.label),
            ...(config.attributes ?? []),
          ],
          [config.icon],
        ),
    },
    h,
  )
