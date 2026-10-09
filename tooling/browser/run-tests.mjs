import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

const root = resolve(import.meta.dirname, '../..')
const preview = spawn(
  process.execPath,
  [
    resolve(root, 'demo/node_modules/vite/bin/vite.js'),
    'preview',
    '--config',
    'demo/vite.config.ts',
    '--host',
    '127.0.0.1',
    '--port',
    '5268',
    '--strictPort',
  ],
  { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'inherit'] },
)
const exited = child =>
  new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) =>
      resolve(code ?? 128 + constants.signals[signal]),
    )
  })
const previewExited = exited(preview)
const startup = new AbortController()
let runner
let runnerExited
let interruption = 0

const interrupt = signal => {
  if (!interruption) {
    interruption = 128 + constants.signals[signal]
    startup.abort()
    runner?.kill('SIGINT')
  }
}
process.on('SIGINT', () => interrupt('SIGINT'))
process.on('SIGTERM', () => interrupt('SIGTERM'))
console.log(`Owned preview PID=${preview.pid}`)

try {
  await new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(
      () => reject(new Error('Preview startup timed out.')),
      20_000,
    )
    const finish = operation => {
      clearTimeout(timeout)
      operation()
    }
    preview.stdout.on('data', data => {
      process.stdout.write(data)
      output += data.toString()
      if (stripVTControlCharacters(output).includes('http://127.0.0.1:5268/')) {
        finish(resolve)
      }
    })
    previewExited.then(
      () =>
        finish(() => reject(new Error('Owned preview exited before ready.'))),
      reject,
    )
    startup.signal.addEventListener(
      'abort',
      () => finish(() => reject(new Error('Browser run interrupted.'))),
      { once: true },
    )
  })
  runner = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve('@playwright/test/cli')),
      'test',
      ...process.argv.slice(2),
    ],
    { cwd: import.meta.dirname, detached: true, stdio: 'inherit' },
  )
  runnerExited = exited(runner)
  console.log(`Owned Playwright runner PID=${runner.pid}`)
  process.exitCode = await runnerExited
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  try {
    if (runner && runner.exitCode === null && runner.signalCode === null) {
      runner.kill('SIGINT')
      await runnerExited
    }
  } finally {
    if (preview.exitCode === null && preview.signalCode === null) {
      preview.kill('SIGTERM')
    }
    await previewExited
    process.exitCode = interruption || process.exitCode
  }
}
