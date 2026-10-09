import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

const packageSource = resolve(import.meta.dirname, 'packages/foldkit-dials/src')

export default defineConfig({
  resolve: {
    conditions: ['@pleat/source', 'module', 'browser', 'development|production'],
    alias: [
      { find: /^foldkit-dials$/, replacement: resolve(packageSource, 'index.ts') },
    ],
  },
  test: {
    include: ['packages/foldkit-dials/src/**/*.test.ts', 'demo/src/**/*.test.ts'],
    environment: 'happy-dom',
    server: { deps: { inline: ['foldkit', '@foldkit/ui', '@pleat/core', '@pleat/foldkit'] } },
  },
})
