import { Array, Option, Order, Record } from 'effect'
import * as Story from 'foldkit/story'
import { describe, expect, it } from 'vitest'

import { RadioGroup } from '@foldkit/ui'

import * as BezierEditor from '../bezierEditor/index.js'
import * as ScrubSlider from '../scrubSlider/index.js'
import {
  DEFAULT_EASING,
  DEFAULT_PHYSICS_SPRING,
  DEFAULT_TIME_SPRING,
  Transition,
  TransitionMode,
} from '../transition/index.js'
import {
  type ModeParameter,
  parametersFor,
  withParameter,
} from '../transition/parameters.js'
import type { Model } from './index.js'
import {
  Message,
  OutMessage,
  formatEase,
  init,
  parseEase,
  subscriptions,
  update,
} from './index.js'

const started = init({ id: 'pop' })

const timeSpring = Transition.TimeSpring({ visualDuration: 0.4, bounce: 0.3 })
const easing = Transition.Easing({ duration: 0.5, ease: [0.4, 0, 0.2, 1] })

const editing = (value: Transition) => (model: Model, message: Message) =>
  update(model, message, value)

const selectMode = (index: number, value: string) =>
  Message.GotModeMessage({
    message: RadioGroup.Message.SelectedOption({ index, value }),
  })

const jumpSlider = (parameter: ModeParameter, value: number) =>
  Message.GotSliderMessage({
    parameterId: parameter,
    message: ScrubSlider.Message.PressedKeyboardNavigation({
      direction: 'Max',
      value,
    }),
  })

const focusedMode = Story.Command.resolve(
  RadioGroup.FocusOption,
  RadioGroup.Message.CompletedFocusOption(),
)

