import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as GitHub from 'alchemy/GitHub'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Redacted from 'effect/Redacted'

const owner = 'Manzanita-Research'
const repository = 'foldkit-dials'

// CI's Cloudflare credentials, as code. This stack mints a Cloudflare API
// token scoped to what the demo's deploy needs and stores it, with the account
// ID, as this repository's Actions secrets. Deploy it once from a laptop with
// the elevated `admin` profile (see the README), and again only to rotate the
// token or change its permissions:
//
//   pnpm alchemy deploy --config stacks/github.ts --profile admin
export default Alchemy.Stack(
  'github',
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    // The account comes from the profile this stack deploys with.
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment

    const token = yield* Cloudflare.ApiToken.AccountApiToken('CIToken', {
      name: `${repository} CI`,
      accountId,
      policies: [
        {
          effect: 'allow',
          permissionGroups: [
            // Deploy the Worker, its version previews and its custom domain.
            'Workers Scripts Write',
            // The account's workers.dev subdomain.
            'Account Settings Write',
            // Alchemy's state store keeps its auth token and encryption key
            // in the account's Secrets Store.
            'Secrets Store Write',
            'Workers Tail Read',
          ],
          resources: { [`com.cloudflare.api.account.${accountId}`]: '*' },
        },
      ],
    })

    yield* GitHub.Secret('CloudflareApiToken', {
      owner,
      repository,
      name: 'CLOUDFLARE_API_TOKEN',
      value: token.value,
    })
    yield* GitHub.Secret('CloudflareAccountId', {
      owner,
      repository,
      name: 'CLOUDFLARE_ACCOUNT_ID',
      value: Redacted.make(accountId),
    })
  }),
)
