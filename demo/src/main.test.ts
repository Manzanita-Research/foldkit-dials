import { DialTimeline } from 'foldkit-dials'
import * as Story from 'foldkit/story'
import { describe, expect, it } from 'vitest'

import { IntroDock } from './intro'
import { Message, type Model, init, update } from './main'
import { restingAt } from './spring'

const start: Model = init().model

describe('demo', () => {
  it('springs the card toward its lifted position', () => {
    Story.story(
      update,
      Story.given(start),
      Story.message(Message.ClickedCard()),
      Story.model(model => {
        expect(model.isLifted).toBe(true)
        expect(model.spring).toEqual({ position: 0, velocity: 0, target: 1 })
      }),
    )
  })

  it('skips the animations when the user prefers reduced motion', () => {
    Story.story(
      update,
      Story.given(start),
      Story.message(Message.UpdatedReducedMotion({ isReducedMotion: true })),
      Story.model(model => {
        expect(IntroDock.valuesOf(model.intro).card.current).toEqual({
          y: 0,
          opacity: 1,
        })
      }),
      Story.message(Message.ClickedCard()),
      Story.model(model => {
        expect(model.spring).toEqual(restingAt(1))
      }),
      Story.message(Message.RequestedReplay()),
      Story.model(model => {
        expect(model.spring).toEqual(restingAt(1))
      }),
    )
  })

  it('retains timeline seeking when a route resubscribes to an unchanged motion preference', () => {
    Story.story(
      update,
      Story.given(start),
      Story.message(Message.UpdatedReducedMotion({ isReducedMotion: true })),
      Story.message(
        Message.GotIntroMessage({
          message: DialTimeline.Message.RequestedSeek({ time: 1.2 }),
        }),
      ),
      Story.message(Message.UpdatedReducedMotion({ isReducedMotion: true })),
      Story.model(model => {
        expect(model.intro.time).toBe(1.2)
        expect(model.intro.isPlaying).toBe(false)
        expect(model.isReducedMotion).toBe(true)
      }),
    )
  })
})
