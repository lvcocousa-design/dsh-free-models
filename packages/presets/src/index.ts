import type { ChainEntry, ProviderPreset } from '@dsh-free-models/core'
import { cloudflare } from './cloudflare.ts'
import { google } from './google.ts'
import { groq } from './groq.ts'
import { mistral } from './mistral.ts'
import { modelscope } from './modelscope.ts'
import { nvidia } from './nvidia.ts'
import { openrouter } from './openrouter.ts'
import { zhipu } from './zhipu.ts'
import { zhipuIntl } from './zhipu-intl.ts'

export { cloudflare, google, groq, mistral, modelscope, nvidia, openrouter, zhipu, zhipuIntl }

/** Every preset shipped here. Add a provider by adding one file and one line. */
export const PRESETS: readonly ProviderPreset[] = [zhipu, zhipuIntl, google, openrouter, mistral, groq, cloudflare, modelscope, nvidia]

export function presetMap(presets: readonly ProviderPreset[] = PRESETS): ReadonlyMap<string, ProviderPreset> {
  return new Map(presets.map(preset => [preset.route, preset]))
}

/**
 * The out-of-the-box chain for agent and coding work: long context and tool calling only.
 * Groq is left out because its free token-per-minute cap is too small for agent contexts.
 * Cloudflare, ModelScope and NVIDIA are available in the settings page but stay out of the chain by default.
 */
export const DEFAULT_CHAIN: readonly ChainEntry[] = [
  { route: 'zhipu', model: 'glm-4.7-flash', enabled: true },
  { route: 'zhipu-intl', model: 'glm-4.7-flash', enabled: true },
  { route: 'google', model: 'gemini-4-hydrogen', enabled: true },
  { route: 'google', model: 'gemini-3.8-flash', enabled: true },
  { route: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free', enabled: true },
  { route: 'openrouter', model: 'google/gemma-4-31b-it:free', enabled: true },
  { route: 'mistral', model: 'mistral-small-latest', enabled: true },
]
