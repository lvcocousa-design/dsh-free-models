import type { ProviderPreset } from '@dsh-free-models/core'

/**
 * NVIDIA API catalog (build.nvidia.com hosted endpoints). Free to prototype with, up to about 40 requests per
 * minute per account for most models, with no per-token billing. Terms: the API Trial Terms of Service allow
 * trial use only, not production, and let NVIDIA use submitted and generated content to improve its products.
 * That is why `trainsOnFreeTierData` is true and the route is skipped when `sensitiveRequests` is on.
 * The route name and base URL come from dsh's own catalog entry for `nvidia`.
 * Which models accept tool calls is per model page and was not checked, hence `unverified`.
 */
export const nvidia: ProviderPreset = {
  route: 'nvidia',
  displayName: 'NVIDIA API catalog (trial only)',
  apiKeyEnv: 'NVIDIA_API_KEY',
  overage: 'reject',
  resetPolicy: 'unknown',
  limits: { requestsPerMinute: 40 },
  quotaScope: 'route',
  models: [
    { id: 'nvidia/nemotron-3-ultra-550b-a55b', name: 'Nemotron 3 Ultra 550B', contextWindow: 1_000_000, tools: true, reasoning: true, unverified: true },
    { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', contextWindow: 131_072, tools: true, reasoning: true, unverified: true },
    { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6', contextWindow: 262_144, tools: true, reasoning: true, unverified: true },
  ],
  billingNotice:
    'Hosted endpoints are free for prototyping at about 40 requests per minute; there is no per-token billing. Past the limit NVIDIA points you to paid deployment, so keep using a free account.',
  trainsOnFreeTierData: true,
  keyUrl: 'https://build.nvidia.com/search',
  docsUrl: 'https://build.nvidia.com/search',
  verifiedAt: '2026-11-20',
  requirements:
    'Trial terms: not for production use. NVIDIA may use your prompts and outputs to improve its products. Needs an NVIDIA account (verification) and an API key.',
  offByDefault: true,
}
