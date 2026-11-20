import type { ProviderPreset } from '@dsh-free-models/core'

/**
 * Cloudflare Workers AI. Every account gets 10,000 Neurons per day free, reset at 00:00 UTC. Past that, the
 * Free plan fails the call, but an account on the Workers Paid plan is billed ($0.011 per 1,000 Neurons). So this
 * is "depends on account billing". Some models need a paid method at all and are never allowed here.
 * The route name matches dsh's own catalog route, whose base URL is built from CLOUDFLARE_ACCOUNT_ID.
 * Ten thousand Neurons is roughly a hundred thousand tokens a day on these models: a fallback, not a main route.
 */
export const cloudflare: ProviderPreset = {
  route: 'cloudflare-workers-ai',
  displayName: 'Cloudflare Workers AI (free daily allowance)',
  apiKeyEnv: 'CLOUDFLARE_API_KEY',
  overage: 'depends-on-account-billing',
  resetPolicy: 'utc-midnight',
  limits: {},
  quotaScope: 'route',
  models: [
    { id: '@cf/zai-org/glm-4.7-flash', name: 'GLM-4.7-Flash', contextWindow: 131_072, tools: true, reasoning: true },
    { id: '@cf/openai/gpt-oss-120b', name: 'GPT-OSS 120B', contextWindow: 128_000, tools: true, reasoning: true },
    { id: '@cf/openai/gpt-oss-20b', name: 'GPT-OSS 20B', contextWindow: 131_072, tools: true, reasoning: true, unverified: true },
  ],
  deniedModels: [
    '@cf/moonshotai/kimi-k2.6', '@cf/moonshotai/kimi-k2.7-code', '@cf/zai-org/glm-5.2', '@cf/zai-org/glm-5.3',
    '@cf/zai-org/glm-5.3-flash', '@cf/deepseek-ai/deepseek-v4-flash-0731', '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
    '@cf/deepseek-ai/deepseek-v4-pro-0813', '@cf/thinkingmachines/inkling-2-small',
  ],
  billingNotice:
    '10,000 Neurons per day are free (resets 00:00 UTC). Free plan: calls fail past that. Workers Paid plan: usage past it is billed. Use an account on the Free plan.',
  trainsOnFreeTierData: false,
  keyUrl: 'https://developers.cloudflare.com/fundamentals/api/get-started/create-token/',
  docsUrl: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
  verifiedAt: '2026-11-20',
  requirements:
    'Needs a Cloudflare account on the Free Workers plan, an API token with Workers AI permission, and the account id. Cloudflare says it does not train on or keep Workers AI inputs and outputs.',
  extraCredentials: [
    { env: 'CLOUDFLARE_ACCOUNT_ID', hint: 'Cloudflare dashboard, Workers & Pages overview: "Account ID" on the right. It is not secret, but dsh needs it to build the URL.' },
  ],
  offByDefault: true,
}
