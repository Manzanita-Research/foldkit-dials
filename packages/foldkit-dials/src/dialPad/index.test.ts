import { Option } from 'effect'
import * as Story from 'foldkit/story'
import { describe, expect, it } from 'vitest'

import {
  FocusThumb,
  Message,
  OutMessage,
  gridIntersection,
  gridLineOffsets,
  init,
  snapToAxis,
  update,
  valueAtFraction,
} from './index.js'

const unitAxis = { min: -1, max: 1, step: 0.01, default: 0 }

const defaultInit = () => init({ id: 'offset', x: unitAxis, y: unitAxis })

const surface = { left: 0, top: 0, width: 300, height: 300 }
const plane = { left: 12, top: 12, width: 276, height: 276 }
const startingValue = { x: 0.5, y: 0.5 }

const pressAt = (x: number, y: number) =>
  Message.PressedSurface({
    pointer: { x, y },
    grabOffset: { x: 0, y: 0 },
    plane,
    surface,
    originValue: startingValue,
  })

const pressed = (x: number, y: number) =>
  update(defaultInit(), pressAt(x, y)).model

const moveTo = (x: number, y: number, isShiftHeld = false) =>
  Message.MovedDragPointer({ pointer: { x, y }, isShiftHeld })

const releaseAt = (x: number, y: number, isShiftHeld = false) =>
  Message.ReleasedDragPointer({ pointer: { x, y }, isShiftHeld })

const dragged = (x: number, y: number) =>
  update(pressed(150, 150), moveTo(x, y)).model

