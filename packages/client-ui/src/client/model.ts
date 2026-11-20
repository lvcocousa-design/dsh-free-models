/** Pure helpers behind the page. No React, no dsh services, so they are unit-tested directly. */

export interface ChainEntry { route: string; model: string; enabled: boolean }

export interface RouterConfigView {
  chain?: ChainEntry[]
  forbidBillableCalls?: boolean
  confirmedNoBilling?: Record<string, boolean>
  minContext?: number
  sensitiveRequests?: boolean
  switchPolicy?: 'priority' | 'sticky'
}

export interface ModelStatus { id: string; name: string; contextWindow: number; unverified: boolean; status: string; until?: number; requests: number }
export interface ProviderStatus {
  route: string; displayName: string; status: 'ok' | 'cooling' | 'exhausted' | 'disabled'; reason?: string; until?: number
  usage: { requests: number; tokens: number }
  limits: { requestsPerMinute?: number; requestsPerDay?: number; tokensPerMinute?: number; tokensPerDay?: number }
  overage: string; trainsOnFreeTierData: boolean; billingNotice: string; keyUrl: string; docsUrl: string; verifiedAt: string
  apiKeyEnv: string; models: ModelStatus[]
}
export interface StatusReport { route: string; generatedAt: number; providers: ProviderStatus[] }

export function move(chain: readonly ChainEntry[], index: number, delta: -1 | 1): ChainEntry[] {
  const target = index + delta
  if (index < 0 || index >= chain.length || target < 0 || target >= chain.length) return chain.map(entry => ({ ...entry }))
  const next = chain.map(entry => ({ ...entry }))
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item!)
  return next
}

export function toggle(chain: readonly ChainEntry[], index: number): ChainEntry[] {
  return chain.map((entry, i) => i === index ? { ...entry, enabled: !entry.enabled } : { ...entry })
}

export function remove(chain: readonly ChainEntry[], index: number): ChainEntry[] {
  return chain.filter((_, i) => i !== index).map(entry => ({ ...entry }))
}

export function add(chain: readonly ChainEntry[], route: string, model: string): ChainEntry[] {
  const copy = chain.map(entry => ({ ...entry }))
  if (copy.some(entry => entry.route === route && entry.model === model)) return copy
  return [...copy, { route, model, enabled: true }]
}

/** Turn every entry of one route on or off. Used for the "skip Gemini for sensitive code" switch. */
export function setRoute(chain: readonly ChainEntry[], route: string, enabled: boolean): ChainEntry[] {
  return chain.map(entry => entry.route === route ? { ...entry, enabled } : { ...entry })
}

export function routeEnabled(chain: readonly ChainEntry[], route: string): boolean {
  return chain.some(entry => entry.route === route && entry.enabled)
}

/** The page offers only models a preset lists, so a typo cannot put a billable id into the chain. */
export function addable(report: StatusReport | undefined, chain: readonly ChainEntry[]): { route: string; model: string; label: string }[] {
  if (!report) return []
  const present = new Set(chain.map(entry => `${entry.route}/${entry.model}`))
  return report.providers.flatMap(provider => provider.models
    .filter(model => !present.has(`${provider.route}/${model.id}`))
    .map(model => ({ route: provider.route, model: model.id, label: `${provider.displayName}: ${model.name}` })))
}

export function usageText(provider: ProviderStatus): string {
  const day = provider.limits.requestsPerDay
  return day === undefined ? `${provider.usage.requests}` : `${provider.usage.requests} / ${day}`
}

/** Share of the daily request allowance used, 0 to 1, or undefined when no daily cap is published. */
export function usageRatio(provider: ProviderStatus): number | undefined {
  const day = provider.limits.requestsPerDay
  return day === undefined || day <= 0 ? undefined : Math.min(1, provider.usage.requests / day)
}

export function untilText(until: number | undefined, now: number): string | undefined {
  if (until === undefined) return undefined
  const minutes = Math.max(1, Math.round((until - now) / 60_000))
  if (minutes < 90) return `${minutes} min`
  return `${Math.round(minutes / 60)} h`
}
