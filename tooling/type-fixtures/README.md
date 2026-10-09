# DialPanel factory declarations

`DialPanel.make` returns the explicit `Panel<Fields>` bundle. `PanelOutMessage<Fields>` retains the real MessageUnion Schema, its callable constructors, and values typed by the dial Schema. `DialPanel.attach` returns `AttachBundle<AppModel, AppMessage, InitArgs>`; `AttachModel<AppModel>` names the wrapper state. All are exported through the explicit DialPanel public barrel.

The Schema objects and factory bodies are unchanged. The existing broad panel view inputs and the app Codec's encoded/service types remain unchanged too. The attach Message wrappers refer to `typeof PanelMessage`, so the two cases do not each repeat its structure in declarations.

## Consumer checks

After building the library, run:

```sh
node tooling/check-panel-types.mjs
```

The fixture checks nested and literal dial values, typed OutMessage construction and exhaustive matching, comparison values, required/optional/no-argument init inference, the app and attach Message union, Schema access, Runtime integration, views, lifted Subscriptions, and history exclusions. `@ts-expect-error` cases reject invalid Schemas, values, init arguments, Messages, read/write callbacks, and action results.

The same fixture compiles against the workspace source and against an actual npm tarball extracted into a temporary consumer's `node_modules`. The latter uses NodeNext package exports with no TypeScript paths, baseUrl, or source conditions. Peer dependencies link to the exact catalog-pinned installed copies; the library is a disposable tarball copy. The script prints the verified peer versions. Temporary files are removed on success and failure.

`runtime.mjs` imports only public package entry points, resolves and reads the stylesheet export, and asserts `make`/`attach` initialization and reset behavior. Node's ESM loader traverses the public JS graph, catching missing `.js` paths. `browser-globals.mjs` supplies `window` and `document` using the existing root Happy DOM tool, since subscriptions reference browser globals at module evaluation. The package's published types and runtime never resolve to library source, and the fixture boots no Runtime.

`pnpm test:smoke` builds both artifacts, runs these consumer checks and the focused Playwright suite in `tooling/browser`. `pnpm check` runs the same command in CI. See the root README for browser setup, the shared heavy-job lock, failure artifacts and supported peer versions.

## Timeline source exports

`timeline.mjs` generates TypeScript with `Timeline.toTimelineSource` from the
packed public package. The harness typechecks and emits that source using
NodeNext with no source aliases, then reconstructs it against the same packed
JavaScript. Four fixtures compare exact parsed configurations and 4,052 full
sampled-value records, covering every clip and transition family, groups,
repeat flags, partial/disjoint sequence updates, delayed property sequences,
minimum versus content duration, numeric precision, non-finite animated values,
control characters, Unicode, quotes/backslashes, and computed `__proto__` keys.
Positive and negative inference checks cover grouped clips, sequence properties,
string/numeric tracks, missing properties and markers. This runs inside the
existing packed-consumer check and therefore in `pnpm check` and Repository CI.

## Declaration measurement

Run these from the repository root with the pinned TypeScript 5.9.3 dependencies installed:

```sh
node tooling/declaration-size.mjs ac1ee83
node tooling/declaration-size.mjs
```

The script uses the library build config, emits declarations in memory, and counts UTF-8 bytes. The optional Git ref substitutes package source files from that revision without changing the checkout. The build config and dependency versions stay fixed. Baseline `ac1ee83` (main when this change started) reproduces the `b4d3809` audit measurements.

| Declaration              | Baseline bytes | Explicit bundles | Reduction |
| ------------------------ | -------------: | ---------------: | --------: |
| dialPanel/attach.d.ts    |        513,388 |            4,905 |     99.0% |
| dialPanel/index.d.ts     |        183,561 |            2,847 |     98.4% |
| All package declarations |      1,370,543 |          681,391 |     50.3% |

The remaining declarations expose the concrete Schemas by design: consumers retain fields, constructors, encoded types, and decoding/encoding services. Existing inferred returns elsewhere also still expand child Schemas. The largest files remain colorField/index.d.ts (67,444 bytes), transitionEditor/index.d.ts (61,796), dialTimeline/editor.d.ts (53,388), and timeline/index.d.ts (49,285). The panel update (44,265) and view (40,174) declarations also retain their existing signatures. Those component return types are outside this change's scope.
