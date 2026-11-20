import { describe, expect, it } from 'vitest'
import {
  QuotaTracker, checkEntry, classifyFailure, nextDailyReset, quotaKey, selectCandidates,
} from '../src/index.ts'
import type { GuardSettings, ProviderPreset } from '../src/index.ts'

const iso = (value: string): number => Date.parse(value)

describe('classifyFailure', () => {
  it.each([
    [{ code: 'QUOTA', message: 'quota exceeded' }, 'quota-daily'],
    [{ code: 'RATE_LIMIT', message: 'Too many requests' }, 'rate-minute'],
    [{ code: 'HTTP_429', message: 'Rate limit exceeded: free-models-per-day' }, 'quota-daily'],
    [{ code: 'RATE_LIMIT', message: 'Quota exceeded for metric: requests per minute' }, 'rate-minute'],
    [{ code: 'RATE_LIMIT', message: 'RESOURCE_EXHAUSTED' }, 'quota-daily'],
    [{ code: 'HTTP_402', message: 'payment required' }, 'billing'],
    [{ code: 'RATE_LIMIT', message: 'Insufficient credits, add credits' }, 'billing'],
    [{ code: 'ACCOUNT_QUOTA' }, 'billing'],
    [{ code: 'AUTH' }, 'auth'],
    [{ code: 'MISSING_CREDENTIAL' }, 'auth'],
    [{ code: 'HTTP_403' }, 'auth'],
    [{ code: 'UNSUPPORTED_OPTION' }, 'unsupported'],
    [{ code: 'UNKNOWN_MODEL' }, 'unsupported'],
    [{ code: 'SERVER', status: 503 }, 'transient'],
    [{ code: 'TIMEOUT' }, 'transient'],
    [{ code: 'CONTEXT_WINDOW_EXCEEDED' }, 'context'],
    [{ code: 'ABORTED' }, 'aborted'],
    [{ code: 'SOMETHING_ELSE' }, 'fatal'],
  ] as const)('%j -> %s', (facts, expected) => {
    expect(classifyFailure(facts)).toBe(expected)
  })

  it('treats billing as stronger than quota', () => {
    expect(classifyFailure({ code: 'QUOTA', message: 'insufficient credits' })).toBe('billing')
  })
})

describe('daily reset times', () => {
  it('Pacific midnight in winter (UTC-8)', () => {
    expect(nextDailyReset('pacific-midnight', iso('2026-11-20T09:44:00Z'))).toBe(iso('2026-11-21T08:00:00Z'))
  })
  it('Pacific midnight in summer (UTC-7)', () => {
    expect(nextDailyReset('pacific-midnight', iso('2026-07-01T12:00:00Z'))).toBe(iso('2026-07-02T07:00:00Z'))
  })
  it('crosses the spring-forward boundary', () => {
    // 01:00 PST on Mar 8 2026; DST starts at 02:00 local that day. Next midnight is Mar 9 00:00 PDT.
    expect(nextDailyReset('pacific-midnight', iso('2026-03-08T09:00:00Z'))).toBe(iso('2026-03-09T07:00:00Z'))
  })
  it('crosses the fall-back boundary', () => {
    expect(nextDailyReset('pacific-midnight', iso('2026-11-01T08:00:00Z'))).toBe(iso('2026-11-02T08:00:00Z'))
  })
  it('exactly at Pacific midnight rolls to the next day', () => {
    expect(nextDailyReset('pacific-midnight', iso('2026-11-21T08:00:00Z'))).toBe(iso('2026-11-22T08:00:00Z'))
  })
  it('UTC midnight', () => {
    expect(nextDailyReset('utc-midnight', iso('2026-11-20T23:59:59Z'))).toBe(iso('2026-11-21T00:00:00Z'))
  })
  it('unknown policy assumes 24 hours', () => {
    expect(nextDailyReset('unknown', 1000)).toBe(1000 + 86_400_000)
  })
})

