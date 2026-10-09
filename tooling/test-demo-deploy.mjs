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

function attempt(t, env = {}, args = []) {
  const root = mkdtempSync(join(tmpdir(), 'fkd-deploy-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'scripts'))
  mkdirSync(join(root, 'bin'))
  mkdirSync(join(root, 'dist'))
  copyFileSync(
    new URL('../demo/scripts/deploy.mjs', import.meta.url),
    join(root, 'scripts/deploy.mjs'),
  )
  writeFileSync(join(root, 'dist/index.html'), 'stale')
  writeFileSync(join(root, 'dist/stale.js'), 'stale')
  writeFileSync(
    join(root, 'bin/pnpm'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(args) + '\\n');
if (args[0] === 'run') {
  if (process.env.BUILD_FAIL) process.exit(23);
  if (!process.env.NO_OUTPUT) {
    fs.mkdirSync('dist', { recursive: true });
    fs.writeFileSync('dist/index.html', 'fresh');
  }
} else {
  if (fs.readFileSync('dist/index.html', 'utf8') !== 'fresh' || fs.existsSync('dist/stale.js')) process.exit(90);
  process.exit(Number(process.env.DEPLOY_STATUS || 0));
}
`,
    { mode: 0o700 },
  )
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts/deploy.mjs'), ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: `${join(root, 'bin')}:${process.env.PATH}`, ...env },
    },
  )
  const calls = readFileSync(join(root, 'calls.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
  return { result, calls, root }
}

test('deploy builds fresh assets before forwarding the explicit stage and flags', t => {
  const { result, calls } = attempt(t, {}, ['--stage', 'prod', '--yes'])
  assert.equal(result.status, 0)
  assert.deepEqual(calls, [
    ['run', 'build'],
    ['exec', 'alchemy', 'deploy', '--stage', 'prod', '--yes'],
  ])
})

test('a failed build stops deployment and discards stale assets', t => {
  const { result, calls, root } = attempt(t, { BUILD_FAIL: 'true' })
  assert.equal(result.status, 23)
  assert.deepEqual(calls, [['run', 'build']])
  assert.equal(existsSync(join(root, 'dist')), false)
})

test('a successful command without built assets still cannot deploy', t => {
  const { result, calls } = attempt(t, { NO_OUTPUT: 'true' })
  assert.equal(result.status, 1)
  assert.deepEqual(calls, [['run', 'build']])
})

test('deployment failure is returned to the caller', t => {
  const { result } = attempt(t, { DEPLOY_STATUS: '13' })
  assert.equal(result.status, 13)
})
