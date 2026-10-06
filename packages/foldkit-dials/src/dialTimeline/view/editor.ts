import { Array, Option, Predicate, Record, pipe } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import * as Mount from 'foldkit/mount'

import { Input, Popover } from '@foldkit/ui'

import { formatLabel } from '../../dial/index.js'
import { ICON_CLOSE, strokeIcon } from '../../internal/icons.js'
import { segmented } from '../../internal/segmented.js'
import { sliderRow } from '../../internal/sliderRow.js'
import { themeAttribute } from '../../internal/theme.js'
import * as ScrubSlider from '../../scrubSlider/index.js'
import * as Timeline from '../../timeline/index.js'
import { Transition, TransitionMode } from '../../transition/index.js'
import { MODE_LABELS, PARAMETERS } from '../../transition/parameters.js'
import {
  ModeGroup,
  fieldValue,
  findEditorSlider,
  isPhysicsSpan,
  parametersOf,
} from '../editor.js'
import {
  editorFieldId,
  editorId,
  fieldKey,
  spanElementId,
  targetKey,
} from '../ids.js'
import { Message } from '../message.js'
import { type Editor, EditorField, type Model } from '../model.js'
import { iconButton } from './shared.js'

// VIEW

const EDITOR_GAP_PIXELS = 10
const EDITOR_PADDING_PIXELS = 12