describe('QuotaTracker', () => {
  const make = (start: string) => {
    let now = iso(start)
    const tracker = new QuotaTracker([
      { route: 'g', resetPolicy: 'pacific-midnight', limits: {} },
      { route: 'o', resetPolicy: 'utc-midnight', limits: { requestsPerMinute: 20, requestsPerDay: 50 } },
    ], { clock: () => now })
    return { tracker, advance: (ms: number) => { now += ms }, set: (value: string) => { now = iso(value) } }
  }

  it('exhausts a route on a daily quota failure and recovers at the reset', () => {
    const { tracker, set } = make('2026-11-20T10:00:00Z')
    tracker.recordFailure('g', 'quota-daily')
    expect(tracker.isAvailable('g')).toBe(false)
    expect(tracker.state('g').status).toBe('exhausted')
    set('2026-11-21T07:59:59Z')
    expect(tracker.isAvailable('g')).toBe(false)
    set('2026-11-21T08:00:00Z')
    expect(tracker.isAvailable('g')).toBe(true)
  })

  it('honors a longer Retry-After than the guessed reset', () => {
    const { tracker, set } = make('2026-11-20T10:00:00Z')
    tracker.recordFailure('g', 'quota-daily', { code: 'QUOTA', providerRetryAfterMs: 30 * 3_600_000 })
    set('2026-11-21T09:00:00Z')
    expect(tracker.isAvailable('g')).toBe(false)
  })

  it('cools a route on a minute limit using Retry-After, else the default', () => {
    const { tracker, advance } = make('2026-11-20T10:00:00Z')
    tracker.recordFailure('g', 'rate-minute', { code: 'RATE_LIMIT', providerRetryAfterMs: 5000 })
    expect(tracker.isAvailable('g')).toBe(false)
    advance(5000)
    expect(tracker.isAvailable('g')).toBe(true)
    tracker.recordFailure('g', 'rate-minute')
    advance(59_000)
    expect(tracker.isAvailable('g')).toBe(false)
    advance(1000)
    expect(tracker.isAvailable('g')).toBe(true)
  })

  it('disables a route for good on billing or auth failures', () => {
    const { tracker, advance } = make('2026-11-20T10:00:00Z')
    tracker.recordFailure('g', 'billing')
    advance(10 * 86_400_000)
    expect(tracker.state('g').status).toBe('disabled')
    expect(tracker.earliestRecovery(['g'])).toBeUndefined()
    tracker.reset('g')
    expect(tracker.isAvailable('g')).toBe(true)
  })

  it('stops at 80% of the daily request allowance, before the provider refuses', () => {
    const { tracker } = make('2026-11-20T10:00:00Z')
    for (let index = 0; index < 39; index++) tracker.recordRequest('o')
    // requests spread so the per-minute cap is not the reason; fake by checking status via daily only
    expect(tracker.state('o').usage.requests).toBe(39)
    // 39 < 40 (80% of 50). The per-minute cap of 20 has tripped, but the daily one has not.
    expect(tracker.state('o').reason).toBe('per-minute request cap reached')
    tracker.recordRequest('o')
    expect(tracker.state('o').status).toBe('exhausted')
    expect(tracker.state('o').reason).toBe('estimated allowance reached')
  })

  it('rolls the estimate over at the reset', () => {
    const { tracker, set } = make('2026-11-20T10:00:00Z')
    for (let index = 0; index < 40; index++) tracker.recordRequest('o')
    expect(tracker.isAvailable('o')).toBe(false)
    set('2026-11-21T00:00:00Z')
    expect(tracker.isAvailable('o')).toBe(true)
    expect(tracker.state('o').usage.requests).toBe(0)
  })

  it('a real refusal always beats the estimate', () => {
    const { tracker } = make('2026-11-20T10:00:00Z')
    tracker.recordRequest('o')
    tracker.recordFailure('o', 'quota-daily')
    expect(tracker.state('o').status).toBe('exhausted')
    expect(tracker.state('o').reason).toBe('daily allowance spent')
  })

  it('keys per model share the route config', () => {
    const { tracker } = make('2026-11-20T10:00:00Z')
    tracker.recordFailure('g/model-a', 'quota-daily')
    expect(tracker.isAvailable('g/model-a')).toBe(false)
    expect(tracker.isAvailable('g/model-b')).toBe(true)
  })

  it('reports the earliest recovery among routes', () => {
    const { tracker } = make('2026-11-20T10:00:00Z')
    tracker.recordFailure('g', 'quota-daily')
    tracker.recordFailure('o', 'rate-minute', { code: 'RATE_LIMIT', providerRetryAfterMs: 7000 })
    expect(tracker.earliestRecovery(['g', 'o'])).toBe(iso('2026-11-20T10:00:07Z'))
  })
})

