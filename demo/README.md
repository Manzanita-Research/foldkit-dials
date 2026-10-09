# Demo development and deployment

Run commands from the repository root with Node 24 and the pinned pnpm 12.10.1.
Python 3 is also required for the deployment safety tests in `pnpm check`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Vite keeps the Foldkit HMR plugin and DevTools configuration in
[`vite.config.ts`](vite.config.ts). A standalone build is `pnpm build:demo`.
The demo uses the local library source without a separate library build.

## Deploy by hand

Connect the default Alchemy profile once on each machine:

```sh
pnpm run setup:demo
```

Choose Cloudflare OAuth and Basic Scopes, approve the browser login and select
the account. Credentials stay in Alchemy's local profile. CI uses its own API
token; an OAuth access token should not be copied into Actions secrets.
Alchemy beta.80 already has the correct profile-dashboard JSX runtime and
needs no Pleat beta.81 patch.

```sh
pnpm run deploy:personal   # your live_<user> stage
pnpm run destroy:personal # remove that personal stage
pnpm run deploy:prod       # prod, matching CI and the production domain
```

Every deploy clears generated `demo/dist`, builds it and verifies that
`dist/index.html` exists before Alchemy starts. A missing or failed build stops
deployment instead of uploading stale assets. CI uses the same build-and-deploy
path. Use `pnpm run`, since bare `pnpm deploy` is pnpm's package-copy command.
An explicitly named disposable stage can use `pnpm run deploy --stage <stage>`
and `pnpm run destroy --stage <stage>`.

## Production and previews

[`alchemy.run.ts`](alchemy.run.ts) owns the `FoldkitDials` stack and `Demo`
resource. Production keeps Worker `foldkit-dials` and custom domain
<https://foldkit-dials.manzanita.dev>. The Worker serves the fresh Vite build
with single-page-application fallback for deep links.

Same-repository PRs use `pr-<number>` stages and upload versions of production
without taking production traffic. Alchemy updates the preview URL comment
on each push. Closing a PR destroys its stage and comment; Cloudflare version
URLs can keep serving the last upload. Cleanup does not delete production.
This retains the existing preview behavior. Native `Website.Foldkit` cannot
combine Vite with `version.parent` in beta.80; a future native migration would
need isolated preview Workers and different URLs, validated before cutover.

The Deploy workflow serializes production, previews and cleanup through one
repository concurrency group with `queue: max` and `cancel-in-progress: false`.
Safety tooling comes from the workflow revision, so closing an older PR does
not require that PR to contain the new preflight helper. It checks the current PR state before deploying or cleaning up so an old
queued event cannot recreate a closed preview or remove a reopened one.
The queue has a finite GitHub limit; other repositories and local commands
sharing this account's Alchemy store must also coordinate their deployments.

## CI credentials and state

Actions resolves `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` from
repository or inherited organization secrets. Provision repository credentials
with the existing [`../stacks/github.ts`](../stacks/github.ts) Alchemy stack,
using a separate `admin` profile as documented in the
[Alchemy CI tutorial](https://alchemy.run/cloudflare/tutorial/part-5/). Default OAuth
is for local deployment; it cannot grant API-token management permissions.

An administrator must configure the admin profile with API Key + Email or an
API Token that permits Account API Tokens Write (and User API Tokens Write for
a user-owned token). Confirm that this profile selects the existing deployment
account before applying the stack. The ordinary deployment profile does not
need those token-management permissions. Creating a new admin grant or changing
CI credentials requires review of the exact account, permissions and state plan.

Run the existing provisioning stack from `stacks`, preserving its stack and
stage identity; inspect the plan before approving any mutation:

```sh
pnpm --filter @foldkit-dials/ci-bootstrap exec alchemy plan --config github.ts --profile admin
pnpm --filter @foldkit-dials/ci-bootstrap exec alchemy deploy --config github.ts --profile admin
```

This provisions an account token and this repository's two Actions secrets;
it leaves organization secrets alone. Preserve the existing account and shared
state-store keys. Review the existing `github` stack state before adoption or
rotation: adopting a token whose one-time value is unavailable must not publish
an empty secret. After provisioning, verify the resolved CI pair through the
GET-only diagnostic before allowing an ordinary deployment. Rollback requires
restoring the prior repository secret configuration and revoking only a newly
created CI token; it must not destroy the shared state store or production.

The existing CI policy is scoped to the deployment account: Workers Scripts
Write, Account Settings Write, Secrets Store Write and Workers Tail Read.
Recreating a domain attachment may also need Zone Read scoped to
`manzanita.dev`; assess the existing attachment before adding that permission.
Ordinary deploys do not provision credentials.

Before invoking Alchemy, CI makes bounded GET-only checks of account Worker
metadata, the existing `alchemy-state-store` Worker, Secrets Store metadata and
the public state contract. Missing/malformed inputs, unavailable metadata,
rate limits and a contract other than beta.80's version 7 stop the job.
These checks do not read secret values or establish every permission needed
by Alchemy's later login/deploy operations.

Keep state-store recovery separate from routine deployment. Do not delete
`alchemy-state-store`, replace its bearer/encryption secrets or repeat a failed
automatic bootstrap. Diagnose the failing operation and review its recovery
first. The currently serving production Worker should remain available while
the deployment pipeline is repaired.
