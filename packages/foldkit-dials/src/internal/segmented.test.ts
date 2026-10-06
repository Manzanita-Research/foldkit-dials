import { Array, Option, Predicate } from 'effect'
import type { Html } from 'foldkit/html'
import * as Scene from 'foldkit/scene'
import { describe, expect, it } from 'vitest'

import { RadioGroup } from '@foldkit/ui'

import { segmented } from './segmented.js'

type Toggle = 'Off' | 'On'

const ToggleGroup = RadioGroup.create<Toggle>()
const TOGGLE_OPTIONS: ReadonlyArray<Toggle> = ['Off', 'On']

const sceneView = Scene.withViewInputs(ToggleGroup.view, {
  options: TOGGLE_OPTIONS,
  selectedValue: Option.some<Toggle>('On'),
  ariaLabel: 'Shadow',
  orientation: 'Horizontal',
  toView: segmented<Toggle>(value => value),
})

const optionInfo = (
  value: Toggle,
  index: number,
): RadioGroup.OptionInfo<Toggle> => ({
  value,
  index,
  isSelected: value === 'On',
  isActive: value === 'On',
  isDisabled: false,
  isReadOnly: false,
  option: [],
  label: [],
  description: [],
})

const keysOf = (html: Html): ReadonlyArray<unknown> =>
  Array.map(html?.children ?? [], child =>
    Predicate.isString(child) ? child : child.key,
  )

const on = Scene.role('radio', { name: 'On' })
const off = Scene.role('radio', { name: 'Off' })

describe('segmented', () => {
  it('keys each option button by its value', () => {
    const html = segmented<Toggle>(value => value)({
      group: [],
      options: Array.map(TOGGLE_OPTIONS, optionInfo),
      selectedValue: Option.some('On'),
      hiddenInput: [],
    })

    expect(keysOf(html)).toEqual([undefined, 'Off', 'On'])
  })

  it("keeps the RadioGroup's checked and active markers", () => {
    Scene.scene(
      { update: ToggleGroup.update, view: sceneView() },
      Scene.given(RadioGroup.init({ id: 'shadow' })),
      Scene.expect(on).toHaveAttr('data-checked', ''),
      Scene.expect(on).toHaveAttr('data-active', ''),
      Scene.expect(off).not.toHaveAttr('data-checked'),
      Scene.expect(off).not.toHaveAttr('data-active'),
    )
  })
})
