import { resolve } from 'node:path'

import { foldkit } from '@foldkit/vite-plugin'
import { type Plugin, defineConfig } from 'vite'

const demoRoot = resolve(import.meta.dirname, 'demo')
const packageSource = resolve(import.meta.dirname, 'packages/foldkit-dials/src')

// NOTE: Alchemy's `Cloudflare.Website.Foldkit` builds with the project
// directory as Vite's inline `root`, which overrides `root` below, so the
// build cannot find `demo/index.html`. A config hook runs after that merge
// and puts the root back.
const keepDemoRoot = (): Plugin => ({
  name: 'keep-demo-root',
  enforce: 'pre',
  config: () => ({ root: demoRoot }),
})

// NOTE: @foldkit/vite-plugin 0.26.1 pre-bundles `foldkit/devtools-host` while
// it serves `foldkit` from source, so the DevTools overlay registers on a
// second copy of the runtime and never mounts (foldkit/foldkit#1592). Remove
// once the fix in foldkit/foldkit#1593 ships.
const serveDevToolsHostFromSource = (): Plugin => ({
  name: 'serve-devtools-host-from-source',
  enforce: 'post',
  configResolved: config => {
    config.optimizeDeps.include = (config.optimizeDeps.include ?? []).filter(
      specifier => specifier !== 'foldkit/devtools-host',
    )
  },
})

export default defineConfig({
  root: demoRoot,
  plugins: [keepDemoRoot(), foldkit(), serveDevToolsHostFromSource()],
  resolve: {
    alias: [
      { find: /^foldkit-dials\/styles\.css$/, replacement: resolve(packageSource, 'styles/dials.css') },
      { find: /^foldkit-dials$/, replacement: resolve(packageSource, 'index.ts') },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5267,
    strictPort: true,
    allowedHosts: true,
    // NOTE: native file events do not reach Vite inside the agent sandbox.
    watch: { usePolling: true, interval: 300 },
  },
  build: { outDir: resolve(import.meta.dirname, 'dist/demo'), emptyOutDir: true },
})