describe('TransitionEditor', () => {
  describe('init', () => {
    it("caches DialKit's default for each mode", () => {
      expect(started.cache).toEqual({
        easing: DEFAULT_EASING,
        timeSpring: DEFAULT_TIME_SPRING,
        physicsSpring: DEFAULT_PHYSICS_SPRING,
      })
      expect(started.easeDraft._tag).toBe('Viewing')
    })

    it('holds a slider for each parameter some mode shows, and no other', () => {
      const shown = Array.dedupe(
        Array.flatMap(TransitionMode.literals, parametersFor),
      )

      expect(Array.sort(Record.keys(started.sliders), Order.String)).toEqual(
        Array.sort(shown, Order.String),
      )
    })

    it('watches drags only for those sliders and the curve handles', () => {
      const keys = Record.keys(subscriptions)

      expect(Array.filter(keys, key => key.startsWith('Ease'))).toEqual([])
      expect(Array.some(keys, key => key.startsWith('Bounce:'))).toBe(true)
      expect(keys).toContain('dragPointer')
    })
  })

  describe('parameters', () => {
    it('reports a slider change as the transition with that parameter set', () => {
      Story.story(
        editing(timeSpring),
        Story.given(started),
        Story.message(jumpSlider('Bounce', 0.3)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({
            value: Transition.TimeSpring({ visualDuration: 0.4, bounce: 1 }),
          }),
        ),
      )
    })

    it('leaves a transition unchanged by a parameter its mode does not have', () => {
      expect(withParameter(easing, 'Bounce', 1)).toBe(easing)
      expect(withParameter(timeSpring, 'Mass', 4)).toBe(timeSpring)
    })

    it("lists each mode's parameters in DialKit's order", () => {
      expect(parametersFor('Easing')).toEqual(['EasingDuration'])
      expect(parametersFor('TimeSpring')).toEqual(['Bounce', 'VisualDuration'])
      expect(parametersFor('PhysicsSpring')).toEqual([
        'Stiffness',
        'Damping',
        'Mass',
      ])
    })
  })

  describe('mode switch', () => {
    it('reports the cached value of the selected mode', () => {
      Story.story(
        editing(timeSpring),
        Story.given(started),
        Story.message(selectMode(0, 'Easing')),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: DEFAULT_EASING }),
        ),
        focusedMode,
        Story.model(model => {
          expect(model.cache.timeSpring).toEqual(timeSpring)
        }),
      )
    })

    it('reports nothing when the current mode is chosen again', () => {
      Story.story(
        editing(timeSpring),
        Story.given(started),
        Story.message(selectMode(1, 'TimeSpring')),
        Story.expectNoOutMessage(),
        focusedMode,
      )
    })

    it('restores the edits of a mode after switching away and back', () => {
      const away = update(
        started,
        selectMode(2, 'PhysicsSpring'),
        timeSpring,
      ).model

      Story.story(
        editing(DEFAULT_PHYSICS_SPRING),
        Story.given(away),
        Story.message(selectMode(1, 'TimeSpring')),
        Story.expectOutMessage(OutMessage.ChangedValue({ value: timeSpring })),
        focusedMode,
      )
    })
  })

  describe('easing curve', () => {
    it('keeps the duration when a curve handle moves', () => {
      Story.story(
        editing(easing),
        Story.given(started),
        Story.message(
          Message.GotBezierMessage({
            message: BezierEditor.Message.PressedKeyboardNavigation({
              handle: 'First',
              direction: 'Right',
              increment: 'Coarse',
              value: easing.ease,
            }),
          }),
        ),
        Story.expectOutMessage(
          OutMessage.ChangedValue({
            value: Transition.Easing({ duration: 0.5, ease: [0.5, 0, 0.2, 1] }),
          }),
        ),
      )
    })

    it('commits a typed ease on Enter and keeps the duration', () => {
      Story.story(
        editing(easing),
        Story.given(started),
        Story.message(Message.UpdatedEaseDraft({ draft: '0.1, 0.7, 0.1, 1' })),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.easeDraft).toEqual({
            _tag: 'Editing',
            draft: '0.1, 0.7, 0.1, 1',
          })
        }),
        Story.message(Message.PressedEnterInEaseInput()),
        Story.expectOutMessage(
          OutMessage.ChangedValue({
            value: Transition.Easing({
              duration: 0.5,
              ease: [0.1, 0.7, 0.1, 1],
            }),
          }),
        ),
        Story.model(model => {
          expect(model.easeDraft._tag).toBe('Viewing')
          expect(model.cache.easing.ease).toEqual([0.1, 0.7, 0.1, 1])
        }),
      )
    })

    it('commits a typed ease on blur', () => {
      Story.story(
        editing(easing),
        Story.given(started),
        Story.message(Message.UpdatedEaseDraft({ draft: '0, 0, 1, 1' })),
        Story.message(Message.BlurredEaseInput()),
        Story.expectOutMessage(
          OutMessage.ChangedValue({
            value: Transition.Easing({ duration: 0.5, ease: [0, 0, 1, 1] }),
          }),
        ),
      )
    })

    it('drops an invalid typed ease without a change', () => {
      Story.story(
        editing(easing),
        Story.given(started),
        Story.message(Message.UpdatedEaseDraft({ draft: '0, 0, 1.5, 1' })),
        Story.message(Message.PressedEnterInEaseInput()),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.easeDraft._tag).toBe('Viewing')
        }),
      )
    })

    it('reports nothing when the typed ease is the current one', () => {
      Story.story(
        editing(easing),
        Story.given(started),
        Story.message(Message.UpdatedEaseDraft({ draft: '0.4, 0, 0.2, 1' })),
        Story.message(Message.PressedEnterInEaseInput()),
        Story.expectNoOutMessage(),
      )
    })

    it('discards the draft on Escape', () => {
      Story.story(
        editing(easing),
        Story.given(started),
        Story.message(Message.UpdatedEaseDraft({ draft: '0, 0, 1, 1' })),
        Story.message(Message.PressedEscapeInEaseInput()),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.easeDraft._tag).toBe('Viewing')
        }),
        Story.message(Message.BlurredEaseInput()),
        Story.expectNoOutMessage(),
      )
    })
  })

  describe('parseEase', () => {
    it('round-trips a formatted ease', () => {
      expect(parseEase(formatEase(easing.ease))).toEqual(
        Option.some(easing.ease),
      )
    })

    it('accepts a CSS cubic-bezier() and clamps Y to -1 to 2', () => {
      expect(parseEase('cubic-bezier(0.4, 0, 0.2, 1)')).toEqual(
        Option.some([0.4, 0, 0.2, 1]),
      )
      expect(parseEase(' .1, -2e2, +.9, 3. ')).toEqual(
        Option.some([0.1, -1, 0.9, 2]),
      )
    })

    it.each([
      '0, Infinity, 1, 1',
      '0, NaN, 1, 1',
      '0, 2px, 1, 1',
      '0, , 1, 1',
      '-0.1, 0, 1, 1',
      '0, 0, 1.1, 1',
      '0,0,1',
      '0,0,1,1,2',
      '0,1e999,1,1',
    ])('rejects %j as DialKit does', text => {
      expect(parseEase(text)).toEqual(Option.none())
    })
  })
})
