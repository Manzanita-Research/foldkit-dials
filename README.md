# foldkit-dials

Live tuning controls for [Foldkit](https://foldkit.dev) apps, after Josh Puckett's [DialKit](https://github.com/joshpuckett/dialkit). Declare tunable values as an Effect Schema, attach a panel, and drag, type, or scroll them while the app runs. Every dial edit is a Message, so DevTools records it, time travel replays it, and Story and Scene tests can drive it.

- **Package and API:** [`packages/foldkit-dials`](packages/foldkit-dials/README.md), with the DialKit parity table.
- **Demo app:** [`demo/`](demo). Run `pnpm install`, then `pnpm dev`.
- **Tests:** `pnpm test` (Vitest, with Foldkit Story and Scene tests). Typecheck: `pnpm typecheck`.

Status: early. Not yet published to npm. Built on `foldkit` 0.166 and `effect` 4.0.

## Deploy the demo

The demo is one Cloudflare Worker, `foldkit-dials`, configured in `wrangler.jsonc`. It serves the built app as static assets. `.github/workflows/deploy.yml` deploys it with wrangler:

- **Production:** every push to `main` runs `wrangler deploy`. The demo is at https://foldkit-dials.manzanita.dev.
- **Pull request previews:** each pull request from this repository runs `wrangler versions upload --preview-alias pr-<n>`. That uploads a version of the same Worker that takes no traffic, at `https://pr-<n>-foldkit-dials.manzanita.workers.dev`. The URL is commented on the PR, and each push re-points it. Cloudflare can't delete versions, so the URL keeps serving the PR's last version after the PR closes.

The deploy reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the Manzanita-Research organization's Actions secrets, so this repository needs no secrets of its own.

## Licence

MIT. See [LICENSE](LICENSE). DialKit's stylesheet and design are used under its MIT licence, and Foldkit under its own. See [NOTICE](packages/foldkit-dials/NOTICE).
