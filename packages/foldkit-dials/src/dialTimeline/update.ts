import { Array, Match, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import * as Update from 'foldkit/update'

import { clamp } from '../internal/range.js'
import * as Timeline from '../timeline/index.js'
import { activateBar, applyBarDrag, maybeStepIndexOf } from './barEdits.js'
import { CopyTimeline, FocusBar, WaitBeforeResetCopy } from './command.js'
import {
  applyEditorField,
  closeEditor,
  draggingEditorSlider,
  findEditorSliderById,
  foldEditorSlider,
  foldModeGroup,
} from './editor.js'
import {
  MIN_DOCK_HEIGHT,
  clampDockHeight,
  clampViewStart,
  cycleTimeOf,
  durationOf,
  maxZoomOf,
  maybeMaxDockHeightOf,
  viewWindowOf,
} from './geometry.js'
import { spanElementId } from './ids.js'
import {
  Message,
  type NudgeSize,
  OutMessage,
  type PlayheadDirection,
  type ResizeStep,
  type ZoomStep,
} from './message.js'
import {
  BarHandle,
  type BarRow,
  CopyState,
  DragState,
  type Model,
  type RulerGesture,
  type ScrubSurface,
} from './model.js'

// PLAYBACK AND VIEW

const MAX_FRAME_DELTA_MILLISECONDS = 100
const MILLISECONDS_PER_SECOND = 1000
const ZOOM_KEY_FACTOR = 1.5
const DOCK_HEIGHT_KEY_STEP = 20

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const seekTo = (model: Model, time: number): Model =>
  modifyFields(model, {
    time: () => clamp(time, 0, durationOf(model)),
    wraps: () => 0,
  })

const startPlayback = (model: Model): Model => {
  const duration = durationOf(model)
  if (duration <= 0) {
    return modifyFields(model, { isPlaying: () => false })
  } else if (model.time >= duration) {
    return modifyFields(model, {
      time: () => 0,
      wraps: () => 0,
      isPlaying: () => true,
    })
  } else {
    return modifyFields(model, { isPlaying: () => true })
  }
}

const advancePlayhead = (model: Model, deltaTime: number): Model => {
  const duration = durationOf(model)
  const nextTime =
    model.time +
    clamp(deltaTime, 0, MAX_FRAME_DELTA_MILLISECONDS) / MILLISECONDS_PER_SECOND

  if (duration <= 0) {
    return modifyFields(model, {
      time: () => 0,
      wraps: () => 0,
      isPlaying: () => false,
    })
  } else if (nextTime < duration) {
    return modifyFields(model, { time: () => nextTime })
  } else {
    return Timeline.TimelineLoop.match<Model>(model.loop, {
      Off: () =>
        modifyFields(model, { time: () => duration, isPlaying: () => false }),
      Repeat: loop => {
        const folded = Timeline.foldLoopTime(
          nextTime,
          duration,
          Timeline.loopStartOf(loop),
        )
        return modifyFields(model, {
          time: () => folded.time,
          wraps: wraps => wraps + folded.wraps,
        })
      },
    })
  }
}

const startScrub = (model: Model, surface: ScrubSurface): Model =>
  modifyFields(model, {
    dragState: () =>
      DragState.Scrubbing({ surface, isResumingOnRelease: model.isPlaying }),
    isPlaying: () => false,
  })

const centerViewAt = (model: Model, time: number): Model => {
  const viewWindow = viewWindowOf(model, durationOf(model))
  if (model.zoom <= 1) {
    return model
  } else {
    return modifyFields(model, {
      viewStart: () =>
        clampViewStart(
          time - viewWindow.visible / 2,
          viewWindow.duration,
          viewWindow.visible,
        ),
    })
  }
}

// NOTE: the playhead renders only inside the visible window, so a keyboard
// seek must keep it there. Otherwise the focused playhead would unmount and
// drop focus to the page.
const revealTime = (model: Model, time: number): Model => {
  const viewWindow = viewWindowOf(model, durationOf(model))
  const viewEnd = viewWindow.start + viewWindow.visible

  if (time < viewWindow.start) {
    return modifyFields(model, {
      viewStart: () =>
        clampViewStart(time, viewWindow.duration, viewWindow.visible),
    })
  } else if (time > viewEnd) {
    return modifyFields(model, {
      viewStart: () =>
        clampViewStart(
          time - viewWindow.visible,
          viewWindow.duration,
          viewWindow.visible,
        ),
    })
  } else {
    return model
  }
}

const seekWithinView = (model: Model, fraction: number): Model => {
  const viewWindow = viewWindowOf(model, durationOf(model))
  return seekTo(
    model,
    viewWindow.start + clamp(fraction, 0, 1) * viewWindow.visible,
  )
}

const resetZoom = (model: Model): Model =>
  modifyFields(model, { zoom: () => 1, viewStart: () => 0 })

const zoomAroundPlayhead = (model: Model, factor: number): Model =>
  centerViewAt(
    modifyFields(model, {
      zoom: zoom =>
        clamp(zoom * factor, 1, maxZoomOf(durationOf(model), model.rulerWidth)),
    }),
    model.time,
  )

const zoomByStep = (model: Model, step: ZoomStep): Model =>
  Match.value(step).pipe(
    Match.withReturnType<Model>(),
    Match.when('In', () => zoomAroundPlayhead(model, ZOOM_KEY_FACTOR)),
    Match.when('Out', () => zoomAroundPlayhead(model, 1 / ZOOM_KEY_FACTOR)),
    Match.when('Reset', () => resetZoom(model)),
    Match.exhaustive,
  )

const withMembership = (
  items: ReadonlyArray<string>,
  item: string,
  isMember: boolean,
): ReadonlyArray<string> =>
  isMember
    ? Array.union(items, [item])
    : Array.filter(items, existing => existing !== item)

// POINTER DRAGS

const DRAG_THRESHOLD_PIXELS = 3
const ZOOM_DRAG_DISTANCE_PIXELS = 180

const toIdle = (model: Model): Model =>
  modifyFields(model, { dragState: () => DragState.Idle() })

const isPastThreshold = (
  model: Model,
  fraction: number,
  originFraction: number,
  isMoved: boolean,
): boolean =>
  isMoved ||
  Math.abs((fraction - originFraction) * model.rulerWidth) >
    DRAG_THRESHOLD_PIXELS

const zoomByDrag = (
  model: Model,
  zooming: typeof DragState.Zooming.Type,
  fraction: number,
): Model => {
  const duration = durationOf(model)

  if (
    duration <= 0 ||
    !isPastThreshold(model, fraction, zooming.originFraction, zooming.isMoved)
  ) {
    return model
  } else {
    const deltaPixels = (fraction - zooming.originFraction) * model.rulerWidth
    const nextZoom = clamp(
      zooming.originZoom * Math.exp(deltaPixels / ZOOM_DRAG_DISTANCE_PIXELS),
      1,
      maxZoomOf(duration, model.rulerWidth),
    )
    const nextVisible = duration / nextZoom
    return modifyFields(model, {
      zoom: () => nextZoom,
      viewStart: () =>
        clampViewStart(
          zooming.anchorTime - zooming.anchorFraction * nextVisible,
          duration,
          nextVisible,
        ),
      dragState: () => modifyFields(zooming, { isMoved: () => true }),
    })
  }
}

const dragBar = (
  model: Model,
  dragging: typeof DragState.DraggingBar.Type,
  fraction: number,
): Model => {
  if (
    !isPastThreshold(model, fraction, dragging.originFraction, dragging.isMoved)
  ) {
    return model
  } else {
    const viewWindow = viewWindowOf(
      model,
      Timeline.durationOfTimeline(dragging.originTimeline),
    )
    return modifyFields(model, {
      timeline: () =>
        applyBarDrag(
          dragging.originTimeline,
          dragging.row,
          dragging.handle,
          (fraction - dragging.originFraction) * viewWindow.visible,
        ),
      dragState: () => modifyFields(dragging, { isMoved: () => true }),
      maybeEditor: () => Option.none(),
    })
  }
}

const moveLanePointer = (model: Model, fraction: number): Model =>
  DragState.match<Model>(model.dragState, {
    Idle: () => model,
    ResizingDock: () => model,
    Scrubbing: ({ surface }) => {
      if (surface === 'Lanes') {
        return seekWithinView(model, fraction)
      } else {
        const sought = seekTo(model, clamp(fraction, 0, 1) * durationOf(model))
        return centerViewAt(sought, sought.time)
      }
    },
    Zooming: zooming => zoomByDrag(model, zooming, fraction),
    DraggingBar: dragging => dragBar(model, dragging, fraction),
  })

const releaseDrag = (model: Model): Model =>
  DragState.match<Model>(model.dragState, {
    Idle: () => model,
    Scrubbing: ({ isResumingOnRelease }) =>
      isResumingOnRelease ? startPlayback(toIdle(model)) : toIdle(model),
    Zooming: () => toIdle(model),
    DraggingBar: ({ row, handle, isMoved }) =>
      isMoved
        ? toIdle(model)
        : activateBar(toIdle(model), row, maybeStepIndexOf(handle)),
    ResizingDock: () => toIdle(model),
  })

const cancelDrag = (model: Model): Model =>
  DragState.match<Model>(model.dragState, {
    Idle: () => model,
    Scrubbing: ({ isResumingOnRelease }) =>
      isResumingOnRelease ? startPlayback(toIdle(model)) : toIdle(model),
    Zooming: () => toIdle(model),
    DraggingBar: ({ originTimeline }) =>
      modifyFields(toIdle(model), { timeline: () => originTimeline }),
    ResizingDock: ({ originHeight }) =>
      modifyFields(toIdle(model), { dockHeight: () => originHeight }),
  })

const startRulerGesture = (
  model: Model,
  fraction: number,
  gesture: RulerGesture,
): Model =>
  Match.value(gesture).pipe(
    Match.withReturnType<Model>(),
    Match.when('Seek', () =>
      seekWithinView(startScrub(model, 'Lanes'), fraction),
    ),
    Match.when('ResetAndSeek', () =>
      seekWithinView(startScrub(resetZoom(model), 'Lanes'), fraction),
    ),
    Match.when('Zoom', () => {
      const viewWindow = viewWindowOf(model, durationOf(model))
      const anchorFraction = clamp(fraction, 0, 1)
      return modifyFields(model, {
        dragState: () =>
          DragState.Zooming({
            originFraction: fraction,
            originZoom: model.zoom,
            anchorFraction,
            anchorTime: viewWindow.start + anchorFraction * viewWindow.visible,
            isMoved: false,
          }),
      })
    }),
    Match.exhaustive,
  )

// KEYS, VISIBILITY, AND COPY

const PLAYHEAD_STEP_SECONDS = 0.1
const PLAYHEAD_PAGE_SECONDS = 1
const NUDGE_FINE_SECONDS = 0.01
const NUDGE_COARSE_SECONDS = 0.1

const playheadTarget = (model: Model, direction: PlayheadDirection): number =>
  Match.value(direction).pipe(
    Match.withReturnType<number>(),
    Match.when('StepBackward', () => model.time - PLAYHEAD_STEP_SECONDS),
    Match.when('StepForward', () => model.time + PLAYHEAD_STEP_SECONDS),
    Match.when('PageBackward', () => model.time - PLAYHEAD_PAGE_SECONDS),
    Match.when('PageForward', () => model.time + PLAYHEAD_PAGE_SECONDS),
    Match.when('Start', () => 0),
    Match.when('End', () => durationOf(model)),
    Match.exhaustive,
  )

const nudgeSeconds = (
  direction: 'Earlier' | 'Later',
  size: NudgeSize,
): number => {
  const magnitude =
    size === 'Coarse' ? NUDGE_COARSE_SECONDS : NUDGE_FINE_SECONDS
  return direction === 'Earlier' ? -magnitude : magnitude
}

const resizedDockHeight = (model: Model, step: ResizeStep): number =>
  Match.value(step).pipe(
    Match.withReturnType<number>(),
    Match.when('Grow', () =>
      clampDockHeight(model, model.dockHeight + DOCK_HEIGHT_KEY_STEP),
    ),
    Match.when('Shrink', () =>
      clampDockHeight(model, model.dockHeight - DOCK_HEIGHT_KEY_STEP),
    ),
    Match.when('Minimum', () => MIN_DOCK_HEIGHT),
    Match.when('Maximum', () =>
      Option.getOrElse(maybeMaxDockHeightOf(model), () => model.dockHeight),
    ),
    Match.exhaustive,
  )

const whenIdle = (model: Model, next: () => Model): Model =>
  model.dragState._tag === 'Idle' ? next() : model

const applyVisibility = (model: Model, isVisible: boolean): UpdateReturn => {
  if (isVisible === model.isVisible) {
    return { model }
  } else {
    const visibilityChanged = modifyFields(model, {
      isVisible: () => isVisible,
    })
    return {
      model: isVisible ? visibilityChanged : closeEditor(visibilityChanged),
      outMessage: OutMessage.ChangedVisibility({ isVisible }),
    }
  }
}

const closeEditorWithFocus = (model: Model): UpdateReturn =>
  Option.match(model.maybeEditor, {
    onNone: () => ({ model }),
    onSome: ({ target }) => ({
      model: closeEditor(model),
      commands: [FocusBar({ elementId: spanElementId(model.id, target) })],
    }),
  })

const showCopyResult = (model: Model, copyState: CopyState): UpdateReturn => {
  const copyVersion = model.copyVersion + 1
  return {
    model: modifyFields(model, {
      copyState: () => copyState,
      copyVersion: () => copyVersion,
    }),
    commands: [WaitBeforeResetCopy({ copyVersion })],
  }
}

const resetCopy = (model: Model, copyVersion: number): Model =>
  copyVersion === model.copyVersion
    ? modifyFields(model, { copyState: () => CopyState.Idle() })
    : model

const startBarDrag = (
  model: Model,
  row: BarRow,
  handle: BarHandle,
  fraction: number,
): Model =>
  modifyFields(model, {
    dragState: () =>
      DragState.DraggingBar({
        row,
        handle,
        originFraction: fraction,
        originTimeline: model.timeline,
        isMoved: false,
      }),
  })

const scrollLanes = (model: Model, deltaFraction: number): Model => {
  const viewWindow = viewWindowOf(model, durationOf(model))
  return modifyFields(model, {
    viewStart: () =>
      clampViewStart(
        viewWindow.start + deltaFraction * viewWindow.visible,
        viewWindow.duration,
        viewWindow.visible,
      ),
  })
}

const startOverviewScrub = (model: Model, fraction: number): Model => {
  const sought = seekTo(
    startScrub(model, 'Overview'),
    clamp(fraction, 0, 1) * durationOf(model),
  )
  return centerViewAt(sought, sought.time)
}

const moveResizePointer = (model: Model, clientY: number): Model =>
  DragState.matchOrElse<Model>(
    model.dragState,
    {
      ResizingDock: ({ originClientY, originHeight }) =>
        modifyFields(model, {
          dockHeight: () =>
            clampDockHeight(model, originHeight + originClientY - clientY),
        }),
    },
    () => model,
  )

// UPDATE

/** Processes a dock Message and returns the next Model, Commands, and an
 *  optional `ChangedVisibility` OutMessage. Every edit, gesture, and frame
 *  is a Message, so DevTools can replay the session. */
export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    TickedFrame: ({ deltaTime }) =>
      model.isPlaying
        ? { model: advancePlayhead(model, deltaTime) }
        : { model },

    RequestedPlay: () => ({ model: startPlayback(model) }),

    RequestedPause: () => ({
      model: modifyFields(model, { isPlaying: () => false }),
    }),

    RequestedReplay: () => ({
      model: startPlayback(
        modifyFields(model, {
          time: () => 0,
          wraps: () => 0,
          viewStart: () => 0,
        }),
      ),
    }),

    RequestedSeek: ({ time }) => ({ model: seekTo(model, time) }),

    RequestedVisibility: ({ isVisible }) => applyVisibility(model, isVisible),

    ToggledOpen: ({ isOpen }) => {
      const toggled = modifyFields(model, { isOpen: () => isOpen })
      return { model: isOpen ? toggled : closeEditor(toggled) }
    },

    ClickedCopyTimeline: () => ({
      model,
      commands: [
        CopyTimeline({
          text: Timeline.copyInstruction(model.name, model.timeline),
        }),
      ],
    }),

    SucceededCopyTimeline: () => showCopyResult(model, CopyState.Copied()),

    FailedCopyTimeline: () => showCopyResult(model, CopyState.Failed()),

    CompletedWaitBeforeResetCopy: ({ copyVersion }) => ({
      model: resetCopy(model, copyVersion),
    }),

    ResizedRuler: ({ width }) => ({
      model: modifyFields(model, {
        rulerWidth: () => width,
        zoom: zoom => clamp(zoom, 1, maxZoomOf(durationOf(model), width)),
      }),
    }),

    ResizedViewport: ({ height }) => {
      const resized = modifyFields(model, {
        maybeViewportHeight: () => Option.some(height),
      })
      return {
        model: modifyFields(resized, {
          dockHeight: dockHeight => clampDockHeight(resized, dockHeight),
        }),
      }
    },

    PressedRuler: ({ fraction, gesture }) => ({
      model: whenIdle(model, () => startRulerGesture(model, fraction, gesture)),
    }),

    PressedPlayhead: () => ({
      model: whenIdle(model, () => startScrub(model, 'Lanes')),
    }),

    PressedPlayheadNavigation: ({ direction }) => {
      const sought = seekTo(model, playheadTarget(model, direction))
      return { model: revealTime(sought, sought.time) }
    },

    PressedZoomKey: ({ step }) => ({ model: zoomByStep(model, step) }),

    PressedOverview: ({ fraction }) => ({
      model: whenIdle(model, () => startOverviewScrub(model, fraction)),
    }),

    PressedBar: ({ row, handle, fraction }) => ({
      model: whenIdle(model, () => startBarDrag(model, row, handle, fraction)),
    }),

    PressedBarNudge: ({ row, direction, size }) => ({
      model: modifyFields(model, {
        timeline: timeline =>
          applyBarDrag(
            timeline,
            row,
            BarHandle.Body({ maybeStepIndex: Option.none() }),
            nudgeSeconds(direction, size),
          ),
      }),
    }),

    PressedEnterOnBar: ({ row, maybeStepIndex }) => ({
      model: activateBar(model, row, maybeStepIndex),
    }),

    MovedLanePointer: ({ fraction }) => ({
      model: moveLanePointer(model, fraction),
    }),

    ScrolledLanes: ({ deltaFraction }) => ({
      model: scrollLanes(model, deltaFraction),
    }),

    PressedResizeHandle: ({ clientY, height }) => ({
      model: whenIdle(model, () =>
        modifyFields(model, {
          dragState: () =>
            DragState.ResizingDock({
              originClientY: clientY,
              originHeight: height,
            }),
        }),
      ),
    }),

    MovedResizePointer: ({ clientY }) => ({
      model: moveResizePointer(model, clientY),
    }),

    PressedResizeKey: ({ step }) => ({
      model: modifyFields(model, {
        dockHeight: () => resizedDockHeight(model, step),
      }),
    }),

    ReleasedDragPointer: () => ({ model: releaseDrag(model) }),

    CancelledDrag: () => ({ model: cancelDrag(model) }),

    ToggledGroup: ({ group, isOpen }) => ({
      model: modifyFields(model, {
        collapsedGroups: groups => withMembership(groups, group, !isOpen),
      }),
    }),

    ToggledTracks: ({ key, isOpen }) => ({
      model: modifyFields(model, {
        expandedClips: keys => withMembership(keys, key, isOpen),
      }),
    }),

    ClickedCloseEditor: () => closeEditorWithFocus(model),

    PressedEscapeInEditor: () => closeEditorWithFocus(model),

    PressedOutsideEditor: () => ({ model: closeEditor(model) }),

    MovedFocusOutsideEditor: () => ({ model: closeEditor(model) }),

    GotModeMessage: ({ message: modeMessage }) =>
      foldModeGroup(model, modeMessage),

    UpdatedEditorText: ({ field, value }) => ({
      model: applyEditorField(model, field, value),
    }),

    GotSliderMessage: ({ sliderId, message: sliderMessage }) =>
      Option.match(findEditorSliderById(model, sliderId), {
        onNone: () => ({ model }),
        onSome: editorSlider =>
          foldEditorSlider(editorSlider)(model, sliderMessage),
      }),

    GotDraggingSliderMessage: ({ message: sliderMessage }) =>
      Option.match(draggingEditorSlider(model), {
        onNone: () => ({ model }),
        onSome: editorSlider =>
          foldEditorSlider(editorSlider)(model, sliderMessage),
      }),

    CompletedAnchorClipEditor: () => ({ model }),

    CompletedFocusBar: () => ({ model }),
  })

