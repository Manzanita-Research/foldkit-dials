import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
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
  renameSync(join(consumer, 'package'), join(modules, 'foldkit-dials'))
  const { paths, baseUrl, customConditions, ...consumerOptions } =
    source.options
  const packedOptions = {
    ...consumerOptions,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: [],
  }
  const installedLibrary = join(modules, 'foldkit-dials')
  const packedManifest = JSON.parse(
    readFileSync(join(installedLibrary, 'package.json'), 'utf8'),
  )
  const declarations = realpathSync(
    resolve(installedLibrary, packedManifest.exports['.'].types),
  )
  const resolvedTypes = ts.resolveModuleName(
    'foldkit-dials',
    consumerFixture,
    packedOptions,
    ts.sys,
    undefined,
    undefined,
    ts.ModuleKind.ESNext,
  ).resolvedModule
  assert.ok(resolvedTypes, 'The public declaration export must resolve.')
  assert.equal(
    realpathSync(declarations),
    realpathSync(resolvedTypes.resolvedFileName),
  )
  check([consumerFixture], packedOptions)
  cpSync(
    resolve('tooling/type-fixtures/runtime.mjs'),
    join(consumer, 'runtime.mjs'),
  )
  execFileSync(
    process.execPath,
    [
      '--import',
      resolve('tooling/type-fixtures/browser-globals.mjs'),
      'runtime.mjs',
    ],
    {
      cwd: consumer,
      stdio: 'inherit',
    },
  )
  cpSync(
    resolve('tooling/type-fixtures/timeline.mjs'),
    join(consumer, 'timeline.mjs'),
  )
  const runTimeline = args =>
    execFileSync(
      process.execPath,
      [
        '--import',
        resolve('tooling/type-fixtures/browser-globals.mjs'),
        'timeline.mjs',
        ...args,
      ],
      { cwd: consumer, stdio: 'inherit' },
    )
  runTimeline(['--generate'])
  const timelineFixture = join(consumer, 'timeline.generated.ts')
  check([timelineFixture], packedOptions)
  if (!process.exitCode) {
    const program = ts.createProgram([timelineFixture], {
      ...packedOptions,
      noEmit: false,
    })
    assert.equal(program.emit().emitSkipped, false)
    runTimeline([])
  }
  if (!process.exitCode) {
    console.log(
      `DialPanel fixtures pass against source and packed package (NodeNext, no source aliases). Verified peers: ${JSON.stringify(dependencies)}`,
    )
  }
} finally {
  rmSync(consumer, { recursive: true, force: true })
}
