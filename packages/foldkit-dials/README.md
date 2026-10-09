# foldkit-dials

Live tuning controls for [Foldkit](https://foldkit.dev) apps, after Josh Puckett's
[DialKit](https://github.com/joshpuckett/dialkit). Declare your tunable values as
an Effect Schema, attach a panel, and drag, type, or scroll them while the app
runs. Every dial edit is a Message, so DevTools records it, time travel replays
it, and Story tests can drive it.

```ts
import { Schema } from 'effect'
import { Dial, DialPanel } from 'foldkit-dials'
import 'foldkit-dials/styles.css'

export const CardTuning = Schema.Struct({
  radius: Dial.slider({ default: 20, min: 0, max: 48, shortcut: { key: 'r' } }),
  accent: Dial.color('#6d5efc'),
  hasShadow: Dial.toggle(true),
  pop: Dial.spring({ stiffness: 260, damping: 16 }),
  replay: Dial.action('Replay'),
  shadow: Dial.folder({ blur: Dial.slider({ default: 40, min: 0, max: 80 }) }),
})

export const CardDials = DialPanel.make({
  name: 'Card',
  schema: CardTuning,
  persist: true,
})
```

The tuning is a normal Schema field in your Model, typed and decoded like any
other. `CardDials.defaults` is its initial value.

> Status: early, version 0.1.0.

## Install

```sh
npm install foldkit-dials
```

Peer dependencies: `foldkit` and `@foldkit/ui` 0.166 or later, and `effect` 4.
A Foldkit app already has them. The package ships ES modules with type
declarations, and the stylesheet is `foldkit-dials/styles.css`.

## Styling with Pleat (optional)

[Pleat](https://github.com/Manzanita-Research/pleat) is optional, but encouraged
for styling your Foldkit app. Dials works with any CSS and does not require
Pleat. Keep importing `foldkit-dials/styles.css` for the panel itself.

With Pleat, define styles once and bind dial values in the view:

```ts
import { Style, Var } from '@pleat/core'
import { css } from '@pleat/foldkit'

const radius = Var.string('card-radius')
const cardStyle = Style.make({ padding: 20, borderRadius: radius })

// Inside your view:
h.article(
  [...css(cardStyle, Var.bind(radius, `${model.tuning.radius}px`))],
  [model.tuning.title],
)
```

The [demo](https://github.com/Manzanita-Research/foldkit-dials/tree/main/demo/src)
uses recipes for layouts and variables for live tuning. Follow Pleat's repo
for setup; its packages are not yet published to npm.

## Attach a panel

`DialPanel.attach` wraps a program. It adds the panel's Model, Messages,
Commands, Subscriptions, and view, and writes each edit back into your Model.

```ts
const program = DialPanel.attach(
  { Model, Message, init, update, view, subscriptions },
  {
    panel: CardDials,
    read: model => model.tuning,
    write: (model, tuning) => modifyFields(model, { tuning: () => tuning }),
    onAction: path => Message.ClickedReplay(),
    theme: 'Light',
  },
)

Runtime.run(
  Runtime.makeApplication({
    ...program,
    container: document.getElementById('root'),
    devTools: {
      Message: program.Message,
      excludeFromHistory: program.excludeFromHistory,
    },
  }),
)
```

| Option          | Purpose                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `panel`         | The panel from `DialPanel.make`                                                                                                |
| `read`, `write` | Where the values live in your Model                                                                                            |
| `onAction`      | Turns an action dial's path into one of your Messages                                                                          |
| `show`          | `'Development'` (default: only when `import.meta.hot` is set, as under Vite's dev server and vitest), `'Always'`, or `'Never'` |
| `theme`         | `'System'`, `'Light'`, or `'Dark'`                                                                                             |
| `position`      | `'TopRight'` (default), `'TopLeft'`, `'BottomRight'`, or `'BottomLeft'`                                                        |
| `layout`        | `'Floating'` (draggable, collapses to an icon) or `'Inline'`                                                                   |

`attach` routes each drag and scroll frame under `GotDialPanelDragMessage`, and
lists it in `excludeFromHistory`, so DevTools keeps clicks and drops but skips
the frames. With `show: 'Never'`, the app runs unchanged: the panel renders
nothing, listens for nothing, and loads no stored values.

## Embed a panel yourself

A panel is an ordinary Submodel. Use this form for several panels, an inline
panel in your own layout, or full control of the wiring.

```ts
// Model
dials: CardDials.Model,
// Message
GotCardDialsMessage: { message: CardDials.Message },
// init
const cardDialsInit = CardDials.init()
// update
GotCardDialsMessage: ({ message }) =>
  Update.foldChild({
    update: (dials, dialsMessage) =>
      CardDials.update(dials, dialsMessage, model.tuning),
    read: model => Option.some(model.dials),
    write: (model, nextDials) => modifyFields(model, { dials: () => nextDials }),
    toParentMessage: message => Message.GotCardDialsMessage({ message }),
    foldOutMessage: CardDials.OutMessage.match({
      ChangedValues: ({ values }) => model => ({
        model: modifyFields(model, { tuning: () => values }),
      }),
      ClickedAction: ({ path }) => model => ({ model }),
    }),
  })(model, message),
// view
h.submodel({
  slotId: 'card-dials',
  model: model.dials,
  view: CardDials.view,
  viewInputs: { values: model.tuning, layout: 'Inline' },
  toParentMessage: message => Message.GotCardDialsMessage({ message }),
})
```

Lift `CardDials.subscriptions` with `Subscription.lift`. Every key starts with
the panel id (`card:…`), so the subscriptions of several panels combine with
`Subscription.aggregate`.

### Several panels

Give each panel its own Model field and `Got*Message`, as above. To show them
as sections of one window, render each with `layout: 'Section'` and wrap them
in `DialPanel.root`:

```ts
// subscriptions
Subscription.aggregate(
  Subscription.lift(CardDials.subscriptions)<Model, Message>({
    read: model => Option.some(model.cardDials),
    toParentMessage: message => Message.GotCardDialsMessage({ message }),
  }),
  Subscription.lift(HeroDials.subscriptions)<Model, Message>({
    read: model => Option.some(model.heroDials),
    toParentMessage: message => Message.GotHeroDialsMessage({ message }),
  }),
)
// view
DialPanel.root(
  {
    sections: [
      h.submodel({
        slotId: 'card-dials',
        model: model.cardDials,
        view: CardDials.view,
        viewInputs: { values: model.card, layout: 'Section' },
        toParentMessage: message => Message.GotCardDialsMessage({ message }),
      }),
      h.submodel({
        slotId: 'hero-dials',
        model: model.heroDials,
        view: HeroDials.view,
        viewInputs: { values: model.hero, layout: 'Section' },
        toParentMessage: message => Message.GotHeroDialsMessage({ message }),
      }),
    ],
    theme: 'Light',
  },
  h,
)
```

Two panels need different names, or different `id`s.

## Dials

Each constructor returns a Schema with a `dial` annotation. A stored or
preserved value that no longer fits the Schema decodes to the default, so a
changed range or option list never breaks a reload.

| Dial            | Constructor                                                                    | Value                                                               |
| --------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Slider          | `Dial.slider({ default, min, max, step?, shortcut? })`                         | `number`                                                            |
| Inferred slider | `Dial.number(1.2)`                                                             | `number`                                                            |
| Toggle          | `Dial.toggle(true, { shortcut? })`                                             | `boolean`                                                           |
| Text            | `Dial.text('Hello', { placeholder? })`                                         | `string`                                                            |
| Select          | `Dial.select(['stack', 'grid'], { default? })`                                 | one of the options                                                  |
| Color           | `Dial.color('#a78bfa')`                                                        | CSS colour: hex, `rgb()`, `hsl()`, `oklch()`, `color(display-p3 …)` |
| Image           | `Dial.image({ options?, default? })`                                           | URL or data URL; uploads up to 10 MB stay in the browser            |
| XY pad          | `Dial.pad({ x?, y?, labels? })`                                                | `{ x, y }`                                                          |
| Spring          | `Dial.spring({ visualDuration, bounce })` or `({ stiffness, damping, mass? })` | `Transition`                                                        |
| Easing          | `Dial.easing({ duration, ease? })`                                             | `Transition`                                                        |
| Action          | `Dial.action('Replay')`                                                        | no value; reports `ClickedAction`                                   |
| Folder          | `Dial.folder({ ... }, { isCollapsed? })`                                       | nested values                                                       |

Spring and easing dials share one editor with Easing, Time, and Physics modes.
`Transition.toMotion` turns a value into Motion options, and
`Transition.springParams` into spring constants. For CSS, pair
`Transition.toCssTimingFunction` (a `cubic-bezier()` for an easing, a sampled
`linear()` curve for a spring) with `Transition.cssDurationOf`, which gives a
spring the time it takes to come to rest.

## Versions, persistence, and copy

- The version menu saves, selects, and deletes versions. Version 1 holds the
  base values, and edits save into the selected version.
- Compare shows a saved version beside the selected one. The banner's Stop
  button ends it.
- `persist: true` saves values and versions to `localStorage` under
  `foldkit-dials:<id>`. Use `persist: { key, storage: 'Session', isVersionsPersisted }`
  to change that. With `isVersionsPersisted: false`, only the current values
  are saved, as Version 1.
- A save waits for 400 ms with no edit, so a drag writes once. When storage
  refuses a save, for example because uploaded images fill it, the panel
  shows "Couldn't save to storage" until a later save works.
- Stored data that does not decode is ignored. A stored value that no longer
  fits its dial decodes to the dial's default. When storage lacks Version 1,
  the panel adds it back; when the stored active version is missing, the
  panel opens Version 1.
- Copy puts a paste-ready `Schema.Struct({ ... Dial.* ... })` on the clipboard,
  with the current values as the defaults. An uploaded image is left out.
  The button shows a tick when the copy worked and a cross when the browser
  refused it, and a status message announces the result to screen readers.

## Shortcuts

Give a slider or toggle a `shortcut`:

```ts
radius: Dial.slider({
  default: 20, min: 0, max: 48,
  shortcut: { key: 'r', modifier: 'Alt', interaction: 'Drag', mode: 'Fine' },
}),
```

Hold the key and scroll, drag, or move the pointer, or press arrow keys. A
toggle flips once per key press. `interaction: 'ScrollOnly'` needs no key and
reacts to scrolling over the panel only. `mode` is `'Fine'` (1% of the range),
`'Normal'` (the step), or `'Coarse'` (10%). A shortcut matches the typed key,
so it follows the user's keyboard layout. When Alt or Shift turns the key into
a symbol, the key's position is used instead, so `{ key: 'r', modifier: 'Alt' }`
works on macOS, where Option+R types `®`. Shortcuts pause while a text field or
control has focus.

## Timeline

`Timeline` defines clips in code. `DialTimeline` is the dock that scrubs,
moves, resizes, and edits them.

```ts
const intro = Timeline.make({
  duration: 3,
  clips: {
    card: Timeline.clip({ at: 0, duration: 0.7, from: { y: 28, opacity: 0 }, to: { y: 0, opacity: 1 } }),
    badge: Timeline.clip({ at: 0.9, from: { scale: 0 }, to: { scale: 1 }, transition: springy }),
  },
})

const IntroDock = DialTimeline.make({ name: 'Intro', timeline: intro })

// view: values are typed from the clips
const { card } = IntroDock.valuesOf(model.intro)
h.div([h.Style({ opacity: `${card.current.opacity}` })], [...])
```

Embed the dock as a Submodel, like a panel. While a floating panel is open,
the dock stops short of the panel's side, so its controls stay visible. Route
`IntroDock.isContinuousMessage(message)` Messages under their own tag to keep
playback frames out of DevTools history. Also available: `Timeline.sequence`,
`Timeline.tracks`, `Timeline.group`, `Timeline.marker`, loops, and
`play`, `pause`, `replay`, and `seek` helpers.

## Components

The panel is built from headless Submodels in the style of `@foldkit/ui`. Each
renders through your `toView` callback, so you can use them on their own:
`ScrubSlider`, `DialPad`, `BezierEditor`, `ColorPicker`, `ColorField`,
`ImagePicker`, `TransitionEditor`, and `Curve`. `Color` parses and formats
colours in OKLCH.

## Smooth frame animations

Foldkit's `Subscription.animationFrame` updates the view on every other
display frame: its tick lands inside the browser's animation-frame callbacks,
and the render that tick asks for runs one frame later and absorbs the next
tick. Use `Frame.animationFrame` instead; it takes the same config and renders
every frame. The timeline dock uses it.

```ts
frame: Frame.animationFrame<Model, Message>({
  isActive: model => model.isPlaying,
  toMessage: deltaTime => Message.TickedFrame({ deltaTime }),
}),
```

## Parity with DialKit

| Area                                                                                | DialKit 2.0.2                      | foldkit-dials                                                       |
| ----------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| Slider, inferred slider, toggle, text, select                                       | Yes                                | Yes                                                                 |
| Color (hex, RGB, HSL, OKLCH, Display P3)                                            | Yes                                | Yes                                                                 |
| Image with upload                                                                   | Yes                                | Yes                                                                 |
| XY pad                                                                              | Yes                                | Yes                                                                 |
| Spring and easing editor (Easing, Time, Physics)                                    | Yes                                | Yes                                                                 |
| Action, folder, collapsed folder                                                    | Yes                                | Yes                                                                 |
| Panel `id`, `persist` (key, storage, presets)                                       | Yes                                | Yes                                                                 |
| `defaultCollapsed`, `onAction`                                                      | Yes                                | Yes: `isCollapsedByDefault`, `onAction`                             |
| Shortcuts (key, modifier, interaction, mode, badges)                                | Panel option                       | Yes, declared on the dial                                           |
| Versions: new, select, delete, auto-save                                            | Yes                                | Yes                                                                 |
| Compare two versions                                                                | No                                 | Yes                                                                 |
| Copy                                                                                | Values plus an instruction         | Paste-ready dial Schema source; a refused copy shows as failed      |
| Floating (drag, collapse to icon), inline                                           | Yes                                | Yes                                                                 |
| Several panels as sections of one root                                              | Yes                                | Yes: `DialPanel.root`, with Subscription keys per panel             |
| Position and theme                                                                  | Yes                                | Yes                                                                 |
| Hidden in production                                                                | Yes                                | Yes: `show: 'Development'`                                          |
| Keyboard map (panel, slider, editor, pad, select, segmented, colour, image, Bézier) | Yes                                | Yes                                                                 |
| Values from code (`setValue`, `setValues`)                                          | Controller                         | Write your Model; the active version updates on the next panel edit |
| `resetValues`, `setOpen`, `getOpen` from code                                       | Controller                         | Not yet                                                             |
| Timeline clips, sequences, tracks, groups, loops                                    | Yes                                | Yes                                                                 |
| Timeline dock (scrub, move, resize, edit, zoom, copy)                               | Yes                                | Yes, except the native horizontal scrollbar                         |
| Timeline presets and persistence                                                    | Yes                                | Not yet                                                             |
| Framework adapters                                                                  | React, Solid, Svelte, Vue, vanilla | Foldkit                                                             |
| Values typed and decoded by a Schema; stale stored values fall back per field       | No                                 | Yes                                                                 |
| Edits as Messages: DevTools history and time travel, Story and Scene tests          | No                                 | Yes (drag frames kept out of history)                               |
| Saves while dragging                                                                | Every change                       | Once, 400 ms after the last change                                  |

## Licence

The stylesheet (`src/styles/dials.css`), the icon paths, and several ported
algorithms come from DialKit, MIT License, Copyright (c) 2026 Josh Puckett. See
`LICENSE.dialkit` and `NOTICE`. `src/internal/selectors.ts` and
`src/internal/accessibleName.ts` are copied from `@foldkit/ui` (MIT; see
`LICENSE.foldkit`).
