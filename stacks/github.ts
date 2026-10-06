import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import * as GitHub from 'alchemy/GitHub'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Redacted from 'effect/Redacted'

// CI's deploy credentials, as code. Deploy this once, locally, with a profile
// that may mint API tokens (see the README): it creates a Cloudflare token
// scoped to what the demo's deploy needs and writes it, with the account id,
// into this repository's Actions secrets. Re-deploy it to rotate the token or
// change its permissions.
const OWNER = 'Manzanita-Research'
const REPOSITORY = 'foldkit-dials'

export default Alchemy.Stack(
  'FoldkitDialsGitHub',
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment

    const apiToken = yield* Cloudflare.ApiToken.AccountApiToken('CIToken', {
      accountId,
      policies: [
        {
          effect: 'allow',
          // Workers for the demo; Account Settings for its workers.dev URL;
          // Secrets Store for Alchemy's state store, which CI reads on every
          // run.
          permissionGroups: [
            'Workers Scripts Write',
            'Account Settings Write',
            'Secrets Store Write',
          ],
          resources: { [`com.cloudflare.api.account.${accountId}`]: '*' },
        },
      ],
    })

    yield* GitHub.Secret('CloudflareApiToken', {
      owner: OWNER,
      repository: REPOSITORY,
      name: 'CLOUDFLARE_API_TOKEN',
      value: apiToken.value,
    })
    yield* GitHub.Secret('CloudflareAccountId', {
      owner: OWNER,
      repository: REPOSITORY,
      name: 'CLOUDFLARE_ACCOUNT_ID',
      value: Redacted.make(accountId),
    })
  }),
)
