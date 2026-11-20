import { describe, expect, it } from 'vitest'
import { add, addable, move, remove, routeEnabled, setRoute, toggle, untilText, usageRatio } from '../src/client/model.ts'
import type { ProviderStatus, StatusReport } from '../src/client/model.ts'

const chain = [
  { route: 'google', model: 'a', enabled: true },
  { route: 'openrouter', model: 'b:free', enabled: true },
  { route: 'mistral', model: 'c', enabled: false },
]

describe('chain editing', () => {
  it('moves entries and ignores out-of-range moves without mutating', () => {
    expect(move(chain, 1, -1).map(e => e.route)).toEqual(['openrouter', 'google', 'mistral'])
    expect(move(chain, 0, -1).map(e => e.route)).toEqual(['google', 'openrouter', 'mistral'])
    expect(move(chain, 2, 1).map(e => e.route)).toEqual(['google', 'openrouter', 'mistral'])
    expect(chain[0]!.route).toBe('google')
  })
  it('toggles, removes and adds without duplicates', () => {
    expect(toggle(chain, 2)[2]!.enabled).toBe(true)
    expect(remove(chain, 0)).toHaveLength(2)
    expect(add(chain, 'google', 'a')).toHaveLength(3)
    expect(add(chain, 'groq', 'g').at(-1)).toEqual({ route: 'groq', model: 'g', enabled: true })
  })
  it('switches a whole route', () => {
    expect(routeEnabled(setRoute(chain, 'google', false), 'google')).toBe(false)
    expect(routeEnabled(chain, 'google')).toBe(true)
  })
})

describe('status helpers', () => {
  const provider = (over: Partial<ProviderStatus> = {}): ProviderStatus => ({
    route: 'openrouter', displayName: 'OR', status: 'ok', usage: { requests: 10, tokens: 0 }, limits: { requestsPerDay: 50 },
    overage: 'reject', trainsOnFreeTierData: true, billingNotice: '', keyUrl: '', docsUrl: '', verifiedAt: '', apiKeyEnv: 'K',
    models: [{ id: 'b:free', name: 'B', contextWindow: 1, unverified: false, status: 'ok', requests: 0 }, { id: 'd:free', name: 'D', contextWindow: 1, unverified: false, status: 'ok', requests: 0 }],
    ...over,
  })
  it('offers only preset models that are not in the chain', () => {
    const report: StatusReport = { route: 'free-auto', generatedAt: 0, providers: [provider()] }
    expect(addable(report, chain).map(o => o.model)).toEqual(['d:free'])
    expect(addable(undefined, chain)).toEqual([])
  })
  it('computes usage ratio and recovery text', () => {
    expect(usageRatio(provider())).toBeCloseTo(0.2)
    expect(usageRatio(provider({ limits: {} }))).toBeUndefined()
    expect(untilText(undefined, 0)).toBeUndefined()
    expect(untilText(30 * 60_000, 0)).toBe('30 min')
    expect(untilText(5 * 3_600_000, 0)).toBe('5 h')
  })
})