const preset = (overrides: Partial<ProviderPreset> & Pick<ProviderPreset, 'route'>): ProviderPreset => ({
  displayName: overrides.route, apiKeyEnv: 'K', overage: 'reject', resetPolicy: 'utc-midnight', limits: {},
  quotaScope: 'route', models: [], billingNotice: '', trainsOnFreeTierData: false, keyUrl: '', docsUrl: '', verifiedAt: '2026-11-20',
  ...overrides,
})

const model = (id: string, extra: Partial<ProviderPreset['models'][number]> = {}) =>
  ({ id, name: id, contextWindow: 200_000, tools: true, reasoning: false, ...extra })

const presets = new Map<string, ProviderPreset>([
  ['free', preset({ route: 'free', models: [model('a'), model('small', { contextWindow: 8000 }), model('notools', { tools: false })] })],
  ['suffix', preset({ route: 'suffix', requiredModelSuffix: ':free', deniedModels: ['x:free-denied'] })],
  ['maybe', preset({ route: 'maybe', overage: 'depends-on-account-billing', models: [model('m')], trainsOnFreeTierData: true })],
  ['paid', preset({ route: 'paid', overage: 'bills', models: [model('p')] })],
])
const strict: GuardSettings = { forbidBillableCalls: true, confirmedNoBilling: new Set(), allowBilling: new Set() }

describe('checkEntry', () => {
  it('allows a listed free model on a rejecting route', () => {
    expect(checkEntry({ route: 'free', model: 'a' }, presets, strict).ok).toBe(true)
  })
  it('rejects an unlisted model where the free list is closed', () => {
    const verdict = checkEntry({ route: 'free', model: 'surprise' }, presets, strict)
    expect(verdict).toMatchObject({ ok: false, reason: 'not-free-model' })
  })
  it('requires the :free suffix and accepts hand-added suffixed models', () => {
    expect(checkEntry({ route: 'suffix', model: 'vendor/model' }, presets, strict)).toMatchObject({ ok: false, reason: 'missing-suffix' })
    expect(checkEntry({ route: 'suffix', model: 'vendor/model:free' }, presets, strict).ok).toBe(true)
  })
  it('blocks denied models even when they would otherwise pass', () => {
    expect(checkEntry({ route: 'suffix', model: 'x:free-denied' }, presets, strict)).toMatchObject({ ok: false, reason: 'denied-model' })
    const denied = new Map(presets)
    denied.set('d', preset({ route: 'd', deniedModels: ['gemini-4-carbon'], models: [model('gemini-4-carbon')] }))
    expect(checkEntry({ route: 'd', model: 'gemini-4-carbon' }, denied, strict)).toMatchObject({ ok: false, reason: 'denied-model' })
  })
  it('needs the no-billing confirmation where the account decides', () => {
    expect(checkEntry({ route: 'maybe', model: 'm' }, presets, strict)).toMatchObject({ ok: false, reason: 'billing-unconfirmed' })
    expect(checkEntry({ route: 'maybe', model: 'm' }, presets, { ...strict, confirmedNoBilling: new Set(['maybe']) }).ok).toBe(true)
  })
  it('never calls a billing route while the global switch is on, even if allowed per route', () => {
    const allowed = { ...strict, allowBilling: new Set(['paid']) }
    expect(checkEntry({ route: 'paid', model: 'p' }, presets, allowed)).toMatchObject({ ok: false, reason: 'may-bill' })
  })
  it('needs both the switch off and the per-route allowance to call a billing route', () => {
    expect(checkEntry({ route: 'paid', model: 'p' }, presets, { ...strict, forbidBillableCalls: false })).toMatchObject({ ok: false })
    expect(checkEntry({ route: 'paid', model: 'p' }, presets, { forbidBillableCalls: false, confirmedNoBilling: new Set(), allowBilling: new Set(['paid']) }).ok).toBe(true)
  })
  it('rejects an unknown route', () => {
    expect(checkEntry({ route: 'nope', model: 'a' }, presets, strict)).toMatchObject({ ok: false, reason: 'unknown-route' })
  })
})

