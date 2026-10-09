import { Array, Option, Record, pipe } from 'effect'

import { type TimelineClip } from './model.js'

/** The path a clip's values live at: `name`, or `group.name` inside a
 *  group. */
export const clipKey = ({ name, maybeGroup }: TimelineClip): string =>
  Option.match(maybeGroup, {
    onNone: () => name,
    onSome: groupName => `${groupName}.${name}`,
  })

type NamedClip = Readonly<{ name: string; maybeGroup: Option.Option<string> }>

const groupNamesOf = (items: ReadonlyArray<NamedClip>): ReadonlyArray<string> =>
  Array.dedupe(Array.getSomes(Array.map(items, ({ maybeGroup }) => maybeGroup)))

/** Keys each item by its name, with grouped items nested under their
 *  group's name. `wrapGroup` shapes the record of one group. Ungrouped
 *  items come first, then groups in order of appearance. */
export const nestByGroup = <Item extends NamedClip>(
  items: ReadonlyArray<Item>,
  toValue: (item: Item) => unknown,
  wrapGroup: (clips: Readonly<Record<string, unknown>>) => unknown,
): Readonly<Record<string, unknown>> => {
  const entryOf = (item: Item): readonly [string, unknown] => [
    item.name,
    toValue(item),
  ]
  const ungrouped = pipe(
    items,
    Array.filter(({ maybeGroup }) => Option.isNone(maybeGroup)),
    Array.map(entryOf),
  )
  const grouped = Array.map(
    groupNamesOf(items),
    (groupName): readonly [string, unknown] => [
      groupName,
      wrapGroup(
        pipe(
          items,
          Array.filter(({ maybeGroup }) =>
            Option.contains(maybeGroup, groupName),
          ),
          Array.map(entryOf),
          Record.fromEntries,
        ),
      ),
    ],
  )

  return Record.fromEntries([...ungrouped, ...grouped])
}
