# foldkit-dials

Live tuning controls for [Foldkit](https://foldkit.dev) apps, after Josh Puckett's [DialKit](https://github.com/joshpuckett/dialkit). Declare tunable values as an Effect Schema, attach a panel, and drag, type, or scroll them while the app runs. Every dial edit is a Message, so DevTools records it, time travel replays it, and Story and Scene tests can drive it.

- **Package and API:** [`packages/foldkit-dials`](packages/foldkit-dials/README.md), with the DialKit parity table.
- **Demo app:** [`demo/`](demo). Run `pnpm install`, then `pnpm dev`.
- **Tests:** `pnpm test` (Vitest, with Foldkit Story and Scene tests). Typecheck: `pnpm typecheck`.

Install with `npm install foldkit-dials`. Status: early (0.1.0). Built on `foldkit` 0.166 and `effect` 4.0.

## Workspace development

Use pnpm **12.10.1**, pinned in the root `packageManager`. One root
`pnpm install --frozen-lockfile` installs the entire workspace:

| Package                  | Owns                                                                            |
| ------------------------ | ------------------------------------------------------------------------------- |
| Root                     | TypeScript, Vitest, Happy DOM, Oxlint/Foldkit lint plugin, Oxfmt                |
| `packages/foldkit-dials` | Published library and explicit runtime peers; catalog-pinned development copies |
| `demo` (private)         | App runtime, Pleat, Vite/Foldkit integration, Alchemy stack and Worker entry    |
| `stacks` (private)       | Privileged CI credential bootstrap dependencies, with no default deploy script  |

The demo declares `foldkit-dials: workspace:*`, so pnpm links the local
library and never substitutes a registry release. TypeScript, Vitest and
demo Vite resolve the library's source through explicit aliases. Tests and
`pnpm dev` therefore work immediately after install, without building the
library. Published exports still resolve `dist` JavaScript, declarations
and CSS; `pnpm build:library` builds those files, and
`pnpm --filter foldkit-dials pack` produces the release tarball.

The catalog keeps library development and demo runtime on the same Foldkit,
Effect and browser-platform versions. Foldkit 0.166.0 and its DevTools/Vite
peers require exact Effect 4.0.0. The library directly uses the browser
platform, so consumers must supply that peer too. Pleat's existing
`@pleat/source` condition stays confined to source development; Pleat is
still absent from the library's dependencies and peers.

Vite is also a library development dependency for the existing
`import.meta.hot` types; it is not a published runtime dependency. Alchemy's
SQL adapters are held at 4.0.0 to satisfy the same Effect peer. The unused
Alchemy frontend-frameworks package is omitted: this stack uses a Worker
with static assets, without a frontend-framework resource.

Run `pnpm check` for the same repository check CI runs: formatting, lint,
types, tests, both builds, package contents and DialPanel consumer types.
Use `pnpm format` to format the repository, `pnpm format <files...>` (or
`tooling/format.sh <files...>`) for selected files, and `pnpm format:check`
to check without writing. Oxfmt **0.72.0** and Oxlint **1.77.0** are pinned
root tools available after the frozen install.

`pnpm lint` checks all owned JavaScript and TypeScript, including config,
deployment stacks and browser tooling, with general correctness rules.
It then applies Foldkit's `all.json` preset to library and demo source,
including the preset's test and entry-point exceptions. Both passes use
explicit configs with nested discovery disabled. Formatting also uses
an explicit root config and preserves embedded code and documented snippet
layout. Dependency trees, build output, generated files, Alchemy state,
scratch files and `repos/` reference trees are excluded from both tools;
the generated lockfile is excluded from formatting.

Individual commands include `pnpm typecheck`, `pnpm test`,
`pnpm build:library`, `pnpm build:demo`, `pnpm typecheck:panel-consumer`
and `pnpm dev`. Lint has no separate installation. Install policy keeps
the one-day release delay and denies dependency install scripts; the
reasons and Pleat Git exception are in `pnpm-workspace.yaml`. Run/exec
fail on a stale installation instead of silently installing.

## Styling with Pleat (optional)

[Pleat](https://github.com/Manzanita-Research/pleat) is optional, but encouraged
for styling Foldkit apps. Dials works with any CSS; Pleat is not a dependency
or peer dependency of `foldkit-dials`. Keep importing `foldkit-dials/styles.css`
for the controls.

The demo uses Pleat's `Style` and `Recipe` for its card and layouts, and `Var`
bindings to apply live dial values without compiling styles on each frame.
See [`demo/src/styles.ts`](demo/src/styles.ts) and
[`demo/src/main.ts`](demo/src/main.ts) for the wiring. Until Pleat is published
to npm, the demo pins its two packages to a GitHub commit and resolves their
`@pleat/source` exports.

## Deploy the demo

The demo owns its stack, Vite build and deployment. See
[`demo/README.md`](demo/README.md) for fresh setup, explicit production and
personal commands, CI credentials and preview cleanup behavior.

```sh
pnpm run setup:demo
pnpm run deploy:personal
pnpm run deploy:prod
```

Every deploy builds fresh assets first. Production preserves
<https://foldkit-dials.manzanita.dev>; PR previews retain the existing version
URLs and comments. Closing a PR removes its Alchemy stage, while the uploaded
version URL can remain available. CI checks existing state-store availability
before Alchemy and serializes deployment and cleanup across stages.

## Licence

MIT. See [LICENSE](LICENSE). DialKit's stylesheet and design are used under its MIT licence, and Foldkit under its own. See [NOTICE](packages/foldkit-dials/NOTICE).
