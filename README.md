# foldkit-dials

Live tuning controls for [Foldkit](https://foldkit.dev) apps, after Josh Puckett's [DialKit](https://github.com/joshpuckett/dialkit). Declare tunable values as an Effect Schema, attach a panel, and drag, type, or scroll them while the app runs. Every dial edit is a Message, so DevTools records it, time travel replays it, and Story and Scene tests can drive it.

- **Package and API:** [`packages/foldkit-dials`](packages/foldkit-dials/README.md), with the DialKit parity table.
- **Demo app:** [`demo/`](demo). Run `pnpm install`, then `pnpm dev`.
- **Tests:** `pnpm test` (Vitest, with Foldkit Story and Scene tests). Typecheck: `pnpm typecheck`.

Status: early. Not yet published to npm. Built on `foldkit` 0.166 and `effect` 4.0.

## Deploy the demo

CI deploys the demo to a Cloudflare Worker with [Alchemy](https://alchemy.run/cloudflare/frontend/foldkit/):

- **`prod`** on every push to `main`.
- **A `pr-<n>` preview** for each pull request from this repository. Its URL is commented on the PR and updated on every push. The preview is destroyed when the PR closes.

`alchemy.run.ts` declares the demo as one `Cloudflare.Website.Foldkit`. Alchemy runs the project's `vite build` and uploads the output as static assets. `.github/workflows/deploy.yml` runs it.

### One-time setup: CI's credentials

CI needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as Actions secrets. `stacks/github.ts` creates them as code: it mints a Cloudflare token scoped to this deploy and writes both secrets into the repository. Run it once from a machine with a Cloudflare credential that can create API tokens. Your Global API Key works; a plain "Edit Workers" token does not.

```sh
pnpm exec alchemy profile create admin
pnpm exec alchemy profile edit --profile admin    # Cloudflare: your Global API Key; GitHub: "GitHub CLI" (uses your gh login)
pnpm exec alchemy deploy --config stacks/github.ts --profile admin
```

Run it again to rotate the token or change its permissions. Alchemy's [CI guide](https://alchemy.run/environments/ci/) explains the pattern.

### Deploy by hand

`pnpm run deploy` deploys your own `live_<user>` stage, and `pnpm run destroy` removes it. Use `pnpm run`, because `pnpm deploy` is a different, built-in pnpm command.

## Licence

MIT. See [LICENSE](LICENSE). DialKit's stylesheet and design are used under its MIT licence, and Foldkit under its own. See [NOTICE](packages/foldkit-dials/NOTICE).