/** Plays from the playhead, or from the start when it is parked at the end. */
export const play = (model: Model): UpdateReturn =>
  update(model, Message.RequestedPlay())

/** Pauses playback. */
export const pause = (model: Model): UpdateReturn =>
  update(model, Message.RequestedPause())

/** Plays from the start. Use it with `autoplay: false` for event-driven
 *  playback. */
export const replay = (model: Model): UpdateReturn =>
  update(model, Message.RequestedReplay())

/** Moves the playhead to `time`, clamped to the timeline. Seeking shows the
 *  first-pass state at that time. */
export const seek = (model: Model, time: number): UpdateReturn =>
  update(model, Message.RequestedSeek({ time }))

/** Shows or hides the dock. Visibility does not affect playback. */
export const setVisible = (model: Model, isVisible: boolean): UpdateReturn =>
  update(model, Message.RequestedVisibility({ isVisible }))

/** The playhead, play state, and effective duration. */
export type Transport = Readonly<{
  time: number
  isPlaying: boolean
  duration: number
}>

/** Reads the dock's transport. */
export const transportOf = (model: Model): Transport => ({
  time: model.time,
  isPlaying: model.isPlaying,
  duration: durationOf(model),
})

/** Resolves the edited timeline once for cycle time and value sampling. */
export const sampleValues = <Entries>(
  model: Model,
): Timeline.ValuesOf<Entries> => {
  const timelineStatic = Timeline.resolve(model.timeline)
  return Timeline.valuesAtResolved<Entries>(
    timelineStatic,
    model.time,
    cycleTimeOf(model, timelineStatic.duration),
  )
}

/** Samples every clip at the playhead, keyed by clip name with grouped clips
 *  nested under their group. A host binds `values.card.current` in its
 *  view. A `make` bundle's `valuesOf` returns the same values typed by the
 *  timeline config. */
export const valuesOf = (model: Model): Readonly<Record<string, unknown>> =>
  sampleValues(model)
