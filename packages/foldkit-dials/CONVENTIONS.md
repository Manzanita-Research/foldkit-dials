# foldkit-dials conventions

Read the project's [AGENTS.md](../../AGENTS.md) and canonical
[FOLDKIT.md](../../FOLDKIT.md) first. This file adds stable library-specific
guidance. Use the release-pinned `@foldkit/ui` as the closest component
precedent; upstream repository maintenance instructions do not govern
this workspace. The demo follows application conventions instead.

## Read before writing

- Framework guidance: [FOLDKIT.md](../../FOLDKIT.md); release code practices
  in [repos/foldkit/AGENTS.md](../../repos/foldkit/AGENTS.md).
- `@foldkit/ui` source: [`packages/ui/src/`](../../repos/foldkit/packages/ui/src) in the Foldkit repo. These are the closest precedents:
  - `slider/` for a headless, parent-owned-value component with drag Subscriptions, plus its `index.test.ts` and `scene.test.ts`.
  - `popover/` for an anchored floating panel (Mount + Floating UI), Commands, and OutMessage.
  - `radioGroup/` for a `create<Value>()` factory with roving focus.
- Our exemplar is `src/scrubSlider/`: `index.ts`, `public.ts`, `index.test.ts` (Story), and `scene.test.ts` (Scene). Copy its shape.
- Shared helpers live in `src/internal/` (`range.ts`, `selectors.ts`, `accessibleName.ts`). Reuse them; add to them only when two components need the same thing.
- Domain modules: `src/transition/` (spring and easing math, the `Transition` union) and `src/dial/` (dial Schemas).
- Framework source for exact APIs: [`packages/foldkit/src/`](../../repos/foldkit/packages/foldkit/src) in the Foldkit repo. Effect 4 types: `node_modules/effect/dist/*.d.ts` from this package directory. Read real signatures; don't guess.

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
- Cover changed behavior with meaningful Story/Scene tests. Keep existing
  `index.test.ts` filenames; new test files may follow the canonical
  `story.test.ts` naming. The existing namespace import style is supported
  and need not be changed during unrelated work.
- Commands, from the repo root:
  - Typecheck: `node_modules/.bin/tsc --noEmit -p tsconfig.json`.
  - Test: `node_modules/.bin/vitest run packages/foldkit-dials/src/<name>`.
  - Lint: `node_modules/.bin/oxlint --disable-nested-config -c oxlint.foldkit.json packages/foldkit-dials/src/<name>`. This runs general correctness and Foldkit's lint plugin (`all.json`) from the root installation. `pnpm lint` also checks repository config, stacks and tooling with the general preset.
  - Format: `tooling/format.sh <files>`.
  - Repository check: `pnpm check`. CI runs this command after one frozen root install; it includes formatting, lint, types, tests, both builds, package contents and the source/packed consumer fixture.
- Preserve explicit public factory return types, especially DialPanel.
  `pnpm typecheck:panel-consumer` checks source and packed consumers.
- Avoid type assertions; if an exception is required, explain it with
  `// NOTE:` and use the installed Oxlint rule name in a narrow suppression.

## Workspace boundaries

- Keep runtime boot in the demo. Library modules export definitions,
  helpers and public types; importing them must not start a Runtime.
- Relative library imports end in `.js` for declaration consumers. Demo
  imports may follow its bundler conventions.
- Package dependencies belong in the library manifest; shared tools belong
  at the root and demo-only tooling stays in the demo. Use one root install.
- Treat `repos/` as read-only references. Import installed npm packages,
  never reference source. Preserve stylesheet attribution and licenses.
- Installs, short-lived dev servers, commits and PRs are normal development
  actions when the assignment calls for them. Follow root AGENTS.md and
  the assignment's scope/review rules; stop servers when finished.
