import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const run = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, stdio: 'inherit' })

run('pnpm', ['build:library'])
run('pnpm', ['build:demo'])
run('node', ['tooling/check-panel-types.mjs'])
run(process.execPath, ['run-tests.mjs'], import.meta.dirname)
