# foldkit-dials conventions

This package follows `@foldkit/ui`'s conventions exactly, and Foldkit's `AGENTS.md`. When this file and those disagree, those win.

## Read before writing

- Foldkit `AGENTS.md`: [`AGENTS.md`](https://github.com/foldkit/foldkit/blob/main/AGENTS.md) in the Foldkit repo. It has naming, state modeling, code style, comments, and prose rules. Read all of it.
- `@foldkit/ui` source: [`packages/ui/src/`](https://github.com/foldkit/foldkit/tree/main/packages/ui/src) in the Foldkit repo. These are the closest precedents:
  - `slider/` for a headless, parent-owned-value component with drag Subscriptions, plus its `index.test.ts` and `scene.test.ts`.
  - `popover/` for an anchored floating panel (Mount + Floating UI), Commands, and OutMessage.
  - `radioGroup/` for a `create<Value>()` factory with roving focus.
- Our exemplar is `src/scrubSlider/`: `index.ts`, `public.ts`, `index.test.ts` (Story), and `scene.test.ts` (Scene). Copy its shape.
- Shared helpers live in `src/internal/` (`range.ts`, `selectors.ts`, `accessibleName.ts`). Reuse them; add to them only when two components need the same thing.
- Domain modules: `src/transition/` (spring and easing math, the `Transition` union) and `src/dial/` (dial Schemas).
- Framework source for exact APIs: [`packages/foldkit/src/`](https://github.com/foldkit/foldkit/tree/main/packages/foldkit/src) in the Foldkit repo. Effect 4 types: `node_modules/effect/dist/*.d.ts`. Read real signatures; don't guess.

## Component shape

- One folder per component: `src/<name>/index.ts` (code), `src/<name>/public.ts` (an explicit barrel of the public names), `index.test.ts` (Story tests on `update` and helpers), and `scene.test.ts` (Scene tests through the view).
- Headless, like `@foldkit/ui`: `view` is `defineView<Model, Message, ViewInputs>` and calls `viewInputs.toView(...)` with attribute groups built by `childAttributes(...)`. The consumer owns markup and classes. The panel in `src/dialPanel/` renders each component with DialKit's class names.
- The parent owns the value. The Model holds only interaction state: drag state, edit drafts, focus, open state. The view receives the value through `ViewInputs.value`. Messages that need the current value carry it from the view, as `@foldkit/ui`'s Slider does.
- Report value changes as an OutMessage `ChangedValue({ value })`. Report nothing when the value would not change.
- Sections in this order, with these headers: `// MODEL`, `// MESSAGE`, `// OUT MESSAGE`, `// INIT`, `// COMMAND`, `// UPDATE`, `// SUBSCRIPTION`, `// VIEW`.
- `init(config)` takes `{ id, ... }`. Every DOM id derives from `id`, and is exported as a helper when a parent needs it (`sliderId`, `editorId`).
- Drags: a `defineTaggedUnion` drag state (`Idle | Dragging { origin… }`). Use document `pointermove`, `pointerup`, and `pointercancel` Subscriptions gated on `Dragging`, plus a `keydown` Escape Subscription that cancels and restores the origin value. Add `subscriptionsForRoot(getRoot)` and `subscriptions = subscriptionsForRoot(() => document)`, as Slider does.
- Find elements by a `data-*` attribute with `attributeSelector` from `src/internal/selectors.ts`.
- Focus moves are Commands that use `Dom.focus(selector)` and return a `Completed*` Message.

## Code rules (the ones most often broken)

- No `switch`, no `for` loops, no `let` for iteration, no nested ternaries, no `T[]`, and no bracket indexing (`Array.get` / `Array.head`).
- `Message.match<UpdateReturn>` for Messages. A union's own `.match` for `defineTaggedUnion` values. `Match.tagsExhaustive` or `Match.value(...).pipe(Match.withReturnType<…>(), …)` for the rest.
- Messages are past-tense facts: `PressedHandle`, `MovedDragPointer`, `ReleasedDragPointer`, `CancelledDrag`, `PressedKeyboardNavigation`. A Command result is `Completed<CommandName>`. Never `NoOp`.
- `Option` for absence, prefixed `maybe`. Booleans prefixed `is`. Schema literals capitalized: `Schema.Literals(['Hex', 'Oklch'])`.
- `modifyFields` for Model updates. Never spread a Model.
- Never write `commands: []`. Omit `commands` when there are none.
- Named constants instead of magic numbers.
- Comments: section headers, TSDoc (`/** … */`) on every exported name, and `// NOTE:` only for behavior that would mislead a careful reader. No other comments.
- Effect module functions in pipes (`Array.map`, `Option.match`). `Predicate.isString`, never `typeof x === 'string'`.
- No em dashes in prose, comments, or TSDoc.
- Imports end in `.js` for relative files, as in `@foldkit/ui`.

## Tests

- Story tests: `import * as Story from 'foldkit/story'`, plus `describe`, `expect`, `it` from `vitest`. Resolve every Command a step produces (`Story.Command.resolve`, `Story.Command.expectExact`).
- Scene tests: `import * as Scene from 'foldkit/scene'`, with `Scene.withViewInputs(view, { ... })` and a small `inertHtml` `toView`. Test roles and ARIA attributes, keyboard behaviour, and OutMessages. Pointer handlers that measure the DOM can't run in Scene, so cover drags in Story tests through the Messages.
- Every behaviour you build gets a test. Watch one fail before you trust it: break the code, run the test, see it fail, then restore.
- Commands, from the repo root:
  - Typecheck: `node_modules/.bin/tsc --noEmit -p tsconfig.json`.
  - Test: `node_modules/.bin/vitest run packages/foldkit-dials/src/<name>`.
  - Lint: `node_modules/.bin/oxlint -c tooling/lint/.oxlintrc.json packages/foldkit-dials/src/<name>`. This runs Foldkit's own lint plugin (`all.json`) from the root installation.
  - Format: `tooling/format.sh <files>`.
- A type assertion that cannot be avoided takes `/* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */` plus a `// NOTE:` saying why, as in `@foldkit/ui`.

## Don't

- Don't install packages during a scoped component edit. Workspace maintenance assignments may explicitly authorize a root install. Root `pnpm run`/`pnpm exec` reject a stale installation instead of installing implicitly.
- Don't start a dev server.
- Don't edit files outside your assigned folders. If you need a shared helper changed, say so in your report.
- Don't commit. The lead integrates and commits.
