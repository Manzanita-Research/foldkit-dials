import { Array, Option, Predicate, Record } from 'effect'
import { type Html } from 'foldkit/html'

import {
  type DialMeta,
  type LeafControl,
  getAtPath,
  pathKey,
} from '../../dial/index.js'
import * as DialPad from '../../dialPad/index.js'
import { isTransition } from '../../transition/index.js'
import * as TransitionEditor from '../../transitionEditor/index.js'
import { transitionSlot } from '../controls.js'
import { Message } from '../message.js'
import { type Context, folderShellView } from './shared.js'

const padAxisFieldView = (
  context: Context,
  axisLabelAttributes: DialPad.DialPadAttributes['xLabel'],
  axisLabel: string,
  formattedValue: string,
): Html => {
  const { h } = context
  return h.div(
    [h.Class('dialkit-pad-field')],
    [
      h.span(
        [...axisLabelAttributes, h.Class('dialkit-pad-axis')],
        [axisLabel],
      ),
      h.span([h.Class('dialkit-pad-value fkd-pad-value')], [formattedValue]),
    ],
  )
}

const padFieldsView = (
  context: Context,
  leaf: LeafControl,
  { attributes, axisLabels, formattedValue }: DialPad.RenderInfo,
): Html => {
  const { h } = context
  return h.div(
    [h.Class('dialkit-pad-fields')],
    [
      h.div(
        [h.Class('dialkit-pad-caption')],
        [
          h.span(
            [...attributes.label, h.Class('dialkit-pad-label')],
            [leaf.label],
          ),
        ],
      ),
      padAxisFieldView(
        context,
        attributes.xLabel,
        axisLabels.x,
        formattedValue.x,
      ),
      padAxisFieldView(
        context,
        attributes.yLabel,
        axisLabels.y,
        formattedValue.y,
      ),
    ],
  )
}

const padSurfaceView = (
  context: Context,
  { attributes, gridLineOffsets, thumbPosition }: DialPad.RenderInfo,
): Html => {
  const { h } = context
  return h.div(
    [...attributes.surface, h.Class('dialkit-pad-surface')],
    [
      h.div(
        [...attributes.grid, h.Class('dialkit-pad-grid')],
        Array.flatMap(gridLineOffsets, offset => [
          h.span([
            h.Class('dialkit-pad-grid-line dialkit-pad-grid-vertical'),
            h.Style({ left: offset }),
          ]),
          h.span([
            h.Class('dialkit-pad-grid-line dialkit-pad-grid-horizontal'),
            h.Style({ top: offset }),
          ]),
        ]),
      ),
      h.div(
        [...attributes.plane, h.Class('dialkit-pad-plane')],
        [
          h.span([h.Class('dialkit-pad-center')]),
          h.span([
            ...attributes.thumb,
            h.Class('dialkit-pad-point'),
            h.Style({ left: thumbPosition.left, top: thumbPosition.top }),
          ]),
        ],
      ),
    ],
  )
}

/** Renders a pad and its axis fields. */
export const padView = (
  context: Context,
  leaf: LeafControl,
  meta: Extract<DialMeta, { _tag: 'Pad' }>,
): Html => {
  const { h, model, values } = context
  const key = pathKey(leaf.path)
  const current = getAtPath(values, leaf.path)
  const x = getAtPath(current, ['x'])
  const y = getAtPath(current, ['y'])
  const value = {
    x: Predicate.isNumber(x) ? x : meta.x.default,
    y: Predicate.isNumber(y) ? y : meta.y.default,
  }

  return Option.match(Record.get(model.pads, key), {
    onNone: () => h.empty,
    onSome: padModel =>
      h.submodel({
        slotId: `pad-${key}`,
        model: padModel,
        view: DialPad.view,
        toParentMessage: message =>
          Message.GotPadMessage({ dialId: key, message }),
        viewInputs: {
          value,
          label: leaf.label,
          axisLabels: meta.labels,
          toView: render =>
            h.div(
              [...render.attributes.root, h.Class('dialkit-pad')],
              [
                padFieldsView(context, leaf, render),
                padSurfaceView(context, render),
                h.span(
                  [
                    ...render.attributes.instructions,
                    h.Class('dialkit-pad-instructions'),
                  ],
                  [render.instructions],
                ),
              ],
            ),
        },
      }),
  })
}

/** Renders a transition editor inside a folder. */
export const transitionView = (
  context: Context,
  leaf: LeafControl,
  meta: Extract<DialMeta, { _tag: 'Transition' }>,
): Html => {
  const { h, model, values } = context
  const key = pathKey(leaf.path)
  const current = getAtPath(values, leaf.path)
  const value = isTransition(current) ? current : meta.default

  return Option.match(Record.get(model.transitions, key), {
    onNone: () => h.empty,
    onSome: editorModel =>
      folderShellView(context, {
        key,
        label: leaf.label,
        content: [
          h.submodel({
            slotId: `transition-${key}`,
            model: editorModel,
            view: TransitionEditor.view,
            toParentMessage: transitionSlot.toParentMessage(key),
            viewInputs: { value, label: leaf.label },
          }),
        ],
      }),
  })
}
