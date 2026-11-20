import type { ProviderPreset } from '@dsh-free-models/core'

/**
 * Mistral AI Studio "Free mode": enabled by default, no credit card, lowest rate limits,
 * intended for evaluation and prototyping. Mistral does not publish the numbers; they are
 * on the Limits page of the console. Upgrading to pay-as-you-go is a deliberate step.
 * Model ids are the documented `-latest` aliases; their context sizes are not confirmed.
 */
export const mistral: ProviderPreset = {
  route: 'mistral',
  displayName: 'Mistral AI Studio (free mode)',
  apiKeyEnv: 'MISTRAL_API_KEY',
  overage: 'depends-on-account-billing',
  resetPolicy: 'unknown',
  limits: {},
  quotaScope: 'route',
  models: [
    { id: 'mistral-small-latest', name: 'Mistral Small (latest)', contextWindow: 128_000, tools: true, reasoning: true, unverified: true },
    { id: 'mistral-large-latest', name: 'Mistral Large (latest)', contextWindow: 128_000, tools: true, reasoning: false, unverified: true },
  ],
  billingNotice:
    'Free only while the organization stays in Free mode. Switching to pay-as-you-go in the console makes calls billable.',
  trainsOnFreeTierData: true,
  keyUrl: 'https://console.mistral.ai/api-keys',
  docsUrl: 'https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key',
  verifiedAt: '2026-11-20',
}
