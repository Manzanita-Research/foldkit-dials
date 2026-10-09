import { Global, Recipe, Style, Var, When } from '@pleat/core'

// Compile styles once. The view selects layouts and binds live dial values.
Global.rule(':root', {
  fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif",
  color: '#0f172a',
  background: '#eef0f5',
})
Global.rule('*', { boxSizing: 'border-box' })
Global.rule('body', { margin: 0, minHeight: '100vh' })

export const live = {
  accent: Var.string('accent', { fallback: '#6d5efc' }),
  radius: Var.string('card-radius'),
  shadow: Var.string('card-shadow'),
  opacity: Var.number('card-opacity'),
  transform: Var.string('card-transform'),
  transition: Var.string('card-transition'),
  artRadius: Var.string('art-radius'),
  cover: Var.string('art-cover'),
  glowX: Var.string('glow-x'),
  glowY: Var.string('glow-y'),
  badgeTransform: Var.string('badge-transform'),
  sparkleTransform: Var.string('sparkle-transform'),
}

export const demo = Style.make({
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px 340px 240px 40px',
})

export const card = Recipe.make({
  base: {
    position: 'relative',
    font: 'inherit',
    textAlign: 'left',
    color: 'inherit',
    border: 'none',
    cursor: 'pointer',
    background: 'white',
    display: 'flex',
    gap: 14,
    padding: 14,
    willChange: 'transform',
    borderRadius: live.radius,
    boxShadow: live.shadow,
    opacity: live.opacity,
    transform: live.transform,
    transition: live.transition,
  },
  variants: {
    layout: {
      Stack: { width: 280, flexDirection: 'column' },
      Row: { width: 380, flexDirection: 'row', alignItems: 'center' },
    },
  },
})

export const art = Recipe.make({
  base: Style.make({
    position: 'relative',
    overflow: 'hidden',
    display: 'grid',
    placeItems: 'center',
    color: 'white',
    fontSize: 34,
    backgroundColor: live.accent,
    backgroundSize: 'cover',
    borderRadius: live.artRadius,
    backgroundImage: live.cover,
  }).pipe(
    Style.when(When.before, {
      content: "''",
      position: 'absolute',
      inset: 0,
      background: `radial-gradient(circle at ${live.glowX.reference} ${live.glowY.reference}, color-mix(in oklch, ${live.accent.reference} 45%, white), transparent 60%)`,
      mixBlendMode: 'screen',
    }),
  ),
  variants: {
    layout: {
      Stack: { width: '100%', aspectRatio: '16 / 8' },
      Row: { width: 120, flexShrink: 0, aspectRatio: '1' },
    },
  },
})

export const text = Style.make({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '0 4px 4px',
})
export const title = Style.make({ fontSize: 18, fontWeight: 700 })
export const subtitle = Style.make({ fontSize: 14, color: '#64748b' })
export const description = Style.make({ marginTop: 6, fontSize: 14, lineHeight: 1.5, color: '#475569' })
export const hint = Style.make({ marginTop: 8, fontSize: 12, lineHeight: 1.5, color: '#64748b' })
export const links = Style.make({ textAlign: 'center', fontSize: 12, color: '#475569' })
export const linkRow = Style.make({ margin: '10px 0 0' })
export const badge = Style.make({
  position: 'absolute',
  top: 6,
  right: 6,
  zIndex: 1,
  padding: '4px 10px',
  borderRadius: 999,
  background: 'white',
  color: live.accent,
  fontSize: 12,
  fontWeight: 700,
  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.18)',
  transform: live.badgeTransform,
})
export const sparkle = Style.make({
  position: 'relative',
  display: 'inline-block',
  transform: live.sparkleTransform,
})
export const demoTitle = Style.make({
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
})
export const pleatNote = Style.make({
  position: 'absolute',
  top: 32,
  left: 40,
  maxWidth: 280,
  margin: 0,
  fontSize: 14,
  lineHeight: 1.6,
  color: '#64748b',
})
export const pleatLink = Style.make({ color: '#6d5efc', textUnderlineOffset: 3 })
