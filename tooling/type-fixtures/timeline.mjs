import { Timeline, Transition } from 'foldkit-dials'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'

const easing = Transition.Transition.Easing({
  duration: 0.3141592653589793,
  ease: [0.1234567890123456, -0.4567890123456789, 0.8765432109876543, 1.2],
})
const timeSpring = Transition.Transition.TimeSpring({
  visualDuration: 0.2718281828459045,
  bounce: 0.2345678901234567,
})
const physicsSpring = Transition.Transition.PhysicsSpring({
  stiffness: 123.45678901234567,
  damping: 12.345678901234567,
  mass: 1.2345678901234567,
})
const tricky =
  'quote\'"\\\n\r\t\b\f\0\u2028\u2029💚\ud800`; globalThis.injected = true; //'
const clip = Timeline.clip({
  at: 0.1234567890123456,
  duration: 0.8765432109876543,
  from: { x: -0, color: '#001122', held: tricky },
  to: { x: 1.2345678901234567, color: '#aabbcc' },
  transition: easing,
  loop: true,
})
const fixtures = {
  empty: Timeline.make({ clips: {} }),
  all: Timeline.make({
    duration: 0.2345678901234567,
    clips: {
      first: Timeline.group({
        clip,
        sequence: Timeline.sequence({
          at: 0.3333333333333333,
          loop: true,
          from: { x: 0.1234567890123456, label: tricky, color: '#112233' },
          steps: [
            {
              duration: 0.4567890123456789,
              to: { x: 20.123456789012344 },
              transition: timeSpring,
            },
            {
              duration: 1.2345678901234567,
              to: { label: 'later' },
              transition: easing,
            },
            { to: { color: '#334455' }, transition: physicsSpring },
          ],
        }),
        marker: Timeline.marker({ at: 0.1111111111111111 }),
      }),
      tracks: Timeline.tracks({
        at: 0.2222222222222222,
        loop: true,
        props: {
          x: {
            from: -2.1234567890123457,
            to: 50.123456789012344,
            delay: 0.1234567890123456,
            duration: 0.6543210987654321,
            transition: easing,
          },
          label: {
            from: tricky,
            delay: 0.2345678901234567,
            steps: [
              {
                duration: 0.4567890123456789,
                to: 'middle',
                transition: timeSpring,
              },
              { to: tricky, transition: physicsSpring },
              { duration: 0.3456789012345679, to: 'last', transition: easing },
            ],
          },
          color: { from: '#123456', to: '#fedcba', transition: physicsSpring },
          ['__proto__']: {
            from: 7.123456789012345,
            to: 9,
            transition: timeSpring,
          },
          held: { from: 42, steps: [{ to: 42, transition: easing }] },
        },
      }),
      physics: Timeline.clip({
        at: 0.543210987654321,
        from: { x: 0 },
        to: { x: 1 },
        transition: physicsSpring,
      }),
      spring: Timeline.clip({
        at: 0,
        duration: 1.7654321098765433,
        from: { x: 0 },
        to: { x: 1 },
        transition: timeSpring,
      }),
      singleton: Timeline.sequence({
        at: 0,
        from: { x: 1, held: 3 },
        steps: [{ to: {}, transition: easing }],
      }),
      marker: Timeline.marker({
        at: 2.1234567890123457,
        duration: 0.7654321098765432,
      }),
      last: Timeline.group({ final: Timeline.marker({ at: 3 }) }),
    },
  }),
  strings: Timeline.make({
    duration: 20.123456789012344,
    clips: {
      ['2']: Timeline.marker({ at: 0 }),
      [tricky]: Timeline.clip({
        at: 0,
        from: { [tricky]: tricky, ['__proto__']: -0, ['default']: 'original' },
        to: { ['__proto__']: 2, ['default']: 'new' },
        transition: easing,
      }),
      ['__proto__']: Timeline.group({
        ['constructor']: Timeline.tracks({
          at: 0,
          props: {
            [tricky]: { from: tricky, to: 'after', transition: easing },
          },
        }),
        ['__proto__']: Timeline.marker({ at: 0 }),
      }),
      ['default']: Timeline.marker({ at: 1 }),
      ['a.b']: Timeline.marker({ at: 1.5 }),
    },
  }),
  numbers: Timeline.make({
    clips: {
      values: Timeline.clip({
        at: 0,
        from: {
          negativeZero: -0,
          tiny: 1e-100,
          huge: 1e100,
          nan: NaN,
          positive: Infinity,
          negative: -Infinity,
        },
        to: {},
        transition: easing,
      }),
    },
  }),
}

const times = [
  -1,
  0,
  0.1111111111111111,
  0.1234567890123456,
  0.2222222222222222,
  0.3333333333333333,
  0.543210987654321,
  1,
  2,
  3,
  20.123456789012344,
  30,
  ...Array.from({ length: 1001 }, (_, index) => index / 100),
]

if (process.argv.includes('--generate')) {
  const source = Object.entries(fixtures)
    .map(
      ([name, timeline]) =>
        `export const ${name} = ${Timeline.toTimelineSource(timeline)};`,
    )
    .join('\n\n')
  writeFileSync(
    'timeline.generated.ts',
    `import { Timeline, Transition } from 'foldkit-dials';\n${source}\n
const values = Timeline.valuesAt(all, 0.5);
export const x: number = values.first.clip.current.x;
export const color: string = values.first.clip.current.color;
export const sequenceX: number = values.first.sequence.current.x;
export const label: string = values.tracks.current.label;
export const trackX: number = values.tracks.current.x;
export const prototypeTrack: number = values.tracks.current.__proto__;
export const held: number = values.singleton.current.held;
// @ts-expect-error Numeric properties retain their types.
const wrongX: string = values.first.clip.current.x;
// @ts-expect-error String tracks retain their types.
const wrongLabel: number = values.tracks.current.label;
// @ts-expect-error Undeclared properties are rejected.
const missing = values.first.sequence.current.missing;
// @ts-expect-error Markers have no animated values.
const marker = values.marker.current;
`,
  )
} else {
  const rebuilt = await import('./timeline.generated.js')
  Object.entries(fixtures).forEach(([name, expected]) => {
    const actual = rebuilt[name]
    assert.deepEqual(actual, expected, `${name}: exact parsed configuration`)
    assert.equal(actual.minimumDuration, expected.minimumDuration)
    assert.equal(
      Timeline.durationOfTimeline(actual),
      Timeline.durationOfTimeline(expected),
    )
    times.forEach(time => {
      assert.deepEqual(
        Timeline.valuesAt(actual, time),
        Timeline.valuesAt(expected, time),
        `${name}: sample at ${time}`,
      )
    })
    assert.equal(
      Timeline.toTimelineSource(actual),
      Timeline.toTimelineSource(expected),
      `${name}: stable source`,
    )
  })
  assert.equal(globalThis.injected, undefined)
  assert.ok(
    Object.hasOwn(
      rebuilt.strings.clips.find(entry => entry.name === tricky).clip.from,
      '__proto__',
    ),
  )
  console.log(
    `Timeline generated TypeScript passes against the packed public package: ${Object.keys(fixtures).length} exact config round trips and ${times.length * Object.keys(fixtures).length} full sampled-value comparisons; inference, transitions, loops, groups, partial updates and escaped keys/strings verified.`,
  )
}
