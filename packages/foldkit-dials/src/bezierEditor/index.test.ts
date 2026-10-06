import { Array } from 'effect'
import * as Story from 'foldkit/story'
import { describe, expect, it } from 'vitest'

import type { CubicBezier } from '../transition/index.js'
import {
  FocusHandle,
  Message,
  OutMessage,
  VIEW_BOX_HEIGHT,
  VIEW_BOX_WIDTH,
  bezierGeometry,
  controlLineEnd,
  init,
  moveHandle,
  update,
} from './index.js'

const GRAPH_PADDING = 12

const defaultInit = () => init({ id: 'ease' })

const startingCurve: CubicBezier = [0.25, 0, 0.75, 1]

const fullSize = { width: VIEW_BOX_WIDTH, height: VIEW_BOX_HEIGHT }

const dragging = (
  editorSize = fullSize,
  originValue: CubicBezier = startingCurve,
) =>
  update(
    defaultInit(),
    Message.PressedHandle({
      handle: 'First',
      pointer: { x: 100, y: 100 },
      editorSize,
      originValue,
    }),
  ).model

const moveTo = (x: number, y: number) =>
  Message.MovedDragPointer({ pointer: { x, y } })

describe('BezierEditor', () => {
  describe('init', () => {
    it('starts Idle', () => {
      expect(defaultInit().dragState._tag).toBe('Idle')
    })
  })

  describe('geometry', () => {
    it('fits the 0,0 to 1,1 diagonal inside the padding', () => {
      const geometry = bezierGeometry([0, 0, 1, 1])

      expect(geometry.scale).toBe(156)
      expect(geometry.start).toEqual({ x: 50, y: 168 })
      expect(geometry.end).toEqual({ x: 206, y: 12 })
      expect(geometry.curvePath).toBe('M 50 168 C 50 168, 206 12, 206 12')
    })

    it('keeps the diagonal at 45 degrees and centered as overshoot grows', () => {
      const normal = bezierGeometry([0.25, 0, 0.75, 1])
      const extreme = bezierGeometry([0.25, -1, 0.75, 2])

      expect(extreme.scale).toBeLessThan(normal.scale)
      Array.forEach([normal, extreme], geometry => {
        expect(geometry.end.x - geometry.start.x).toBeCloseTo(
          geometry.start.y - geometry.end.y,
        )
        expect((geometry.start.x + geometry.end.x) / 2).toBe(VIEW_BOX_WIDTH / 2)
        expect((geometry.start.y + geometry.end.y) / 2).toBe(
          VIEW_BOX_HEIGHT / 2,
        )
      })
      expect(extreme.firstHandle.y).toBe(VIEW_BOX_HEIGHT - GRAPH_PADDING)
      expect(extreme.secondHandle.y).toBe(GRAPH_PADDING)
    })

    it.each<Readonly<{ curve: CubicBezier }>>([
      { curve: [0.42, 0, 0.58, 1] },
      { curve: [0.25, -0.6, 0.6, 1.6] },
      { curve: [0.15, -8, 0.85, 9] },
      { curve: [0, -1e6, 1, 1e6] },
    ])('keeps every point of $curve inside the padding', ({ curve }) => {
      const geometry = bezierGeometry(curve)

      Array.forEach(
        [
          geometry.start,
          geometry.firstHandle,
          geometry.secondHandle,
          geometry.end,
        ],
        point => {
          expect(point.x).toBeGreaterThanOrEqual(GRAPH_PADDING - 1e-9)
          expect(point.x).toBeLessThanOrEqual(
            VIEW_BOX_WIDTH - GRAPH_PADDING + 1e-9,
          )
          expect(point.y).toBeGreaterThanOrEqual(GRAPH_PADDING - 1e-9)
          expect(point.y).toBeLessThanOrEqual(
            VIEW_BOX_HEIGHT - GRAPH_PADDING + 1e-9,
          )
        },
      )
    })

    it('draws values that are not finite or have X outside 0 to 1 as their nearest valid curve', () => {
      expect(bezierGeometry([Number.NaN, -Infinity, 2, Infinity])).toEqual(
        bezierGeometry([0, 0, 1, 1]),
      )
    })

    it('stops control lines at the handle rim without reversing short ones', () => {
      expect(controlLineEnd({ x: 0, y: 0 }, { x: 30, y: 40 })).toEqual({
        x: 27,
        y: 36,
      })
      expect(controlLineEnd({ x: 30, y: 40 }, { x: 0, y: 0 })).toEqual({
        x: 3,
        y: 4,
      })
      expect(controlLineEnd({ x: 0, y: 0 }, { x: 3, y: 4 })).toEqual({
        x: 0,
        y: 0,
      })
      expect(controlLineEnd({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual({
        x: 1,
        y: 1,
      })
    })
  })

  describe('moveHandle', () => {
    it('moves one handle and clamps X to 0 to 1 and Y to -1 to 2', () => {
      expect(moveHandle(startingCurve, 'First', { x: 0.25, y: -0.5 })).toEqual([
        0.5, -0.5, 0.75, 1,
      ])
      expect(moveHandle(startingCurve, 'First', { x: 0.25, y: -4 })).toEqual([
        0.5, -1, 0.75, 1,
      ])
      expect(moveHandle(startingCurve, 'Second', { x: 20, y: 8 })).toEqual([
        0.25, 0, 1, 2,
      ])
      expect(moveHandle(startingCurve, 'First', { x: -20, y: 0 })).toEqual([
        0, 0, 0.75, 1,
      ])
    })

    it('keeps the exact value of an axis that did not move', () => {
      const precise: CubicBezier = [0.12345, -0.98765, 0.54321, 1.23456]

      expect(moveHandle(precise, 'First', { x: 0, y: 0 })).toEqual(precise)
      expect(moveHandle(precise, 'First', { x: 0, y: 0.01 })).toEqual([
        0.12345, -0.98, 0.54321, 1.23456,
      ])
    })
  })

  describe('pointer', () => {
    it('starts dragging the pressed handle and focuses it', () => {
      Story.story(
        update,
        Story.given(defaultInit()),
        Story.message(
          Message.PressedHandle({
            handle: 'Second',
            pointer: { x: 100, y: 100 },
            editorSize: fullSize,
            originValue: startingCurve,
          }),
        ),
        Story.expectNoOutMessage(),
        Story.Command.expectExact(
          FocusHandle({ id: 'ease', handle: 'Second' }),
        ),
        Story.Command.resolve(FocusHandle, Message.CompletedFocusHandle()),
        Story.model(model => {
          expect(model.dragState).toMatchObject({
            _tag: 'Dragging',
            handle: 'Second',
          })
        }),
      )
    })

    it('maps pointer travel to curve units with the scale at the press', () => {
      Story.story(
        update,
        Story.given(dragging()),
        Story.message(moveTo(139, 178)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: [0.5, -0.5, 0.75, 1] }),
        ),
      )
    })

    it('moves twice as far per pixel when the editor renders at half size', () => {
      Story.story(
        update,
        Story.given(
          dragging({ width: VIEW_BOX_WIDTH / 2, height: VIEW_BOX_HEIGHT / 2 }),
        ),
        Story.message(moveTo(139, 139)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: [0.75, -0.5, 0.75, 1] }),
        ),
      )
    })

    it('uses the smaller scale of an overshooting curve', () => {
      Story.story(
        update,
        Story.given(dragging(fullSize, [0.25, -1, 0.75, 2])),
        Story.message(moveTo(126, 100)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: [0.75, -1, 0.75, 2] }),
        ),
      )
    })

    it('ignores a second press while dragging', () => {
      Story.story(
        update,
        Story.given(dragging()),
        Story.message(
          Message.PressedHandle({
            handle: 'Second',
            pointer: { x: 0, y: 0 },
            editorSize: fullSize,
            originValue: startingCurve,
          }),
        ),
        Story.Command.expectNone(),
        Story.model(model => {
          expect(model.dragState).toMatchObject({ handle: 'First' })
        }),
      )
    })

    it('ignores pointer moves when not dragging', () => {
      Story.story(
        update,
        Story.given(defaultInit()),
        Story.message(moveTo(139, 178)),
        Story.expectNoOutMessage(),
      )
    })

    it('stops dragging on release without reporting a value', () => {
      Story.story(
        update,
        Story.given(dragging()),
        Story.message(Message.ReleasedDragPointer()),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.dragState._tag).toBe('Idle')
        }),
      )
    })

    it('restores the curve from before the drag on Escape', () => {
      Story.story(
        update,
        Story.given(update(dragging(), moveTo(139, 178)).model),
        Story.message(Message.CancelledDrag()),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: startingCurve }),
        ),
        Story.model(model => {
          expect(model.dragState._tag).toBe('Idle')
        }),
      )
    })

    it('reports nothing for a move that leaves the curve where it is', () => {
      Story.story(
        update,
        Story.given(update(dragging(), moveTo(139, 178)).model),
        Story.message(moveTo(139, 178)),
        Story.expectNoOutMessage(),
        Story.message(moveTo(139.1, 178)),
        Story.expectNoOutMessage(),
        Story.message(moveTo(100, 100)),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: startingCurve }),
        ),
      )
    })

    it('reports nothing on Escape before the curve has moved', () => {
      Story.story(
        update,
        Story.given(dragging()),
        Story.message(Message.CancelledDrag()),
        Story.expectNoOutMessage(),
        Story.model(model => {
          expect(model.dragState._tag).toBe('Idle')
        }),
      )
    })

    it('reports nothing on Escape when not dragging', () => {
      Story.story(
        update,
        Story.given(defaultInit()),
        Story.message(Message.CancelledDrag()),
        Story.expectNoOutMessage(),
      )
    })
  })

  describe('keyboard', () => {
    const edgeCurve: CubicBezier = [0, -1, 1, 2]

    it.each([
      ['First', 'Right', 'Fine', [0.01, -1, 1, 2]],
      ['Second', 'Down', 'Coarse', [0, -1, 1, 1.9]],
      ['Second', 'Left', 'Fine', [0, -1, 0.99, 2]],
      ['First', 'Up', 'Coarse', [0, -0.9, 1, 2]],
    ] as const)(
      '%s handle %s with a %s increment moves to %o',
      (handle, direction, increment, expected) => {
        Story.story(
          update,
          Story.given(defaultInit()),
          Story.message(
            Message.PressedKeyboardNavigation({
              handle,
              direction,
              increment,
              value: edgeCurve,
            }),
          ),
          Story.expectOutMessage(
            OutMessage.ChangedValue({ value: [...expected] }),
          ),
        )
      },
    )

    it.each([
      ['First', 'Left'],
      ['First', 'Down'],
      ['Second', 'Right'],
      ['Second', 'Up'],
    ] as const)(
      '%s handle %s at the edge reports nothing',
      (handle, direction) => {
        Story.story(
          update,
          Story.given(defaultInit()),
          Story.message(
            Message.PressedKeyboardNavigation({
              handle,
              direction,
              increment: 'Coarse',
              value: edgeCurve,
            }),
          ),
          Story.expectNoOutMessage(),
        )
      },
    )

    it('ends an active drag', () => {
      Story.story(
        update,
        Story.given(dragging()),
        Story.message(
          Message.PressedKeyboardNavigation({
            handle: 'First',
            direction: 'Right',
            increment: 'Fine',
            value: startingCurve,
          }),
        ),
        Story.expectOutMessage(
          OutMessage.ChangedValue({ value: [0.26, 0, 0.75, 1] }),
        ),
        Story.model(model => {
          expect(model.dragState._tag).toBe('Idle')
        }),
      )
    })
  })
})
