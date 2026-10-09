import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { relative, resolve } from 'node:path'
import ts from 'typescript'

const [ref] = process.argv.slice(2)
const configPath = resolve('packages/foldkit-dials/tsconfig.build.json')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  resolve('packages/foldkit-dials'),
  {
    noEmit: false,
    declaration: true,
    emitDeclarationOnly: true,
  },
)
const host = ts.createCompilerHost(parsed.options)
const readFile = host.readFile
host.readFile = file => {
  const path = relative(process.cwd(), file)
  if (ref && path.startsWith('packages/foldkit-dials/src/')) {
    return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' })
  }
  return readFile(file)
}
const declarations = new Map()
host.writeFile = (file, text) => {
  if (file.endsWith('.d.ts')) {
    declarations.set(
      relative(resolve('packages/foldkit-dials/dist'), file),
      Buffer.byteLength(text),
    )
  }
}
const program = ts.createProgram(parsed.fileNames, parsed.options, host)
const result = program.emit()
const diagnostics = [
  ...parsed.errors,
  ...ts.getPreEmitDiagnostics(program),
  ...result.diagnostics,
]
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host))
  process.exit(1)
}
console.log(
  JSON.stringify(
    {
      ref: ref ?? 'working tree',
      factories: Object.fromEntries(
        ['dialPanel/attach.d.ts', 'dialPanel/index.d.ts'].map(file => [
          file,
          declarations.get(file),
        ]),
      ),
      total: [...declarations.values()].reduce(
        (total, bytes) => total + bytes,
        0,
      ),
      largest: [...declarations]
        .sort(([, left], [, right]) => right - left)
        .slice(0, 8),
    },
    null,
    2,
  ),
)
