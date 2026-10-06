import { Option } from 'effect'

/** The `button` value of a press with the primary, usually left, mouse
 *  button. */
export const LEFT_MOUSE_BUTTON = 0

const isElement = (target: EventTarget | null): target is Element =>
  target instanceof Element

/** The event target itself or its nearest ancestor that matches `selector`. */
export const closestElement = (
  target: EventTarget | null,
  selector: string,
): Option.Option<Element> =>
  Option.flatMap(Option.liftPredicate(target, isElement), element =>
    Option.fromNullishOr(element.closest(selector)),
  )
