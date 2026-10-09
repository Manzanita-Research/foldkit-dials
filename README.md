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

## Agent guidance and release references

Start with [AGENTS.md](AGENTS.md) and the release-owned
[FOLDKIT.md](FOLDKIT.md). [Agent tooling](docs/agent-reference.md) explains
our read-only Foldkit 0.166.0 subtree, discoverable Foldkit/Effect skills,
reference refresh checks and pinned DevTools MCP setup. All references
arrive with a normal clone and stay outside workspace/build/check globs.

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

CI deploys the demo to a Cloudflare Worker with [Alchemy](https://alchemy.run/cloudflare/frontend/foldkit/):

- **`prod`** on every push to `main`: the `foldkit-dials` Worker, at https://foldkit-dials.manzanita.dev.
- **A `pr-<n>` preview** for each pull request from this repository, at `https://pr-<n>-foldkit-dials.manzanita.workers.dev`. It is a version of the production Worker that takes no traffic, as with Cloudflare's Git integration. Its URL is commented on the PR, and each push re-points it. Cloudflare can't delete versions, so after the PR closes the URL keeps serving its last version.

`demo/alchemy.run.ts` declares the demo as one `Cloudflare.Worker` that serves `demo/dist`, the output of `pnpm build:demo`, as static assets. Its entry and asset paths resolve from the stack file. `.github/workflows/deploy.yml` builds the demo, then runs the root deploy script, which forwards to the demo package.

### CI's credentials

The deploy reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from this repository's Actions secrets. `stacks/github.ts` sets both. It mints a Cloudflare API token for CI with only the account permissions the deploy needs: Workers Scripts, Account Settings and Secrets Store (write), and Workers Tail (read). Alchemy keeps its state in the account's Secrets Store.

Deploy that stack once from your laptop, with an `admin` Alchemy profile that can create API tokens:

```sh
pnpm --filter @foldkit-dials/ci-bootstrap exec alchemy profile create admin
pnpm --filter @foldkit-dials/ci-bootstrap exec alchemy profile edit --profile admin --add Cloudflare   # Global API Key + email, or a token with API Tokens Write
pnpm --filter @foldkit-dials/ci-bootstrap exec alchemy profile edit --profile admin --add GitHub       # gh-cli
pnpm --filter @foldkit-dials/ci-bootstrap exec alchemy deploy --config github.ts --profile admin
```

Deploy it again only to rotate the token or change its permissions. Treat the `admin` profile like root and use it only for this stack.

Credential provisioning stays in the separate `stacks` workspace package.
Its `github.ts` declaration is unchanged by the workspace migration. The
demo stack consumes existing credentials; it does not provision or rotate
them. Routine root demo deploy and cleanup never select the bootstrap
package. The bootstrap has no default deploy script and requires the
explicit command and admin profile above.

### Deploy by hand

`pnpm run deploy` deploys your own `live_<user>` stage, and `pnpm run destroy` removes it. Use `pnpm run`, because `pnpm deploy` is a different, built-in pnpm command.

## Licence

MIT. See [LICENSE](LICENSE). DialKit's stylesheet and design are used under its MIT licence, and Foldkit under its own. See [NOTICE](packages/foldkit-dials/NOTICE).
