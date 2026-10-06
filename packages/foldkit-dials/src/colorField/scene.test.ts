import { Array } from 'effect'
import { inertHtml as ih } from 'foldkit/html'
import * as Scene from 'foldkit/scene'
import { describe, it } from 'vitest'

import { Popover, type RadioGroup } from '@foldkit/ui'

import type { ColorFormat } from '../color/index.js'
import * as ColorPicker from '../colorPicker/index.js'
import type { RenderInfo } from './index.js'
import { Message, OutMessage, init, update, view } from './index.js'

const RED = '#ff0000'
const ANCHOR = { placement: 'left-start' as const, gap: 8 }

const testFormatGroupView = ({
  group,
  options,
}: RadioGroup.RenderInfo<ColorFormat>) =>
  ih.div(
    [...group],
    Array.map(options, ({ value, option, label }) =>
      ih.button(
        [...option],
        [ih.span([...label], [ColorPicker.colorFormatLabel(value)])],
      ),
    ),
  )

const testToPickerView = ({
  attributes,
  formatGroup,
}: ColorPicker.RenderInfo) =>
  ih.div(
    [...attributes.root],
    [
      formatGroup,
      ih.div([...attributes.area], [ih.div([...attributes.areaThumb])]),
      ih.div([...attributes.hueTrack], [ih.div([...attributes.hueThumb])]),
      ih.div([...attributes.alphaTrack], [ih.div([...attributes.alphaThumb])]),
      ih.input([...attributes.textInput]),
    ],
  )

const testToView = ({ attributes, picker, isOpen, isRejected }: RenderInfo) =>
  ih.div(
    [...attributes.root],
    [
      ih.span([...attributes.label], ['Accent']),
      ih.input([...attributes.valueInput]),
      ...(isRejected
        ? [ih.span([...attributes.error], ['Not a valid color'])]
        : []),
      ih.button([...attributes.swatch]),
      ...(isOpen
        ? [
            ih.div([...attributes.backdrop]),
            ih.div([...attributes.panel], [picker]),
          ]
        : []),
    ],
  )

const sceneView = Scene.withViewInputs(view, {
  value: RED,
  label: 'Accent',
  anchor: ANCHOR,
  toView: testToView,
  toPickerView: testToPickerView,
  toFormatGroupView: testFormatGroupView,
})

const acknowledgeAnchorPopover = Scene.Mount.resolve(
  Popover.AnchorPopover,
  Popover.Message.CompletedAnchorPopover(),
)
const acknowledgePopoverBackdrop = Scene.Mount.resolve(
  Popover.PortalPopoverBackdrop,
  Popover.Message.CompletedPortalPopoverBackdrop(),
)

const closedField = init({ id: 'accent', value: RED })
const openField = update(
  closedField,
  Message.GotPopoverMessage({ message: Popover.Message.RequestedOpen() }),
).model

const valueInput = Scene.label('Accent color value')
const swatch = Scene.role('button', { name: 'Pick accent color' })
const dialog = Scene.role('dialog', { name: 'Accent color picker' })
const opacityThumb = Scene.role('slider', { name: 'Opacity' })

