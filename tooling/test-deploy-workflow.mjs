import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const workflow = readFileSync(
  new URL('../.github/workflows/deploy.yml', import.meta.url),
  'utf8',
)
// Read only step boundaries/scalar fields, leaving multiline shell unchanged.
function steps(job) {
  const body = workflow
    .split(`  ${job}:\n`)[1]
    .split(/^  [a-z]+:\n/m)[0]
    .split('    steps:\n')[1]
  return body
    .split(/^      - /m)
    .slice(1)
    .map(block => ({
      block,
      run: block.match(/^        run: (.+)$/m)?.[1],
      shell: block
        .match(/^        run: \|\n([\s\S]*)/m)?.[1]
        ?.replace(/^          /gm, ''),
    }))
}

for (const job of ['deploy', 'cleanup']) {
  test(`${job} uses workflow safety revision before application checkout`, () => {
    const items = steps(job)
    const health = items.findIndex(item =>
      item.run?.includes('cloudflare_preflight.py'),
    )
    assert.ok(health > 0)
    assert.match(
      items[health - 1].block,
      /ref: \$\{\{ github\.workflow_sha \}\}/,
    )
    assert.match(items[health - 1].block, /path: \.deploy-safety/)
    assert.match(
      items[health].run,
      /python3 -I -B \.deploy-safety\/tooling\/cloudflare_preflight.py$/,
    )
    assert.match(items[health + 1].block, /uses: actions\/checkout@/)
    if (job === 'cleanup')
      assert.match(
        items[health + 1].block,
        /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/,
      )
    assert.ok(
      items.findIndex(item => item.run === 'pnpm install --frozen-lockfile') >
        health,
    )
  })

  test(`${job} lifecycle blocks stale events and unknown PR state`, t => {
    const root = mkdtempSync(join(tmpdir(), 'fkd-lifecycle-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    writeFileSync(
      join(root, 'gh'),
      '#!/bin/sh\n[ "$GH_EXIT" = 0 ] || exit "$GH_EXIT"\nprintf "%s\\n" "$FAKE_STATE"\n',
      { mode: 0o700 },
    )
    const lifecycle = steps(job).find(item =>
      item.block.includes('id: lifecycle'),
    )
    assert.ok(
      steps(job)
        .at(-1)
        .block.includes("steps.lifecycle.outputs.ready == 'true'"),
    )
    for (const [state, exit, expected] of [
      ['open', '0', job === 'deploy'],
      ['closed', '0', job === 'cleanup'],
      ['unknown', '0', null],
      ['open', '5', null],
    ]) {
      const output = join(root, 'output')
      writeFileSync(output, '')
      const result = spawnSync(
        'bash',
        [
          '--noprofile',
          '--norc',
          '-e',
          '-o',
          'pipefail',
          '-c',
          lifecycle.shell,
        ],
        {
          encoding: 'utf8',
          env: {
            PATH: `${root}:${process.env.PATH}`,
            GH_EXIT: exit,
            FAKE_STATE: state,
            GITHUB_EVENT_NAME: 'pull_request',
            GITHUB_REPOSITORY: 'example/repo',
            PULL_REQUEST: '14',
            GITHUB_OUTPUT: output,
          },
        },
      )
      if (expected === null) {
        assert.notEqual(result.status, 0)
        assert.equal(readFileSync(output, 'utf8'), '')
      } else {
        assert.equal(result.status, 0)
        assert.equal(readFileSync(output, 'utf8'), `ready=${expected}\n`)
      }
    }
  })
}

test('closed old head without safety helper can still reach historical destroy', t => {
  const root = mkdtempSync(join(tmpdir(), 'fkd-old-head-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const items = steps('cleanup')
  const health = items.findIndex(item =>
    item.run?.includes('cloudflare_preflight.py'),
  )
  mkdirSync(join(root, 'bin'))
  writeFileSync(join(root, 'bin/timeout'), '#!/bin/sh\nshift 3\nexec "$@"\n', {
    mode: 0o700,
  })
  const safety = join(root, '.deploy-safety/tooling')
  mkdirSync(safety, { recursive: true })
  // Safety code is the reviewed workflow revision. Replace its GET transport
  // with an offline healthy stub; historical app head deliberately lacks it.
  copyFileSync(
    new URL('./cloudflare_preflight.py', import.meta.url),
    join(safety, 'cloudflare_preflight.py'),
  )
  writeFileSync(
    join(safety, 'cloudflare_probe.py'),
    `
API_BASE = 'https://example.invalid'
EXPECTED_CONTRACT = 7
class RateLimited(Exception): pass
def validate_credentials(*args): return True
def emit(row): pass
def query(opener, operation, url, token=None):
 return {'success':True,'result':{'subdomain':'fixture'}} if operation=='workers.getSubdomain' else {'success':True,'result':{}} if operation=='workers.getScriptSetting' else {'success':True,'result':[{'id':'fixture'}]} if operation=='secretsStore.listStores' else {'version':7}
def main(check): return check('fixture','fixture',None)
`,
  )
  assert.equal(existsSync(join(root, 'tooling/cloudflare_preflight.py')), false)
  const checked = spawnSync(
    'bash',
    ['-e', '-o', 'pipefail', '-c', items[health].run],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}` },
    },
  )
  assert.equal(checked.status, 0, checked.stderr)
  writeFileSync(
    join(root, 'bin/pnpm'),
    '#!/bin/sh\n[ "$*" = "run destroy --stage pr-14 --yes" ]\n',
    { mode: 0o700 },
  )
  const destroyed = spawnSync(
    'bash',
    ['-e', '-o', 'pipefail', '-c', items.at(-1).run],
    {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: `${join(root, 'bin')}:${process.env.PATH}`, STAGE: 'pr-14' },
    },
  )
  assert.equal(destroyed.status, 0)
})
