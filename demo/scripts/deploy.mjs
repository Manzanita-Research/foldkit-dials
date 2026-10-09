import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = fileURLToPath(new URL('../dist/', import.meta.url))

// Discard generated assets before building. A failed build cannot deploy the
// previous build, and callers never need to build the demo separately.
rmSync(output, { recursive: true, force: true })
const build = spawnSync('pnpm', ['run', 'build'], {
  cwd: root,
  stdio: 'inherit',
})
if (build.status !== 0) process.exit(build.status ?? 1)
if (!existsSync(new URL('../dist/index.html', import.meta.url))) {
  console.error(
    'The demo build did not produce dist/index.html. Deployment stopped.',
  )
  process.exit(1)
}

const deploy = spawnSync(
  'pnpm',
  ['exec', 'alchemy', 'deploy', ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: 'inherit',
  },
)
process.exit(deploy.status ?? 1)
