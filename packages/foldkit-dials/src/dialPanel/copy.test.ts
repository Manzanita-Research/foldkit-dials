import { Array, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import * as Dial from '../dial/index.js'
import { toDialSource } from './copy.js'
import { make } from './index.js'

const Source = Schema.Struct({
  title: Dial.text('Hello'),
  radius: Dial.slider({
    default: 20,
    min: 0,
    max: 48,
    step: 1,
    shortcut: { key: 'r', modifier: 'Alt' },
  }),
  cover: Dial.image({ options: ['/a.png'] }),
  shadow: Dial.folder(
    {
      blur: Dial.slider({ default: 12, min: 0, max: 40 }),
      inner: Dial.folder({ isOn: Dial.toggle(true) }),
    },
    { isCollapsed: true },
  ),
})
type Source = typeof Source.Type

const { controls, defaults } = make({ name: 'Card', schema: Source })

const sourceLines = (values: Source): ReadonlyArray<string> =>
  toDialSource('Card', controls, values).split('\n')

describe('toDialSource', () => {
  it('writes the dial Schema with the given values as its defaults', () => {
    expect(
      toDialSource('Card', controls, {
        title: "it's a \\ path",
        radius: 33,
        cover: 'data:image/png;base64,AAAA',
        shadow: { blur: 12, inner: { isOn: false } },
      }),
    ).toBe(
      Array.join(
        [
          '// Card: tuned with foldkit-dials. Paste over your dial Schema.',
          'Schema.Struct({',
          "  title: Dial.text('it\\'s a \\\\ path'),",
          "  radius: Dial.slider({ default: 33, min: 0, max: 48, step: 1, shortcut: { key: 'r', modifier: 'Alt' } }),",
          "  cover: Dial.image({ options: ['/a.png'], default: '' /* uploaded image omitted */ }),",
          '  shadow: Dial.folder({',
          '    blur: Dial.slider({ default: 12, min: 0, max: 40, step: 1 }),',
          '    inner: Dial.folder({',
          '      isOn: Dial.toggle(false),',
          '    }),',
          '  }, { isCollapsed: true }),',
          '})',
        ],
        '\n',
      ),
    )
  })

  it('escapes quotes and backslashes in text', () => {
    expect(sourceLines({ ...defaults, title: "Bob's \\n" })).toContain(
      "  title: Dial.text('Bob\\'s \\\\n'),",
    )
  })

  it('keeps an image URL and leaves out an uploaded data URL', () => {
    expect(sourceLines({ ...defaults, cover: '/a.png' })).toContain(
      "  cover: Dial.image({ options: ['/a.png'], default: '/a.png' }),",
    )
    expect(
      sourceLines({ ...defaults, cover: 'data:image/png;base64,AAAA' }),
    ).toContain(
      "  cover: Dial.image({ options: ['/a.png'], default: '' /* uploaded image omitted */ }),",
    )
  })
})
