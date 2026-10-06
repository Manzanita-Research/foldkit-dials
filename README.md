# foldkit-dials

Live tuning controls for [Foldkit](https://foldkit.dev) apps, after Josh Puckett's [DialKit](https://github.com/joshpuckett/dialkit). Declare tunable values as an Effect Schema, attach a panel, and drag, type, or scroll them while the app runs. Every dial edit is a Message, so DevTools records it, time travel replays it, and Story and Scene tests can drive it.

- **Package and API:** [`packages/foldkit-dials`](packages/foldkit-dials/README.md), with the DialKit parity table.
- **Demo app:** [`demo/`](demo). Run `pnpm install`, then `pnpm dev`.
- **Tests:** `pnpm test` (Vitest, with Foldkit Story and Scene tests). Typecheck: `pnpm typecheck`.

Status: early. Not yet published to npm. Built on `foldkit` 0.166 and `effect` 4.0.

## Deploy the demo

The demo deploys to a Cloudflare Worker with [Alchemy](https://alchemy.run/cloudflare/frontend/foldkit/). `alchemy.run.ts` declares it as one `Cloudflare.Website.Foldkit`, and Alchemy runs the project's `vite build` and uploads the output as static assets.

```sh
pnpm run deploy    # the first run asks you to sign in to Cloudflare
pnpm run destroy   # removes the Worker
```

The first deploy also sets up Alchemy's state store in the Cloudflare account. It prints the demo's URL when it finishes.

## Licence

MIT. See [LICENSE](LICENSE). DialKit's stylesheet and design are used under its MIT licence, and Foldkit under its own. See [NOTICE](packages/foldkit-dials/NOTICE).
