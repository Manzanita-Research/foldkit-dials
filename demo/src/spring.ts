import { Array, Schema } from 'effect'
import type { Transition } from 'foldkit-dials'

export const SpringState = Schema.Struct({
  position: Schema.Number,
  velocity: Schema.Number,
  target: Schema.Number,
})
export type SpringState = typeof SpringState.Type

const MAX_STEP_MILLISECONDS = 32
const SUBSTEP_MILLISECONDS = 4
const MILLISECONDS_PER_SECOND = 1000
const REST_DELTA = 0.0005
const REST_SPEED = 0.005

/** A spring settled at `target`. */
export const restingAt = (target: number): SpringState => ({
  position: target,
  velocity: 0,
  target,
})

export const isAtRest = (state: SpringState): boolean =>
  Math.abs(state.target - state.position) < REST_DELTA &&
  Math.abs(state.velocity) < REST_SPEED

const integrate = (
  state: SpringState,
  params: Transition.SpringParams,
  deltaSeconds: number,
): SpringState => {
  const displacement = state.position - state.target
  const acceleration =
    (-params.stiffness * displacement - params.damping * state.velocity) /
    params.mass
  const velocity = state.velocity + acceleration * deltaSeconds
  return {
    target: state.target,
    velocity,
    position: state.position + velocity * deltaSeconds,
  }
}

export const step = (
  state: SpringState,
  params: Transition.SpringParams,
  deltaMilliseconds: number,
): SpringState => {
  const clampedMilliseconds = Math.min(deltaMilliseconds, MAX_STEP_MILLISECONDS)
  const substeps = Math.max(
    1,
    Math.ceil(clampedMilliseconds / SUBSTEP_MILLISECONDS),
  )
  const substepSeconds =
    clampedMilliseconds / substeps / MILLISECONDS_PER_SECOND
  const stepped = Array.reduce(Array.range(1, substeps), state, current =>
    integrate(current, params, substepSeconds),
  )
  return isAtRest(stepped) ? restingAt(stepped.target) : stepped
}
