import { Array, Match, Option } from 'effect'
import {
  type Attribute,
  type ChildAttribute,
  type Html,
  type HtmlBuilder,
} from 'foldkit/html'

import { Button, Popover } from '@foldkit/ui'

import {
  ICON_CHECK,
  ICON_CHEVRON,
  ICON_CLIPBOARD,
  ICON_CLOSE,
  ICON_COMPARE,
  ICON_KEYBOARD,
  ICON_PLUS,
  ICON_RESET,
  ICON_TRASH,
  strokeIcon,
} from '../../internal/icons.js'
import { themeAttribute } from '../../internal/theme.js'
import { Message } from '../message.js'
import { type CopyStatus, activeVersionName } from '../model.js'
import {
  type ShortcutTarget,
  formatShortcutBadge,
  formatTargetMode,
} from '../shortcuts.js'
import { type PanelSpec } from '../spec.js'
import { BASE_VERSION_ID, type Version, findVersion } from '../versions.js'
import { type Context, iconButton } from './shared.js'

const MENU_ANCHOR = { placement: 'bottom-start', gap: 6, padding: 8 } as const

// TOOLBAR

const menuPanel = (
  context: Context,
  attributes: ReadonlyArray<Attribute<Message> | ChildAttribute>,
  className: string,
  children: ReadonlyArray<Html>,
): Html => {
  const { h, theme } = context
  return h.div(
    [
      ...attributes,
      h.Class(`dialkit-root ${className}`),
      h.DataAttribute('theme', themeAttribute(theme)),
    ],
    children,
  )
}

const menuActionButton = (
  h: HtmlBuilder<Message>,
  config: Readonly<{ icon: string; label: string; onClick: Message }>,
): Html =>
  Button.view(
    {
      onClick: config.onClick,
      toView: ({ button }) =>
        h.button(
          [...button, h.Class('dialkit-preset-create')],
          [strokeIcon(config.icon, 'dialkit-preset-check', h), config.label],
        ),
    },
    h,
  )

const versionRow = (context: Context, version: Version): Html => {
  const { h, model } = context
  const isActive = version.id === model.activeVersionId
  return h.keyed('li')(
    version.id,
    [
      h.Class('dialkit-preset-item'),
      h.DataAttribute('active', isActive ? 'true' : 'false'),
    ],
    [
      strokeIcon(isActive ? ICON_CHECK : '', 'dialkit-preset-check', h),
      Button.view(
        {
          onClick: Message.ClickedVersion({ versionId: version.id }),
          toView: ({ button }) =>
            h.button(
              [
                ...button,
                h.Class('dialkit-preset-name'),
                ...(isActive ? [h.AriaCurrent('true')] : []),
              ],
              [version.name],
            ),
        },
        h,
      ),
      ...(isActive
        ? []
        : [
            iconButton(h, {
              className: 'dialkit-preset-delete fkd-compare-button',
              label: `Compare with ${version.name}`,
              icon: ICON_COMPARE,
              onClick: Message.ClickedCompareVersion({ versionId: version.id }),
            }),
          ]),
      ...(version.id === BASE_VERSION_ID
        ? []
        : [
            iconButton(h, {
              className: 'dialkit-preset-delete',
              label: `Delete ${version.name}`,
              icon: ICON_TRASH,
              onClick: Message.ClickedDeleteVersion({ versionId: version.id }),
            }),
          ]),
    ],
  )
}

const versionMenuContent = (context: Context): ReadonlyArray<Html> => {
  const { h, model } = context
  return [
    h.ul(
      [h.Class('dialkit-preset-list')],
      Array.map(model.versions, version => versionRow(context, version)),
    ),
    menuActionButton(h, {
      icon: ICON_PLUS,
      label: 'New version',
      onClick: Message.ClickedSaveVersion(),
    }),
    menuActionButton(h, {
      icon: ICON_RESET,
      label: 'Reset to defaults',
      onClick: Message.ClickedResetValues(),
    }),
  ]
}

const versionMenuView = (context: Context): Html => {
  const { h, model } = context
  const versionName = activeVersionName(model)
  return h.submodel({
    slotId: 'version-menu',
    model: model.versionMenu,
    view: Popover.view,
    toParentMessage: message => Message.GotVersionMenuMessage({ message }),
    viewInputs: {
      anchor: MENU_ANCHOR,
      ariaLabel: `Versions: ${versionName}`,
      toView: ({ button, panel, isVisible }) =>
        h.div(
          [h.Class('dialkit-preset-manager')],
          [
            h.button(
              [
                ...button,
                h.Class('dialkit-preset-trigger'),
                h.DataAttribute(
                  'open',
                  model.versionMenu.isOpen ? 'true' : 'false',
                ),
              ],
              [
                h.span([h.Class('dialkit-preset-label')], [versionName]),
                strokeIcon(ICON_CHEVRON, 'dialkit-select-chevron', h),
              ],
            ),
            ...(isVisible
              ? [
                  menuPanel(
                    context,
                    panel,
                    'dialkit-preset-dropdown',
                    versionMenuContent(context),
                  ),
                ]
              : []),
          ],
        ),
    },
  })
}