const editorSliderView = (
  model: Model,
  editor: Editor,
  field: EditorField,
  label: string,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Array.fromOption(
    Option.map(
      Option.all({
        editorSlider: findEditorSlider(model, field),
        value: fieldValue(model.timeline, editor.target, field),
      }),
      ({ editorSlider, value }) =>
        h.submodel({
          slotId: `editor-${fieldKey(field)}`,
          model: editorSlider.slider,
          view: ScrubSlider.view,
          toParentMessage: message =>
            Message.GotSliderMessage({
              sliderId: editorSlider.slider.id,
              message,
            }),
          viewInputs: { value, label, toView: sliderRow({ label }) },
        }),
    ),
  )

const textFieldView = (
  model: Model,
  field: EditorField,
  label: string,
  value: string,
  h: HtmlBuilder<Message>,
): Html =>
  Input.view(
    {
      id: editorFieldId(model.id, field),
      value,
      onInput: nextValue =>
        Message.UpdatedEditorText({ field, value: nextValue }),
      toView: attributes =>
        h.label(
          [...attributes.label, h.Class('dialkit-text-control')],
          [
            h.span([h.Class('dialkit-labeled-control-label')], [label]),
            h.input([...attributes.input, h.Class('dialkit-text-input')]),
          ],
        ),
    },
    h,
  )

const valueGroupView = (
  model: Model,
  editor: Editor,
  title: string,
  values: Timeline.Values,
  toField: (prop: string) => EditorField,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Array.match(Record.toEntries(values), {
    onEmpty: (): ReadonlyArray<Html> => [],
    onNonEmpty: entries => [
      h.div(
        [
          h.Class('dialkit-timeline-editor-group'),
          h.Role('group'),
          h.AriaLabel(title),
        ],
        [
          h.div([h.Class('dialkit-labeled-control-label')], [title]),
          ...Array.flatMap(entries, ([prop, value]) =>
            Predicate.isNumber(value)
              ? editorSliderView(
                  model,
                  editor,
                  toField(prop),
                  formatLabel(prop),
                  h,
                )
              : [
                  textFieldView(
                    model,
                    toField(prop),
                    formatLabel(prop),
                    value,
                    h,
                  ),
                ],
          ),
        ],
      ),
    ],
  })

const transitionControlsView = (
  model: Model,
  editor: Editor,
  transition: Transition,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.submodel({
    slotId: 'editor-transition-mode',
    model: editor.modeGroup,
    view: ModeGroup.view,
    toParentMessage: message => Message.GotModeMessage({ message }),
    viewInputs: {
      options: TransitionMode.literals,
      selectedValue: Option.some(transition._tag),
      ariaLabel: 'Transition type',
      orientation: 'Horizontal',
      toView: segmented<TransitionMode>(mode => MODE_LABELS[mode]),
    },
  }),
  ...Array.flatMap(parametersOf(transition), parameter =>
    editorSliderView(
      model,
      editor,
      EditorField.Parameter({ parameter }),
      PARAMETERS[parameter].label,
      h,
    ),
  ),
]

const editorTitle = (name: string, span: Timeline.Span): string => {
  const label = formatLabel(name)
  return Timeline.Span.match(span, {
    Whole: () => label,
    Step: ({ index }) => `${label} ${Timeline.formatStepLabel(index)}`,
    Track: ({ prop }) => `${label} ${formatLabel(prop)}`,
    TrackStep: ({ prop, index }) =>
      `${label} ${formatLabel(prop)} ${Timeline.formatStepLabel(index)}`,
  })
}

const physicsDurationView = (
  clip: Timeline.Clip,
  span: Timeline.Span,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  pipe(
    Timeline.spanDuration(clip, span),
    Option.filter(() => isPhysicsSpan(clip, span)),
    Option.map(duration =>
      h.div(
        [h.Class('dialkit-labeled-control')],
        [
          h.span([h.Class('dialkit-labeled-control-label')], ['Duration']),
          h.span(
            [h.Class('dialkit-timeline-time')],
            [`~${Timeline.formatSeconds(duration)}`],
          ),
        ],
      ),
    ),
    Array.fromOption,
  )

const editorBodyView = (
  model: Model,
  editor: Editor,
  clip: Timeline.Clip,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const { span } = editor.target
  const startLabel = Timeline.Span.matchOrElse(
    span,
    { Track: () => 'Delay' },
    () => 'Start',
  )

  return [
    ...editorSliderView(model, editor, EditorField.Start(), startLabel, h),
    ...editorSliderView(model, editor, EditorField.Duration(), 'Duration', h),
    ...physicsDurationView(clip, span, h),
    ...Option.match(Timeline.spanTransition(clip, span), {
      onNone: (): ReadonlyArray<Html> => [],
      onSome: transition =>
        transitionControlsView(model, editor, transition, h),
    }),
    ...valueGroupView(
      model,
      editor,
      'From',
      Timeline.spanFrom(clip, span),
      prop => EditorField.From({ prop }),
      h,
    ),
    ...valueGroupView(
      model,
      editor,
      'To',
      Timeline.spanTo(clip, span),
      prop => EditorField.To({ prop }),
      h,
    ),
  ]
}

// NOTE: the clip editor is hand-rolled rather than a `@foldkit/ui` Popover or
// Dialog. A Popover binds its panel to its own trigger button, but the editor
// opens from any bar or step segment. A Dialog is modal, and the timeline must
// stay live while the editor tunes it. The editor reuses Popover's anchoring
// Mount, and its Subscriptions close it on Escape, on a press outside, and
// when focus leaves it.
/** Renders the clip editor for the span it edits. */
export const editorView = (
  model: Model,
  editor: Editor,
  h: HtmlBuilder<Message>,
): Option.Option<Html> =>
  Option.map(
    Timeline.findClip(model.timeline, editor.target.key),
    ({ name, clip }) => {
      const title = editorTitle(name, editor.target.span)
      return h.keyed('div')(
        targetKey(editor.target),
        [
          h.Id(editorId(model.id)),
          h.Class('dialkit-root dialkit-timeline-popover'),
          h.DataAttribute('theme', themeAttribute(model.theme)),
          h.DataAttribute('dial-timeline-editor', model.id),
          h.Role('dialog'),
          h.AriaLabel(`Edit ${title}`),
          h.Tabindex(-1),
          h.Style({
            position: 'absolute',
            margin: '0',
            visibility: 'hidden',
          }),
          h.OnMount(
            Mount.mapMessage(
              Popover.AnchorPopover({
                buttonId: spanElementId(model.id, editor.target),
                anchor: {
                  placement: 'top',
                  gap: EDITOR_GAP_PIXELS,
                  padding: EDITOR_PADDING_PIXELS,
                  portal: true,
                },
              }),
              () => Message.CompletedAnchorClipEditor(),
            ),
          ),
        ],
        [
          h.div(
            [h.Class('dialkit-timeline-popover-header')],
            [
              h.span([h.Class('dialkit-timeline-popover-title')], [title]),
              iconButton(h, {
                className: 'dialkit-timeline-popover-close',
                label: 'Close editor',
                icon: strokeIcon(ICON_CLOSE, '', h),
                onClick: Message.ClickedCloseEditor(),
              }),
            ],
          ),
          h.div(
            [h.Class('dialkit-timeline-popover-body')],
            editorBodyView(model, editor, clip, h),
          ),
        ],
      )
    },
  )
