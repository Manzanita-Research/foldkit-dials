import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { RadioGroup } from '@foldkit/ui'

import * as ScrubSlider from '../scrubSlider/index.js'
import { BarHandle, BarRow, EditorField, RulerGesture } from './model.js'

// MESSAGE

/** A keyboard step of the playhead. */
export const PlayheadDirection = Schema.Literals([
  'StepBackward',
  'StepForward',
  'PageBackward',
  'PageForward',
  'Start',
  'End',
])
export type PlayheadDirection = typeof PlayheadDirection.Type

/** A keyboard zoom step on the playhead. */
export const ZoomStep = Schema.Literals(['In', 'Out', 'Reset'])
export type ZoomStep = typeof ZoomStep.Type

/** How far a keyboard nudge moves a bar. */
export const NudgeSize = Schema.Literals(['Fine', 'Coarse'])
export type NudgeSize = typeof NudgeSize.Type

/** A keyboard step of the dock's resize handle. `Minimum` and `Maximum`
 *  jump to the smallest and largest heights. */
export const ResizeStep = Schema.Literals([
  'Grow',
  'Shrink',
  'Minimum',
  'Maximum',
])
export type ResizeStep = typeof ResizeStep.Type

/** Union of all Messages the dock can produce. Frame ticks are all
 *  `TickedFrame`, so a host can leave them out of DevTools history. */
export const Message = defineMessageUnion({
  TickedFrame: { deltaTime: Schema.Number },
  RequestedPlay: {},
  RequestedPause: {},
  RequestedReplay: {},
  RequestedSeek: { time: Schema.Number },
  RequestedVisibility: { isVisible: Schema.Boolean },
  ToggledOpen: { isOpen: Schema.Boolean },
  ClickedCopyTimeline: {},
  SucceededCopyTimeline: {},
  FailedCopyTimeline: {},
  CompletedWaitBeforeResetCopy: { copyVersion: Schema.Number },
  ResizedRuler: { width: Schema.Number },
  ResizedViewport: { height: Schema.Number },
  PressedRuler: { fraction: Schema.Number, gesture: RulerGesture },
  PressedPlayhead: {},
  PressedPlayheadNavigation: { direction: PlayheadDirection },
  PressedZoomKey: { step: ZoomStep },
  PressedOverview: { fraction: Schema.Number },
  PressedBar: { row: BarRow, handle: BarHandle, fraction: Schema.Number },
  PressedBarNudge: {
    row: BarRow,
    direction: Schema.Literals(['Earlier', 'Later']),
    size: NudgeSize,
  },
  PressedEnterOnBar: {
    row: BarRow,
    maybeStepIndex: Schema.Option(Schema.Number),
  },
  MovedLanePointer: { fraction: Schema.Number },
  ScrolledLanes: { deltaFraction: Schema.Number },
  PressedResizeHandle: { clientY: Schema.Number, height: Schema.Number },
  MovedResizePointer: { clientY: Schema.Number },
  PressedResizeKey: { step: ResizeStep },
  ReleasedDragPointer: {},
  CancelledDrag: {},
  ToggledGroup: { group: Schema.String, isOpen: Schema.Boolean },
  ToggledTracks: { key: Schema.String, isOpen: Schema.Boolean },
  ClickedCloseEditor: {},
  PressedEscapeInEditor: {},
  PressedOutsideEditor: {},
  MovedFocusOutsideEditor: {},
  GotModeMessage: { message: RadioGroup.Message },
  UpdatedEditorText: { field: EditorField, value: Schema.String },
  GotSliderMessage: { sliderId: Schema.String, message: ScrubSlider.Message },
  GotDraggingSliderMessage: { message: ScrubSlider.Message },
  CompletedAnchorClipEditor: {},
  CompletedFocusBar: {},
})
export type Message = typeof Message.Type

// OUT MESSAGE

/** Union of OutMessages the dock emits to its parent. */
export const OutMessage = defineMessageUnion({
  ChangedVisibility: { isVisible: Schema.Boolean },
})
export type OutMessage = typeof OutMessage.Type
