import { Array, Option, Order, Record } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  type CubicBezier,
  DEFAULT_EASING,
  DEFAULT_PHYSICS_SPRING,
  DEFAULT_TIME_SPRING,
  type SpringParams,
  Transition,
  TransitionMode,
  cssDurationOf,
  cubicBezierProgress,
  defaultTransitionForMode,
  durationOf,
  isTransition,
  progressAt,
  springParams,
  springProgress,
  springRestDuration,
  springSettleDuration,
  toCssTimingFunction,
  toMotion,
} from './index.js'
import {
  MODE_LABELS,
  MODE_PARAMETERS,
  ModeParameter,
  PARAMETERS,
  Parameter,
  parameterValue,
  parametersFor,
  withParameter,
} from './parameters.js'

const SPRING_PRECISION_DIGITS = 9
const BEZIER_PRECISION_DIGITS = 4
const REFERENCE_BISECTION_STEPS = 60
const SAMPLE_COUNT = 100
const SAMPLE_INTERVAL_SECONDS = 0.05
const CSS_SPRING_POINT_COUNT = 40
const REST_TOLERANCE = 0.005
const MAX_LAST_CSS_STEP = 0.01
const REST_SWEEP_BOUNCES = [0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9]
const REST_SWEEP_VISUAL_DURATIONS = [0.15, 0.3, 0.6, 1]
const REST_CHECK_STEP_SECONDS = 0.001
const REST_CHECK_SPAN_SECONDS = 3
const CSS_SPRING_POINT = /^-?\d+(\.\d{1,4})?$/
const WRITTEN_VALUE = 0.123

const CSS_EASE: CubicBezier = [0.25, 0.1, 0.25, 1]
const FLAT_MIDDLE_CURVE: CubicBezier = [1, 0, 0, 1]

const UNDERDAMPED: SpringParams = { stiffness: 25, damping: 6, mass: 1 }
const CRITICALLY_DAMPED: SpringParams = { stiffness: 100, damping: 20, mass: 1 }
const OVERDAMPED: SpringParams = { stiffness: 4, damping: 5, mass: 1 }

const DEFAULTS: ReadonlyArray<Transition> = [
  DEFAULT_EASING,
  DEFAULT_TIME_SPRING,
  DEFAULT_PHYSICS_SPRING,
]

type DefaultRow = Readonly<{
  transition: Transition
  values: Record.ReadonlyRecord<string, number>
}>

const DEFAULT_ROWS: ReadonlyArray<DefaultRow> = [
  {
    transition: DEFAULT_EASING,
    values: {
      EasingDuration: 0.3,
      EaseX1: 1,
      EaseY1: -0.4,
      EaseX2: 0.5,
      EaseY2: 1,
    },
  },
  {
    transition: DEFAULT_TIME_SPRING,
    values: { VisualDuration: 0.3, Bounce: 0.2 },
  },
  {
    transition: DEFAULT_PHYSICS_SPRING,
    values: { Stiffness: 200, Damping: 25, Mass: 1 },
  },
]

const EDITOR_ROWS: ReadonlyArray<
  Readonly<{ mode: TransitionMode; parameters: ReadonlyArray<Parameter> }>
> = [
  { mode: 'Easing', parameters: ['EasingDuration'] },
  { mode: 'TimeSpring', parameters: ['Bounce', 'VisualDuration'] },
  { mode: 'PhysicsSpring', parameters: ['Stiffness', 'Damping', 'Mass'] },
]

const sampleTimes = Array.makeBy(
  SAMPLE_COUNT,
  index => (index + 1) * SAMPLE_INTERVAL_SECONDS,
)

const dampingRatioOf = ({ stiffness, damping, mass }: SpringParams): number =>
  damping / (2 * Math.sqrt(stiffness * mass))

const bernsteinAxis = (
  parameter: number,
  first: number,
  second: number,
): number =>
  3 * first * parameter * (1 - parameter) ** 2 +
  3 * second * parameter ** 2 * (1 - parameter) +
  parameter ** 3

