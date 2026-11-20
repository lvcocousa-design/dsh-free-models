import type { ProviderPreset } from '@dsh-free-models/core'

/**
 * ModelScope (Alibaba) API-Inference. Free, non-commercial, not for production. The ModelScope account must be
 * linked to an Alibaba Cloud account that passed real-name verification. Usage is metered in "Magic Beans"
 * (0.5, 1 or 2 per call by model size). The official page no longer states a daily number, so none is recorded.
 * The model list changes (old models are retired); the ids below are the ones the official guide uses.
 * Whether each model supports tool calls is not stated on the official pages, hence `unverified`.
 */
export const modelscope: ProviderPreset = {
  route: 'modelscope',
  displayName: 'ModelScope API-Inference (free, non-commercial)',
  apiKeyEnv: 'MODELSCOPE_ACCESS_TOKEN',
  overage: 'reject',
  resetPolicy: 'unknown',
  limits: {},
  quotaScope: 'route',
  models: [
    { id: 'Qwen/Qwen3.5-35B-A3B', name: 'Qwen3.5 35B A3B', contextWindow: 131_072, tools: true, reasoning: true, unverified: true },
    { id: 'Qwen/Qwen3.5-27B', name: 'Qwen3.5 27B', contextWindow: 131_072, tools: true, reasoning: true, unverified: true },
  ],
  billingNotice:
    'Free for developers, not for production or commercial use. When the daily allowance or concurrency is used up, calls are refused.',
  trainsOnFreeTierData: false,
  keyUrl: 'https://modelscope.cn/my/myaccesstoken',
  docsUrl: 'https://www.modelscope.cn/docs/model-service/API-Inference/limits.md',
  verifiedAt: '2026-11-20',
  requirements:
    'Non-commercial use only. The ModelScope account must be bound to an Alibaba Cloud account that passed real-name verification. Allowance and concurrency change with platform load and are not published. No official statement about training on prompts was found.',
  customRoute: { api: 'openai-completions', baseURL: 'https://api-inference.modelscope.cn/v1/' },
  offByDefault: true,
}
