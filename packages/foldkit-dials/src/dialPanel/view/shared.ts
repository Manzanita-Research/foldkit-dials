import { Array, Option, pipe } from 'effect'
import { type Html, type HtmlBuilder } from 'foldkit/html'

import { Button, Disclosure } from '@foldkit/ui'

import { ICON_CHEVRON, strokeIcon } from '../../internal/icons.js'
import { Message } from '../message.js'
import { type Model, type Theme, isFolderOpen } from '../model.js'
import {
  type ShortcutTarget,
  findShortcutTarget,
  formatShortcutBadge,
} from '../shortcuts.js'
import { type PanelSpec, controlId } from '../spec.js'

/** The panel inputs and builder shared by one render. */
export type Context = Readonly<{
  spec: PanelSpec
  model: Model
  values: unknown
  theme: Theme
  h: HtmlBuilder<Message>
}>

const heldTarget = (
  context: Context,
  key: string,
): Option.Option<ShortcutTarget> =>
  pipe(
    context.model.heldShortcutKeys,
    Array.findFirst(heldKey =>
      findShortcutTarget(
        context.spec.shortcutTargets,
        heldKey,
        context.model.maybeShortcutModifier,
      ),
    ),
    Option.filter(target => target.key === key),
  )

/** The shortcut badge for a control, including its held state. */
export const shortcutPill = (
  context: Context,
  key: string,
): ReadonlyArray<Html> => {
  const { h } = context
  return Array.fromOption(
    Option.map(
      Array.findFirst(
        context.spec.shortcutTargets,
        target => target.key === key,
      ),
      target =>
        h.span(
          [
            h.Class(
              Option.isSome(heldTarget(context, key))
                ? 'dialkit-shortcut-pill dialkit-shortcut-pill-active'
                : 'dialkit-shortcut-pill',
            ),
          ],
          [formatShortcutBadge(target)],
        ),
    ),
  )
}

/** A button that shows only an icon, named by `label`. */
export const iconButton = (
  h: HtmlBuilder<Message>,
  config: Readonly<{
    className: string
    label: string
    icon: string | ReadonlyArray<string>
    onClick: Message
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
            h.Title(config.label),
            h.AriaLabel(config.label),
          ],
          [strokeIcon(config.icon, '', h)],
        ),
    },
    h,
  )

/** DialKit's folder: a Disclosure header with the label and a chevron, and
 *  an animated panel holding `content`. Folders and spring editors share
 *  it. */
export const folderShellView = (
  context: Context,
  config: Readonly<{
    key: string
    label: string
    content: ReadonlyArray<Html>
  }>,
): Html => {
  const { h, spec, model } = context
  const isOpen = isFolderOpen(spec, model, config.key)
  return Disclosure.view(
    {
      id: controlId(spec, config.key),
      isOpen,
      onToggle: nextIsOpen =>
        Message.ToggledFolder({ dialId: config.key, isOpen: nextIsOpen }),
      toView: ({ button, panel, animatePanel }) =>
        h.div(
          [
            h.Class('dialkit-folder'),
            h.DataAttribute('open', isOpen ? 'true' : 'false'),
          ],
          [
            h.div(
              [h.Class('dialkit-folder-header')],
              [
                h.button(
                  [
                    ...button,
                    h.Class('dialkit-folder-header-top fkd-reset-button'),
                  ],
                  [
                    h.span(
                      [h.Class('dialkit-folder-title-row')],
                      [
                        h.span(
                          [h.Class('dialkit-folder-title')],
                          [config.label],
                        ),
                      ],
                    ),
                    strokeIcon(
                      ICON_CHEVRON,
                      isOpen
                        ? 'dialkit-folder-icon fkd-open'
                        : 'dialkit-folder-icon',
                      h,
                    ),
                  ],
                ),
              ],
            ),
            animatePanel(
              h.div(
                [...panel, h.Class('dialkit-folder-content')],
                [h.div([h.Class('dialkit-folder-inner')], config.content)],
              ),
            ),
          ],
        ),
    },
    h,
  )
}