const shortcutRow = (h: HtmlBuilder<Message>, target: ShortcutTarget): Html =>
  h.keyed('li')(
    target.key,
    [h.Class('dialkit-shortcuts-row')],
    [
      h.span(
        [h.Class('dialkit-shortcuts-row-key')],
        [formatShortcutBadge(target)],
      ),
      h.span([h.Class('dialkit-shortcuts-row-label')], [target.label]),
      h.span(
        [h.Class('dialkit-shortcuts-row-mode')],
        [formatTargetMode(target)],
      ),
    ],
  )

const shortcutsTitleId = (spec: PanelSpec): string =>
  `${spec.id}-shortcuts-title`

const shortcutsMenuContent = (
  context: Context,
  targets: ReadonlyArray<ShortcutTarget>,
): ReadonlyArray<Html> => {
  const { h, spec } = context
  return [
    h.div(
      [h.Id(shortcutsTitleId(spec)), h.Class('dialkit-shortcuts-title')],
      ['Keyboard Shortcuts'],
    ),
    h.ul(
      [h.Class('dialkit-shortcuts-list')],
      Array.map(targets, target => shortcutRow(h, target)),
    ),
    h.div(
      [h.Class('dialkit-shortcuts-hint')],
      ['See pill badges on controls for keys'],
    ),
  ]
}

const shortcutsMenuView = (context: Context): ReadonlyArray<Html> => {
  const { h, model, spec } = context
  return Array.match(spec.shortcutTargets, {
    onEmpty: () => [],
    onNonEmpty: targets => [
      h.submodel({
        slotId: 'shortcuts-menu',
        model: model.shortcutsMenu,
        view: Popover.view,
        toParentMessage: message =>
          Message.GotShortcutsMenuMessage({ message }),
        viewInputs: {
          anchor: MENU_ANCHOR,
          ariaLabel: 'Keyboard shortcuts',
          toView: ({ button, panel, isVisible }) =>
            h.div(
              [h.Class('fkd-shortcuts-menu')],
              [
                h.button(
                  [
                    ...button,
                    h.Class('dialkit-shortcuts-trigger'),
                    h.Title('Keyboard shortcuts'),
                  ],
                  [strokeIcon(ICON_KEYBOARD, '', h)],
                ),
                ...(isVisible
                  ? [
                      menuPanel(
                        context,
                        [...panel, h.AriaLabelledBy(shortcutsTitleId(spec))],
                        'dialkit-shortcuts-dropdown',
                        shortcutsMenuContent(context, targets),
                      ),
                    ]
                  : []),
              ],
            ),
        },
      }),
    ],
  })
}

const copyIcon = (copyStatus: CopyStatus): string | ReadonlyArray<string> =>
  Match.value(copyStatus).pipe(
    Match.withReturnType<string | ReadonlyArray<string>>(),
    Match.when('Idle', () => ICON_CLIPBOARD),
    Match.when('Copied', () => ICON_CHECK),
    Match.when('Failed', () => ICON_CLOSE),
    Match.exhaustive,
  )

const copyStatusText = (copyStatus: CopyStatus): string =>
  Match.value(copyStatus).pipe(
    Match.withReturnType<string>(),
    Match.when('Idle', () => ''),
    Match.when('Copied', () => 'Copied'),
    Match.when('Failed', () => 'Copy failed'),
    Match.exhaustive,
  )

/** Renders the panel's version, copy and shortcut actions. */
export const toolbarView = (context: Context): Html => {
  const { h, model } = context
  return h.div(
    [h.Class('dialkit-panel-toolbar')],
    [
      versionMenuView(context),
      ...shortcutsMenuView(context),
      iconButton(h, {
        className: 'dialkit-toolbar-add dialkit-toolbar-primary',
        label: 'Copy as dial Schema',
        icon: copyIcon(model.copyStatus),
        onClick: Message.ClickedCopyValues(),
      }),
      h.span(
        [h.Role('status'), h.Class('fkd-visually-hidden')],
        [copyStatusText(model.copyStatus)],
      ),
    ],
  )
}

const SAVE_FAILED_TEXT = "Couldn't save to storage"

/** A status line that reports a failed save. It stays in the page while
 *  empty, so screen readers announce the text when it appears. */
export const saveStatusView = (context: Context): Html => {
  const { h, model } = context
  return h.div(
    [h.Role('status'), h.Class('fkd-save-status')],
    model.isSaveFailed ? [SAVE_FAILED_TEXT] : [],
  )
}

/** Renders the active version comparison status. */
export const compareBannerView = (context: Context): ReadonlyArray<Html> => {
  const { h, model } = context
  return Array.fromOption(
    Option.map(
      Option.flatMap(model.maybeComparedVersionId, versionId =>
        findVersion(model.versions, versionId),
      ),
      version =>
        h.div(
          [h.Class('fkd-compare-banner'), h.Role('status')],
          [
            h.span([], [`Comparing with ${version.name}`]),
            Button.view(
              {
                onClick: Message.ClickedStopCompare(),
                toView: ({ button }) =>
                  h.button([...button, h.Class('fkd-compare-stop')], ['Stop']),
              },
              h,
            ),
          ],
        ),
    ),
  )
}
