import { inertHtml as ih } from 'foldkit/html'
import * as Scene from 'foldkit/scene'
import { describe, it } from 'vitest'

import type { RenderInfo } from './index.js'
import { Message, OutMessage, init, update, view } from './index.js'

const testToView = ({ attributes, instructions }: RenderInfo) =>
  ih.div(
    [...attributes.root],
    [
      ih.svg(
        [...attributes.svg],
        [
          ih.line([
            ...attributes.referenceLine,
            ih.DataAttribute('line', 'reference'),
          ]),
          ih.line([
            ...attributes.firstControlLine,
            ih.DataAttribute('line', 'first'),
          ]),
          ih.line([
            ...attributes.secondControlLine,
            ih.DataAttribute('line', 'second'),
          ]),
          ih.path([...attributes.curve]),
          ih.circle([
            ...attributes.startPoint,
            ih.DataAttribute('point', 'start'),
          ]),
          ih.circle([...attributes.endPoint, ih.DataAttribute('point', 'end')]),
        ],
      ),
      ih.button([...attributes.firstHandle]),
      ih.button([...attributes.secondHandle]),
      ih.span([...attributes.instructions], [instructions]),
    ],
  )

const sceneView = Scene.withViewInputs(view, {
  value: [0.25, 0, 0.75, 1],
  toView: testToView,
})

const defaultModel = init({ id: 'ease' })

const root = Scene.role('group', { name: 'Bézier easing curve' })
const firstHandle = Scene.role('slider', { name: 'Bézier handle 1' })
const secondHandle = Scene.role('slider', { name: 'Bézier handle 2' })
const curve = Scene.selector('path')

describe('BezierEditor', () => {
  describe('rendering', () => {
    it('labels the editor as a group and hides the SVG from assistive technology', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.expect(root).toHaveAttr('data-bezier-editor-id', 'ease'),
        Scene.expect(Scene.selector('svg')).toHaveAttr(
          'viewBox',
          '0 0 256 180',
        ),
        Scene.expect(Scene.selector('svg')).toHaveAttr('aria-hidden', 'true'),
      )
    })

    it('draws the curve, the reference diagonal, and control lines that stop at the handle rims', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.expect(curve).toHaveAttr(
          'd',
          'M 50 168 C 89 168, 167 12, 206 12',
        ),
        Scene.expect(Scene.selector('[data-line="reference"]')).toHaveAttr(
          'x1',
          '50',
        ),
        Scene.expect(Scene.selector('[data-line="reference"]')).toHaveAttr(
          'y2',
          '12',
        ),
        Scene.expect(Scene.selector('[data-line="first"]')).toHaveAttr(
          'x2',
          '84',
        ),
        Scene.expect(Scene.selector('[data-line="second"]')).toHaveAttr(
          'x2',
          '172',
        ),
        Scene.expect(Scene.selector('[data-point="start"]')).toHaveAttr(
          'cx',
          '50',
        ),
        Scene.expect(Scene.selector('[data-point="end"]')).toHaveAttr(
          'cy',
          '12',
        ),
      )
    })

    it('makes each handle a 2D slider with its coordinates as its value text', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.expect(firstHandle).toHaveAttr('tabIndex', '0'),
        Scene.expect(firstHandle).toHaveAttr('type', 'button'),
        Scene.expect(firstHandle).toHaveAttr(
          'aria-roledescription',
          '2D slider',
        ),
        Scene.expect(firstHandle).toHaveAttr('aria-valuetext', 'X 0.25, Y 0'),
        Scene.expect(firstHandle).toHaveAttr('aria-valuenow', '0.25'),
        Scene.expect(secondHandle).toHaveAttr('aria-valuetext', 'X 0.75, Y 1'),
        Scene.expect(firstHandle).toHaveAttr(
          'aria-describedby',
          'ease-instructions',
        ),
        Scene.expect(Scene.selector('#ease-instructions')).toHaveText(
          'Drag to adjust X from 0 to 1 and Y from -1 to 2. Arrow keys adjust by 0.01. Shift adjusts by 0.1. Escape cancels a drag.',
        ),
      )
    })

    it('positions each handle over its control point', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.expect(firstHandle).toHaveStyle('left', '34.77%'),
        Scene.expect(firstHandle).toHaveStyle('top', '93.33%'),
        Scene.expect(secondHandle).toHaveStyle('left', '65.23%'),
        Scene.expect(secondHandle).toHaveStyle('top', '6.67%'),
      )
    })

    it('marks only the dragged handle', () => {
      const draggingModel = update(
        defaultModel,
        Message.PressedHandle({
          handle: 'Second',
          pointer: { x: 0, y: 0 },
          editorSize: { width: 256, height: 180 },
          originValue: [0.25, 0, 0.75, 1],
        }),
      ).model

      Scene.scene(
        { update, view: sceneView() },
        Scene.given(draggingModel),
        Scene.expect(secondHandle).toHaveAttr('data-dragging', ''),
        Scene.expect(firstHandle).not.toHaveAttr('data-dragging'),
        Scene.expect(root).toHaveAttr('data-dragging', ''),
      )
    })
  })

  describe('keyboard', () => {
    it('moves the focused handle by 0.01 and by 0.1 with Shift', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.keydown(firstHandle, 'ArrowRight'),
        Scene.expectOutMessage(
          OutMessage.ChangedValue({ value: [0.26, 0, 0.75, 1] }),
        ),
        Scene.keydown(secondHandle, 'ArrowUp', { shiftKey: true }),
        Scene.expectOutMessage(
          OutMessage.ChangedValue({ value: [0.25, 0, 0.75, 1.1] }),
        ),
      )
    })

    it('leaves other keys and modified arrows to the browser', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.keydown(firstHandle, 'Tab'),
        Scene.expectIgnored(),
        Scene.keydown(firstHandle, 'ArrowRight', { metaKey: true }),
        Scene.expectIgnored(),
      )
    })
  })

  describe('pointer', () => {
    it('ignores a press while the editor has no size', () => {
      Scene.scene(
        { update, view: sceneView() },
        Scene.given(defaultModel),
        Scene.pointerDown(firstHandle),
        Scene.expectIgnored(),
      )
    })
  })
})
