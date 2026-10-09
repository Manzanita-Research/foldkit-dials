import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const fixture = resolve('tooling/type-fixtures/dialPanel.ts')
const sourceConfigPath = resolve('tsconfig.json')
const sourceConfig = ts.readConfigFile(sourceConfigPath, ts.sys.readFile)
const source = ts.parseJsonConfigFileContent(
  sourceConfig.config,
  ts.sys,
  process.cwd(),
)
const check = (file, options) => {
  const program = ts.createProgram([file], { ...options, noEmit: true })
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
check(fixture, source.options)

const consumer = mkdtempSync(resolve('node_modules/.panel-consumer-'))
try {
  const modules = join(consumer, 'node_modules')
  mkdirSync(modules)
  readdirSync(resolve('node_modules'))
    .filter(name => !name.startsWith('.') && name !== 'foldkit-dials')
    .forEach(name => {
      symlinkSync(resolve('node_modules', name), join(modules, name))
    })
  const [packed] = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', consumer],
      {
        cwd: resolve('packages/foldkit-dials'),
        env: { ...process.env, npm_config_cache: join(consumer, 'npm-cache') },
        encoding: 'utf8',
      },
    ),
  )
  execFileSync('tar', ['-xzf', join(consumer, packed.filename), '-C', consumer])
  symlinkSync(join(consumer, 'package'), join(modules, 'foldkit-dials'))
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ type: 'module' }),
  )
  const packedFixture = join(consumer, 'consumer.ts')
  cpSync(fixture, packedFixture)
  const { paths, baseUrl, customConditions, ...consumerOptions } =
    source.options
  check(packedFixture, { ...consumerOptions, types: [] })
  if (!process.exitCode) {
    console.log(
      'DialPanel fixtures pass against source and packed package (no source aliases).',
    )
  }
} finally {
  rmSync(consumer, { recursive: true, force: true })
}