const referenceBezierProgress = (
  progress: number,
  [x1, y1, x2, y2]: CubicBezier,
): number => {
  const { low, high } = Array.reduce(
    Array.range(1, REFERENCE_BISECTION_STEPS),
    { low: 0, high: 1 },
    bounds => {
      const middle = (bounds.low + bounds.high) / 2
      if (bernsteinAxis(middle, x1, x2) < progress) {
        return { low: middle, high: bounds.high }
      } else {
        return { low: bounds.low, high: middle }
      }
    },
  )
  return bernsteinAxis((low + high) / 2, y1, y2)
}

const parameterValuesOf = (
  transition: Transition,
): Record.ReadonlyRecord<string, number> =>
  Record.getSomes(
    Record.fromIterableWith(Parameter.literals, parameter => [
      parameter,
      parameterValue(transition, parameter),
    ]),
  )

const parametersIn = (
  values: Record.ReadonlyRecord<string, number>,
): ReadonlyArray<Parameter> =>
  Array.filter(Parameter.literals, parameter => Record.has(values, parameter))

describe('transition', () => {
  describe('springProgress', () => {
    it.each([UNDERDAMPED, CRITICALLY_DAMPED, OVERDAMPED])(
      'starts at 0 at or before release',
      params => {
        expect(springProgress(0, params)).toBe(0)
        expect(springProgress(-1, params)).toBe(0)
      },
    )

    it.each([
      [Math.PI / 8, 1 - 0.75 * Math.exp((-3 * Math.PI) / 8)],
      [Math.PI / 4, 1 + Math.exp((-3 * Math.PI) / 4)],
    ])(
      'follows 1 - e^(-3t)(cos 4t + 0.75 sin 4t) for an underdamped spring at %s seconds',
      (seconds, expected) => {
        expect(springProgress(seconds, UNDERDAMPED)).toBeCloseTo(
          expected,
          SPRING_PRECISION_DIGITS,
        )
      },
    )

    it('overshoots past 1 when underdamped', () => {
      expect(springProgress(Math.PI / 4, UNDERDAMPED)).toBeGreaterThan(1)
    })

    it.each([0.1, 0.3, 0.5])(
      'follows 1 - e^(-10t)(1 + 10t) for a critically damped spring at %s seconds',
      seconds => {
        expect(springProgress(seconds, CRITICALLY_DAMPED)).toBeCloseTo(
          1 - Math.exp(-10 * seconds) * (1 + 10 * seconds),
          SPRING_PRECISION_DIGITS,
        )
      },
    )

    it('never overshoots when critically damped', () => {
      const progresses = Array.map(sampleTimes, seconds =>
        springProgress(seconds, CRITICALLY_DAMPED),
      )

      expect(Math.max(...progresses)).toBeLessThanOrEqual(1)
    })

    it.each([0.5, 1, 2])(
      'follows 1 - (4/3)e^(-t) + (1/3)e^(-4t) for an overdamped spring at %s seconds',
      seconds => {
        expect(springProgress(seconds, OVERDAMPED)).toBeCloseTo(
          1 - (4 / 3) * Math.exp(-seconds) + (1 / 3) * Math.exp(-4 * seconds),
          SPRING_PRECISION_DIGITS,
        )
      },
    )

    it('rises monotonically and stays below 1 when overdamped', () => {
      const progresses = Array.map(sampleTimes, seconds =>
        springProgress(seconds, OVERDAMPED),
      )
      const fallingSteps = Array.filter(
        Array.zip(progresses, Array.drop(progresses, 1)),
        ([earlier, later]) => later <= earlier,
      )

      expect(fallingSteps).toEqual([])
      expect(Math.max(...progresses)).toBeLessThan(1)
    })

    it.each([UNDERDAMPED, CRITICALLY_DAMPED, OVERDAMPED])(
      'depends on mass only through stiffness and damping per unit mass',
      params => {
        const heavier = {
          stiffness: params.stiffness * 2,
          damping: params.damping * 2,
          mass: params.mass * 2,
        }

        expect(springProgress(0.4, heavier)).toBeCloseTo(
          springProgress(0.4, params),
          SPRING_PRECISION_DIGITS,
        )
      },
    )
  })

  describe('springParams', () => {
    it("maps a time spring to physics with Motion's formula", () => {
      const stiffness = ((2 * Math.PI) / (0.5 * 1.2)) ** 2
      const params = springParams(
        Transition.TimeSpring({ visualDuration: 0.5, bounce: 0.25 }),
      )

      expect(params.stiffness).toBeCloseTo(stiffness, SPRING_PRECISION_DIGITS)
      expect(params.damping).toBeCloseTo(
        2 * 0.75 * Math.sqrt(stiffness),
        SPRING_PRECISION_DIGITS,
      )
      expect(params.mass).toBe(1)
    })

    it.each([
      [0, 1],
      [0.25, 0.75],
      [0.99, 0.05],
      [1, 0.05],
      [-0.5, 1],
    ])('maps bounce %s to damping ratio %s', (bounce, dampingRatio) => {
      const params = springParams(
        Transition.TimeSpring({ visualDuration: 0.5, bounce }),
      )

      expect(dampingRatioOf(params)).toBeCloseTo(
        dampingRatio,
        SPRING_PRECISION_DIGITS,
      )
    })

    it('treats a visual duration below 0.05 seconds as 0.05 seconds', () => {
      expect(
        springParams(Transition.TimeSpring({ visualDuration: 0, bounce: 0.2 })),
      ).toEqual(
        springParams(
          Transition.TimeSpring({ visualDuration: 0.05, bounce: 0.2 }),
        ),
      )
    })

    it('passes a physics spring through', () => {
      expect(springParams(DEFAULT_PHYSICS_SPRING)).toEqual({
        stiffness: 200,
        damping: 25,
        mass: 1,
      })
    })
  })

  describe('springSettleDuration', () => {
    it.each([
      {
        name: 'an underdamped spring by its envelope',
        params: UNDERDAMPED,
        seconds: 1.77,
      },
      {
        name: 'a critically damped spring',
        params: CRITICALLY_DAMPED,
        seconds: 0.53,
      },
      {
        name: 'an overdamped spring by its slow root',
        params: OVERDAMPED,
        seconds: 5.3,
      },
      {
        name: 'a very stiff spring at the 0.05 second floor',
        params: { stiffness: 1e6, damping: 2000, mass: 1 },
        seconds: 0.05,
      },
      {
        name: 'a barely damped spring at the 10 second ceiling',
        params: { stiffness: 1, damping: 0.01, mass: 1 },
        seconds: 10,
      },
      {
        name: 'an undamped spring at the 10 second ceiling',
        params: { stiffness: 100, damping: 0, mass: 1 },
        seconds: 10,
      },
    ])('settles $name, rounded to hundredths', ({ params, seconds }) => {
      expect(springSettleDuration(params)).toBe(seconds)
    })

    it('leaves a spring with no bounce about 3.3% short of its target', () => {
      const params = springParams(
        Transition.TimeSpring({ visualDuration: 0.3, bounce: 0 }),
      )

      expect(
        1 - springProgress(springSettleDuration(params), params),
      ).toBeCloseTo(0.033, 3)
    })
  })

  describe('springRestDuration', () => {
    const distanceFromRest = (params: SpringParams, seconds: number): number =>
      Math.abs(1 - springProgress(seconds, params))

    it.each([
      { name: 'an underdamped spring', params: UNDERDAMPED },
      { name: 'a critically damped spring', params: CRITICALLY_DAMPED },
      { name: 'an overdamped spring', params: OVERDAMPED },
      ...Array.flatMap(REST_SWEEP_BOUNCES, bounce =>
        Array.map(REST_SWEEP_VISUAL_DURATIONS, visualDuration => ({
          name: `a time spring with bounce ${bounce} over ${visualDuration}s`,
          params: springParams(
            Transition.TimeSpring({ visualDuration, bounce }),
          ),
        })),
      ),
    ])('finds the moment $name comes to rest and stays there', ({ params }) => {
      const rest = springRestDuration(params)
      const later = Array.makeBy(
        REST_CHECK_SPAN_SECONDS / REST_CHECK_STEP_SECONDS,
        index => rest + index * REST_CHECK_STEP_SECONDS,
      )

      expect(
        distanceFromRest(params, rest - REST_CHECK_STEP_SECONDS),
      ).toBeGreaterThan(REST_TOLERANCE)
      expect(
        Array.every(
          later,
          seconds => distanceFromRest(params, seconds) <= REST_TOLERANCE,
        ),
      ).toBe(true)
    })

    it('is never earlier than the settle time a curve snaps at', () => {
      expect(springRestDuration(CRITICALLY_DAMPED)).toBeGreaterThan(
        springSettleDuration(CRITICALLY_DAMPED),
      )
    })

    it.each([
      {
        name: 'an undamped spring at the 10 second ceiling',
        params: { stiffness: 100, damping: 0, mass: 1 },
        seconds: 10,
      },
      {
        name: 'a very stiff spring at the 0.05 second floor',
        params: { stiffness: 1e6, damping: 2000, mass: 1 },
        seconds: 0.05,
      },
    ])('clamps $name', ({ params, seconds }) => {
      expect(springRestDuration(params)).toBe(seconds)
    })
  })

  describe('cubicBezierProgress', () => {
    it.each([
      [-0.5, 0],
      [0, 0],
      [1, 1],
      [1.5, 1],
    ])('clamps progress %s to %s', (progress, expected) => {
      expect(cubicBezierProgress(progress, DEFAULT_EASING.ease)).toBe(expected)
    })

    it.each([0.1, 0.37, 0.5, 0.9])(
      'returns progress %s unchanged on the linear curve',
      progress => {
        expect(cubicBezierProgress(progress, [0, 0, 1, 1])).toBeCloseTo(
          progress,
          BEZIER_PRECISION_DIGITS,
        )
      },
    )

    it.each([
      [0.25, 0.40851],
      [0.5, 0.8024],
      [0.75, 0.96046],
    ])('matches the CSS ease curve at progress %s', (progress, expected) => {
      expect(cubicBezierProgress(progress, CSS_EASE)).toBeCloseTo(
        expected,
        BEZIER_PRECISION_DIGITS,
      )
    })

    it.each([0.45, 0.49, 0.51, 0.55])(
      "solves a curve with a flat middle, where Newton's method does not converge, at progress %s",
      progress => {
        expect(cubicBezierProgress(progress, FLAT_MIDDLE_CURVE)).toBeCloseTo(
          referenceBezierProgress(progress, FLAT_MIDDLE_CURVE),
          BEZIER_PRECISION_DIGITS,
        )
      },
    )
  })

  describe('progressAt', () => {
    it.each(DEFAULTS)('is 0 at or before the start of $_tag', transition => {
      expect(progressAt(transition, 0)).toBe(0)
      expect(progressAt(transition, -1)).toBe(0)
    })

    it('holds a zero-duration easing at 0 until it starts, then jumps to 1', () => {
      const instant = Transition.Easing({ duration: 0, ease: CSS_EASE })

      expect(progressAt(instant, 0)).toBe(0)
      expect(progressAt(instant, 0.001)).toBe(1)
    })

    it('eases an easing along its curve and holds 1 after its duration', () => {
      expect(progressAt(DEFAULT_EASING, 0.15)).toBe(
        cubicBezierProgress(0.5, DEFAULT_EASING.ease),
      )
      expect(progressAt(DEFAULT_EASING, 0.3)).toBe(1)
      expect(progressAt(DEFAULT_EASING, 2)).toBe(1)
    })

    it.each([DEFAULT_TIME_SPRING, DEFAULT_PHYSICS_SPRING])(
      'follows the $_tag until it settles, then returns exactly 1',
      spring => {
        const params = springParams(spring)
        const settleSeconds = springSettleDuration(params)

        expect(progressAt(spring, settleSeconds / 2)).toBe(
          springProgress(settleSeconds / 2, params),
        )
        expect(progressAt(spring, settleSeconds)).toBe(1)
        expect(progressAt(spring, settleSeconds + 1)).toBe(1)
      },
    )
  })

  describe('durationOf', () => {
    it.each([
      {
        name: 'an easing by its duration',
        transition: Transition.Easing({ duration: 0.6, ease: CSS_EASE }),
        seconds: 0.6,
      },
      {
        name: 'a time spring by its visual duration',
        transition: Transition.TimeSpring({
          visualDuration: 0.45,
          bounce: 0.2,
        }),
        seconds: 0.45,
      },
      {
        name: 'a physics spring by its settle time',
        transition: DEFAULT_PHYSICS_SPRING,
        seconds: 0.42,
      },
    ])('times $name', ({ transition, seconds }) => {
      expect(durationOf(transition)).toBe(seconds)
    })
  })

  describe('toCssTimingFunction', () => {
    it('writes an easing as cubic-bezier()', () => {
      expect(
        toCssTimingFunction(
          Transition.Easing({ duration: 0.3, ease: CSS_EASE }),
        ),
      ).toBe('cubic-bezier(0.25, 0.1, 0.25, 1)')
    })

    it('samples a spring into a linear() curve from 0 to 1', () => {
      const css = toCssTimingFunction(DEFAULT_PHYSICS_SPRING)
      const points = css.slice('linear('.length, -')'.length).split(', ')

      expect(css).toMatch(/^linear\(0, .*, 1\)$/)
      expect(points).toHaveLength(CSS_SPRING_POINT_COUNT)
      expect(
        Array.filter(points, point => !CSS_SPRING_POINT.test(point)),
      ).toEqual([])
    })

    it('ends a bouncy time spring at rest, after its visual duration', () => {
      const bouncy = Transition.TimeSpring({ visualDuration: 0.3, bounce: 0.6 })

      expect(toCssTimingFunction(bouncy)).toMatch(/, 1\)$/)
      expect(cssDurationOf(bouncy)).toBe(
        springRestDuration(springParams(bouncy)),
      )
      expect(cssDurationOf(bouncy)).toBeGreaterThan(durationOf(bouncy))
      expect(cssDurationOf(DEFAULT_EASING)).toBe(DEFAULT_EASING.duration)
    })

    it.each([0, 0.1, 0.2, 0.5, 0.8])(
      'ends a time spring with bounce %s with a last step under one percent',
      bounce => {
        const points = Array.map(
          toCssTimingFunction(
            Transition.TimeSpring({ visualDuration: 0.3, bounce }),
          )
            .slice('linear('.length, -')'.length)
            .split(', '),
          point => globalThis.Number(point),
        )
        const [secondToLast, last] = Array.takeRight(points, 2)

        expect(last).toBe(1)
        expect(Math.abs(1 - (secondToLast ?? 0))).toBeLessThan(
          MAX_LAST_CSS_STEP,
        )
      },
    )

    it('samples the spring itself, without the snap to 1 at its settle time', () => {
      const spring = Transition.TimeSpring({ visualDuration: 0.3, bounce: 0 })
      const params = springParams(spring)
      const duration = cssDurationOf(spring)
      const points = toCssTimingFunction(spring)
        .slice('linear('.length, -')'.length)
        .split(', ')
      const lastIndex = CSS_SPRING_POINT_COUNT - 1

      expect(Array.dropRight(points, 1)).toEqual(
        Array.makeBy(lastIndex, index =>
          globalThis
            .Number(
              springProgress((index / lastIndex) * duration, params).toFixed(4),
            )
            .toString(),
        ),
      )
    })
  })

  describe('toMotion', () => {
    it.each([
      {
        transition: DEFAULT_EASING,
        motion: { duration: 0.3, ease: [1, -0.4, 0.5, 1] },
      },
      {
        transition: DEFAULT_TIME_SPRING,
        motion: { type: 'spring', visualDuration: 0.3, bounce: 0.2 },
      },
      {
        transition: DEFAULT_PHYSICS_SPRING,
        motion: { type: 'spring', stiffness: 200, damping: 25, mass: 1 },
      },
    ])(
      "writes $transition._tag in Motion's config shape",
      ({ transition, motion }) => {
        expect(toMotion(transition)).toStrictEqual(motion)
      },
    )
  })

  describe('isTransition', () => {
    it.each(DEFAULTS)('accepts $_tag', transition => {
      expect(isTransition(transition)).toBe(true)
    })

    it.each([
      { _tag: 'Easing' },
      { _tag: 'TimeSpring', visualDuration: '0.3', bounce: 0.2 },
      0.3,
      null,
    ])('rejects %j', value => {
      expect(isTransition(value)).toBe(false)
    })
  })

  describe('defaultTransitionForMode', () => {
    it.each(TransitionMode.literals)('defaults %s to that mode', mode => {
      expect(defaultTransitionForMode(mode)._tag).toBe(mode)
    })
  })

  describe('parameters', () => {
    it.each(EDITOR_ROWS)(
      'shows $parameters for $mode',
      ({ mode, parameters }) => {
        expect(parametersFor(mode)).toEqual(parameters)
      },
    )

    it('names exactly the parameters some mode shows as mode parameters', () => {
      expect(
        Array.sort(
          Array.dedupe(Array.flatMap(TransitionMode.literals, parametersFor)),
          Order.String,
        ),
      ).toEqual(Array.sort(ModeParameter.literals, Order.String))
      expect(Record.keys(MODE_PARAMETERS)).toEqual(ModeParameter.literals)
    })

    it.each(DEFAULT_ROWS)(
      'reads the parameters $transition._tag has and no others',
      ({ transition, values }) => {
        expect(parameterValuesOf(transition)).toEqual(values)
      },
    )

    it.each(DEFAULT_ROWS)(
      'writes each parameter of $transition._tag where parameterValue reads it',
      ({ transition, values }) => {
        Array.forEach(parametersIn(values), parameter => {
          expect(
            parameterValuesOf(
              withParameter(transition, parameter, WRITTEN_VALUE),
            ),
          ).toEqual({ ...values, [parameter]: WRITTEN_VALUE })
        })
      },
    )

    it.each(DEFAULT_ROWS)(
      'leaves $transition._tag unchanged for a parameter it lacks',
      ({ transition, values }) => {
        const lackedParameters = Array.difference(
          Parameter.literals,
          parametersIn(values),
        )

        Array.forEach(lackedParameters, parameter => {
          expect(withParameter(transition, parameter, WRITTEN_VALUE)).toEqual(
            transition,
          )
        })
      },
    )

    it.each(Parameter.literals)(
      'gives %s a range with min below max and a positive step',
      parameter => {
        const { min, max, step } = PARAMETERS[parameter]

        expect(min).toBeLessThan(max)
        expect(step).toBeGreaterThan(0)
      },
    )

    it.each(DEFAULTS)('starts $_tag inside every slider range', transition => {
      const outOfRange = Array.filter(Parameter.literals, parameter =>
        Option.exists(
          parameterValue(transition, parameter),
          value =>
            value < PARAMETERS[parameter].min ||
            value > PARAMETERS[parameter].max,
        ),
      )

      expect(outOfRange).toEqual([])
    })

    it("labels every mode with DialKit's names", () => {
      expect(
        Array.map(TransitionMode.literals, mode => MODE_LABELS[mode]),
      ).toEqual(['Easing', 'Time', 'Physics'])
    })
  })
})
