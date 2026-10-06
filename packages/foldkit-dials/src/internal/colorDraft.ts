import { Option, Schema } from 'effect'
import type { Attribute, HtmlBuilder } from 'foldkit/html'
import { defineTaggedUnion } from 'foldkit/schema'

import { parseColor } from '../color/parse.js'
import { editorKeyToMessage } from './keyboard.js'

/** Text typed into a colour input. `Viewing` shows the parent's value,
 *  `Editing` holds the typed text, and `Rejected` keeps text that Enter
 *  could not parse, so the input can say why. */
export const ColorDraft = defineTaggedUnion({
  Viewing: {},
  Editing: { draft: Schema.String },
  Rejected: { draft: Schema.String },
})
export type ColorDraft = typeof ColorDraft.Type

/** What a commit does with text that does not parse. Enter keeps it as
 *  `Rejected`, and blur drops it. */
export type InvalidDraftHandling = 'Reject' | 'Discard'

/** The outcome of committing a draft: the next draft state, and the text to
 *  submit when the draft parses. */
export type DraftCommit = Readonly<{
  nextDraft: ColorDraft
  maybeSubmittedText: Option.Option<string>
}>

const commitText = (
  text: string,
  handling: InvalidDraftHandling,
): DraftCommit => {
  if (Option.isSome(parseColor(text))) {
    return {
      nextDraft: ColorDraft.Viewing(),
      maybeSubmittedText: Option.some(text),
    }
  } else if (handling === 'Reject') {
    return {
      nextDraft: ColorDraft.Rejected({ draft: text }),
      maybeSubmittedText: Option.none(),
    }
  } else {
    return {
      nextDraft: ColorDraft.Viewing(),
      maybeSubmittedText: Option.none(),
    }
  }
}

/** Commits a draft. Text that parses closes the editor and is submitted.
 *  Text that does not is rejected or dropped, as `handling` says. With
 *  nothing typed, the draft stays as it is. */
export const commitDraft = (
  draft: ColorDraft,
  handling: InvalidDraftHandling,
): DraftCommit =>
  ColorDraft.match<DraftCommit>(draft, {
    Viewing: () => ({ nextDraft: draft, maybeSubmittedText: Option.none() }),
    Editing: ({ draft: text }) => commitText(text, handling),
    Rejected: ({ draft: text }) => commitText(text, handling),
  })

const draftText = (draft: ColorDraft, value: string): string =>
  ColorDraft.match<string>(draft, {
    Viewing: () => value,
    Editing: ({ draft: text }) => text,
    Rejected: ({ draft: text }) => text,
  })

/** Whether the draft is text Enter could not parse. */
export const isRejected = (draft: ColorDraft): boolean =>
  draft._tag === 'Rejected'

const draftErrorId = (inputId: string): string => `${inputId}-error`

/** Configuration for `draftInputAttributes`. */
export type DraftInputConfig<Message> = Readonly<{
  id: string
  ariaLabel: string
  value: string
  draft: ColorDraft
  onInput: (text: string) => Message
  onEnter: Message
  onEscape: Message
  onBlur: Message
}>

/** Attributes for a colour text input. Enter commits, Escape cancels, and
 *  blur commits. A rejected draft marks the input invalid and points it at
 *  the error message. */
export const draftInputAttributes = <Message>(
  config: DraftInputConfig<Message>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Attribute<Message>> => [
  h.Id(config.id),
  h.Type('text'),
  h.Spellcheck(false),
  h.Autocomplete('off'),
  h.AriaLabel(config.ariaLabel),
  h.Value(draftText(config.draft, config.value)),
  h.OnInput(config.onInput),
  h.OnKeyDownPreventDefault(
    editorKeyToMessage(config.onEnter, config.onEscape),
  ),
  h.OnBlur(config.onBlur),
  ...(isRejected(config.draft)
    ? [
        h.AriaInvalid(true),
        h.AriaDescribedBy(draftErrorId(config.id)),
        h.DataAttribute('invalid', ''),
      ]
    : []),
]

/** Attributes for the message that says a draft is not a colour. Render it
 *  only while the draft is rejected, so the alert is announced when it
 *  appears. */
export const draftErrorAttributes = <Message>(
  inputId: string,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Attribute<Message>> => [
  h.Id(draftErrorId(inputId)),
  h.Role('alert'),
]
