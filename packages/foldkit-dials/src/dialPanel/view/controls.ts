import { Array, Match } from 'effect'
import { type Html } from 'foldkit/html'

import { type Control, type LeafControl, pathKey } from '../../dial/index.js'
import { colorView } from './color.js'
import { imageView } from './image.js'
import {
  actionView,
  selectView,
  sliderView,
  textView,
  toggleView,
} from './scalar.js'
import { type Context, folderShellView } from './shared.js'
import { padView, transitionView } from './spatial.js'

const leafView = (context: Context, leaf: LeafControl): Html =>
  Match.value(leaf.meta).pipe(
    Match.withReturnType<Html>(),
    Match.tagsExhaustive({
      Slider: meta => sliderView(context, leaf, meta),
      Toggle: () => toggleView(context, leaf),
      Select: meta => selectView(context, leaf, meta),
      Text: meta => textView(context, leaf, meta),
      Action: () => actionView(context, leaf),
      Color: () => colorView(context, leaf),
      Image: () => imageView(context, leaf),
      Pad: meta => padView(context, leaf, meta),
      Transition: meta => transitionView(context, leaf, meta),
    }),
  )

const folderView = (
  context: Context,
  folder: Extract<Control, { _tag: 'Folder' }>,
): Html =>
  folderShellView(context, {
    key: pathKey(folder.path),
    label: folder.label,
    content: controlsView(context, folder.children),
  })

/** Renders the control tree in specification order. */
export const controlsView = (
  context: Context,
  controls: ReadonlyArray<Control>,
): ReadonlyArray<Html> =>
  Array.map(controls, control =>
    control._tag === 'Leaf'
      ? leafView(context, control)
      : folderView(context, control),
  )
