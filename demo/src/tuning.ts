import { Schema } from 'effect'
import { Dial, DialPanel } from 'foldkit-dials'

const svgCover = (from: string, to: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="160" height="100" fill="url(#g)"/></svg>`,
  )}`

const coverAurora = { value: svgCover('#6d5efc', '#22d3ee'), label: 'Aurora' }
const coverDusk = { value: svgCover('#f97316', '#db2777'), label: 'Dusk' }
const coverMint = { value: svgCover('#10b981', '#a3e635'), label: 'Mint' }

export const CardTuning = Schema.Struct({
  title: Dial.text('Foldkit Dials', { placeholder: 'Card title' }),
  layout: Dial.select(['Stack', 'Row']),
  radius: Dial.slider({
    default: 20,
    min: 0,
    max: 48,
    step: 1,
    shortcut: { key: 'r', mode: 'Normal' },
  }),
  lift: Dial.slider({ default: 18, min: 0, max: 60, step: 1 }),
  accent: Dial.color('#6d5efc'),
  hasShadow: Dial.toggle(true, { shortcut: { key: 's' } }),
  pop: Dial.spring({ stiffness: 260, damping: 16, mass: 1 }),
  glow: Dial.pad({
    x: [0.2, -1, 1, 0.01],
    y: [0.4, -1, 1, 0.01],
    labels: { x: 'X', y: 'Y' },
  }),
  cover: Dial.image({ options: [coverAurora, coverDusk, coverMint] }),
  fade: Dial.easing({ duration: 0.4, ease: [0.22, 1, 0.36, 1] }),
  replay: Dial.action('Replay lift'),
  shadow: Dial.folder(
    {
      blur: Dial.slider({ default: 40, min: 0, max: 80 }),
      opacity: Dial.slider({ default: 0.18, min: 0, max: 0.6 }),
    },
    { isCollapsed: true },
  ),
})
export type CardTuning = typeof CardTuning.Type

export const CardDials = DialPanel.make({
  name: 'Card',
  schema: CardTuning,
  persist: true,
})