describe('selectCandidates', () => {
  const tracker = () => new QuotaTracker([...presets.values()].map(p => ({ route: p.route, resetPolicy: p.resetPolicy, limits: p.limits })))
  const guard: GuardSettings = { forbidBillableCalls: true, confirmedNoBilling: new Set(['maybe']), allowBilling: new Set() }
  const chain = [
    { route: 'maybe', model: 'm', enabled: true },
    { route: 'free', model: 'a', enabled: true },
    { route: 'free', model: 'small', enabled: true },
    { route: 'free', model: 'notools', enabled: true },
    { route: 'paid', model: 'p', enabled: true },
    { route: 'suffix', model: 'v/m:free', enabled: false },
  ]

  it('keeps order and explains every skip', () => {
    const { candidates, skipped } = selectCandidates(chain, presets, tracker(), guard, { needsTools: true, minContext: 128_000 })
    expect(candidates.map(c => `${c.entry.route}/${c.entry.model}`)).toEqual(['maybe/m', 'free/a'])
    expect(skipped.map(s => [s.model, s.reason])).toEqual([
      ['small', 'small-context'], ['notools', 'no-tools'], ['p', 'guard'], ['v/m:free', 'disabled'],
    ])
  })

  it('skips routes by state and by exclusion', () => {
    const t = tracker()
    t.recordFailure('maybe', 'quota-daily')
    t.recordFailure('free', 'auth')
    const { candidates, skipped } = selectCandidates(chain.slice(0, 2), presets, t, guard, { needsTools: false, minContext: 0 })
    expect(candidates).toEqual([])
    expect(skipped.map(s => s.reason)).toEqual(['exhausted', 'route-disabled'])
    const excluded = selectCandidates(chain.slice(0, 2), presets, tracker(), guard, { needsTools: false, minContext: 0, exclude: new Set(['maybe/m']) })
    expect(excluded.candidates.map(c => c.entry.route)).toEqual(['free'])
  })

  it('skips providers that train on free-tier data when the request is sensitive', () => {
    const { candidates, skipped } = selectCandidates(chain.slice(0, 2), presets, tracker(), guard, { needsTools: false, minContext: 0, sensitive: true })
    expect(candidates.map(c => c.entry.route)).toEqual(['free'])
    expect(skipped[0]?.reason).toBe('trains-on-data')
  })

  it('tracks per-model quota separately when the preset says so', () => {
    const scoped = new Map(presets)
    scoped.set('free', { ...presets.get('free')!, quotaScope: 'model' })
    const t = new QuotaTracker([{ route: 'free', resetPolicy: 'utc-midnight', limits: {} }])
    t.recordFailure(quotaKey(scoped.get('free')!, 'a'), 'quota-daily')
    const result = selectCandidates([{ route: 'free', model: 'a', enabled: true }, { route: 'free', model: 'notools', enabled: true }], scoped, t, guard, { needsTools: false, minContext: 0 })
    expect(result.candidates.map(c => c.entry.model)).toEqual(['notools'])
  })
})
