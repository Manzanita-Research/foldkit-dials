import { Array, Option, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { Transition } from '../transition/index.js'
import * as Dial from './index.js'

const Tuning = Schema.Struct({
  title: Dial.text('Hello', { placeholder: 'Title' }),
  layout: Dial.select(['stack', { value: 'grid', label: 'Grid layout' }]),
  radius: Dial.slider({ default: 24, min: 0, max: 64 }),
  scale: Dial.number(1.2),
  accent: Dial.color('#a78bfa'),
  isVisible: Dial.toggle(true, { shortcut: { key: 'v' } }),
  cover: Dial.image({ options: ['/coast.jpg', '/mountains.jpg'] }),
  position: Dial.pad({ x: [0.3, 0.1, 1, 0.01], labels: { x: 'Duration' } }),
  pop: Dial.spring({ visualDuration: 0.3, bounce: 0.2 }),
  replay: Dial.action('Replay animation'),
  shadow: Dial.folder(
    {
      blur: Dial.slider({ default: 12, min: 0, max: 40 }),
      reset: Dial.action(),
    },
    { isCollapsed: true },
  ),
})

const decode = Schema.decodeUnknownSync(Tuning)

describe('Dial', () => {
  describe('defaults', () => {
    it('collects every dial default into a valid values record', () => {
      const values = Dial.defaults(Tuning)

      expect(values).toEqual({
        title: 'Hello',
        layout: 'stack',
        radius: 24,
        scale: 1.2,
        accent: '#a78bfa',
        isVisible: true,
        cover: '/coast.jpg',
        position: { x: 0.3, y: 0 },
        pop: Transition.TimeSpring({ visualDuration: 0.3, bounce: 0.2 }),
        shadow: { blur: 12 },
      })
      expect(Schema.is(Tuning)(values)).toBe(true)
    })

    it('leaves actions out of the values', () => {
      const values = Dial.defaults(Tuning)

      expect('replay' in values).toBe(false)
      expect('reset' in values.shadow).toBe(false)
    })

    it('throws when a colour default cannot be parsed', () => {
      const Broken = Schema.Struct({ accent: Dial.color('not a colour') })

      expect(() => Dial.defaults(Broken)).toThrow(/does not satisfy/)
    })

    it('throws when a folder field default cannot be parsed', () => {
      expect(() => Dial.folder({ accent: Dial.color('not a colour') })).toThrow(
        /a CSS colour/,
      )
    })

    it.each([
      { given: 'no options', options: [], expected: '' },
      {
        given: 'string options',
        options: ['/coast.jpg', '/mountains.jpg'],
        expected: '/coast.jpg',
      },
      {
        given: 'a labelled option',
        options: [{ value: '/coast.jpg', label: 'Coast' }],
        expected: '/coast.jpg',
      },
    ])(
      'defaults an image to its first option value, given $given',
      ({ options, expected }) => {
        const Cover = Schema.Struct({ cover: Dial.image({ options }) })

        expect(Dial.defaults(Cover).cover).toBe(expected)
      },
    )
  })

  describe('slider range inference', () => {
    it('infers the step from the range, as DialKit does', () => {
      expect(Dial.inferStep(0, 1)).toBe(0.01)
      expect(Dial.inferStep(0, 10)).toBe(0.1)
      expect(Dial.inferStep(0, 64)).toBe(1)
      expect(Dial.inferStep(0, 500)).toBe(10)
    })

    it('infers a bare number range of 0 to three times the value', () => {
      const controls = Dial.controlsOf(Tuning)
      const scale = Dial.findLeaf(controls, 'scale')

      expect(Option.map(scale, ({ meta }) => meta)).toEqual(
        Option.some({
          _tag: 'Slider',
          min: 0,
          max: 3.6,
          step: 0.1,
          default: 1.2,
          maybeShortcut: Option.none(),
        }),
      )
    })

    it('ranges a negative bare number from three times itself to its opposite', () => {
      const Negative = Schema.Struct({ offset: Dial.number(-4) })
      const offset = Dial.findLeaf(Dial.controlsOf(Negative), 'offset')

      expect(
        Option.map(offset, ({ meta }) =>
          meta._tag === 'Slider' ? [meta.min, meta.max] : [],
        ),
      ).toEqual(Option.some([-12, 12]))
    })

    it('carries a bare number shortcut onto its slider', () => {
      const Scaled = Schema.Struct({
        scale: Dial.number(1.2, { shortcut: { key: 's' } }),
      })
      const scale = Dial.findLeaf(Dial.controlsOf(Scaled), 'scale')

      expect(
        Option.flatMap(scale, ({ meta }) =>
          meta._tag === 'Slider' ? meta.maybeShortcut : Option.none(),
        ),
      ).toEqual(Option.some({ key: 's' }))
    })
  })

  describe('pad axes', () => {
    it('divides an axis without a step into 200 intervals', () => {
      const Point = Schema.Struct({ point: Dial.pad({ x: [0, 0, 1] }) })
      const point = Dial.findLeaf(Dial.controlsOf(Point), 'point')

      expect(
        Option.map(point, ({ meta }) =>
          meta._tag === 'Pad' ? [meta.x.step, meta.y.step] : [],
        ),
      ).toEqual(Option.some([0.005, 0.01]))
    })
  })

  describe('lenient decoding', () => {
    it('fills a missing key with its default', () => {
      const values = decode({ radius: 30 })

      expect(values.radius).toBe(30)
      expect(values.title).toBe('Hello')
      expect(values.shadow.blur).toBe(12)
    })

    it('replaces a stored value outside the range with the default', () => {
      expect(decode({ radius: 999 }).radius).toBe(24)
    })

    it('replaces a stored value of the wrong type with the default', () => {
      expect(decode({ isVisible: 'yes', layout: 'carousel' })).toMatchObject({
        isVisible: true,
        layout: 'stack',
      })
    })

    it('replaces an unparsable colour with the default', () => {
      expect(decode({ accent: 'banana' }).accent).toBe('#a78bfa')
    })

    it('decodes an empty record as the defaults', () => {
      expect(decode({})).toEqual(Dial.defaults(Tuning))
    })

    it.each([
      {
        stored: 'a pad axis outside its range',
        values: { position: { x: 99 } },
      },
      { stored: 'an image that is not a string', values: { cover: 3 } },
      { stored: 'a spring that is not a Transition', values: { pop: 'fast' } },
      { stored: 'a folder that is not a record', values: { shadow: 3 } },
    ])('replaces $stored with the default', ({ values }) => {
      expect(decode(values)).toEqual(Dial.defaults(Tuning))
    })

    it('replaces only the invalid axis of a pad', () => {
      expect(decode({ position: { x: 99, y: 0.5 } }).position).toEqual({
        x: 0.3,
        y: 0.5,
      })
    })

    it('replaces only the invalid field of a folder', () => {
      const Shadow = Schema.Struct({
        shadow: Dial.folder({
          blur: Dial.slider({ default: 12, min: 0, max: 40 }),
          isInset: Dial.toggle(false),
        }),
      })

      expect(
        Schema.decodeUnknownSync(Shadow)({
          shadow: { blur: 999, isInset: true },
        }),
      ).toEqual({ shadow: { blur: 12, isInset: true } })
    })

    it('still rejects invalid values when validating, not decoding', () => {
      const values = Dial.defaults(Tuning)

      expect(Schema.is(Tuning)({ ...values, radius: 99 })).toBe(false)
      expect(Schema.is(Tuning)({ ...values, accent: 'banana' })).toBe(false)
    })
  })

  describe('control tree', () => {
    it('lists controls in declaration order with formatted labels', () => {
      const labels = Array.map(Dial.controlsOf(Tuning), ({ label }) => label)

      expect(labels).toEqual([
        'Title',
        'Layout',
        'Radius',
        'Scale',
        'Accent',
        'Is Visible',
        'Cover',
        'Position',
        'Pop',
        'Replay animation',
        'Shadow',
      ])
    })

    it.each([
      { key: 'shadowBlur', label: 'Shadow Blur' },
      { key: 'layer2Opacity', label: 'Layer2 Opacity' },
      { key: 'radius', label: 'Radius' },
    ])('labels the key $key as $label', ({ key, label }) => {
      expect(Dial.formatLabel(key)).toBe(label)
    })

    it('nests folder children with full paths', () => {
      const shadow = Array.findFirst(
        Dial.controlsOf(Tuning),
        control => control._tag === 'Folder',
      )

      expect(
        Option.map(shadow, control =>
          control._tag === 'Folder'
            ? [
                control.isCollapsed,
                Array.map(control.children, ({ path }) => Dial.pathKey(path)),
              ]
            : [],
        ),
      ).toEqual(Option.some([true, ['shadow.blur', 'shadow.reset']]))
    })

    it('labels select options from their values unless given', () => {
      const layout = Dial.findLeaf(Dial.controlsOf(Tuning), 'layout')

      expect(
        Option.map(layout, ({ meta }) =>
          meta._tag === 'Select' ? meta.options : [],
        ),
      ).toEqual(
        Option.some([
          { value: 'stack', label: 'Stack' },
          { value: 'grid', label: 'Grid layout' },
        ]),
      )
    })

    it('carries a shortcut on the control', () => {
      const isVisible = Dial.findLeaf(Dial.controlsOf(Tuning), 'isVisible')

      expect(
        Option.flatMap(isVisible, ({ meta }) =>
          meta._tag === 'Toggle' ? meta.maybeShortcut : Option.none(),
        ),
      ).toEqual(Option.some({ key: 'v' }))
    })
  })

  describe('paths', () => {
    it('reads and writes nested values without mutating', () => {
      const values = Dial.defaults(Tuning)
      const next = Dial.setAtPath(values, ['shadow', 'blur'], 30)

      expect(Dial.getAtPath(next, ['shadow', 'blur'])).toBe(30)
      expect(values.shadow.blur).toBe(12)
    })

    it('writes through a value that is not a record by replacing it', () => {
      expect(
        Dial.setAtPath({ radius: 24, shadow: 3 }, ['shadow', 'blur'], 30),
      ).toEqual({ radius: 24, shadow: { blur: 30 } })
    })
  })
})
