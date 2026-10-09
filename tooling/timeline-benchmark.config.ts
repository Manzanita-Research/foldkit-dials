import config from '../vitest.config.js'

export default {
  ...config,
  test: {
    ...config.test,
    include: ['packages/foldkit-dials/benchmarks/timeline.test.ts'],
    testTimeout: 120_000,
    fileParallelism: false,
  },
}
