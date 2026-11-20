import type { ChainEntry, ProviderPreset } from '@dsh-free-models/core'
import { google } from './google.ts'
import { groq } from './groq.ts'
import { mistral } from './mistral.ts'
import { openrouter } from './openrouter.ts'

export { google, groq, mistral, openrouter }

/** Every preset shipped here. Add a provider by adding one file and one line. */
export const PRESETS: readonly ProviderPreset[] = [google, openrouter, mistral, groq]

export function presetMap(presets: readonly ProviderPreset[] = PRESETS): ReadonlyMap<string, ProviderPreset> {
  return new Map(presets.map(preset => [preset.route, preset]))
}

/**
 * The out-of-the-box chain for agent and coding work: long context and tool calling only.
 * Groq is left out because its free token-per-minute cap is too small for agent contexts.
 */
export const DEFAULT_CHAIN: readonly ChainEntry[] = [
  { route: 'google', model: 'gemini-4-hydrogen', enabled: true },
  { route: 'google', model: 'gemini-3.8-flash', enabled: true },
  { route: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free', enabled: true },
  { route: 'openrouter', model: 'google/gemma-4-31b-it:free', enabled: true },
  { route: 'mistral', model: 'mistral-small-latest', enabled: true },
]
