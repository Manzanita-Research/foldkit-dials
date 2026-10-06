import * as Timeline from '../timeline/index.js'
import { BarRow, type EditTarget, EditorField } from './model.js'

// IDS

/** The DOM id of the clip editor. */
export const editorId = (id: string): string => `${id}-editor`

// NOTE: clip keys, props, and group names are URI-encoded, which escapes
// `/`, so the `/` separators below never occur inside them and no two rows
// share an id.
const idPart = (text: string): string => encodeURIComponent(text)

/** The DOM id of a clip's or track's bar. */
export const barId = (id: string, row: BarRow): string =>
  BarRow.match(row, {
    Clip: ({ key }) => `${id}-bar-${idPart(key)}`,
    Track: ({ key, prop }) => `${id}-bar-${idPart(key)}/${idPart(prop)}`,
  })

/** The DOM id of one step segment of a sequence bar. */
export const segmentId = (id: string, row: BarRow, index: number): string =>
  `${barId(id, row)}/step-${index}`

/** The DOM id of the bar or segment an edit target belongs to. The clip
 *  editor anchors to it and returns focus to it. */
export const spanElementId = (id: string, { key, span }: EditTarget): string =>
  Timeline.Span.match(span, {
    Whole: () => barId(id, BarRow.Clip({ key })),
    Step: ({ index }) => segmentId(id, BarRow.Clip({ key }), index),
    Track: ({ prop }) => barId(id, BarRow.Track({ key, prop })),
    TrackStep: ({ prop, index }) =>
      segmentId(id, BarRow.Track({ key, prop }), index),
  })

/** The DOM id of the dock body the resize handle controls. */
export const dockId = (id: string): string => `${id}-dock`

/** The DOM id of the hidden text that describes a bar's keys. Unlike a
 *  bar id, it has no `-bar-` part, so no clip key can produce it. */
export const barHelpId = (id: string): string => `${id}-keys-help`

/** The Disclosure id of the dock's collapse toggle. */
export const bodyDisclosureId = (id: string): string => `${id}-body`

/** The Disclosure id of a clip group's toggle. */
export const groupDisclosureId = (id: string, group: string): string =>
  `${id}-group-${idPart(group)}`

/** The Disclosure id of a props clip's property-track toggle. */
export const tracksDisclosureId = (id: string, key: string): string =>
  `${id}-tracks-${idPart(key)}`

/** A stable key for an editor field, used in DOM ids. */
export const fieldKey = (field: EditorField): string =>
  EditorField.match(field, {
    Start: () => 'start',
    Duration: () => 'duration',
    Parameter: ({ parameter }) => parameter.toLowerCase(),
    From: ({ prop }) => `from-${prop}`,
    To: ({ prop }) => `to-${prop}`,
  })

const spanKey = (span: Timeline.Span): string =>
  Timeline.Span.match(span, {
    Whole: () => 'whole',
    Step: ({ index }) => `step-${index}`,
    Track: ({ prop }) => `track-${prop}`,
    TrackStep: ({ prop, index }) => `track-${prop}-step-${index}`,
  })

/** A stable key for an edit target. It keys the editor element, so the
 *  editor remounts and re-anchors when its target changes. */
export const targetKey = ({ key, span }: EditTarget): string =>
  `${key}:${spanKey(span)}`

/** The DOM id of the control editing a field: a ScrubSlider for a number,
 *  or a text field for a string. */
export const editorFieldId = (id: string, field: EditorField): string =>
  `${id}-editor-${fieldKey(field)}`

/** The id of the clip editor's transition-mode RadioGroup. */
export const modeGroupId = (id: string): string => `${id}-editor-mode`
