import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const src = (p: string): string => fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@dsh-free-models/core': src('core'),
      '@dsh-free-models/presets': src('presets'),
      '@dsh-free-models/llm-free-router': src('llm-free-router'),
    },
  },
  test: { include: ['packages/*/tests/**/*.spec.{ts,tsx}'], exclude: ['**/*.live.spec.ts'] },
})
