import { Array, Match, Option, Predicate, Record, String, pipe } from 'effect'
import {
  type Attribute,
  type ChildAttribute,
  type Html,
  type HtmlBuilder,
  childAttributes,
} from 'foldkit/html'
import { defineView } from 'foldkit/submodel'

import { Button, Disclosure, Popover, Textarea } from '@foldkit/ui'

import * as ColorField from '../colorField/index.js'
import * as ColorPicker from '../colorPicker/index.js'
import {
  type Control,
  type DialMeta,
  type DialOption,
  type LeafControl,
  getAtPath,
  pathKey,
} from '../dial/index.js'
import * as DialPad from '../dialPad/index.js'
import * as ImagePicker from '../imagePicker/index.js'
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
  panelIcon,
  strokeIcon,
} from '../internal/icons.js'
import { formatStepValue } from '../internal/range.js'
import { segmented } from '../internal/segmented.js'
import { sliderRow } from '../internal/sliderRow.js'
import { themeAttribute } from '../internal/theme.js'
import * as ScrubSlider from '../scrubSlider/index.js'
import { isTransition } from '../transition/index.js'
import * as TransitionEditor from '../transitionEditor/index.js'
import {
  SelectListbox,
  ToggleGroup,
  selectSlot,
  sliderSlot,
  toggleSlot,
  transitionSlot,
} from './controls.js'
import { Message } from './message.js'
import {
  type CopyStatus,
  type Corner,
  type Layout,
  type Model,
  type Theme,
  type ToggleOption,
  activeVersionName,
  isFolderOpen,
} from './model.js'
import {
  type ShortcutTarget,
  findShortcutTarget,
  formatShortcutBadge,
  formatTargetMode,
} from './shortcuts.js'
import { PANEL_ID_ATTRIBUTE, type PanelSpec, controlId } from './spec.js'
import { BASE_VERSION_ID, type Version, findVersion } from './versions.js'

// VIEW

/** Per-render view inputs for a panel. `values` is the parent-owned values
 *  record. `layout` defaults to `Floating`, `position` to `TopRight`, and
 *  `theme` to `System`. */
export type ViewInputs = Readonly<{
  values: unknown
  theme?: Theme
  position?: Corner
  layout?: Layout
}>

const PANEL_WIDTH = '280px'
const COLLAPSED_SIZE = '42px'
const PANEL_MAX_HEIGHT = 'calc(100dvh - 32px)'
const LEFT_MOUSE_BUTTON = 0
const MENU_ANCHOR = { placement: 'bottom-start', gap: 6, padding: 8 } as const
const SELECT_ANCHOR = { placement: 'bottom-end', gap: 4, padding: 8 } as const

const positionAttribute = (corner: Corner): string =>
  Match.value(corner).pipe(
    Match.withReturnType<string>(),
    Match.when('TopRight', () => 'top-right'),
    Match.when('TopLeft', () => 'top-left'),
    Match.when('BottomRight', () => 'bottom-right'),
    Match.when('BottomLeft', () => 'bottom-left'),
    Match.exhaustive,
  )

