import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as GitHub from 'alchemy/GitHub'
import * as Output from 'alchemy/Output'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

// The demo, deployed as static assets on a Cloudflare Worker. Alchemy runs
// this project's own `vite build` (its root is `demo/`) and uploads the
// client output; deep links fall back to `index.html`.
export const Demo = Cloudflare.Website.Foldkit('Demo')

export default Alchemy.Stack(
  'FoldkitDials',
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const demo = yield* Demo
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
