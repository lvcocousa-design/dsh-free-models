import type { ProviderPreset } from '@dsh-free-models/core'

/**
 * Z.ai, the international site of Zhipu. Same free text models as the China site, different account, key and endpoint.
 * The pricing page lists GLM-4.7-Flash and GLM-4.5-Flash as free for input, output and cache. A free model has no
 * billing path, so the failure mode is HTTP 429 (concurrency), never a charge. The limit is concurrency only; the number
 * is shown after login at z.ai/manage-apikey/rate-limits, so it is not recorded here.
 *
 * Use a **standard API key**. Since 2026-10-16 the standard API and the GLM Coding Plan have separate keys that do not work
 * for each other. dsh's own `zai` route points at the Coding Plan endpoint, so this route is declared by hand.
 *
 * Privacy: for API use the Data Processing Addendum says Z.ai does not store the content you send or receive. It does not say
 * "never used for training", so this preset does not claim that.
 *
 * GLM-4.5-Flash: the GLM-4.5 guide lists a 128K context and function calling; another overview page says 200K. The lower number is used.
 */
export const zhipuIntl: ProviderPreset = {
  route: 'zhipu-intl',
  displayName: 'Z.ai international (GLM-4.7-Flash, free)',
  apiKeyEnv: 'ZAI_STANDARD_API_KEY',
  overage: 'reject',
  resetPolicy: 'unknown',
  limits: {},
  quotaScope: 'route',
  models: [
    { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash', contextWindow: 200_000, maxTokens: 128_000, tools: true, reasoning: true },
    { id: 'glm-4.5-flash', name: 'GLM-4.5-Flash', contextWindow: 128_000, tools: true, reasoning: true, unverified: true },
  ],
  deniedModels: ['glm-5.3-flash', 'glm-5.3-flashx', 'glm-4.7-flashx', 'glm-4.6v-flashx'],
  billingNotice:
    'GLM-4.7-Flash and GLM-4.5-Flash are free (input, output and cache). Other Flash models (5.3-Flash, 5.3-FlashX, 4.7-FlashX) are billed. Over the concurrency limit the API answers 429.',
  trainsOnFreeTierData: false,
  keyUrl: 'https://docs.z.ai/guides/develop/http/introduction',
  docsUrl: 'https://docs.z.ai/guides/overview/pricing',
  verifiedAt: '2026-11-20',
  requirements:
    'International site (api.z.ai), separate from the China site. Use a standard API key, not a GLM Coding Plan key. The official pages list no real-name or card requirement for free models (not tested by signing up). For API use, the data addendum says content is not stored; it makes no explicit promise about training.',
  customRoute: { api: 'openai-completions', baseURL: 'https://api.z.ai/api/paas/v4' },
}
