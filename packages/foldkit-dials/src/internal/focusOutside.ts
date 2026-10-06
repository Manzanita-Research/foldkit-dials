import { Array, Effect, Stream } from 'effect'

import { attributeSelector } from './selectors.js'

const isInsideMarked = (event: Event, selector: string): boolean =>
  Array.some(
    event.composedPath(),
    target => target instanceof Element && target.matches(selector),
  )

// NOTE: this watches where focus lands rather than listening for `focusout`
// on the panel. A `focusout` also fires when a native dialog, such as the
// file chooser, takes window focus, which would close a picker in the middle
// of an upload.
/** While `isOpen`, emits `message` each time focus lands on an element
 *  outside every element marked `data-<attribute>="<id>"`. Mark both the
 *  trigger's wrapper and the floating panel, so moving between them stays
 *  inside. */
export const focusLeavingMarked = <Message>(
  config: Readonly<{
    attribute: string
    id: string
    isOpen: boolean
    message: Message
  }>,
): Stream.Stream<Message> => {
  const selector = attributeSelector(`data-${config.attribute}`, config.id)
  return Stream.when(
    Stream.fromEventListener<FocusEvent>(document, 'focusin').pipe(
      Stream.filter(event => !isInsideMarked(event, selector)),
      Stream.map(() => config.message),
    ),
    Effect.sync(() => config.isOpen),
  )
}
