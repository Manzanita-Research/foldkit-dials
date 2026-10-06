import { DialTimeline, Timeline, Transition } from 'foldkit-dials'

/** How long the card's entrance runs. */
export const INTRO_DURATION_SECONDS = 3

const settle = Transition.Transition.Easing({
  duration: 0.6,
  ease: [0.22, 1, 0.36, 1],
})

/** The card's entrance: it rises in, the sparkle spins up, and the badge
 *  springs on. It plays once on load; replay it and edit every bar in the
 *  dock. */
export const introTimeline = Timeline.make({
  duration: INTRO_DURATION_SECONDS,
  clips: {
    card: Timeline.clip({
      at: 0,
      duration: 0.7,
      from: { y: 28, opacity: 0 },
      to: { y: 0, opacity: 1 },
      transition: settle,
    }),
    sparkle: Timeline.sequence({
      at: 0.3,
      from: { rotate: -120, scale: 0.4 },
      transition: settle,
      steps: [
        { duration: 0.5, to: { rotate: 0, scale: 1.25 } },
        { duration: 0.4, to: { rotate: 0, scale: 1 } },
      ],
    }),
    badge: Timeline.clip({
      at: 0.9,
      from: { scale: 0 },
      to: { scale: 1 },
      transition: Transition.Transition.PhysicsSpring({
        stiffness: 320,
        damping: 14,
        mass: 1,
      }),
    }),
  },
})

export const IntroDock = DialTimeline.make({
  name: 'Intro',
  timeline: introTimeline,
  loop: false,
  theme: 'Light',
})
