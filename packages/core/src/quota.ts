import { nextDailyReset } from './resets.ts'
import type { Clock, FailureClass, FailureFacts, FreeLimits, ResetPolicy, RouteState } from './types.ts'

export interface QuotaRouteConfig {
  route: string
  resetPolicy: ResetPolicy
  limits: FreeLimits
}

export interface QuotaOptions {
  clock?: Clock
  /** Stop using a route when estimated daily usage reaches this share of its published allowance. Default 0.8. */
  softLimitRatio?: number
  /** Cool-down after a per-minute limit when the provider gives no Retry-After. Default 60 s. */
  defaultRateCooldownMs?: number
  /** Cool-down after transient trouble. Default 15 s. */
  transientCooldownMs?: number
  /** How long an auth failure disables a route before it is tried again. Default 1 h. */
  authRetryMs?: number
}

const MINUTE = 60_000

/**
 * Tracks which routes may be called right now.
 *
 * It is the second line of defense. The first is the provider answering 429 once an
 * allowance is gone, which this tracker treats as authoritative: a refusal always
 * wins over the local estimate. The estimate only exists to stop earlier than the
 * provider would, with headroom, for tiers where overshooting could cost money.
 */
export class QuotaTracker {
  private readonly clock: Clock
  private readonly softLimitRatio: number
  private readonly defaultRateCooldownMs: number
  private readonly transientCooldownMs: number
  private readonly authRetryMs: number
  private readonly configs = new Map<string, QuotaRouteConfig>()
  private readonly states = new Map<string, RouteState>()
  private readonly minuteWindows = new Map<string, number[]>()

  constructor(routes: readonly QuotaRouteConfig[], options: QuotaOptions = {}) {
    this.clock = options.clock ?? Date.now
    this.softLimitRatio = options.softLimitRatio ?? 0.8
    this.defaultRateCooldownMs = options.defaultRateCooldownMs ?? MINUTE
    this.transientCooldownMs = options.transientCooldownMs ?? 15_000
    this.authRetryMs = options.authRetryMs ?? 3_600_000
    for (const route of routes) this.configs.set(route.route, route)
  }

  /** Replace the route set, keeping state for routes that remain. */
  configure(routes: readonly QuotaRouteConfig[]): void {
    this.configs.clear()
    for (const route of routes) this.configs.set(route.route, route)
    for (const key of [...this.states.keys()]) if (this.configFor(key) === undefined) this.states.delete(key)
  }

  state(route: string): RouteState {
    const now = this.clock()
    const state = this.ensure(route, now)
    this.rollWindow(state, now)
    if (state.status !== 'ok' && state.until !== undefined && now >= state.until) {
      state.status = 'ok'
      delete state.until
      delete state.reason
    }
    return { ...state, usage: { ...state.usage } }
  }

  /** True when the route may be called now. */
  isAvailable(route: string): boolean {
    return this.state(route).status === 'ok'
  }

  /** Earliest time any of `routes` is available again, or undefined if none will recover on its own. */
  earliestRecovery(routes: readonly string[]): number | undefined {
    let earliest: number | undefined
    for (const route of routes) {
      const state = this.state(route)
      if (state.status === 'ok') return this.clock()
      if (state.status === 'disabled' || state.until === undefined) continue
      if (earliest === undefined || state.until < earliest) earliest = state.until
    }
    return earliest
  }

  /**
   * Record a request about to be sent. Counting at send time, not at success, means a
   * request that fails midway still counts, which is how providers count it too.
   */
  recordRequest(route: string): void {
    const now = this.clock()
    const state = this.ensure(route, now)
    this.rollWindow(state, now)
    state.usage.requests += 1
    const window = (this.minuteWindows.get(route) ?? []).filter(stamp => now - stamp < MINUTE)
    window.push(now)
    this.minuteWindows.set(route, window)
    this.applySoftLimits(route, state, now)
  }

  /** Record tokens a finished request used. */
  recordUsage(route: string, tokens: number): void {
    const now = this.clock()
    const state = this.ensure(route, now)
    this.rollWindow(state, now)
    state.usage.tokens += Math.max(0, Math.trunc(tokens))
    this.applySoftLimits(route, state, now)
  }

