// Builds lib/client.js in the format dsh's client module system loads: one script that hands a
// factory to window.__ModuleLoader__. react, the JSX runtime and cordis come from the page's module
// table (require), everything else is bundled. This mirrors the preset dsh uses for its own pages.
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const { name } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const shared = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis']
mkdirSync(new URL('./lib', import.meta.url), { recursive: true })

const result = await build({
  entryPoints: [new URL('./src/client/index.ts', import.meta.url).pathname],
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', write: false, jsx: 'automatic',
  external: shared, sourcemap: false, legalComments: 'none',
})
const body = result.outputFiles[0].text
const script = `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => {var module = { exports: {} }; var exports = module.exports;\n${body}\nreturn module.exports; } });\n`
writeFileSync(new URL('./lib/client.js', import.meta.url), script)
// Host half: the page needs no Host behavior, but dsh loads the package root as a plugin.
writeFileSync(new URL('./lib/index.js', import.meta.url), "export const name = 'free-models-client-ui'\nexport function apply() {}\n")
console.log(`built lib/client.js (${script.length} bytes)`)
