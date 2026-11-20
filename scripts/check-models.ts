/**
 * Deprecation check. Run with `pnpm check:models`.
 *
 * - OpenRouter: the public /models list needs no key. Every preset model must still be listed with
 *   zero prompt and completion price. Exit code 1 if one is gone or no longer free.
 * - Gemini, Mistral, ModelScope, NVIDIA: listed only when GEMINI_API_KEY / MISTRAL_API_KEY / MODELSCOPE_ACCESS_TOKEN /
 *   NVIDIA_API_KEY is set. (The ModelScope and NVIDIA list endpoints are OpenAI-style and were not run against a real key;
 *   a failure shows up as a note, not a problem.)
 * - Zhipu, Cloudflare: not checked (no keyless or documented list endpoint was verified).
 *   Uses the key for one read-only models call. Nothing is sent to any other host.
 */
import { PRESETS } from '../packages/presets/src/index.ts'

interface Problem { route: string; model: string; why: string }
const problems: Problem[] = []
const notes: string[] = []

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return await response.json()
}

async function checkOpenRouter(): Promise<void> {
  const preset = PRESETS.find(p => p.route === 'openrouter')
  if (!preset) return
  const body = await getJson('https://openrouter.ai/api/v1/models') as { data: { id: string; pricing?: { prompt?: string; completion?: string }; context_length?: number }[] }
  const listed = new Map(body.data.map(m => [m.id, m]))
  for (const model of preset.models) {
    const found = listed.get(model.id)
    if (!found) { problems.push({ route: 'openrouter', model: model.id, why: 'no longer listed' }); continue }
    if (Number(found.pricing?.prompt ?? 'NaN') !== 0 || Number(found.pricing?.completion ?? 'NaN') !== 0) {
      problems.push({ route: 'openrouter', model: model.id, why: 'listed but not free' })
    }
    if (found.context_length !== undefined && found.context_length !== model.contextWindow) {
      notes.push(`openrouter ${model.id}: context is now ${found.context_length}, preset says ${model.contextWindow}`)
    }
  }
  const free = body.data.filter(m => m.id.endsWith(':free') && Number(m.pricing?.prompt) === 0).map(m => m.id)
  const known = new Set(preset.models.map(m => m.id))
  const fresh = free.filter(id => !known.has(id))
  notes.push(`openrouter: ${free.length} free models listed, ${fresh.length} not in the preset`)
}

async function checkGemini(): Promise<void> {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
  const preset = PRESETS.find(p => p.route === 'google')
  if (!key || !preset) { notes.push('google: skipped (set GEMINI_API_KEY to check)'); return }
  const body = await getJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': key }) as { models: { name: string }[] }
  const ids = new Set(body.models.map(m => m.name.replace(/^models\//, '')))
  for (const model of preset.models) if (!ids.has(model.id)) problems.push({ route: 'google', model: model.id, why: 'not in the models list' })
}

async function checkMistral(): Promise<void> {
  const key = process.env.MISTRAL_API_KEY
  const preset = PRESETS.find(p => p.route === 'mistral')
  if (!key || !preset) { notes.push('mistral: skipped (set MISTRAL_API_KEY to check)'); return }
  const body = await getJson('https://api.mistral.ai/v1/models', { authorization: `Bearer ${key}` }) as { data: { id: string }[] }
  const ids = new Set(body.data.map(m => m.id))
  for (const model of preset.models) if (!ids.has(model.id)) problems.push({ route: 'mistral', model: model.id, why: 'not in the models list' })
}

/** OpenAI-style model list for the providers that expose one with a bearer key. Only these two, and only with a key set. */
async function checkListed(route: string, envName: string, url: string): Promise<void> {
  const key = process.env[envName]
  const preset = PRESETS.find(p => p.route === route)
  if (!key || !preset) { notes.push(`${route}: skipped (set ${envName} to check)`); return }
  const body = await getJson(url, { authorization: `Bearer ${key}` }) as { data: { id: string }[] }
  const ids = new Set(body.data.map(m => m.id))
  for (const model of preset.models) if (!ids.has(model.id)) problems.push({ route, model: model.id, why: 'not in the models list' })
}
const checkModelScope = (): Promise<void> => checkListed('modelscope', 'MODELSCOPE_ACCESS_TOKEN', 'https://api-inference.modelscope.cn/v1/models')
const checkNvidia = (): Promise<void> => checkListed('nvidia', 'NVIDIA_API_KEY', 'https://integrate.api.nvidia.com/v1/models')

for (const check of [checkOpenRouter, checkGemini, checkMistral, checkModelScope, checkNvidia]) {
  try { await check() } catch (error) { notes.push(`${check.name}: ${(error as Error).message}`) }
}
for (const note of notes) console.log(note)
for (const p of problems) console.log(`PROBLEM ${p.route}/${p.model}: ${p.why}`)
process.exit(problems.length > 0 ? 1 : 0)
