import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as Effect from 'effect/Effect'

// The demo, deployed as static assets on a Cloudflare Worker. Alchemy runs
// this project's own `vite build` (its root is `demo/`) and uploads the
// client output; deep links fall back to `index.html`.
export const Demo = Cloudflare.Website.Foldkit('Demo')

export default Alchemy.Stack(
  'FoldkitDials',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const demo = yield* Demo
    return { url: demo.url }
  }),
)
