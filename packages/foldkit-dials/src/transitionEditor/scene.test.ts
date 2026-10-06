import * as Scene from 'foldkit/scene'
import { describe, it } from 'vitest'

import { RadioGroup } from '@foldkit/ui'

import { DEFAULT_TIME_SPRING, Transition } from '../transition/index.js'
import type { Model } from './index.js'
import { Message, OutMessage, init, update, view } from './index.js'

const physics = Transition.PhysicsSpring({
  stiffness: 260,
  damping: 16,
  mass: 1,
})
const easing = Transition.Easing({ duration: 0.5, ease: [0.4, 0, 0.2, 1] })

const started = init({ id: 'pop' })

const editing = (value: Transition) => ({
  update: (model: Model, message: Message) => update(model, message, value),
  view: Scene.withViewInputs(view, { value, label: 'Pop' })(),
})

const easeField = Scene.label('Ease')
const firstHandle = Scene.role('slider', { name: 'Bézier handle 1' })

describe('TransitionEditor view', () => {
  it('checks the current mode and shows only its parameters', () => {
    Scene.scene(
      editing(physics),
      Scene.given(started),
      Scene.expect(Scene.role('radiogroup', { name: 'Pop type' })).toExist(),
      Scene.expect(Scene.role('radio', { name: 'Physics' })).toHaveAttr(
        'aria-checked',
        'true',
      ),
      Scene.expect(Scene.role('slider', { name: 'Stiffness' })).toHaveAttr(
        'aria-valuenow',
        '260',
      ),
      Scene.expect(Scene.role('slider', { name: 'Mass' })).toExist(),
      Scene.expect(Scene.role('slider', { name: 'Bounce' })).not.toExist(),
      Scene.expect(easeField).not.toExist(),
    )
  })

  it('shows the curve handles and the Ease field in Easing mode', () => {
    Scene.scene(
      editing(easing),
      Scene.given(started),
      Scene.expect(easeField).toHaveValue('0.4, 0, 0.2, 1'),
      Scene.expect(Scene.role('slider', { name: 'Duration' })).toHaveAttr(
        'aria-valuenow',
        '0.5',
      ),
      Scene.expect(firstHandle).toHaveAttr('aria-valuetext', 'X 0.4, Y 0'),
    )
  })

  it('labels the Ease field with its visible label alone', () => {
    Scene.scene(
      editing(easing),
      Scene.given(started),
      Scene.expect(easeField).toHaveAttr('id', 'pop-ease'),
      Scene.expect(easeField).not.toHaveAttr('aria-label'),
      Scene.expect(Scene.role('textbox', { name: 'Ease' })).toExist(),
    )
  })

  it('reads the curve handle instructions to screen readers', () => {
    Scene.scene(
      editing(easing),
      Scene.given(started),
      Scene.expect(firstHandle).toHaveAttr(
        'aria-describedby',
        'pop-bezier-instructions',
      ),
      Scene.expect(Scene.selector('#pop-bezier-instructions')).toHaveText(
        'Drag to adjust X from 0 to 1 and Y from -1 to 2. Arrow keys adjust by 0.01. Shift adjusts by 0.1. Escape cancels a drag.',
      ),
    )
  })

  it('reports the cached spring when Time is chosen', () => {
    Scene.scene(
      editing(physics),
      Scene.given(started),
      Scene.click(Scene.role('radio', { name: 'Time' })),
      Scene.expectOutMessage(
        OutMessage.ChangedValue({ value: DEFAULT_TIME_SPRING }),
      ),
      Scene.Command.resolve(
        RadioGroup.FocusOption,
        RadioGroup.Message.CompletedFocusOption(),
      ),
    )
  })

  it('commits a typed ease on Enter', () => {
    Scene.scene(
      editing(easing),
      Scene.given(started),
      Scene.type(easeField, '0.1, 0.7, 0.1, 1'),
      Scene.keydown(easeField, 'Enter'),
      Scene.expectOutMessage(
        OutMessage.ChangedValue({
          value: Transition.Easing({ duration: 0.5, ease: [0.1, 0.7, 0.1, 1] }),
        }),
      ),
    )
  })

  it('restores the shown ease on Escape and commits nothing on blur', () => {
    Scene.scene(
      editing(easing),
      Scene.given(started),
      Scene.type(easeField, '0, 0, 1, 1'),
      Scene.keydown(easeField, 'Escape'),
      Scene.expect(easeField).toHaveValue('0.4, 0, 0.2, 1'),
      Scene.blur(easeField),
      Scene.expectNoOutMessage(),
    )
  })
})
