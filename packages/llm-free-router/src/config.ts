import type {} from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_CHAIN } from '@dsh-free-models/presets'

/** Route id the adapter registers. Select it as the provider in dsh. */
export const FREE_ROUTE = 'free-auto'
/** The single virtual model the route advertises. Any model id sent to the route behaves the same. */
export const FREE_MODEL = 'auto'

/**
 * Every field is volatile, so the settings page can edit it and the next request sees it
 * without a restart. API keys are NOT here: each provider's key lives in dsh's credential
 * store, entered on the Models page under the provider's own route (google, openrouter, ...).
 */
export const Config = z.object({
  chain: z.array(z.object({
    route: z.string().required().description('Provider route key, for example google, openrouter or mistral.'),
    model: z.string().required().description('Model id on that route.'),
    enabled: z.boolean().default(true).description('Turn the entry off without deleting it.'),
  })).default(DEFAULT_CHAIN.map(entry => ({ ...entry }))).volatile()
    .description('Fallback order. The first entry that is available is used.'),
  forbidBillableCalls: z.boolean().default(true).volatile()
    .description('Never send a request that could be billed. Leave on unless you know what you are doing.'),
  allowBilling: z.dict(z.boolean()).default({}).volatile()
    .description('Per provider: explicitly allow a provider that bills after its free allowance. Needs forbidBillableCalls off.'),
  confirmedNoBilling: z.dict(z.boolean()).default({}).volatile()
    .description('Per provider: you confirmed the account behind the key has no paid plan or billing attached.'),
  minContext: z.natural().default(128_000).volatile()
    .description('Skip models with a smaller context window than this many tokens.'),
  sensitiveRequests: z.boolean().default(false).volatile()
    .description('Skip providers whose free tier may use prompts to improve their products.'),
  switchPolicy: z.union([z.const('priority'), z.const('sticky')]).default('priority').volatile()
    .description('priority: always prefer the first available entry. sticky: stay on the entry that last worked.'),
  statusPage: z.boolean().default(true).volatile()
    .description('Serve the usage counters the settings page shows, at /free-models/status.'),
  softLimitRatio: z.number().min(0.1).max(1).default(0.8).volatile()
    .description('Stop using a provider at this share of its published daily allowance.'),
})

export type Config = ReturnType<typeof Config>
