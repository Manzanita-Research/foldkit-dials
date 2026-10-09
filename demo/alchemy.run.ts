import { resolve } from 'node:path'

import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as GitHub from 'alchemy/GitHub'
import * as Output from 'alchemy/Output'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

// Production is one Worker, served on its custom domain.
const productionWorker = 'foldkit-dials'
const productionDomain = 'foldkit-dials.manzanita.dev'

export default Alchemy.Stack(
  'FoldkitDials',
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage
    // The demo is one Worker that serves the app `pnpm build:demo` built into
    // demo/dist. Production deploys it as `foldkit-dials` on its domain. A
    // `pr-<n>` stage uploads a version of that same Worker instead of creating
    // its own, like Cloudflare's Git integration: the version takes no traffic,
    // its preview URL is `pr-<n>-foldkit-dials.<subdomain>.workers.dev`, and
    // each push re-points it.
    const demo = yield* Cloudflare.Worker('Demo', {
      // NOTE: a version upload needs an entry module, so the Worker has a
      // `main` even though the demo is static.
      main: resolve(import.meta.dirname, 'worker.ts'),
      assets: { directory: resolve(import.meta.dirname, 'dist'), notFoundHandling: 'single-page-application' },
      ...(stage === 'prod'
        ? { name: productionWorker, domain: productionDomain }
        : stage.startsWith('pr-')
          ? { version: { parent: productionWorker, alias: stage } }
          : {}),
      // PR previews are served from the production Worker's workers.dev
      // preview URLs, so keep its workers.dev subdomain (the default) on.
    })
    const github = yield* GitHub.GitHubEnv

    // A pull request's `pr-<n>` stage gets a comment with its preview URL,
    // updated in place on every push.
    if (github?.pr) {
      yield* GitHub.Comment('PreviewComment', {
        owner: github.owner,
        repository: github.repository,
        issueNumber: github.pr,
        body: Output.interpolate`## Demo preview

${demo.url}

Built from ${github.sha.slice(0, 7)}. This comment updates on every push.`,
      })
    }

    return { url: demo.url }
  }),
)
