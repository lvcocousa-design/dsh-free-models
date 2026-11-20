import { quotaKey } from '@dsh-free-models/core'
import type { ProviderPreset, QuotaTracker } from '@dsh-free-models/core'

/** Path the settings page reads. Authenticated like every other dsh page request. */
export const STATUS_PATH = '/free-models/status'

export interface ProviderStatus {
  route: string
  displayName: string
  status: 'ok' | 'cooling' | 'exhausted' | 'disabled'
  reason?: string
  /** Epoch ms when the route may be used again. */
  until?: number
  usage: { requests: number; tokens: number }
  limits: { requestsPerMinute?: number; requestsPerDay?: number; tokensPerMinute?: number; tokensPerDay?: number }
  overage: string
  trainsOnFreeTierData: boolean
  billingNotice: string
  keyUrl: string
  docsUrl: string
  verifiedAt: string
  /** The credential reference the key is stored under. A name only, never a value. */
  apiKeyEnv: string
  models: { id: string; name: string; contextWindow: number; unverified: boolean; status: ProviderStatus['status']; until?: number; requests: number }[]
}

export interface StatusReport {
  route: string
  generatedAt: number
  providers: ProviderStatus[]
}

/** Build the page's data. Holds counters and static preset text only: no keys, no prompts. */
export function buildStatus(route: string, presets: Iterable<ProviderPreset>, tracker: QuotaTracker, now: number): StatusReport {
  return {
    route,
    generatedAt: now,
    providers: [...presets].map((preset) => {
      const routeState = tracker.state(preset.route)
      const models = preset.models.map((model) => {
        const state = tracker.state(quotaKey(preset, model.id))
        return { model, state }
      })
      // A per-model allowance (Gemini) only blocks the route once every model is blocked.
      const allBlocked = preset.quotaScope === 'model' && models.length > 0 && models.every(({ state }) => state.status !== 'ok')
      const blocked = allBlocked
        ? models.map(({ state }) => state).sort((a, b) => (a.until ?? Infinity) - (b.until ?? Infinity))[0]
        : undefined
      const state = routeState.status !== 'ok' ? routeState : blocked ?? routeState
      const requests = preset.quotaScope === 'model'
        ? models.reduce((sum, { state: s }) => sum + s.usage.requests, 0)
        : routeState.usage.requests
      const tokens = preset.quotaScope === 'model'
        ? models.reduce((sum, { state: s }) => sum + s.usage.tokens, 0)
        : routeState.usage.tokens
      return {
        route: preset.route,
        displayName: preset.displayName,
        status: state.status,
        ...state.reason === undefined ? {} : { reason: state.reason },
        ...state.until === undefined ? {} : { until: state.until },
        usage: { requests, tokens },
        limits: preset.limits,
        overage: preset.overage,
        trainsOnFreeTierData: preset.trainsOnFreeTierData,
        billingNotice: preset.billingNotice,
        keyUrl: preset.keyUrl,
        docsUrl: preset.docsUrl,
        verifiedAt: preset.verifiedAt,
        apiKeyEnv: preset.apiKeyEnv,
        models: models.map(({ model, state: ms }) => ({
          id: model.id, name: model.name, contextWindow: model.contextWindow, unverified: model.unverified === true,
          status: ms.status, ...ms.until === undefined ? {} : { until: ms.until }, requests: ms.usage.requests,
        })),
      }
    }),
  }
}

/** Fetch-style resource for the dsh web server. */
export function statusResource(build: () => StatusReport): (request: Request) => Promise<Response> {
  return async () => new Response(JSON.stringify(build()), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
