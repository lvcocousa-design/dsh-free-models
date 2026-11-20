import type { ProviderPreset } from '@dsh-free-models/core'

/**
 * Zhipu (BigModel) free text model GLM-4.7-Flash. The pricing page lists it as free for input, output and
 * cache, and a free model has no billing path, so the failure mode is a refusal (HTTP 429), never a charge.
 * The limit is concurrency (requests in flight at once), per account and per model. The number is only
 * visible in the console, so it is not recorded here.
 *
 * Several other models are named "...Flash" and are billed (GLM-5.3-Flash is 0.8 yuan per million input tokens).
 * They are listed in `deniedModels` so a typo or an edited chain can never select one.
 *
 * dsh's own `zai` route points at the international coding-plan endpoint, not this one, so this route is
 * declared by hand (see `customRoute`).
 */
export const zhipu: ProviderPreset = {
  route: 'zhipu',
  displayName: 'Zhipu BigModel (GLM-4.7-Flash, free)',
  apiKeyEnv: 'ZHIPU_API_KEY',
  overage: 'reject',
  resetPolicy: 'unknown',
  limits: {},
  quotaScope: 'route',
  models: [
    { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash', contextWindow: 200_000, maxTokens: 128_000, tools: true, reasoning: true },
  ],
  deniedModels: ['glm-5.3-flash', 'glm-5.3-flashx', 'glm-4.6v-flashx'],
  billingNotice:
    'GLM-4.7-Flash is free (input, output and cache). Only this model is free: other Flash models are billed. Over the concurrency limit the API answers 429.',
  trainsOnFreeTierData: false,
  keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys/',
  docsUrl: 'https://open.bigmodel.cn/pricing',
  verifiedAt: '2026-11-20',
  requirements:
    'Create an account at open.bigmodel.cn. Real-name verification may be required before calls work (not confirmed from the official pages). The concurrency limit is shown in the console and is not published. No official statement about training on prompts was found.',
  customRoute: { api: 'openai-completions', baseURL: 'https://open.bigmodel.cn/api/paas/v4/' },
}