describe('DialPad', () => {
  describe('init', () => {
    it('starts Idle with the configured axes', () => {
      const model = defaultInit()

      expect(model.dragState._tag).toBe('Idle')
      expect([model.x, model.y]).toEqual([unitAxis, unitAxis])
    })
  })

  describe('geometry', () => {
    it('maps all four corners with Y increasing upward and clamps outside the plane', () => {
      const axes = { x: unitAxis, y: unitAxis }

      expect(valueAtFraction(0, 0, axes)).toEqual({ x: -1, y: 1 })
      expect(valueAtFraction(1, 0, axes)).toEqual({ x: 1, y: 1 })
      expect(valueAtFraction(0, 1, axes)).toEqual({ x: -1, y: -1 })
      expect(valueAtFraction(1, 1, axes)).toEqual({ x: 1, y: -1 })
      expect(valueAtFraction(0.5, 0.5, axes)).toEqual({ x: 0, y: 0 })
      expect(valueAtFraction(-4, 3, axes)).toEqual({ x: -1, y: -1 })
      expect(
        valueAtFraction(0.5, 0.25, {
          x: { min: 0, max: 100, step: 1, default: 25 },
          y: { min: -20, max: 20, step: 1, default: 10 },
        }),
      ).toEqual({ x: 50, y: 10 })
    })

    it('snaps from the minimum, supports tiny steps, and keeps both ends reachable', () => {
      const axis = { min: 0.05, max: 0.98, step: 0.1, default: 0.05 }

      expect(snapToAxis(0.26, axis)).toBe(0.25)
      expect(snapToAxis(0.98, axis)).toBe(0.98)
      expect(snapToAxis(50, axis)).toBe(0.98)
      expect(snapToAxis(-50, axis)).toBe(0.05)
      expect(
        snapToAxis(0.00000026, {
          min: 0,
          max: 0.000001,
          step: 0.0000001,
          default: 0,
        }),
      ).toBe(0.0000003)
    })

    it('finds grid intersections within eight pixels on both axes', () => {
      expect(gridIntersection(152, 147, 300, 300)).toEqual(
        Option.some({ x: 150, y: 150 }),
      )
      expect(gridIntersection(158, 142, 300, 300)).toEqual(
        Option.some({ x: 150, y: 150 }),
      )
      expect(gridIntersection(52, 247, 300, 300)).toEqual(
        Option.some({ x: 50, y: 250 }),
      )
      expect(gridIntersection(122, 123, 240, 240)).toEqual(
        Option.some({ x: 120, y: 120 }),
      )
      expect(gridIntersection(158.01, 150, 300, 300)).toEqual(Option.none())
      expect(gridIntersection(150, 141.99, 300, 300)).toEqual(Option.none())
      expect(gridIntersection(152, 175, 300, 300)).toEqual(Option.none())
      expect(gridIntersection(2, 2, 300, 300)).toEqual(Option.none())
      expect(gridIntersection(249, 240, 480, 480)).toEqual(Option.none())
      expect(gridIntersection(0, 0, 0, 0)).toEqual(Option.none())
    })

    it('places five interior grid lines at sixths of the surface', () => {
      expect(gridLineOffsets).toEqual([
        '16.67%',
        '33.33%',
        '50%',
        '66.67%',
        '83.33%',
      ])
    })
  })

  describe('pointer', () => {
    it('sets the value from the pressed point and focuses the thumb', () => {
      Story.story(
        update,
        Story.given(defaultInit()),
        Story.message(pressAt(12, 12)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: -1, y: 1 } }),
        ),
        Story.Command.expectExact(FocusThumb({ id: 'offset' })),
        Story.Command.resolve(FocusThumb, Message.CompletedFocusThumb()),
        Story.model(model => {
          expect(model.dragState._tag).toBe('Pressed')
        }),
      )
    })

    it('keeps the value when the press grabs the thumb off center', () => {
      Story.story(
        update,
        Story.given(defaultInit()),
        Story.message(
          Message.PressedSurface({
            pointer: { x: 154, y: 147 },
            grabOffset: { x: 4, y: -3 },
            plane,
            surface,
            originValue: { x: 0, y: 0 },
          }),
        ),
        Story.expectNoOutMessage(),
        Story.Command.resolve(FocusThumb, Message.CompletedFocusThumb()),
      )
    })

    it('reports nothing when the plane has no size', () => {
      Story.story(
        update,
        Story.given(defaultInit()),
        Story.message(
          Message.PressedSurface({
            pointer: { x: 12, y: 12 },
            grabOffset: { x: 0, y: 0 },
            plane: { left: 0, top: 0, width: 0, height: 0 },
            surface,
            originValue: startingValue,
          }),
        ),
        Story.expectNoOutMessage(),
        Story.Command.resolve(FocusThumb, Message.CompletedFocusThumb()),
      )
    })

    it('ignores a second press while one is active', () => {
      Story.story(
        update,
        Story.given(pressed(150, 150)),
        Story.message(pressAt(12, 12)),
        Story.Command.expectNone(),
        Story.expectNoOutMessage(),
      )
    })

    it('follows the pointer and starts dragging once it travels three pixels', () => {
      Story.story(
        update,
        Story.given(pressed(150, 150)),
        Story.message(moveTo(152, 151)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 0.01, y: -0.01 } }),
        ),
        Story.model(model => {
          expect(model.dragState._tag).toBe('Pressed')
        }),
        Story.message(moveTo(288, 12)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 1, y: 1 } }),
        ),
        Story.model(model => {
          expect(model.dragState._tag).toBe('Dragging')
        }),
      )
    })

    it('ignores pointer moves when no press is active', () => {
      Story.story(
        update,
        Story.given(defaultInit()),
        Story.message(moveTo(12, 12)),
        Story.expectNoOutMessage(),
      )
    })

    it('stops on release', () => {
      Story.story(
        update,
        Story.given(dragged(288, 12)),
        Story.message(releaseAt(288, 12)),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.dragState._tag).toBe('Idle')
        }),
      )
    })
  })

  describe('grid snapping', () => {
    it('snaps a click near the center to the center', () => {
      Story.story(
        update,
        Story.given(pressed(152, 147)),
        Story.message(releaseAt(152, 147)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 0, y: 0 } }),
        ),
        Story.model(model => {
          expect(model.dragState._tag).toBe('Idle')
        }),
      )
    })

    it('snaps a click to the value under an inner intersection of the inset plane', () => {
      Story.story(
        update,
        Story.given(pressed(52, 247)),
        Story.message(releaseAt(52, 247)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: -0.72, y: -0.72 } }),
        ),
      )
    })

    it('leaves a click away from intersections where it landed', () => {
      Story.story(
        update,
        Story.given(pressed(152, 175)),
        Story.message(releaseAt(152, 175)),
        Story.expectNoOutMessage(),
      )
    })

    it('does not snap a click with Shift held', () => {
      Story.story(
        update,
        Story.given(pressed(152, 147)),
        Story.message(releaseAt(152, 147, true)),
        Story.expectNoOutMessage(),
      )
    })

    it('does not snap a drag that ends near an intersection', () => {
      Story.story(
        update,
        Story.given(update(pressed(100, 100), moveTo(152, 147)).model),
        Story.message(releaseAt(152, 147)),
        Story.expectNoOutMessage(),
      )
    })
  })

  describe('axis lock', () => {
    it('locks to X when Shift is held and the pointer moved most horizontally', () => {
      Story.story(
        update,
        Story.given(pressed(150, 150)),
        Story.message(moveTo(190, 160, true)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 0.29, y: 0 } }),
        ),
        Story.message(moveTo(200, 250, true)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 0.36, y: 0 } }),
        ),
        Story.message(moveTo(200, 250)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 0.36, y: -0.72 } }),
        ),
      )
    })

    it('locks to Y when the pointer moved most vertically', () => {
      Story.story(
        update,
        Story.given(pressed(150, 150)),
        Story.message(moveTo(155, 100, true)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 0, y: 0.36 } }),
        ),
      )
    })

    it('holds the other axis where the drag had taken it when Shift goes down', () => {
      Story.story(
        update,
        Story.given(pressed(150, 150)),
        Story.message(moveTo(190, 160)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 0.29, y: -0.07 } }),
        ),
        Story.message(moveTo(230, 170, true)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 0.58, y: -0.07 } }),
        ),
      )
    })

    it('waits for three pixels of travel before choosing an axis', () => {
      Story.story(
        update,
        Story.given(pressed(150, 150)),
        Story.message(moveTo(151, 151, true)),
        Story.expectNoOutMessage(),
      )
    })
  })

  describe('cancel', () => {
    it('restores the value from before the press on Escape', () => {
      Story.story(
        update,
        Story.given(dragged(288, 12)),
        Story.message(Message.CancelledDrag()),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: startingValue }),
        ),
        Story.model(model => {
          expect(model.dragState._tag).toBe('Idle')
        }),
      )
    })

    it('reports nothing when no press is active', () => {
      Story.story(
        update,
        Story.given(defaultInit()),
        Story.message(Message.CancelledDrag()),
        Story.expectNoOutMessage(),
      )
    })
  })

  describe('keyboard', () => {
    const value = { x: 0.4, y: -0.3 }

    it.each([
      ['Right', 'Fine', { x: 0.41, y: -0.3 }],
      ['Left', 'Coarse', { x: 0.3, y: -0.3 }],
      ['Up', 'Fine', { x: 0.4, y: -0.29 }],
      ['Down', 'Coarse', { x: 0.4, y: -0.4 }],
    ] as const)(
      '%s with a %s increment moves one axis to %o',
      (direction, increment, expected) => {
        Story.story(
          update,
          Story.given(defaultInit()),
          Story.message(
            Message.PressedKeyboardNavigation({ direction, increment, value }),
          ),
          Story.expectOutMessage(OutMessage.ChangedValue({ value: expected })),
        )
      },
    )

    it('reports nothing at the edge of the range', () => {
      Story.story(
        update,
        Story.given(defaultInit()),
        Story.message(
          Message.PressedKeyboardNavigation({
            direction: 'Up',
            increment: 'Coarse',
            value: { x: 1, y: 1 },
          }),
        ),
        Story.expectNoOutMessage(),
      )
    })

    it('reaches the maximum when the step does not divide the range', () => {
      const axis = { min: 0.05, max: 0.98, step: 0.1, default: 0.05 }

      Story.story(
        update,
        Story.given(init({ id: 'offset', x: axis, y: axis })),
        Story.message(
          Message.PressedKeyboardNavigation({
            direction: 'Right',
            increment: 'Fine',
            value: { x: 0.95, y: 0.05 },
          }),
        ),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 0.98, y: 0.05 } }),
        ),
      )
    })
  })

  describe('reset', () => {
    it('restores the configured defaults, snapped to the step', () => {
      Story.story(
        update,
        Story.given(
          init({
            id: 'offset',
            x: { ...unitAxis, default: 0.333 },
            y: { ...unitAxis, default: -0.5 },
          }),
        ),
        Story.message(Message.RequestedReset({ value: { x: 0.8, y: 0.8 } })),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 0.33, y: -0.5 } }),
        ),
      )
    })

    it('ends an active drag', () => {
      Story.story(
        update,
        Story.given(dragged(288, 12)),
        Story.message(Message.RequestedReset({ value: { x: 1, y: 1 } })),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 0, y: 0 } }),
        ),
        Story.model(model => {
          expect(model.dragState._tag).toBe('Idle')
        }),
      )
    })

    it('reports nothing when the value is already the default', () => {
      Story.story(
        update,
        Story.given(defaultInit()),
        Story.message(Message.RequestedReset({ value: { x: 0, y: 0 } })),
        Story.expectNoOutMessage(),
      )
    })
  })
})
