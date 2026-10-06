import { Array } from 'effect'
import { inertHtml as ih } from 'foldkit/html'
import * as Scene from 'foldkit/scene'
import { describe, it } from 'vitest'

import type { RenderInfo } from './index.js'
import { FocusThumb, Message, OutMessage, init, update, view } from './index.js'

const testToView = ({
  attributes,
  gridLineOffsets,
  axisLabels,
  formattedValue,
  instructions,
}: RenderInfo) =>
  ih.div(
    [...attributes.root],
    [
      ih.span([...attributes.label], ['Offset']),
      ih.span([...attributes.xLabel], [`${axisLabels.x} ${formattedValue.x}`]),
      ih.span([...attributes.yLabel], [`${axisLabels.y} ${formattedValue.y}`]),
      ih.div(
        [...attributes.surface],
        [
          ih.div(
            [...attributes.grid],
            Array.map(gridLineOffsets, offset =>
              ih.span([ih.DataAttribute('grid-line', offset)]),
            ),
          ),
          ih.div([...attributes.plane], [ih.span([...attributes.thumb])]),
        ],
      ),
      ih.span([...attributes.instructions], [instructions]),
    ],
  )

const sceneView = Scene.withViewInputs(view, {
  value: { x: 0.5, y: -0.25 },
  label: 'Offset',
  toView: testToView,
})

const unitAxis = { min: -1, max: 1, step: 0.01, default: 0 }
const defaultModel = init({ id: 'offset', x: unitAxis, y: unitAxis })

const draggingModel = update(
  update(
    defaultModel,
    Message.PressedSurface({
      pointer: { x: 150, y: 150 },
      grabOffset: { x: 0, y: 0 },
      plane: { left: 0, top: 0, width: 300, height: 300 },
      surface: { left: 0, top: 0, width: 300, height: 300 },
      originValue: { x: 0.5, y: -0.25 },
    }),
  ).model,
  Message.MovedDragPointer({ pointer: { x: 200, y: 100 }, isShiftHeld: false }),
).model

const thumb = Scene.role('slider', { name: 'Offset' })
const surface = Scene.selector('[data-dial-pad-surface-id="offset"]')
const xLabel = Scene.selector('[data-dial-pad-axis="x"]')
const gridLines = Scene.all.selector('[data-grid-line]')

describe('DialPad', () => {
  describe('rendering', () => {
    it('makes the thumb a 2D slider named by the label, with both axis values as its value text', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.expect(thumb).toHaveAttr('tabIndex', '0'),
        Scene.expect(thumb).toHaveAttr('aria-roledescription', '2D slider'),
        Scene.expect(thumb).toHaveAttr('aria-valuetext', 'X 0.5, Y -0.25'),
        Scene.expect(thumb).toHaveAttr('aria-valuenow', '0.5'),
        Scene.expect(thumb).toHaveAttr('aria-valuemin', '-1'),
        Scene.expect(thumb).toHaveAttr('aria-valuemax', '1'),
        Scene.expect(thumb).toHaveAttr(
          'aria-describedby',
          'offset-instructions',
        ),
        Scene.expect(Scene.selector('#offset-instructions')).toHaveText(
          'Arrow keys adjust each axis. Shift adjusts by ten steps. Home resets both axes. Hold Shift while dragging to lock an axis.',
        ),
      )
    })

    it('names the axes with the given labels', () => {
      Scene.scene(
        {
          update,
          view: sceneView({ axisLabels: { x: 'Duration', y: 'Bounce' } }),
        },
        Scene.given(defaultModel),
        Scene.expect(thumb).toHaveAttr(
          'aria-valuetext',
          'Duration 0.5, Bounce -0.25',
        ),
        Scene.expect(xLabel).toHaveAttr('title', 'Duration'),
        Scene.expect(xLabel).toHaveText('Duration 0.5'),
      )
    })

    it('positions the thumb with X from the left and Y from the bottom', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.expect(thumb).toHaveStyle('left', '75%'),
        Scene.expect(thumb).toHaveStyle('top', '62.5%'),
      )
    })

    it('draws five interior grid lines', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.expectAll(gridLines).toHaveCount(5),
        Scene.expect(Scene.selector('[data-grid-line="50%"]')).toExist(),
      )
    })

    it('marks the surface and thumb while dragging', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(draggingModel),
        Scene.expect(surface).toHaveAttr('data-dragging', ''),
        Scene.expect(thumb).toHaveAttr('data-dragging', ''),
      )
    })
  })

  describe('keyboard', () => {
    it('steps one axis with the arrow keys and ten steps with Shift', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.keydown(thumb, 'ArrowRight'),
        Scene.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 0.51, y: -0.25 } }),
        ),
        Scene.keydown(thumb, 'ArrowUp', { shiftKey: true }),
        Scene.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 0.5, y: -0.15 } }),
        ),
      )
    })

    it('restores the defaults on Home', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.keydown(thumb, 'Home'),
        Scene.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 0, y: 0 } }),
        ),
      )
    })

    it('leaves arrow keys with Control, Alt, or Meta to the browser', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.keydown(thumb, 'ArrowRight', { ctrlKey: true }),
        Scene.expectIgnored(),
        Scene.keydown(thumb, 'ArrowRight', { altKey: true }),
        Scene.expectIgnored(),
        Scene.keydown(thumb, 'Home', { metaKey: true }),
        Scene.expectIgnored(),
      )
    })
  })

  describe('pointer', () => {
    it('restores the defaults on double-click', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.doubleClick(surface),
        Scene.expectOutMessage(
          OutMessage.ChangedValue({ value: { x: 0, y: 0 } }),
        ),
      )
    })

    it('focuses the thumb when a press starts on the surface', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.pointerDown(surface),
        Scene.expectHandled(),
        Scene.Command.resolve(FocusThumb, Message.CompletedFocusThumb()),
      )
    })

    it('starts a press from the thumb itself', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.pointerDown(thumb),
        Scene.expectHandled(),
        Scene.Command.resolve(FocusThumb, Message.CompletedFocusThumb()),
      )
    })

    it('ignores presses with other buttons', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.pointerDown(surface, { button: 2 }),
        Scene.expectIgnored(),
      )
    })
  })
})
