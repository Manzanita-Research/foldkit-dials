import { Array, Effect, Option, Record, Schema, Stream } from 'effect'
import * as Subscription from 'foldkit/subscription'

import { documentDragStyles } from '../internal/dragStyles.js'
import { attributeSelector } from '../internal/selectors.js'
import * as ScrubSlider from '../scrubSlider/index.js'
import { findOverview, findRuler, fractionWithin, isWithin } from './dom.js'
import { draggingEditorSlider } from './editor.js'
import { Message } from './message.js'
import { DragState, type Model } from './model.js'

// SUBSCRIPTION

const LaneSurface = Schema.Literals(['None', 'Lanes', 'Overview'])
type LaneSurface = typeof LaneSurface.Type

const laneSurfaceOf = (model: Model): LaneSurface =>
  DragState.match<LaneSurface>(model.dragState, {
    Idle: () => 'None',
    Scrubbing: ({ surface }) => surface,
    Zooming: () => 'Lanes',
    DraggingBar: () => 'Lanes',
    ResizingDock: () => 'None',
  })

const isInEditorOrBar = (target: EventTarget | null, id: string): boolean =>
  isWithin(target, attributeSelector('data-dial-timeline-editor', id)) ||
  isWithin(target, attributeSelector('data-dial-timeline-bar', id))

const viewportMessage = (): Message =>
  Message.ResizedViewport({ height: window.innerHeight })

const pointerEndStreams = (): ReadonlyArray<Stream.Stream<Message>> => [
  Subscription.fromEvent({
    target: document,
    type: 'pointerup',
    mapEvent: (): Message => Message.ReleasedDragPointer(),
  }),
  Subscription.fromEvent({
    target: document,
    type: 'pointercancel',
    mapEvent: (): Message => Message.CancelledDrag(),
  }),
]

const horizontalWheelDelta = (event: WheelEvent): number => {
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    return event.deltaX
  } else if (event.shiftKey) {
    return event.deltaY
  } else {
    return 0
  }
}

