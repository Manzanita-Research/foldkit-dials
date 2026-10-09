import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const fixture = resolve('tooling/type-fixtures/dialPanel.ts')
const library = resolve('packages/foldkit-dials')
const libraryManifest = JSON.parse(
  readFileSync(join(library, 'package.json'), 'utf8'),
)
const sourceConfigPath = resolve('tsconfig.json')
const sourceConfig = ts.readConfigFile(sourceConfigPath, ts.sys.readFile)
const source = ts.parseJsonConfigFileContent(
  sourceConfig.config,
  ts.sys,
  process.cwd(),
)
const check = (files, options) => {
  const program = ts.createProgram(files, { ...options, noEmit: true })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length) {
    console.error(
      ts.formatDiagnosticsWithColorAndContext(
        diagnostics,
        ts.createCompilerHost(options),
      ),
    )
    process.exitCode = 1
  }
}
const consumer = mkdtempSync(join(tmpdir(), 'foldkit-dials-consumer-'))
try {
  const modules = join(consumer, 'node_modules')
  mkdirSync(modules)
  const peers = Object.keys(libraryManifest.peerDependencies)
  const dependencies = Object.fromEntries(
    peers.map(name => {
      const installed = join(library, 'node_modules', name)
      const { version } = JSON.parse(
        readFileSync(join(installed, 'package.json'), 'utf8'),
      )
      const destination = join(modules, name)
      mkdirSync(resolve(destination, '..'), { recursive: true })
      symlinkSync(installed, destination)
      return [name, version]
    }),
  )
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({
      type: 'module',
      dependencies: {
        ...dependencies,
        'foldkit-dials': libraryManifest.version,
      },
    }),
  )
  const consumerFixture = join(consumer, 'consumer.ts')
  cpSync(fixture, consumerFixture)
  check([consumerFixture, resolve('demo/src/vite-env.d.ts')], source.options)
  const [packed] = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', consumer],
      {
        cwd: library,
        env: { ...process.env, npm_config_cache: join(consumer, 'npm-cache') },
        encoding: 'utf8',
      },
    ),
  )
  execFileSync('tar', ['-xzf', join(consumer, packed.filename), '-C', consumer])
  symlinkSync(join(consumer, 'package'), join(modules, 'foldkit-dials'))
  const { paths, baseUrl, customConditions, ...consumerOptions } =
    source.options
  check([consumerFixture], { ...consumerOptions, types: [] })
  if (!process.exitCode) {
    console.log(
      'DialPanel fixtures pass against source and packed package (no source aliases).',
    )
  }
} finally {
  rmSync(consumer, { recursive: true, force: true })
}
