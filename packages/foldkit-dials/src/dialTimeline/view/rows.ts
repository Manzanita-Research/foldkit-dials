import { Array, Equal, Option } from 'effect'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { Disclosure } from '@foldkit/ui'

import { formatLabel } from '../../dial/index.js'
import * as Timeline from '../../timeline/index.js'
import type { ViewWindow } from '../geometry.js'
import { groupDisclosureId, tracksDisclosureId } from '../ids.js'
import { Message } from '../message.js'
import { BarRow, type Model } from '../model.js'
import { type BarKind, barView } from './bars.js'
import { chevronIcon } from './shared.js'

// VIEW

const barKindOf = (clip: Timeline.Clip): BarKind =>
  Timeline.Clip.match<BarKind>(clip, {
    Marker: () => 'Single',
    Tween: () => 'Single',
    Sequence: () => 'Steps',
    Tracks: () => 'Composite',
  })

const groupedAttribute = (
  clipStatic: Timeline.ClipStatic,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Attribute<Message>> =>
  Option.isSome(clipStatic.maybeGroup) ? [h.DataAttribute('grouped', '')] : []

const trackRowsView = (
  model: Model,
  viewWindow: ViewWindow,
  clipStatic: Timeline.ClipStatic,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Array.getSomes(
    Array.map(clipStatic.tracks, track =>
      Option.map(track.maybeProp, prop => {
        const isSequence = Option.exists(
          Timeline.trackOf(clipStatic.clip, prop),
          ({ _tag }) => _tag === 'Sequence',
        )
        const label = formatLabel(prop)
        return h.keyed('div')(
          `track-${clipStatic.key}-${prop}`,
          [
            h.Class('dialkit-timeline-row dialkit-timeline-track-row'),
            ...groupedAttribute(clipStatic, h),
          ],
          [
            h.div([h.Class('dialkit-timeline-label')], [label]),
            h.div(
              [h.Class('dialkit-timeline-lane')],
              barView(
                model,
                viewWindow,
                {
                  row: BarRow.Track({ key: clipStatic.key, prop }),
                  label: `${formatLabel(clipStatic.name)} ${label}`,
                  start: clipStatic.at + track.delay,
                  duration: track.duration,
                  loop: clipStatic.loop,
                  kind: isSequence ? 'Steps' : 'Single',
                  steps: isSequence ? track.steps : [],
                  isPhysics:
                    !isSequence && Array.headNonEmpty(track.steps).isPhysics,
                  isExpanded: false,
                },
                h,
              ),
            ),
          ],
        )
      }),
    ),
  )

const clipRowView = (
  model: Model,
  viewWindow: ViewWindow,
  clipStatic: Timeline.ClipStatic,
  isExpanded: boolean,
  labelPrefix: ReadonlyArray<Html>,
  h: HtmlBuilder<Message>,
): Html => {
  const kind = barKindOf(clipStatic.clip)
  const label = formatLabel(clipStatic.name)

  return h.div(
    [h.Class('dialkit-timeline-row'), ...groupedAttribute(clipStatic, h)],
    [
      h.div([h.Class('dialkit-timeline-label')], [...labelPrefix, label]),
      h.div(
        [h.Class('dialkit-timeline-lane')],
        barView(
          model,
          viewWindow,
          {
            row: BarRow.Clip({ key: clipStatic.key }),
            label,
            start: clipStatic.at,
            duration: clipStatic.duration,
            loop: clipStatic.loop,
            kind,
            steps:
              kind === 'Steps'
                ? Array.flatMap(clipStatic.tracks, ({ steps }) => steps)
                : [],
            isPhysics: clipStatic.isPhysics,
            isExpanded,
          },
          h,
        ),
      ),
    ],
  )
}

const tracksClipView = (
  model: Model,
  viewWindow: ViewWindow,
  clipStatic: Timeline.ClipStatic,
  h: HtmlBuilder<Message>,
): Html => {
  const isExpanded = Array.contains(model.expandedClips, clipStatic.key)
  const label = formatLabel(clipStatic.name)

  return Disclosure.view(
    {
      id: tracksDisclosureId(model.id, clipStatic.key),
      isOpen: isExpanded,
      onToggle: isOpen =>
        Message.ToggledTracks({ key: clipStatic.key, isOpen }),
      ariaLabel: `${label} properties`,
      toView: ({ button, panel }) =>
        h.keyed('div')(
          `clip-${clipStatic.key}`,
          [h.Class('fkd-timeline-rows')],
          [
            clipRowView(
              model,
              viewWindow,
              clipStatic,
              isExpanded,
              [
                h.button(
                  [
                    ...button,
                    h.Class('dialkit-timeline-group-toggle'),
                    h.Title(
                      isExpanded ? 'Collapse properties' : 'Expand properties',
                    ),
                  ],
                  [chevronIcon(h)],
                ),
              ],
              h,
            ),
            ...(isExpanded
              ? [
                  h.div(
                    [...panel, h.Class('fkd-timeline-rows')],
                    trackRowsView(model, viewWindow, clipStatic, h),
                  ),
                ]
              : []),
          ],
        ),
    },
    h,
  )
}

const clipRowsView = (
  model: Model,
  viewWindow: ViewWindow,
  clipStatic: Timeline.ClipStatic,
  h: HtmlBuilder<Message>,
): Html =>
  clipStatic.clip._tag === 'Tracks'
    ? tracksClipView(model, viewWindow, clipStatic, h)
    : h.keyed('div')(
        `clip-${clipStatic.key}`,
        [h.Class('fkd-timeline-rows')],
        [clipRowView(model, viewWindow, clipStatic, false, [], h)],
      )

const groupRowsView = (
  model: Model,
  viewWindow: ViewWindow,
  group: string,
  clips: ReadonlyArray<Timeline.ClipStatic>,
  h: HtmlBuilder<Message>,
): Html => {
  const isOpen = !Array.contains(model.collapsedGroups, group)
  const label = formatLabel(group)

  return Disclosure.view(
    {
      id: groupDisclosureId(model.id, group),
      isOpen,
      onToggle: nextIsOpen =>
        Message.ToggledGroup({ group, isOpen: nextIsOpen }),
      ariaLabel: label,
      toView: ({ button, panel }) =>
        h.keyed('div')(
          `group-${group}`,
          [h.Class('fkd-timeline-rows')],
          [
            h.div(
              [h.Class('dialkit-timeline-row dialkit-timeline-group-row')],
              [
                h.div(
                  [h.Class('dialkit-timeline-label')],
                  [
                    h.button(
                      [
                        ...button,
                        h.Class('dialkit-timeline-group-toggle'),
                        h.Title(isOpen ? 'Collapse layer' : 'Expand layer'),
                      ],
                      [chevronIcon(h)],
                    ),
                    h.span([], [label]),
                  ],
                ),
                h.div([h.Class('dialkit-timeline-lane')]),
              ],
            ),
            ...(isOpen
              ? [
                  h.div(
                    [...panel, h.Class('fkd-timeline-rows')],
                    Array.map(clips, clipStatic =>
                      clipRowsView(model, viewWindow, clipStatic, h),
                    ),
                  ),
                ]
              : []),
          ],
        ),
    },
    h,
  )
}

/** Renders one row per clip. Groups and the property tracks of props
 *  clips render as Disclosures. */
export const rowsView = (
  model: Model,
  viewWindow: ViewWindow,
  clips: ReadonlyArray<Timeline.ClipStatic>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Array.match(clips, {
    onEmpty: (): ReadonlyArray<Html> => [],
    onNonEmpty: nonEmptyClips =>
      Array.flatMap(
        Array.groupWith(nonEmptyClips, (left, right) =>
          Equal.equals(left.maybeGroup, right.maybeGroup),
        ),
        groupClips =>
          Option.match(Array.headNonEmpty(groupClips).maybeGroup, {
            onNone: () =>
              Array.map(groupClips, clipStatic =>
                clipRowsView(model, viewWindow, clipStatic, h),
              ),
            onSome: group => [
              groupRowsView(model, viewWindow, group, groupClips, h),
            ],
          }),
      ),
  })
