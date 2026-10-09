import { ScrubSlider } from 'foldkit-dials'
import * as Scene from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, it } from 'vitest'

import { init, update } from './examples'
import { view } from './page'

const start = init().model
const amount = Scene.role('slider', { name: 'Amount' })

// CONTROLS

describe('gallery parent wiring', () => {
  it('folds slider OutMessages without changing the pad or standalone color', () => {
    Scene.scene(
      { update, view },
      Scene.given(start),
      Scene.keydown(amount, 'ArrowRight'),
      Scene.expect(amount).toHaveAttr('aria-valuenow', '41'),
      Scene.expect(Scene.role('slider', { name: 'Position' })).toHaveAttr(
        'aria-valuetext',
        'X 0, Y 0',
      ),
      Scene.expect(
        Scene.role('textbox', { name: 'Accent color value' }),
      ).toHaveAttr('value', '#6d5efc'),
      Scene.keydown(amount, 'End'),
      Scene.expect(amount).toHaveAttr('aria-valuenow', '100'),
    )
  })

  it('commits precise edits through mapped child Commands and OutMessages', () => {
    const editor = Scene.role('textbox', { name: 'Amount value' })
    Scene.scene(
      { update, view },
      Scene.given(start),
      Scene.keydown(amount, 'Enter'),
      Scene.Command.resolve(
        ScrubSlider.FocusEditor,
        ScrubSlider.Message.CompletedFocusEditor(),
      ),
      Scene.type(editor, '27'),
      Scene.keydown(editor, 'Enter'),
      Scene.Command.resolve(
        ScrubSlider.FocusSlider,
        ScrubSlider.Message.CompletedFocusSlider(),
      ),
      Scene.expect(amount).toHaveAttr('aria-valuenow', '27'),
      Scene.expect(editor).not.toExist(),
    )
  })

  it('folds panel values and actions into the gallery parent', () => {
    Scene.scene(
      { update, view },
      Scene.given(modifyFields(start, { page: () => 'Panels' })),
      Scene.click(Scene.role('button', { name: 'Count action' })),
      Scene.expect(Scene.text('Actions received: 1')).toExist(),
      Scene.keydown(Scene.role('slider', { name: 'Size' }), 'ArrowRight'),
      Scene.expect(Scene.text('Size 25 · Start · Enabled')).toExist(),
      Scene.click(Scene.role('button', { name: 'Section' })),
      Scene.expect(Scene.role('button', { name: 'Section' })).toHaveAttr(
        'aria-pressed',
        'true',
      ),
      Scene.expect(Scene.role('slider', { name: 'Size' })).toHaveAttr(
        'aria-valuenow',
        '25',
      ),
    )
  })
})
