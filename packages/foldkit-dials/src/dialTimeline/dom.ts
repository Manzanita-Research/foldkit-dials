import { Option } from 'effect'

import { attributeSelector } from '../internal/selectors.js'

// DOM

const LEFT_MOUSE_BUTTON = 0

/** Whether a pointer press used the primary button. */
export const isLeftButton = (button: number): boolean =>
  button === LEFT_MOUSE_BUTTON

/** Finds the element that carries `attribute` set to the dock id. */
export const findByAttribute = (
  attribute: string,
  id: string,
): Option.Option<Element> =>
  Option.fromNullishOr(document.querySelector(attributeSelector(attribute, id)))

/** Finds the dock's ruler. */
export const findRuler = (id: string): Option.Option<Element> =>
  findByAttribute('data-dial-timeline-ruler', id)

/** Finds the collapsed dock's overview strip. */
export const findOverview = (id: string): Option.Option<Element> =>
  findByAttribute('data-dial-timeline-overview', id)

/** Maps a pointer's horizontal position to a fraction of an element's
 *  width. The result is not clamped, so a drag can run past either end. */
export const fractionWithin = (element: Element, clientX: number): number => {
  const rect = element.getBoundingClientRect()
  if (rect.width > 0) {
    return (clientX - rect.left) / rect.width
  } else {
    return 0
  }
}

/** Whether an event target sits inside an element matching `selector`. */
export const isWithin = (
  target: EventTarget | null,
  selector: string,
): boolean => target instanceof Element && target.closest(selector) !== null
