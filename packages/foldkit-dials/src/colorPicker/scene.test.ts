import { Array } from 'effect'
import { inertHtml as ih } from 'foldkit/html'
import * as Scene from 'foldkit/scene'
import { describe, it } from 'vitest'

import { RadioGroup } from '@foldkit/ui'

import type { ColorFormat } from '../color/index.js'
import type { RenderInfo } from './index.js'
import { OutMessage, colorFormatLabel, init, update, view } from './index.js'

const RED = '#ff0000'

const testFormatGroupView = ({
  group,
  options,
}: RadioGroup.RenderInfo<ColorFormat>) =>
  ih.div(
    [...group],
    Array.map(options, ({ value, option, label }) =>
      ih.button([...option], [ih.span([...label], [colorFormatLabel(value)])]),
    ),
  )

const testToView = ({
  attributes,
  formatGroup,
  colors,
  isRejected,
}: RenderInfo) =>
  ih.div(
    [...attributes.root],
    [
      formatGroup,
      ih.div([...attributes.area], [ih.div([...attributes.areaThumb])]),
      ih.div([...attributes.hueTrack], [ih.div([...attributes.hueThumb])]),
      ih.div(
        [...attributes.alphaTrack],
        [ih.div([...attributes.alphaThumb], [ih.span([], [colors.current])])],
      ),
      ih.input([...attributes.textInput]),
      ...(isRejected
        ? [ih.span([...attributes.error], ['Not a valid color'])]
        : []),
    ],
  )

const sceneView = Scene.withViewInputs(view, {
  value: RED,
  toView: testToView,
  toFormatGroupView: testFormatGroupView,
})

const focusedFormat = Scene.Command.resolve(
  RadioGroup.FocusOption,
  RadioGroup.Message.CompletedFocusOption(),
)

const hexPicker = init({ id: 'accent', value: RED })
const oklchPicker = init({ id: 'accent', value: 'oklch(0.5 0 0)' })

const areaThumb = Scene.role('slider', { name: 'Saturation and lightness' })
const hueThumb = Scene.role('slider', { name: 'Hue' })
const alphaThumb = Scene.role('slider', { name: 'Opacity' })
const textInput = Scene.label('CSS color')

