import {
  Array,
  Effect,
  Option,
  Record,
  Schema,
  Stream,
  String,
  pipe,
} from 'effect'
import * as Subscription from 'foldkit/subscription'

import * as ColorField from '../colorField/index.js'
import { type LeafMeta, pathKey } from '../dial/index.js'
import * as DialPad from '../dialPad/index.js'
import * as ImagePicker from '../imagePicker/index.js'
import { attributeSelector } from '../internal/selectors.js'
import * as ScrubSlider from '../scrubSlider/index.js'
import * as TransitionEditor from '../transitionEditor/index.js'
import {
  type ControlSlot,
  colorSlot,
  imageSlot,
  padSlot,
  sliderSlot,
  transitionSlot,
} from './controls.js'
import { Message } from './message.js'
import { HeaderDrag, type Model } from './model.js'
import {
  findShortcutTarget,
  isShortcutKey,
  modifierOf,
  scrollOnlyTargets,
  shortcutKeyOf,
} from './shortcuts.js'
import { PANEL_ID_ATTRIBUTE, type PanelSpec } from './spec.js'

// SUBSCRIPTION

const ARROW_DIRECTIONS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
}

const FOCUSED_CONTROL_SELECTOR =
  'select, button, [role="slider"], [role="radio"], [role="listbox"], [role="menu"], [role="menuitem"], [role="menuitemradio"], [role="button"], [role="separator"], [role="group"][tabindex]'

/** Whether keyboard focus sits in a field or control, where DialKit turns
 *  shortcuts off so typing and control keys keep working. */
export const isEditableFocused = (): boolean =>
  Option.exists(
    Option.fromNullishOr(document.activeElement),
    element =>
      element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.closest(FOCUSED_CONTROL_SELECTOR) !== null ||
      (element instanceof HTMLElement && element.isContentEditable),
  )

/** The step a wheel event asks for: up for a scroll up, down for a scroll
 *  down, and none for a purely horizontal scroll. */
const wheelDirection = (deltaY: number): Option.Option<number> =>
  Option.map(
    Option.liftPredicate(deltaY, delta => delta !== 0),
    delta => -Math.sign(delta),
  )

const isInsidePanel = (event: Event, spec: PanelSpec): boolean => {
  const panelSelector = attributeSelector(`data-${PANEL_ID_ATTRIBUTE}`, spec.id)
  return Array.some(
    event.composedPath(),
    target => target instanceof Element && target.matches(panelSelector),
  )
}

const headerDragSubscriptions = Subscription.make<Model, Message>()(entry => ({
  panelHeaderDrag: entry(
    { isActive: Schema.Boolean },
    {
      modelToDependencies: model => ({
        isActive: HeaderDrag.isAnyOf(['Pressing', 'Dragging'])(
          model.headerDrag,
        ),
      }),
      dependenciesToStream: ({ isActive }) =>
        Stream.when(
          Stream.merge(
            Subscription.fromEvent({
              target: document,
              type: 'pointermove',
              mapEvent: ({ clientX, clientY }): Message =>
                Message.MovedPanelPointer({ clientX, clientY }),
            }),
            Subscription.fromEvent({
              target: document,
              type: 'pointerup',
              mapEvent: (): Message => Message.ReleasedPanelPointer(),
            }),
          ),
          Effect.sync(() => isActive),
        ),
    },
  ),
}))

/** Lifts a child control's Subscriptions once per dial of its kind, keyed
 *  `<kind>:<dial path>:<name>`. */
const liftControls = <ChildModel, ChildMessage>(
  spec: PanelSpec,
  kind: LeafMeta['_tag'],
  slot: ControlSlot<ChildModel, ChildMessage>,
  childSubscriptions: Subscription.Subscriptions<ChildModel, ChildMessage>,
): Subscription.Subscriptions<Model, Message> =>
  pipe(
    spec.leaves,
    Array.filter(({ meta }) => meta._tag === kind),
    Array.flatMap(({ path }) => {
      const dialId = pathKey(path)
      const lifted = Subscription.lift(childSubscriptions)<Model, Message>({
        read: model => Record.get(slot.read(model), dialId),
        toParentMessage: slot.toParentMessage(dialId),
      })
      return Array.map(
        Record.toEntries(lifted),
        ([name, subscription]) =>
          [
            `${String.toLowerCase(kind)}:${dialId}:${name}`,
            subscription,
          ] as const,
      )
    }),
    Record.fromEntries,
  )

