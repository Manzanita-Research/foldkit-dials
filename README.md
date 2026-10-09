# foldkit-dials

Live tuning controls for [Foldkit](https://foldkit.dev) apps, after Josh Puckett's [DialKit](https://github.com/joshpuckett/dialkit). Declare tunable values as an Effect Schema, attach a panel, and drag, type, or scroll them while the app runs. Every dial edit is a Message, so DevTools records it, time travel replays it, and Story and Scene tests can drive it.

- **Package and API:** [`packages/foldkit-dials`](packages/foldkit-dials/README.md), with the DialKit parity table.
- **Demo app:** [`demo/`](demo). Run `pnpm install`, then `pnpm dev`.
- **Tests:** `pnpm test` (Vitest, with Foldkit Story and Scene tests). Typecheck: `pnpm typecheck`.

Install with `npm install foldkit-dials`. Status: early (0.1.0). Built on `foldkit` 0.166 and `effect` 4.0.

## Deploy the demo

CI deploys the demo to a Cloudflare Worker with [Alchemy](https://alchemy.run/cloudflare/frontend/foldkit/):

- **`prod`** on every push to `main`: the `foldkit-dials` Worker, at https://foldkit-dials.manzanita.dev.
- **A `pr-<n>` preview** for each pull request from this repository, at `https://pr-<n>-foldkit-dials.manzanita.workers.dev`. It is a version of the production Worker that takes no traffic, as with Cloudflare's Git integration. Its URL is commented on the PR, and each push re-points it. Cloudflare can't delete versions, so after the PR closes the URL keeps serving its last version.

`alchemy.run.ts` declares the demo as one `Cloudflare.Worker` that serves the output of `pnpm build:demo` as static assets. `.github/workflows/deploy.yml` builds the demo, then runs `alchemy deploy`.

### CI's credentials

The deploy reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the Manzanita-Research organization's Actions secrets, so this repository needs no secrets of its own. The token needs these account permissions: Workers Scripts Edit, Account Settings Edit, and Secrets Store Edit. Alchemy keeps its state in the account's Secrets Store.

### Deploy by hand

`pnpm run deploy` deploys your own `live_<user>` stage, and `pnpm run destroy` removes it. Use `pnpm run`, because `pnpm deploy` is a different, built-in pnpm command.

## Licence

MIT. See [LICENSE](LICENSE). DialKit's stylesheet and design are used under its MIT licence, and Foldkit under its own. See [NOTICE](packages/foldkit-dials/NOTICE).