describe('ColorField', () => {
  describe('rendering', () => {
    it('renders the value input and a closed swatch trigger', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(closedField),
        Scene.expect(valueInput).toHaveValue(RED),
        Scene.expect(valueInput).toHaveAttr('title', RED),
        Scene.expect(swatch).toHaveAttr('aria-expanded', 'false'),
        Scene.expect(swatch).toHaveAttr('aria-haspopup', 'dialog'),
        Scene.expect(dialog).toBeAbsent(),
      )
    })

    it('renders the picker in a labelled dialog while open', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(openField),
        Scene.expect(swatch).toHaveAttr('aria-expanded', 'true'),
        Scene.expect(dialog).toExist(),
        Scene.expect(
          Scene.selector('[data-color-field-id="accent"]'),
        ).toHaveAttr('data-open', ''),
        Scene.expect(Scene.role('radio', { name: 'Hex' })).toHaveAttr(
          'aria-checked',
          'true',
        ),
        acknowledgeAnchorPopover,
        acknowledgePopoverBackdrop,
      )
    })

    it('focuses the selected format option when the panel opens', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(openField),
        Scene.Mount.expectHas(
          Popover.AnchorPopover({
            buttonId: 'accent-popover-button',
            anchor: ANCHOR,
            focusSelector:
              '[data-color-picker-id="accent-picker"] [role="radio"][aria-checked="true"]',
            arrowId: 'accent-popover-arrow',
          }),
        ),
        Scene.expect(
          Scene.selector(ColorPicker.selectedFormatSelector('accent-picker')),
        ).toHaveText('Hex'),
        acknowledgeAnchorPopover,
        acknowledgePopoverBackdrop,
      )
    })
  })

  describe('swatch', () => {
    it('opens the picker on click', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(closedField),
        Scene.click(swatch),
        Scene.expectNoOutMessage(),
        Scene.expect(dialog).toExist(),
        acknowledgeAnchorPopover,
        acknowledgePopoverBackdrop,
      )
    })
  })

  describe('picker', () => {
    it('reports keyboard edits inside the panel', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(openField),
        acknowledgeAnchorPopover,
        acknowledgePopoverBackdrop,
        Scene.keydown(opacityThumb, 'ArrowLeft'),
        Scene.expectOutMessage(OutMessage.ChangedValue({ value: '#ff0000fc' })),
      )
    })

    it('marks the panel as part of the field, so focus inside it stays inside', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(openField),
        acknowledgeAnchorPopover,
        acknowledgePopoverBackdrop,
        Scene.expect(dialog).toHaveAttr('data-color-field-id', 'accent'),
      )
    })

    it('closes when focus lands outside the field', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(openField),
        acknowledgeAnchorPopover,
        acknowledgePopoverBackdrop,
        Scene.Subscription.emit(Message.MovedFocusOutsideField()),
        Scene.Mount.expectEnded(
          Popover.AnchorPopover,
          Popover.PortalPopoverBackdrop,
        ),
        Scene.Command.resolve(
          Popover.FocusButton,
          Popover.Message.CompletedFocusButton(),
        ),
        Scene.expect(dialog).toBeAbsent(),
        Scene.expectNoOutMessage(),
      )
    })

    it('closes on Escape and returns focus to the swatch', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(openField),
        acknowledgeAnchorPopover,
        acknowledgePopoverBackdrop,
        Scene.keydown(dialog, 'Escape'),
        Scene.Command.resolve(
          Popover.FocusButton,
          Popover.Message.CompletedFocusButton(),
        ),
        Scene.Mount.expectEnded(
          Popover.AnchorPopover,
          Popover.PortalPopoverBackdrop,
        ),
        Scene.expect(dialog).toBeAbsent(),
        Scene.expect(swatch).toHaveAttr('aria-expanded', 'false'),
      )
    })
  })

  describe('value input', () => {
    it('commits a typed colour on Enter', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(closedField),
        Scene.type(valueInput, 'rgb(0 128 255)'),
        Scene.keydown(valueInput, 'Enter'),
        Scene.expectOutMessage(
          OutMessage.ChangedValue({ value: 'rgb(0 128 255)' }),
        ),
      )
    })

    it('marks unparsable text invalid and restores the value on Escape', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(closedField),
        Scene.type(valueInput, 'crimson'),
        Scene.keydown(valueInput, 'Enter'),
        Scene.expectNoOutMessage(),
        Scene.expect(valueInput).toHaveAttr('aria-invalid', 'true'),
        Scene.keydown(valueInput, 'Escape'),
        Scene.expect(valueInput).toHaveValue(RED),
        Scene.expect(valueInput).not.toHaveAttr('aria-invalid'),
      )
    })

    it('announces a rejected colour in an alert the input points to', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(closedField),
        Scene.type(valueInput, 'crimson'),
        Scene.keydown(valueInput, 'Enter'),
        Scene.expect(Scene.role('alert')).toHaveText('Not a valid color'),
        Scene.expect(valueInput).toHaveAttr(
          'aria-describedby',
          'accent-value-error',
        ),
        Scene.expect(Scene.role('alert')).toHaveAttr(
          'id',
          'accent-value-error',
        ),
        Scene.type(valueInput, '#00ff00'),
        Scene.expect(Scene.role('alert')).not.toExist(),
      )
    })
  })
})