const shortcutSubscriptions = (spec: PanelSpec) =>
  Subscription.make<Model, Message>()(entry => ({
    shortcutKeys: Subscription.persistent(
      Stream.mergeAll(
        [
          Subscription.fromEventFilterMap({
            target: window,
            type: 'keydown',
            filterMapEvent: (event): Option.Option<Message> => {
              const key = shortcutKeyOf(event)
              const maybeModifier = modifierOf(event)
              return pipe(
                findShortcutTarget(spec.shortcutTargets, key, maybeModifier),
                Option.filter(() => !isEditableFocused()),
                Option.map(() =>
                  Message.PressedShortcutKey({ key, maybeModifier }),
                ),
              )
            },
          }),
          Subscription.fromEventFilterMap({
            target: window,
            type: 'keyup',
            filterMapEvent: (event): Option.Option<Message> =>
              Option.map(
                Option.liftPredicate(shortcutKeyOf(event), key =>
                  isShortcutKey(spec.shortcutTargets, key),
                ),
                key => Message.ReleasedShortcutKey({ key }),
              ),
          }),
          Subscription.fromEvent({
            target: window,
            type: 'blur',
            mapEvent: (): Message => Message.BlurredWindow(),
          }),
        ],
        { concurrency: 'unbounded' },
      ),
    ),
    shortcutHeld: entry(
      { isHeld: Schema.Boolean },
      {
        modelToDependencies: model => ({
          isHeld: Array.isReadonlyArrayNonEmpty(model.heldShortcutKeys),
        }),
        dependenciesToStream: ({ isHeld }) =>
          Stream.when(
            Stream.mergeAll(
              [
                Subscription.fromEventFilterMapPreventDefault({
                  target: window,
                  type: 'keydown',
                  filterMapEvent: (event): Option.Option<Message> =>
                    pipe(
                      Record.get(ARROW_DIRECTIONS, event.key),
                      Option.filter(() => !isEditableFocused()),
                      Option.map(direction =>
                        Message.PressedArrowWithShortcut({ direction }),
                      ),
                    ),
                }),
                Subscription.fromEventFilterMapPreventDefault({
                  target: window,
                  type: 'wheel',
                  filterMapEvent: (event): Option.Option<Message> =>
                    pipe(
                      wheelDirection(event.deltaY),
                      Option.filter(() => !isEditableFocused()),
                      Option.map(direction =>
                        Message.ScrolledWithShortcut({ direction }),
                      ),
                    ),
                }),
                Subscription.fromEvent({
                  target: window,
                  type: 'mousedown',
                  mapEvent: ({ clientX }): Message =>
                    Message.PressedShortcutPointer({ clientX }),
                }),
                Subscription.fromEvent({
                  target: window,
                  type: 'mousemove',
                  mapEvent: ({ clientX }): Message =>
                    Message.MovedShortcutPointer({ clientX }),
                }),
                Subscription.fromEvent({
                  target: window,
                  type: 'mouseup',
                  mapEvent: (): Message => Message.ReleasedShortcutPointer(),
                }),
              ],
              { concurrency: 'unbounded' },
            ),
            Effect.sync(() => isHeld),
          ),
      },
    ),
    shortcutScrollOnly: entry(
      { isHeld: Schema.Boolean },
      {
        modelToDependencies: model => ({
          isHeld: Array.isReadonlyArrayNonEmpty(model.heldShortcutKeys),
        }),
        dependenciesToStream: ({ isHeld }) =>
          Stream.when(
            Subscription.fromEventFilterMapPreventDefault({
              target: window,
              type: 'wheel',
              filterMapEvent: (event): Option.Option<Message> =>
                pipe(
                  wheelDirection(event.deltaY),
                  Option.filter(
                    () => isInsidePanel(event, spec) && !isEditableFocused(),
                  ),
                  Option.map(direction =>
                    Message.ScrolledWithShortcut({ direction }),
                  ),
                ),
            }),
            Effect.sync(
              () =>
                !isHeld &&
                Array.isReadonlyArrayNonEmpty(
                  scrollOnlyTargets(spec.shortcutTargets),
                ),
            ),
          ),
      },
    ),
  }))

