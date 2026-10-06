import { Match, Option, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { Transition, type TransitionMode } from './index.js'

/** A parameter that a transition mode's panel shows as a slider. The panel's
 *  transition editor shows only these: it edits an easing's curve on the
 *  curve itself. */
export const ModeParameter = Schema.Literals([
  'EasingDuration',
  'VisualDuration',
  'Bounce',
  'Stiffness',
  'Damping',
  'Mass',
])
export type ModeParameter = typeof ModeParameter.Type

/** One number in a transition that an editor shows as a slider: a mode
 *  parameter, or one of an easing's curve coordinates, which the timeline
 *  dock shows as sliders. */
export const Parameter = Schema.Literals([
  ...ModeParameter.literals,
  'EaseX1',
  'EaseY1',
  'EaseX2',
  'EaseY2',
])
export type Parameter = typeof Parameter.Type

/** A parameter's slider label and range. */
export type ParameterSpec = Readonly<{
  label: string
  min: number
  max: number
  step: number
}>

const EASE_X: Omit<ParameterSpec, 'label'> = { min: 0, max: 1, step: 0.01 }
const EASE_Y: Omit<ParameterSpec, 'label'> = { min: -1, max: 2, step: 0.01 }

/** Each mode parameter's slider label and range, as in DialKit's
 *  transition editor. */
export const MODE_PARAMETERS: Readonly<Record<ModeParameter, ParameterSpec>> = {
  EasingDuration: { label: 'Duration', min: 0.1, max: 2, step: 0.05 },
  VisualDuration: { label: 'Duration', min: 0.1, max: 1, step: 0.05 },
  Bounce: { label: 'Bounce', min: 0, max: 1, step: 0.05 },
  Stiffness: { label: 'Stiffness', min: 1, max: 1000, step: 10 },
  Damping: { label: 'Damping', min: 1, max: 100, step: 1 },
  Mass: { label: 'Mass', min: 0.1, max: 10, step: 0.1 },
}

/** Each parameter's slider label and range: the mode parameters, then the
 *  curve coordinates. */
export const PARAMETERS: Readonly<Record<Parameter, ParameterSpec>> = {
  ...MODE_PARAMETERS,
  EaseX1: { label: 'X1', ...EASE_X },
  EaseY1: { label: 'Y1', ...EASE_Y },
  EaseX2: { label: 'X2', ...EASE_X },
  EaseY2: { label: 'Y2', ...EASE_Y },
}

/** The label DialKit's mode switch shows for each transition mode. */
export const MODE_LABELS: Readonly<Record<TransitionMode, string>> = {
  Easing: 'Easing',
  TimeSpring: 'Time',
  PhysicsSpring: 'Physics',
}

/** The parameters the panel's transition editor shows for each mode, in
 *  DialKit's order. */
export const parametersFor = (
  mode: TransitionMode,
): ReadonlyArray<ModeParameter> =>
  Match.value(mode).pipe(
    Match.withReturnType<ReadonlyArray<ModeParameter>>(),
    Match.when('Easing', () => ['EasingDuration']),
    Match.when('TimeSpring', () => ['Bounce', 'VisualDuration']),
    Match.when('PhysicsSpring', () => ['Stiffness', 'Damping', 'Mass']),
    Match.exhaustive,
  )

/** The value of one parameter in a transition, when it has that parameter. */
export const parameterValue = (
  transition: Transition,
  parameter: Parameter,
): Option.Option<number> =>
  Transition.match<Option.Option<number>>(transition, {
    Easing: ({ duration, ease: [x1, y1, x2, y2] }) =>
      Match.value(parameter).pipe(
        Match.withReturnType<number>(),
        Match.when('EasingDuration', () => duration),
        Match.when('EaseX1', () => x1),
        Match.when('EaseY1', () => y1),
        Match.when('EaseX2', () => x2),
        Match.when('EaseY2', () => y2),
        Match.option,
      ),
    TimeSpring: ({ visualDuration, bounce }) =>
      Match.value(parameter).pipe(
        Match.withReturnType<number>(),
        Match.when('VisualDuration', () => visualDuration),
        Match.when('Bounce', () => bounce),
        Match.option,
      ),
    PhysicsSpring: ({ stiffness, damping, mass }) =>
      Match.value(parameter).pipe(
        Match.withReturnType<number>(),
        Match.when('Stiffness', () => stiffness),
        Match.when('Damping', () => damping),
        Match.when('Mass', () => mass),
        Match.option,
      ),
  })

/** The transition with one parameter set. A parameter the transition does
 *  not have leaves it unchanged. */
export const withParameter = (
  transition: Transition,
  parameter: Parameter,
  value: number,
): Transition =>
  Transition.match<Transition>(transition, {
    Easing: easing => {
      const [x1, y1, x2, y2] = easing.ease
      return Match.value(parameter).pipe(
        Match.withReturnType<Transition>(),
        Match.when('EasingDuration', () =>
          modifyFields(easing, { duration: () => value }),
        ),
        Match.when('EaseX1', () =>
          modifyFields(easing, { ease: () => [value, y1, x2, y2] }),
        ),
        Match.when('EaseY1', () =>
          modifyFields(easing, { ease: () => [x1, value, x2, y2] }),
        ),
        Match.when('EaseX2', () =>
          modifyFields(easing, { ease: () => [x1, y1, value, y2] }),
        ),
        Match.when('EaseY2', () =>
          modifyFields(easing, { ease: () => [x1, y1, x2, value] }),
        ),
        Match.orElse(() => easing),
      )
    },
    TimeSpring: spring =>
      Match.value(parameter).pipe(
        Match.withReturnType<Transition>(),
        Match.when('VisualDuration', () =>
          modifyFields(spring, { visualDuration: () => value }),
        ),
        Match.when('Bounce', () =>
          modifyFields(spring, { bounce: () => value }),
        ),
        Match.orElse(() => spring),
      ),
    PhysicsSpring: spring =>
      Match.value(parameter).pipe(
        Match.withReturnType<Transition>(),
        Match.when('Stiffness', () =>
          modifyFields(spring, { stiffness: () => value }),
        ),
        Match.when('Damping', () =>
          modifyFields(spring, { damping: () => value }),
        ),
        Match.when('Mass', () => modifyFields(spring, { mass: () => value })),
        Match.orElse(() => spring),
      ),
  })