  /** Record a failed attempt and set the route's cool-down accordingly. */
  recordFailure(route: string, failure: FailureClass, facts: FailureFacts = { code: 'UNKNOWN' }): RouteState {
    const now = this.clock()
    const state = this.ensure(route, now)
    switch (failure) {
      case 'quota-daily': {
        const reset = nextDailyReset(this.configFor(route)?.resetPolicy ?? 'unknown', now)
        // A Retry-After longer than the guessed reset wins: the provider knows better.
        const until = Math.max(reset, facts.providerRetryAfterMs === undefined ? 0 : now + facts.providerRetryAfterMs)
        this.mark(state, 'exhausted', until, 'daily allowance spent')
        break
      }
      case 'rate-minute':
        this.mark(state, 'cooling', now + (facts.providerRetryAfterMs ?? this.defaultRateCooldownMs), 'rate limited')
        break
      case 'transient':
        this.mark(state, 'cooling', now + (facts.providerRetryAfterMs ?? this.transientCooldownMs), 'transient provider error')
        break
      case 'billing':
        this.mark(state, 'disabled', undefined, 'provider asked for payment; disabled until re-enabled by hand')
        break
      case 'auth':
        // Retried after an hour so a corrected key works without a restart; a bad key just fails again.
        this.mark(state, 'disabled', now + this.authRetryMs, 'credential missing or invalid, or the route is not set up in dsh')
        break
      default:
        break
    }
    return this.state(route)
  }

  /** Clear a route's cool-down or disabled flag (user pressed "re-enable"). */
  reset(route: string): void {
    const state = this.ensure(route, this.clock())
    state.status = 'ok'
    delete state.until
    delete state.reason
  }

  /** Clear the route's flag and every per-model key under it (`route/model`). */
  resetRoute(route: string): void {
    for (const key of [...this.states.keys()]) {
      if (key === route || key.startsWith(`${route}/`)) this.reset(key)
    }
    this.reset(route)
  }

  /** State of every key seen so far plus every configured route. */
  snapshot(): RouteState[] {
    const keys = new Set<string>([...this.configs.keys(), ...this.states.keys()])
    return [...keys].sort().map(key => this.state(key))
  }

  /** Config for a key: exact match, else the route part of a `route/model` key. */
  private configFor(key: string): QuotaRouteConfig | undefined {
    return this.configs.get(key) ?? this.configs.get(key.split('/')[0] ?? key)
  }

  private ensure(route: string, now: number): RouteState {
    let state = this.states.get(route)
    if (state === undefined) {
      state = { route, status: 'ok', usage: { requests: 0, tokens: 0, windowStart: this.windowStart(route, now) } }
      this.states.set(route, state)
    }
    return state
  }

  /** The daily window started at the previous reset boundary, i.e. one day before the next reset. */
  private windowStart(route: string, now: number): number {
    const policy = this.configFor(route)?.resetPolicy ?? 'unknown'
    return policy === 'unknown' ? now : nextDailyReset(policy, now)
  }

  private rollWindow(state: RouteState, now: number): void {
    const policy = this.configFor(state.route)?.resetPolicy ?? 'unknown'
    if (policy === 'unknown') {
      if (now - state.usage.windowStart >= 86_400_000) state.usage = { requests: 0, tokens: 0, windowStart: now }
      return
    }
    // windowStart stores the reset instant that ends the current window.
    if (now >= state.usage.windowStart) {
      state.usage = { requests: 0, tokens: 0, windowStart: nextDailyReset(policy, now) }
      this.minuteWindows.delete(state.route)
      if (state.status === 'exhausted' && state.reason === 'estimated allowance reached') {
        state.status = 'ok'
        delete state.until
        delete state.reason
      }
    }
  }

  private applySoftLimits(route: string, state: RouteState, now: number): void {
    const limits = this.configFor(route)?.limits ?? {}
    const ratio = this.softLimitRatio
    const resetAt = nextDailyReset(this.configFor(route)?.resetPolicy ?? 'unknown', now)
    if (limits.requestsPerDay !== undefined && state.usage.requests >= limits.requestsPerDay * ratio) {
      this.markIfWorse(state, 'exhausted', resetAt, 'estimated allowance reached')
    }
    if (limits.tokensPerDay !== undefined && state.usage.tokens >= limits.tokensPerDay * ratio) {
      this.markIfWorse(state, 'exhausted', resetAt, 'estimated allowance reached')
    }
    const window = this.minuteWindows.get(route) ?? []
    if (limits.requestsPerMinute !== undefined && window.length >= limits.requestsPerMinute) {
      const oldest = window[0] ?? now
      this.markIfWorse(state, 'cooling', oldest + MINUTE, 'per-minute request cap reached')
    }
  }

  private mark(state: RouteState, status: RouteState['status'], until: number | undefined, reason: string): void {
    state.status = status
    if (until === undefined) delete state.until
    else state.until = until
    state.reason = reason
  }

  /** Never downgrade a route already disabled or cooling for longer. */
  private markIfWorse(state: RouteState, status: 'cooling' | 'exhausted', until: number, reason: string): void {
    if (state.status === 'disabled') return
    if (state.status !== 'ok' && state.until !== undefined && state.until >= until) return
    this.mark(state, status, until, reason)
  }
}