/** Every Subscription a panel needs: the header drag, each child control's
 *  Subscriptions, and, when any dial has a shortcut, the global shortcut
 *  listeners. Each key starts with the panel id, so several panels lift
 *  side by side. A panel without shortcuts installs no window listeners. */
export const subscriptions = (
  spec: PanelSpec,
): Subscription.Subscriptions<Model, Message> =>
  Record.mapKeys(
    Subscription.aggregate<Model, Message>()(
      headerDragSubscriptions,
      liftControls(spec, 'Slider', sliderSlot, ScrubSlider.subscriptions),
      liftControls(spec, 'Image', imageSlot, ImagePicker.subscriptions),
      liftControls(spec, 'Color', colorSlot, ColorField.subscriptions),
      liftControls(spec, 'Pad', padSlot, DialPad.subscriptions),
      liftControls(
        spec,
        'Transition',
        transitionSlot,
        TransitionEditor.subscriptions,
      ),
      Array.match(spec.shortcutTargets, {
        onEmpty: () => ({}),
        onNonEmpty: () => shortcutSubscriptions(spec),
      }),
    ),
    key => `${spec.id}:${key}`,
  )

/** Whether a Message is one frame of a continuous gesture, such as a slider
 *  drag or a panel drag, or the end of the save wait each frame starts.
 *  `attach` routes these under their own wrapper so DevTools can leave them
 *  out of its history. */
export const isContinuousMessage = (message: Message): boolean =>
  Message.match<boolean>(message, {
    GotSliderMessage: ({ message: sliderMessage }) =>
      sliderMessage._tag === 'MovedDragPointer',
    MovedPanelPointer: () => true,
    MovedShortcutPointer: () => true,
    ScrolledWithShortcut: () => true,
    GotToggleMessage: () => false,
    GotSelectMessage: () => false,
    GotImageMessage: () => false,
    GotColorMessage: ({ message: colorMessage }) =>
      colorMessage._tag === 'GotColorPickerMessage' &&
      colorMessage.message._tag === 'MovedDragPointer',
    GotPadMessage: ({ message: padMessage }) =>
      padMessage._tag === 'MovedDragPointer',
    GotTransitionMessage: ({ message: editorMessage }) =>
      (editorMessage._tag === 'GotSliderMessage' &&
        editorMessage.message._tag === 'MovedDragPointer') ||
      (editorMessage._tag === 'GotBezierMessage' &&
        editorMessage.message._tag === 'MovedDragPointer'),
    UpdatedText: () => false,
    ClickedAction: () => false,
    ToggledFolder: () => false,
    ToggledPanel: () => false,
    PressedPanelHeader: () => false,
    ReleasedPanelPointer: () => false,
    GotVersionMenuMessage: () => false,
    ClickedVersion: () => false,
    ClickedSaveVersion: () => false,
    ClickedDeleteVersion: () => false,
    ClickedCompareVersion: () => false,
    ClickedStopCompare: () => false,
    ClickedResetValues: () => false,
    ClickedCopyValues: () => false,
    SucceededCopyValues: () => false,
    FailedCopyValues: () => false,
    CompletedWaitBeforeResetCopy: () => false,
    CompletedLoadPersisted: () => false,
    CompletedWaitBeforePersist: () => true,
    SucceededSavePersisted: () => false,
    FailedSavePersisted: () => false,
    GotShortcutsMenuMessage: () => false,
    PressedShortcutKey: () => false,
    ReleasedShortcutKey: () => false,
    BlurredWindow: () => false,
    PressedArrowWithShortcut: () => false,
    PressedShortcutPointer: () => false,
    ReleasedShortcutPointer: () => false,
  })
