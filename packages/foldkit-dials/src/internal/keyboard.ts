import { Match, Option, Schema } from 'effect'
import type { KeyboardModifiers } from 'foldkit/html'

/** The direction an arrow key points. */
export const ArrowDirection = Schema.Literals(['Left', 'Right', 'Up', 'Down'])
export type ArrowDirection = typeof ArrowDirection.Type

/** How far an arrow key moves a value: `Fine` is one step, and `Coarse`,
 *  with Shift held, is a larger jump. */
export const Increment = Schema.Literals(['Fine', 'Coarse'])
export type Increment = typeof Increment.Type

/** The direction of an arrow key, or `None` for any other key. */
export const arrowKeyToDirection = (
  key: string,
): Option.Option<ArrowDirection> =>
  Match.value(key).pipe(
    Match.withReturnType<ArrowDirection>(),
    Match.when('ArrowLeft', () => 'Left'),
    Match.when('ArrowRight', () => 'Right'),
    Match.when('ArrowUp', () => 'Up'),
    Match.when('ArrowDown', () => 'Down'),
    Match.option,
  )

/** The increment for an arrow key: `Coarse` while Shift is held. */
export const incrementOf = (modifiers: KeyboardModifiers): Increment =>
  modifiers.shiftKey ? 'Coarse' : 'Fine'

/** Whether Alt, Meta, or Control is held. A key pressed with one of them
 *  belongs to the browser or the host app, so controls leave it alone. */
export const hasCommandModifier = (modifiers: KeyboardModifiers): boolean =>
  modifiers.altKey || modifiers.metaKey || modifiers.ctrlKey

/** Maps Enter and Escape in a text editor to its commit and cancel Messages.
 *  Every other key types as usual. */
export const editorKeyToMessage =
  <Message>(onEnter: Message, onEscape: Message) =>
  (key: string): Option.Option<Message> => {
    if (key === 'Enter') {
      return Option.some(onEnter)
    } else if (key === 'Escape') {
      return Option.some(onEscape)
    } else {
      return Option.none()
    }
  }