type Context = Readonly<{
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

const shortcutPill = (context: Context, key: string): ReadonlyArray<Html> => {
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
const iconButton = (
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

// CONTROLS

const sliderView = (
  context: Context,
  leaf: LeafControl,
  meta: Extract<DialMeta, { _tag: 'Slider' }>,
): Html => {
  const { h, model, values } = context
  const key = pathKey(leaf.path)
  const current = getAtPath(values, leaf.path)
  const value = Predicate.isNumber(current) ? current : meta.default

  return Option.match(Record.get(model.sliders, key), {
    onNone: () => h.empty,
    onSome: sliderModel =>
      h.submodel({
        slotId: `slider-${key}`,
        model: sliderModel,
        view: ScrubSlider.view,
        toParentMessage: sliderSlot.toParentMessage(key),
        viewInputs: {
          value,
          label: leaf.label,
          formatValue: sliderValue => formatStepValue(sliderValue, meta.step),
          toView: sliderRow({
            label: leaf.label,
            hasHashmarks: true,
            labelExtras: shortcutPill(context, key),
          }),
        },
      }),
  })
}

const toggleView = (context: Context, leaf: LeafControl): Html => {
  const { h, model, values } = context
  const key = pathKey(leaf.path)
  const isOn = getAtPath(values, leaf.path) === true
  const options: ReadonlyArray<ToggleOption> = ['Off', 'On']

  return Option.match(Record.get(model.toggles, key), {
    onNone: () => h.empty,
    onSome: toggleModel =>
      h.div(
        [h.Class('dialkit-labeled-control')],
        [
          h.span(
            [h.Class('dialkit-labeled-control-label')],
            [leaf.label, ...shortcutPill(context, key)],
          ),
          h.submodel({
            slotId: `toggle-${key}`,
            model: toggleModel,
            view: ToggleGroup.view,
            toParentMessage: toggleSlot.toParentMessage(key),
            viewInputs: {
              options,
              selectedValue: Option.some<ToggleOption>(isOn ? 'On' : 'Off'),
              ariaLabel: leaf.label,
              orientation: 'Horizontal',
              toView: segmented<ToggleOption>(value => value),
            },
          }),
        ],
      ),
  })
}

const optionLabel = (
  options: ReadonlyArray<DialOption>,
  value: string,
): string =>
  Option.match(
    Array.findFirst(options, option => option.value === value),
    { onNone: () => value, onSome: ({ label }) => label },
  )

const selectTriggerContent = (
  h: HtmlBuilder<Message>,
  label: string,
  valueLabel: string,
): Html =>
  h.span(
    [h.Class('fkd-select-trigger-content')],
    [
      h.span([h.Class('dialkit-select-label')], [label]),
      h.span(
        [h.Class('dialkit-select-right')],
        [
          h.span([h.Class('dialkit-select-value')], [valueLabel]),
          strokeIcon(ICON_CHEVRON, 'dialkit-select-chevron', h),
        ],
      ),
    ],
  )

const selectOptionClassName = ({
  isSelected,
  isActive,
}: Readonly<{ isSelected: boolean; isActive: boolean }>): string =>
  Array.join(
    [
      'dialkit-select-option',
      ...(isSelected ? ['fkd-selected'] : []),
      ...(isActive ? ['fkd-active'] : []),
    ],
    ' ',
  )

const selectView = (
  context: Context,
  leaf: LeafControl,
  meta: Extract<DialMeta, { _tag: 'Select' }>,
): Html => {
  const { h, model, values, theme } = context
  const key = pathKey(leaf.path)
  const current = getAtPath(values, leaf.path)
  const selected = Predicate.isString(current) ? current : meta.default
  const selectedLabel = optionLabel(meta.options, selected)

  return Option.match(Record.get(model.selects, key), {
    onNone: () => h.empty,
    onSome: selectModel =>
      h.div(
        [h.Class('dialkit-select-row')],
        [
          h.submodel({
            slotId: `select-${key}`,
            model: selectModel,
            view: SelectListbox.view,
            toParentMessage: selectSlot.toParentMessage(key),
            viewInputs: {
              items: Array.map(meta.options, ({ value }) => value),
              maybeSelectedValue: Option.some(selected),
              ariaLabel: `${leaf.label}: ${selectedLabel}`,
              anchor: SELECT_ANCHOR,
              buttonClassName: 'dialkit-select-trigger fkd-select-trigger',
              buttonContent: selectTriggerContent(h, leaf.label, selectedLabel),
              itemsClassName: 'dialkit-root dialkit-select-dropdown',
              itemsAttributes: childAttributes([
                h.DataAttribute('theme', themeAttribute(theme)),
              ]),
              itemToConfig: (item, itemState) => ({
                className: selectOptionClassName(itemState),
                content: h.span([], [optionLabel(meta.options, item)]),
              }),
            },
          }),
        ],
      ),
  })
}

const textView = (
  context: Context,
  leaf: LeafControl,
  meta: Extract<DialMeta, { _tag: 'Text' }>,
): Html => {
  const { h, spec, values } = context
  const key = pathKey(leaf.path)
  const current = getAtPath(values, leaf.path)
  return Textarea.view(
    {
      id: controlId(spec, key),
      value: Predicate.isString(current) ? current : meta.default,
      rows: 1,
      placeholder: meta.placeholder,
      onInput: value => Message.UpdatedText({ dialId: key, value }),
      toView: ({ label, textarea }) =>
        h.div(
          [h.Class('dialkit-text-control')],
          [
            h.label([...label, h.Class('dialkit-text-label')], [leaf.label]),
            h.textarea([
              ...textarea,
              h.Class('dialkit-text-input fkd-text-input'),
            ]),
          ],
        ),
    },
    h,
  )
}

const actionView = (context: Context, leaf: LeafControl): Html => {
  const { h } = context
  return Button.view(
    {
      onClick: Message.ClickedAction({ dialId: pathKey(leaf.path) }),
      toView: ({ button }) =>
        h.button([...button, h.Class('dialkit-button')], [leaf.label]),
    },
    h,
  )
}

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

const imageView = (context: Context, leaf: LeafControl): Html => {
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

const colorView = (context: Context, leaf: LeafControl): Html => {
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

const padAxisFieldView = (
  context: Context,
  axisLabelAttributes: DialPad.DialPadAttributes['xLabel'],
  axisLabel: string,
  formattedValue: string,
): Html => {
  const { h } = context
  return h.div(
    [h.Class('dialkit-pad-field')],
    [
      h.span(
        [...axisLabelAttributes, h.Class('dialkit-pad-axis')],
        [axisLabel],
      ),
      h.span([h.Class('dialkit-pad-value fkd-pad-value')], [formattedValue]),
    ],
  )
}

const padFieldsView = (
  context: Context,
  leaf: LeafControl,
  { attributes, axisLabels, formattedValue }: DialPad.RenderInfo,
): Html => {
  const { h } = context
  return h.div(
    [h.Class('dialkit-pad-fields')],
    [
      h.div(
        [h.Class('dialkit-pad-caption')],
        [
          h.span(
            [...attributes.label, h.Class('dialkit-pad-label')],
            [leaf.label],
          ),
        ],
      ),
      padAxisFieldView(
        context,
        attributes.xLabel,
        axisLabels.x,
        formattedValue.x,
      ),
      padAxisFieldView(
        context,
        attributes.yLabel,
        axisLabels.y,
        formattedValue.y,
      ),
    ],
  )
}

const padSurfaceView = (
  context: Context,
  { attributes, gridLineOffsets, thumbPosition }: DialPad.RenderInfo,
): Html => {
  const { h } = context
  return h.div(
    [...attributes.surface, h.Class('dialkit-pad-surface')],
    [
      h.div(
        [...attributes.grid, h.Class('dialkit-pad-grid')],
        Array.flatMap(gridLineOffsets, offset => [
          h.span([
            h.Class('dialkit-pad-grid-line dialkit-pad-grid-vertical'),
            h.Style({ left: offset }),
          ]),
          h.span([
            h.Class('dialkit-pad-grid-line dialkit-pad-grid-horizontal'),
            h.Style({ top: offset }),
          ]),
        ]),
      ),
      h.div(
        [...attributes.plane, h.Class('dialkit-pad-plane')],
        [
          h.span([h.Class('dialkit-pad-center')]),
          h.span([
            ...attributes.thumb,
            h.Class('dialkit-pad-point'),
            h.Style({ left: thumbPosition.left, top: thumbPosition.top }),
          ]),
        ],
      ),
    ],
  )
}

const padView = (
  context: Context,
  leaf: LeafControl,
  meta: Extract<DialMeta, { _tag: 'Pad' }>,
): Html => {
  const { h, model, values } = context
  const key = pathKey(leaf.path)
  const current = getAtPath(values, leaf.path)
  const x = getAtPath(current, ['x'])
  const y = getAtPath(current, ['y'])
  const value = {
    x: Predicate.isNumber(x) ? x : meta.x.default,
    y: Predicate.isNumber(y) ? y : meta.y.default,
  }

  return Option.match(Record.get(model.pads, key), {
    onNone: () => h.empty,
    onSome: padModel =>
      h.submodel({
        slotId: `pad-${key}`,
        model: padModel,
        view: DialPad.view,
        toParentMessage: message =>
          Message.GotPadMessage({ dialId: key, message }),
        viewInputs: {
          value,
          label: leaf.label,
          axisLabels: meta.labels,
          toView: render =>
            h.div(
              [...render.attributes.root, h.Class('dialkit-pad')],
              [
                padFieldsView(context, leaf, render),
                padSurfaceView(context, render),
                h.span(
                  [
                    ...render.attributes.instructions,
                    h.Class('dialkit-pad-instructions'),
                  ],
                  [render.instructions],
                ),
              ],
            ),
        },
      }),
  })
}

/** DialKit's folder: a Disclosure header with the label and a chevron, and
 *  an animated panel holding `content`. Folders and spring editors share
 *  it. */
const folderShellView = (
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

const transitionView = (
  context: Context,
  leaf: LeafControl,
  meta: Extract<DialMeta, { _tag: 'Transition' }>,
): Html => {
  const { h, model, values } = context
  const key = pathKey(leaf.path)
  const current = getAtPath(values, leaf.path)
  const value = isTransition(current) ? current : meta.default

  return Option.match(Record.get(model.transitions, key), {
    onNone: () => h.empty,
    onSome: editorModel =>
      folderShellView(context, {
        key,
        label: leaf.label,
        content: [
          h.submodel({
            slotId: `transition-${key}`,
            model: editorModel,
            view: TransitionEditor.view,
            toParentMessage: transitionSlot.toParentMessage(key),
            viewInputs: { value, label: leaf.label },
          }),
        ],
      }),
  })
}

const leafView = (context: Context, leaf: LeafControl): Html =>
  Match.value(leaf.meta).pipe(
    Match.withReturnType<Html>(),
    Match.tagsExhaustive({
      Slider: meta => sliderView(context, leaf, meta),
      Toggle: () => toggleView(context, leaf),
      Select: meta => selectView(context, leaf, meta),
      Text: meta => textView(context, leaf, meta),
      Action: () => actionView(context, leaf),
      Color: () => colorView(context, leaf),
      Image: () => imageView(context, leaf),
      Pad: meta => padView(context, leaf, meta),
      Transition: meta => transitionView(context, leaf, meta),
    }),
  )

const folderView = (
  context: Context,
  folder: Extract<Control, { _tag: 'Folder' }>,
): Html =>
  folderShellView(context, {
    key: pathKey(folder.path),
    label: folder.label,
    content: controlsView(context, folder.children),
  })

const controlsView = (
  context: Context,
  controls: ReadonlyArray<Control>,
): ReadonlyArray<Html> =>
  Array.map(controls, control =>
    control._tag === 'Leaf'
      ? leafView(context, control)
      : folderView(context, control),
  )

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

const toolbarView = (context: Context): Html => {
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
const saveStatusView = (context: Context): Html => {
  const { h, model } = context
  return h.div(
    [h.Role('status'), h.Class('fkd-save-status')],
    model.isSaveFailed ? [SAVE_FAILED_TEXT] : [],
  )
}

const compareBannerView = (context: Context): ReadonlyArray<Html> => {
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

// PANEL

const headerInteractionAttributes = (
  context: Context,
  layout: Layout,
): ReadonlyArray<Attribute<Message>> => {
  const { h } = context
  return layout === 'Floating'
    ? [
        h.OnPointerDown(
          (
            _pointerType,
            button,
            _screenX,
            _screenY,
            _timeStamp,
            clientX,
            clientY,
          ) =>
            Option.liftPredicate(
              Message.PressedPanelHeader({ clientX, clientY }),
              () => button === LEFT_MOUSE_BUTTON,
            ),
        ),
        h.OnKeyDownPreventDefault(key =>
          Option.liftPredicate(
            Message.ToggledPanelWithKeyboard({ isOpen: !context.model.isOpen }),
            () => key === 'Enter' || key === ' ',
          ),
        ),
      ]
    : []
}

const sectionView = (context: Context, layout: Layout): Html => {
  const { h, model, spec } = context
  const isRoot = layout !== 'Section'
  return Disclosure.view(
    {
      id: `${spec.id}-dials`,
      isOpen: model.isOpen,
      ariaLabel: spec.name,
      onToggle: isOpen => Message.ToggledPanel({ isOpen }),
      toView: ({ button, panel }) =>
        h.div(
          [
            h.Class(
              isRoot
                ? 'dialkit-folder dialkit-folder-root'
                : 'dialkit-folder dialkit-folder-section',
            ),
            h.DataAttribute('open', model.isOpen ? 'true' : 'false'),
            h.DataAttribute(PANEL_ID_ATTRIBUTE, spec.id),
            h.Role('region'),
            h.AriaLabel(spec.name),
          ],
          [
            h.div(
              [h.Class('dialkit-folder-header dialkit-panel-header')],
              [
                h.button(
                  [
                    ...Array.filter(
                      button,
                      attribute =>
                        layout !== 'Floating' ||
                        attribute._tag !== 'OnKeyDownPreventDefault',
                    ),
                    ...headerInteractionAttributes(context, layout),
                    h.Class('dialkit-folder-header-top'),
                  ],
                  [
                    h.span(
                      [h.Class('dialkit-folder-title-row')],
                      [
                        h.span(
                          [
                            h.Class(
                              isRoot
                                ? 'dialkit-folder-title dialkit-folder-title-root'
                                : 'dialkit-folder-title',
                            ),
                          ],
                          [spec.name],
                        ),
                      ],
                    ),
                    panelIcon(h),
                  ],
                ),
                ...(model.isOpen
                  ? [
                      toolbarView(context),
                      saveStatusView(context),
                      ...compareBannerView(context),
                    ]
                  : []),
              ],
            ),
            ...(model.isOpen
              ? [
                  h.div(
                    [...panel, h.Class('dialkit-folder-content')],
                    [
                      h.div(
                        [h.Class('dialkit-folder-inner')],
                        controlsView(context, spec.controls),
                      ),
                    ],
                  ),
                ]
              : []),
          ],
        ),
    },
    h,
  )
}

/** Renders a panel as DialKit's markup, so DialKit's stylesheet skins it.
 *  `Floating` and `Inline` wrap the panel in its own `dialkit-root`;
 *  `Section` renders only the panel, for `root` to group. */
export const makeView = (spec: PanelSpec) =>
  defineView<Model, Message, ViewInputs>((model, viewInputs, h): Html => {
    const layout = viewInputs.layout ?? 'Floating'
    const theme = viewInputs.theme ?? 'System'
    const context: Context = {
      spec,
      model,
      values: viewInputs.values,
      theme,
      h,
    }

    if (layout === 'Section') {
      return sectionView(context, layout)
    } else {
      const mode = layout === 'Inline' ? 'inline' : 'popover'
      return h.div(
        [
          h.Class('dialkit-root fkd-root'),
          h.DataAttribute('theme', themeAttribute(theme)),
          h.DataAttribute('mode', mode),
        ],
        [
          h.div(
            [
              h.Class('dialkit-panel'),
              h.DataAttribute('mode', mode),
              h.DataAttribute(
                'position',
                positionAttribute(viewInputs.position ?? 'TopRight'),
              ),
              h.Style({ translate: `${model.offset.x}px ${model.offset.y}px` }),
            ],
            [
              h.div(
                [h.Class('dialkit-panel-wrapper')],
                [
                  h.div(
                    [
                      h.Class('dialkit-panel-inner'),
                      h.DataAttribute(
                        'collapsed',
                        model.isOpen ? 'false' : 'true',
                      ),
                      h.Style(
                        model.isOpen
                          ? {
                              width: PANEL_WIDTH,
                              maxHeight: PANEL_MAX_HEIGHT,
                              overflow: 'hidden auto',
                            }
                          : {
                              width: COLLAPSED_SIZE,
                              height: COLLAPSED_SIZE,
                              overflow: 'hidden',
                            },
                      ),
                    ],
                    [sectionView(context, layout)],
                  ),
                ],
              ),
            ],
          ),
        ],
      )
    }
  })

/** Renders several panels in one DialKit window, as sections, the way a
 *  DialKit root shows every registered panel. Pass each panel's view built
 *  with `layout: 'Section'`. */
export const root = <ParentMessage>(
  config: Readonly<{
    sections: ReadonlyArray<Html>
    theme?: Theme
    position?: Corner
  }>,
  h: HtmlBuilder<ParentMessage>,
): Html =>
  h.div(
    [
      h.Class('dialkit-root fkd-root'),
      h.DataAttribute('theme', themeAttribute(config.theme ?? 'System')),
      h.DataAttribute('mode', 'popover'),
    ],
    [
      h.div(
        [
          h.Class('dialkit-panel'),
          h.DataAttribute('mode', 'popover'),
          h.DataAttribute(
            'position',
            positionAttribute(config.position ?? 'TopRight'),
          ),
          h.DataAttribute('multiple', 'true'),
        ],
        [
          h.div(
            [h.Class('dialkit-panel-wrapper')],
            [
              h.div(
                [
                  h.Class('dialkit-panel-inner'),
                  h.DataAttribute('collapsed', 'false'),
                  h.Style({
                    width: PANEL_WIDTH,
                    maxHeight: PANEL_MAX_HEIGHT,
                    overflow: 'hidden auto',
                  }),
                ],
                [...config.sections],
              ),
            ],
          ),
        ],
      ),
    ],
  )
