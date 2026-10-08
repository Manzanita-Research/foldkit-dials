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
    // The demo, deployed as static assets on a Cloudflare Worker. Alchemy runs
    // this project's own `vite build` (its root is `demo/`) and uploads the
    // client output; deep links fall back to `index.html`.
    //
    // A `pr-<n>` stage uploads a version of the production Worker instead of
    // creating its own, like Cloudflare's Git integration. The version takes
    // no traffic; its aliased preview URL is `pr-<n>-foldkit-dials.<subdomain>
    // .workers.dev`, and each push re-points it.
    const demo = yield* Cloudflare.Website.Foldkit(
      'Demo',
      stage === 'prod'
        ? { name: productionWorker, domain: productionDomain }
        : stage.startsWith('pr-')
          ? { version: { parent: productionWorker, alias: stage } }
          : {},
    )
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
