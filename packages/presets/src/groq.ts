import type { ProviderPreset } from '@dsh-free-models/core'

/**
 * Groq free plan. The published base limit is 8K tokens per minute per model, which is
 * too small for agent conversations, so Groq is available for short tasks but is not in
 * the default chain. Limits are per model; the console Limits page is authoritative.
 */
export const groq: ProviderPreset = {
  route: 'groq',
  displayName: 'Groq (free plan)',
  apiKeyEnv: 'GROQ_API_KEY',
  overage: 'depends-on-account-billing',
  resetPolicy: 'utc-midnight',
  limits: { requestsPerMinute: 30, requestsPerDay: 1000, tokensPerMinute: 8000, tokensPerDay: 200_000 },
  quotaScope: 'model',
  models: [
    { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', contextWindow: 131_072, tools: true, reasoning: true, unverified: true },
    { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', contextWindow: 131_072, tools: true, reasoning: true, unverified: true },
  ],
  billingNotice:
    'Free on the Free plan. Upgrading to the Developer plan needs a payment method and makes usage billable.',
  trainsOnFreeTierData: true,
  keyUrl: 'https://console.groq.com/keys',
  docsUrl: 'https://console.groq.com/docs/rate-limits',
  verifiedAt: '2026-11-20',
}
