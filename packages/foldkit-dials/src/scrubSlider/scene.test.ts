import * as Scene from 'foldkit/scene'
import { describe, it } from 'vitest'

import { sliderRow } from '../internal/sliderRow.js'
import {
  FocusEditor,
  FocusSlider,
  Message,
  OutMessage,
  init,
  update,
  view,
} from './index.js'

const testToView = sliderRow({ label: 'Radius' })

const sceneView = Scene.withViewInputs(view, {
  value: 12,
  label: 'Radius',
  toView: testToView,
})

const defaultModel = init({ id: 'radius', min: 0, max: 48, step: 1 })
const slider = Scene.role('slider', { name: 'Radius' })
const editor = Scene.role('textbox', { name: 'Radius value' })

describe('ScrubSlider', () => {
  describe('rendering', () => {
    it('exposes the WAI-ARIA slider values and the label', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.expect(slider).toHaveAttr('aria-valuemin', '0'),
        Scene.expect(slider).toHaveAttr('aria-valuemax', '48'),
        Scene.expect(slider).toHaveAttr('aria-valuenow', '12'),
        Scene.expect(slider).toHaveAttr('aria-valuetext', '12'),
        Scene.expect(slider).toHaveAttr('aria-labelledby', 'radius-label'),
        Scene.expect(slider).toHaveAttr('tabIndex', '0'),
      )
    })

    it('sizes the fill to the value fraction', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.expect(Scene.selector('[data-scrub-slider-id] div')).toHaveStyle(
          'width',
          '25%',
        ),
      )
    })

    it('formats with as many decimals as the step has', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(init({ id: 'radius', min: 0, max: 48, step: 0.25 })),
        Scene.expect(slider).toHaveAttr('aria-valuetext', '12.00'),
        Scene.expect(Scene.text('12.00')).toExist(),
      )
    })

    it('formats with the formatter when given one', () => {
      Scene.scene(
        { update, view: sceneView({ formatValue: value => `${value}px` }) },
        Scene.given(defaultModel),
        Scene.expect(slider).toHaveAttr('aria-valuetext', '12px'),
      )
    })
  })

  describe('keyboard', () => {
    it('steps with the arrow keys and pages with Shift', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.keydown(slider, 'ArrowRight'),
        Scene.expectOutMessage(OutMessage.ChangedValue({ value: 13 })),
        Scene.keydown(slider, 'ArrowLeft', { shiftKey: true }),
        Scene.expectOutMessage(OutMessage.ChangedValue({ value: 2 })),
      )
    })

    it('opens the value editor on Enter', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.keydown(slider, 'Enter'),
        Scene.Command.resolve(FocusEditor, Message.CompletedFocusEditor()),
        Scene.expect(editor).toExist(),
        Scene.expect(editor).toHaveAttr('aria-label', 'Radius value'),
      )
    })
  })

  describe('value editor', () => {
    it('opens when the value text is clicked and commits a typed value', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.click(Scene.text('12')),
        Scene.Command.resolve(FocusEditor, Message.CompletedFocusEditor()),
        Scene.type(editor, '30'),
        Scene.blur(editor),
        Scene.expectOutMessage(OutMessage.ChangedValue({ value: 30 })),
        Scene.expect(editor).not.toExist(),
      )
    })
  })

  describe('value editor inside a row', () => {
    it('renders the editor beside the slider, never inside its slider role', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.keydown(slider, 'Enter'),
        Scene.Command.resolve(FocusEditor, Message.CompletedFocusEditor()),
        Scene.expect(editor).toExist(),
        Scene.expect(Scene.within(slider, editor)).not.toExist(),
      )
    })

    it('commits once on Enter and returns focus to the slider', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.keydown(slider, 'Enter'),
        Scene.Command.resolve(FocusEditor, Message.CompletedFocusEditor()),
        Scene.type(editor, '30'),
        Scene.keydown(editor, 'Enter'),
        Scene.expectOutMessage(OutMessage.ChangedValue({ value: 30 })),
        Scene.Command.resolve(FocusSlider, Message.CompletedFocusSlider()),
        Scene.expect(editor).not.toExist(),
      )
    })

    it("ignores arrow keys and Home in the editor's own key handler", () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.keydown(slider, 'Enter'),
        Scene.Command.resolve(FocusEditor, Message.CompletedFocusEditor()),
        Scene.keydown(editor, 'ArrowLeft'),
        Scene.expectIgnored(),
        Scene.keydown(editor, 'Home'),
        Scene.expectIgnored(),
        Scene.expectNoOutMessage(),
        Scene.expect(editor).toExist(),
      )
    })

    it('listens for slider keys only on the slider itself', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.expect(slider).toHaveHandler('keydown'),
        Scene.expect(Scene.selector('[data-scrub-slider-value]')).toHaveAttr(
          'aria-hidden',
          'true',
        ),
      )
    })
  })

  describe('disabled', () => {
    it('marks aria-disabled and drops the pointer and keyboard handlers', () => {
      Scene.scene(
        { update, view: sceneView({ isDisabled: true }) },
        Scene.given(defaultModel),
        Scene.expect(slider).toHaveAttr('aria-disabled', 'true'),
        Scene.expect(slider).not.toHaveHandler('pointerdown'),
        Scene.expect(slider).not.toHaveHandler('keydown'),
      )
    })
  })
})
