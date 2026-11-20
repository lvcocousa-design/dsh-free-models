/** What a provider does when the free allowance is used up. */
export type Overage =
  /** The API refuses further calls (HTTP 429). No charge can occur. */
  | 'reject'
  /** Refuses calls only while the account has no paid plan or billing attached; otherwise bills. */
  | 'depends-on-account-billing'
  /** Switches to paid usage on its own. Never part of the default chain. */
  | 'bills'

/** When a daily allowance resets. */
export type ResetPolicy = 'pacific-midnight' | 'utc-midnight' | 'unknown'

/** One model a preset considers free. */
export interface FreeModel {
  /** Model id exactly as the provider API expects it. */
  id: string
  /** Display name. */
  name: string
  /** Context window in tokens. */
  contextWindow: number
  /** Output cap in tokens, when the provider publishes one. */
  maxTokens?: number
  /** Whether the model accepts tool declarations (needed for agent use). */
  tools: boolean
  /** Whether the model produces reasoning output. */
  reasoning: boolean
  /** Overrides the provider-level overage for this model. */
  overage?: Overage
  /** True when the number came from an unofficial source or an alias, and should be re-checked. */
  unverified?: boolean
}

/** Published allowance for a provider free tier. Absent fields are not published. */
export interface FreeLimits {
  requestsPerMinute?: number
  requestsPerDay?: number
  tokensPerMinute?: number
  tokensPerDay?: number
}

/** Static description of one provider's free tier. */
export interface ProviderPreset {
  /** Provider route key; also the pi-ai route name. */
  route: string
  displayName: string
  /** Credential reference (environment-variable style name) the route reads its key from. */
  apiKeyEnv: string
  overage: Overage
  resetPolicy: ResetPolicy
  limits: FreeLimits
  /** Whether the allowance is shared by the whole account (`route`) or counted separately per model. */
  quotaScope: 'route' | 'model'
  models: readonly FreeModel[]
  /** If set, every model id must end with this suffix to be considered free (OpenRouter `:free`). */
  requiredModelSuffix?: string
  /** Models the provider lists that are NOT free. Never allowed, even if a user adds them by hand. */
  deniedModels?: readonly string[]
  /** Plain-language statement shown before the user enables the route. */
  billingNotice: string
  /** True when free-tier prompts may be used by the provider to improve its products. */
  trainsOnFreeTierData: boolean
  /** Where to create a key. */
  keyUrl: string
  /** Official page the limits were read from. */
  docsUrl: string
  /** Date (YYYY-MM-DD) the numbers were last checked against the docs. */
  verifiedAt: string
}

/** One slot in the user's fallback chain. */
export interface ChainEntry {
  route: string
  model: string
  enabled: boolean
}

/** What went wrong with one attempt, reduced to what policy needs. */
export type FailureClass =
  /** The daily or monthly allowance is spent. Stop using the route until it resets. */
  | 'quota-daily'
  /** Short window limit. Back off briefly and try another route first. */
  | 'rate-minute'
  /** The provider asks for payment. Disable the route until a human looks. */
  | 'billing'
  /** Key missing, invalid or not authorized. Needs the user. */
  | 'auth'
  /** Server, timeout or transport trouble. */
  | 'transient'
  /** The request used something this route cannot do (stop sequences, unknown model). */
  | 'unsupported'
  /** The conversation does not fit this model's context window. */
  | 'context'
  | 'aborted'
  | 'fatal'

/** The slice of an LLM failure the classifier reads. */
export interface FailureFacts {
  code: string
  message?: string
  status?: number
  providerRetryAfterMs?: number
}

export type RouteStatus = 'ok' | 'cooling' | 'exhausted' | 'disabled'

export interface RouteState {
  route: string
  status: RouteStatus
  /** Epoch ms when the route may be tried again; absent when ok or disabled for good. */
  until?: number
  /** Why the route is not ok. */
  reason?: string
  usage: { requests: number; tokens: number; windowStart: number }
}

export type Clock = () => number
