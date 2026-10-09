import { Array, Option, Predicate, Record } from 'effect'
import { type Html, type HtmlBuilder, childAttributes } from 'foldkit/html'

import { Button, Textarea } from '@foldkit/ui'

import {
  type DialMeta,
  type DialOption,
  type LeafControl,
  getAtPath,
  pathKey,
} from '../../dial/index.js'
import { ICON_CHEVRON, strokeIcon } from '../../internal/icons.js'
import { formatStepValue } from '../../internal/range.js'
import { segmented } from '../../internal/segmented.js'
import { sliderRow } from '../../internal/sliderRow.js'
import { themeAttribute } from '../../internal/theme.js'
import * as ScrubSlider from '../../scrubSlider/index.js'
import {
  SelectListbox,
  ToggleGroup,
  selectSlot,
  sliderSlot,
  toggleSlot,
} from '../controls.js'
import { Message } from '../message.js'
import { type ToggleOption } from '../model.js'
import { controlId } from '../spec.js'
import { type Context, shortcutPill } from './shared.js'

const SELECT_ANCHOR = { placement: 'bottom-end', gap: 4, padding: 8 } as const

// CONTROLS

/** Renders a slider using its existing child slot. */
export const sliderView = (
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

/** Renders the panel's shared toggle group. */
export const toggleView = (context: Context, leaf: LeafControl): Html => {
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

/** Renders a selection control using the shared listbox factory. */
export const selectView = (
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

/** Renders a parent-owned text value. */
export const textView = (
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

/** Renders an action control. */
export const actionView = (context: Context, leaf: LeafControl): Html => {
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