describe('ColorPicker', () => {
  describe('rendering', () => {
    it('exposes the area thumb as a 2D slider at the colour position', () => {
      Scene.scene(
        { update, view: sceneView({ value: 'oklch(0.5 0 0)' }) },
        Scene.given(oklchPicker),
        Scene.expect(areaThumb).toHaveAttr('aria-roledescription', '2D slider'),
        Scene.expect(areaThumb).toHaveAttr(
          'aria-valuetext',
          'Saturation 0%, lightness 50%',
        ),
        Scene.expect(areaThumb).toHaveAttr('tabIndex', '0'),
        Scene.expect(areaThumb).toHaveStyle('left', '0%'),
        Scene.expect(areaThumb).toHaveStyle('top', '50%'),
      )
    })

    it('exposes the hue and opacity thumbs with their values', () => {
      Scene.scene(
        { update, view: sceneView({ value: 'oklch(0.7 0.1 90 / 0.25)' }) },
        Scene.given(init({ id: 'accent', value: 'oklch(0.7 0.1 90 / 0.25)' })),
        Scene.expect(hueThumb).toHaveAttr('aria-valuemax', '360'),
        Scene.expect(hueThumb).toHaveAttr('aria-valuenow', '90'),
        Scene.expect(hueThumb).toHaveAttr('aria-valuetext', '90 degrees'),
        Scene.expect(hueThumb).toHaveStyle('left', '25%'),
        Scene.expect(alphaThumb).toHaveAttr('aria-valuenow', '25'),
        Scene.expect(alphaThumb).toHaveAttr('aria-valuetext', '25 percent'),
        Scene.expect(alphaThumb).toHaveStyle('left', '25%'),
        Scene.expect(alphaThumb).toHaveStyle(
          '--color-picker-thumb',
          'oklch(0.7 0.1 90 / 0.25)',
        ),
        Scene.expect(hueThumb).toHaveStyle(
          '--color-picker-thumb',
          'oklch(0.7 0.1 90)',
        ),
        Scene.expect(alphaThumb).toHaveText('oklch(0.7 0.1 90 / 0.25)'),
      )
    })

    it('marks the area and tracks for the drag Subscription', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(hexPicker),
        Scene.expect(
          Scene.selector('[data-color-picker-area="accent"]'),
        ).toExist(),
        Scene.expect(
          Scene.selector('[data-color-picker-hue-track="accent"]'),
        ).toHaveHandler('pointerdown'),
        Scene.expect(
          Scene.selector('[data-color-picker-alpha-track="accent"]'),
        ).toHaveStyle(
          '--color-picker-track',
          'linear-gradient(to right, transparent, oklch(0.628 0.2577 29.23))',
        ),
        Scene.expect(
          Scene.selector('[data-color-picker-area="accent"]'),
        ).toHaveStyle(
          '--color-picker-area-neutral',
          'linear-gradient(to bottom in oklab, #fff, #000)',
        ),
      )
    })

    it('checks the selected format option', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(hexPicker),
        Scene.expect(
          Scene.role('radiogroup', { name: 'Color format' }),
        ).toExist(),
        Scene.expect(Scene.role('radio', { name: 'Hex' })).toHaveAttr(
          'aria-checked',
          'true',
        ),
        Scene.expect(Scene.role('radio', { name: 'Hex' })).toHaveAttr(
          'tabIndex',
          '0',
        ),
        Scene.expect(Scene.role('radio', { name: 'OKLCH' })).toHaveAttr(
          'tabIndex',
          '-1',
        ),
      )
    })
  })

  describe('keyboard', () => {
    it('moves the area thumb with the arrow keys, and further with Shift', () => {
      Scene.scene(
        { update, view: sceneView({ value: 'oklch(0.5 0 0)' }) },
        Scene.given(oklchPicker),
        Scene.keydown(areaThumb, 'ArrowUp'),
        Scene.expectOutMessage(
          OutMessage.ChangedValue({ value: 'oklch(0.51 0 0)' }),
        ),
        Scene.keydown(areaThumb, 'ArrowDown', { shiftKey: true }),
        Scene.expectOutMessage(
          OutMessage.ChangedValue({ value: 'oklch(0.4 0 0)' }),
        ),
      )
    })

    it('steps opacity with the arrow keys, and further with Shift', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(hexPicker),
        Scene.keydown(alphaThumb, 'ArrowLeft'),
        Scene.expectOutMessage(OutMessage.ChangedValue({ value: '#ff0000fc' })),
        Scene.keydown(alphaThumb, 'ArrowDown', { shiftKey: true }),
        Scene.expectOutMessage(OutMessage.ChangedValue({ value: '#ff0000e6' })),
        Scene.keydown(alphaThumb, 'Home'),
        Scene.expectOutMessage(OutMessage.ChangedValue({ value: '#ff000000' })),
      )
    })

    it('moves the hue with the arrow keys', () => {
      Scene.scene(
        { update, view: sceneView({ value: 'oklch(0.5 0 0)' }) },
        Scene.given(oklchPicker),
        Scene.keydown(hueThumb, 'ArrowRight', { shiftKey: true }),
        Scene.expectOutMessage(
          OutMessage.ChangedValue({ value: 'oklch(0.5 0 10)' }),
        ),
      )
    })

    it('selects and focuses the next format with the arrow keys', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(hexPicker),
        Scene.keydown(Scene.role('radio', { name: 'Hex' }), 'ArrowRight'),
        Scene.expectOutMessage(
          OutMessage.ChangedValue({ value: 'oklch(0.628 0.2577 29.23)' }),
        ),
        focusedFormat,
        Scene.expect(Scene.role('radio', { name: 'OKLCH' })).toHaveAttr(
          'aria-checked',
          'true',
        ),
      )
    })
  })

  describe('format options', () => {
    it('re-emits the value in the clicked format', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(hexPicker),
        Scene.click(Scene.role('radio', { name: 'Display P3' })),
        Scene.expectOutMessage(
          OutMessage.ChangedValue({
            value: 'color(display-p3 0.91749 0.20029 0.13856)',
          }),
        ),
        focusedFormat,
        Scene.expect(Scene.role('radio', { name: 'Display P3' })).toHaveAttr(
          'aria-checked',
          'true',
        ),
      )
    })
  })

  describe('text input', () => {
    it('shows the value and commits typed colours on Enter', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(hexPicker),
        Scene.expect(textInput).toHaveValue(RED),
        Scene.type(textInput, 'hsl(120 100% 50%)'),
        Scene.keydown(textInput, 'Enter'),
        Scene.expectOutMessage(
          OutMessage.ChangedValue({ value: 'hsl(120 100% 50%)' }),
        ),
      )
    })

    it('marks unparsable text invalid on Enter and drops it on blur', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(hexPicker),
        Scene.type(textInput, 'red'),
        Scene.keydown(textInput, 'Enter'),
        Scene.expectNoOutMessage(),
        Scene.expect(textInput).toHaveAttr('aria-invalid', 'true'),
        Scene.blur(textInput),
        Scene.expectNoOutMessage(),
        Scene.expect(textInput).not.toHaveAttr('aria-invalid'),
        Scene.expect(textInput).toHaveValue(RED),
      )
    })

    it('says why a rejected draft was not used, in an alert the input points to', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(hexPicker),
        Scene.expect(Scene.role('alert')).not.toExist(),
        Scene.type(textInput, 'red'),
        Scene.keydown(textInput, 'Enter'),
        Scene.expect(Scene.role('alert')).toHaveText('Not a valid color'),
        Scene.expect(Scene.role('alert')).toHaveAttr(
          'id',
          'accent-input-error',
        ),
        Scene.expect(textInput).toHaveAttr(
          'aria-describedby',
          'accent-input-error',
        ),
        Scene.blur(textInput),
        Scene.expect(Scene.role('alert')).not.toExist(),
        Scene.expect(textInput).not.toHaveAttr('aria-describedby'),
      )
    })
  })
})
