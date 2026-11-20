import type { ProviderPreset } from '@dsh-free-models/core'

/**
 * Google Gemini API, free tier.
 * Free-tier eligibility is decided per model on the pricing page. A project with a billing
 * account linked moves to a paid tier and is billed, so the key must come from a project
 * with no billing attached.
 */
export const google: ProviderPreset = {
  route: 'google',
  displayName: 'Google Gemini (free tier)',
  apiKeyEnv: 'GEMINI_API_KEY',
  overage: 'depends-on-account-billing',
  resetPolicy: 'pacific-midnight',
  // Per-model RPM/TPM/RPD are shown only inside AI Studio, not in the public docs, so none are listed.
  limits: {},
  quotaScope: 'model',
  models: [
    { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen', contextWindow: 1_000_000, maxTokens: 64_000, tools: true, reasoning: true },
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', contextWindow: 1_000_000, tools: true, reasoning: true },
    { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', contextWindow: 1_000_000, tools: true, reasoning: true },
    { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', contextWindow: 1_000_000, tools: true, reasoning: true, unverified: true },
    { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', contextWindow: 1_000_000, tools: true, reasoning: true, unverified: true },
  ],
  // Listed by Google as not available on the free tier.
  deniedModels: [
    'gemini-4-carbon', 'gemini-4-argon', 'gemini-4-neon',
    'gemini-3.1-pro-preview', 'gemini-3.1-pro-preview-customtools',
  ],
  billingNotice:
    'Free only while the Google Cloud project behind the key has no billing account linked. '
    + 'Linking billing moves the project to a paid tier and Gemini calls are then charged.',
  trainsOnFreeTierData: true,
  keyUrl: 'https://aistudio.google.com/apikey',
  docsUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
  verifiedAt: '2026-11-20',
}
