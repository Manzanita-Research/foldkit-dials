import { Array } from 'effect'

import { Transition } from '../transition/index.js'

/** Creates a transition expression formatter with the caller's constructors
 *  and numeric precision. Instantiate it once at module scope. */
export const createTransitionSource = (
  formatNumber: (value: number) => string,
  constructors: Readonly<Record<Transition['_tag'], string>>,
): ((transition: Transition) => string) =>
  Transition.match<string>({
    TimeSpring: ({ visualDuration, bounce }) =>
      `${constructors.TimeSpring}({ visualDuration: ${formatNumber(visualDuration)}, bounce: ${formatNumber(bounce)} })`,
    PhysicsSpring: ({ stiffness, damping, mass }) =>
      `${constructors.PhysicsSpring}({ stiffness: ${formatNumber(stiffness)}, damping: ${formatNumber(damping)}, mass: ${formatNumber(mass)} })`,
    Easing: ({ duration, ease }) =>
      `${constructors.Easing}({ duration: ${formatNumber(duration)}, ease: [${Array.join(Array.map(ease, formatNumber), ', ')}] })`,
  })
