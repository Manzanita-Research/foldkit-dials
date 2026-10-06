import { Array, Option } from 'effect'
import { type Html, inertHtml } from 'foldkit/html'

import type { RadioGroup } from '@foldkit/ui'

/** Extra classes for `segmented`, added after DialKit's segmented classes on
 *  the group and on each option. */
export type SegmentedClasses = Readonly<{
  group?: string
  option?: string
}>

const withExtraClass = (base: string, extra: string | undefined): string =>
  extra === undefined ? base : `${base} ${extra}`

/** Renders a RadioGroup as DialKit's segmented control, for use as its
 *  `toView`: equal buttons, keyed by value, with a pill behind the selected
 *  one. Each option's label is a span carrying the RadioGroup's label
 *  attributes, so the option's `aria-labelledby` resolves. Style the
 *  selected button by the RadioGroup's `data-checked` marker; its
 *  `data-active` marks the keyboard focus cursor. */
export const segmented =
  <Value extends string>(
    labelOf: (value: Value) => string,
    classes: SegmentedClasses = {},
  ) =>
  ({ group, options }: RadioGroup.RenderInfo<Value>): Html => {
    const count = options.length
    const selectedIndex = Option.getOrElse(
      Array.findFirstIndex(options, ({ isSelected }) => isSelected),
      () => 0,
    )
    return inertHtml.div(
      [
        ...group,
        inertHtml.Class(
          withExtraClass('dialkit-segmented fkd-segmented', classes.group),
        ),
      ],
      [
        inertHtml.div([
          inertHtml.Class('dialkit-segmented-pill'),
          inertHtml.AriaHidden(true),
          inertHtml.Style({
            left: `calc(2px + (100% - 4px) * ${selectedIndex / count})`,
            width: `calc((100% - 4px) / ${count})`,
          }),
        ]),
        ...Array.map(options, ({ value, option, label }) =>
          inertHtml.keyed('button')(
            value,
            [
              ...option,
              inertHtml.Class(
                withExtraClass('dialkit-segmented-button', classes.option),
              ),
            ],
            [inertHtml.span([...label], [labelOf(value)])],
          ),
        ),
      ],
    )
  }
