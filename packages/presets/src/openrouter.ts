import type { ProviderPreset } from '@dsh-free-models/core'

/**
 * OpenRouter models whose id ends in `:free`. They cost $0 per token. Without any credit
 * purchase the account gets 20 requests per minute and 50 requests per day across all
 * free models; buying at least $10 of credit once raises the daily cap to 1000.
 * The suffix rule is enforced in code: the same model without `:free` is billed.
 */
export const openrouter: ProviderPreset = {
  route: 'openrouter',
  displayName: 'OpenRouter (:free models)',
  apiKeyEnv: 'OPENROUTER_API_KEY',
  overage: 'reject',
  resetPolicy: 'utc-midnight',
  limits: { requestsPerMinute: 20, requestsPerDay: 50 },
  quotaScope: 'route',
  requiredModelSuffix: ':free',
  models: [
    { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'NVIDIA Nemotron 3 Ultra (free)', contextWindow: 1_000_000, tools: true, reasoning: true },
    { id: 'google/gemma-4-31b-it:free', name: 'Google Gemma 4 31B (free)', contextWindow: 262_144, tools: true, reasoning: true },
    { id: 'inclusionai/ling-3.2-flash:free', name: 'inclusionAI Ling 3.2 Flash (free)', contextWindow: 1_048_576, tools: true, reasoning: true },
  ],
  // Routers can pick a paid model behind the scenes.
  deniedModels: ['openrouter/auto', 'openrouter/free'],
  billingNotice:
    'Only models ending in ":free" are used. Those cost nothing per token and stop with an error at the limit. '
    + 'The free list changes often; run `pnpm check:models` to see which of these are still listed.',
  trainsOnFreeTierData: true,
  keyUrl: 'https://openrouter.ai/settings/keys',
  docsUrl: 'https://openrouter.ai/docs/api_reference/limits',
  verifiedAt: '2026-11-20',
}