const dockSubscriptions = Subscription.make<Model, Message>()(entry => ({
  frame: Subscription.animationFrame<Model, Message>({
    isActive: model => model.isPlaying,
    toMessage: deltaTime => Message.TickedFrame({ deltaTime }),
  }),

  lanePointer: entry(
    { surface: LaneSurface, id: Schema.String },
    {
      modelToDependencies: model => ({
        surface: laneSurfaceOf(model),
        id: model.id,
      }),
      dependenciesToStream: ({ surface, id }) =>
        Stream.when(
          Stream.mergeAll(
            [
              Subscription.fromEventFilterMap({
                target: document,
                type: 'pointermove',
                filterMapEvent: (event): Option.Option<Message> =>
                  Option.map(
                    surface === 'Overview' ? findOverview(id) : findRuler(id),
                    element =>
                      Message.MovedLanePointer({
                        fraction: fractionWithin(element, event.clientX),
                      }),
                  ),
              }),
              ...pointerEndStreams(),
              documentDragStyles,
            ],
            { concurrency: 'unbounded' },
          ),
          Effect.sync(() => surface !== 'None'),
        ),
    },
  ),

  dockResize: entry(
    { isResizing: Schema.Boolean },
    {
      modelToDependencies: model => ({
        isResizing: model.dragState._tag === 'ResizingDock',
      }),
      dependenciesToStream: ({ isResizing }) =>
        Stream.when(
          Stream.mergeAll(
            [
              Subscription.fromEvent({
                target: document,
                type: 'pointermove',
                mapEvent: (event): Message =>
                  Message.MovedResizePointer({ clientY: event.clientY }),
              }),
              ...pointerEndStreams(),
              documentDragStyles,
            ],
            { concurrency: 'unbounded' },
          ),
          Effect.sync(() => isResizing),
        ),
    },
  ),

  dockDragEscape: entry(
    { isDragging: Schema.Boolean },
    {
      modelToDependencies: model => ({
        isDragging: model.dragState._tag !== 'Idle',
      }),
      dependenciesToStream: ({ isDragging }) =>
        Stream.when(
          Subscription.fromEventFilterMap({
            target: document,
            type: 'keydown',
            filterMapEvent: (event): Option.Option<Message> =>
              Option.liftPredicate(
                Message.CancelledDrag(),
                () => event.key === 'Escape',
              ),
          }),
          Effect.sync(() => isDragging),
        ),
    },
  ),

  wheelPan: entry(
    { isZoomed: Schema.Boolean, id: Schema.String },
    {
      modelToDependencies: model => ({
        isZoomed: model.zoom > 1 && model.isOpen && model.isVisible,
        id: model.id,
      }),
      dependenciesToStream: ({ isZoomed, id }) =>
        Stream.when(
          Subscription.fromEventFilterMapPreventDefault({
            target: document,
            type: 'wheel',
            options: { passive: false },
            filterMapEvent: (event): Option.Option<Message> => {
              const delta = horizontalWheelDelta(event)
              const isInBody = isWithin(
                event.target,
                attributeSelector('data-dial-timeline-body', id),
              )

              if (delta === 0 || !isInBody) {
                return Option.none()
              } else {
                return Option.flatMap(findRuler(id), ruler => {
                  const { width } = ruler.getBoundingClientRect()
                  return Option.liftPredicate(
                    Message.ScrolledLanes({ deltaFraction: delta / width }),
                    () => width > 0,
                  )
                })
              }
            },
          }),
          Effect.sync(() => isZoomed),
        ),
    },
  ),

  editorDismiss: entry(
    { isEditorOpen: Schema.Boolean, id: Schema.String },
    {
      modelToDependencies: model => ({
        isEditorOpen: Option.isSome(model.maybeEditor),
        id: model.id,
      }),
      dependenciesToStream: ({ isEditorOpen, id }) =>
        Stream.when(
          Stream.mergeAll(
            [
              Subscription.fromEventFilterMap({
                target: document,
                type: 'pointerdown',
                options: { capture: true },
                filterMapEvent: (event): Option.Option<Message> =>
                  Option.liftPredicate(
                    Message.PressedOutsideEditor(),
                    () => !isInEditorOrBar(event.target, id),
                  ),
              }),
              // NOTE: the editor is portalled to the end of the document, so
              // Tab out of it would leave it open and detached from its bar.
              // Focus landing elsewhere closes it, as a Popover closes on
              // blur, and focus stays where it landed. Watching `focusin`
              // rather than `focusout` ignores the window losing focus.
              Subscription.fromEventFilterMap({
                target: document,
                type: 'focusin',
                filterMapEvent: (event): Option.Option<Message> =>
                  Option.liftPredicate(
                    Message.MovedFocusOutsideEditor(),
                    () => !isInEditorOrBar(event.target, id),
                  ),
              }),
              Subscription.fromEventFilterMap({
                target: document,
                type: 'keydown',
                filterMapEvent: (event): Option.Option<Message> =>
                  Option.liftPredicate(
                    Message.PressedEscapeInEditor(),
                    () => event.key === 'Escape' && !event.defaultPrevented,
                  ),
              }),
            ],
            { concurrency: 'unbounded' },
          ),
          Effect.sync(() => isEditorOpen),
        ),
    },
  ),

  viewport: Subscription.persistent(
    Stream.concat(
      Stream.sync(() => viewportMessage()),
      Subscription.fromEvent({
        target: window,
        type: 'resize',
        mapEvent: viewportMessage,
      }),
    ),
  ),
}))

const editorSliderSubscriptions = Subscription.lift(ScrubSlider.subscriptions)<
  Model,
  Message
>({
  read: model =>
    Option.map(draggingEditorSlider(model), ({ slider }) => slider),
  toParentMessage: message => Message.GotDraggingSliderMessage({ message }),
})

/** The dock's Subscriptions: frame ticks while playing, pointer drags for
 *  seeking, zooming, bar edits, and dock resizing, horizontal wheel panning
 *  while zoomed, dismissal of the clip editor, the viewport height that
 *  bounds the dock, and the drag of whichever editor slider is active.
 *  Every key starts with the dock `id`, so several docks, or a dock and a
 *  panel, combine with `Subscription.aggregate`. */
export const subscriptions = (
  id: string,
): Subscription.Subscriptions<Model, Message> =>
  Record.mapKeys(
    Subscription.aggregate(dockSubscriptions, editorSliderSubscriptions),
    name => `${id}:${name}`,
  )

const CONTINUOUS_TAGS: ReadonlyArray<Message['_tag']> = [
  'TickedFrame',
  'MovedLanePointer',
  'ScrolledLanes',
  'MovedResizePointer',
  'ResizedViewport',
]

/** Whether a Message is one playback frame, one step of a drag, or one step
 *  of a window resize. A host can route these under their own tag, so
 *  DevTools `excludeFromHistory` leaves them out while clicks and drops stay
 *  in history. */
export const isContinuousMessage = (message: Message): boolean =>
  Array.contains(CONTINUOUS_TAGS, message._tag) ||
  ((message._tag === 'GotSliderMessage' ||
    message._tag === 'GotDraggingSliderMessage') &&
    message.message._tag === 'MovedDragPointer')
