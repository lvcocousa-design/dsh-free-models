import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { failAfter, failBefore, finishOf, ok, setup, settings } from './harness.ts'

const text = (chunks: StreamChunk[]): string => chunks.flatMap(chunk => chunk.type === 'text-delta' ? [chunk.text] : []).join('')
const kind = (chunks: StreamChunk[]): string | undefined => {
  const finish = finishOf(chunks)
  return finish?.type === 'finish' ? finish.reason.kind : undefined
}
const failureOf = (chunks: StreamChunk[]) => {
  const finish = finishOf(chunks)
  return finish?.type === 'finish' && 'failure' in finish.reason ? finish.reason.failure : undefined
}

describe('free-auto routing', () => {
  it('serves the request from the first available entry and passes chunks through', async () => {
    const t = await setup()
    t.providers.script('google', ok('from google'))
    const chunks = await t.run()
    expect(text(chunks)).toBe('from google')
    expect(kind(chunks)).toBe('stop')
    expect(t.providers.callsTo('google')).toHaveLength(1)
    expect(t.providers.callsTo('openrouter')).toHaveLength(0)
    expect(t.providers.callsTo('google')[0]?.model).toBe('gemini-4-hydrogen')
  })

  it('switches to the next provider when the first refuses before any output', async () => {
    const t = await setup()
    t.providers.script('google', failBefore('RATE_LIMIT', 'Quota exceeded: requests per day', { status: 429 }))
    t.providers.script('openrouter', ok('from openrouter'))
    const chunks = await t.run()
    expect(text(chunks)).toBe('from openrouter')
    expect(kind(chunks)).toBe('stop')
    // The refused attempt's usage chunk is not leaked into the reply.
    expect(chunks.filter(chunk => chunk.type === 'usage')).toHaveLength(1)
    expect(t.events.map(event => event.type)).toEqual(['failure', 'switch', 'success'])
  })

  it('remembers an exhausted provider and skips it on the next request until it resets', async () => {
    const t = await setup()
    t.providers.script('google', failBefore('QUOTA', 'quota exhausted'))
    t.providers.script('openrouter', ok('o1'))
    await t.run()
    t.providers.script('google', ok('g'))
    t.providers.script('openrouter', ok('o2'))
    expect(text(await t.run())).toBe('o2')
    expect(t.providers.callsTo('google')).toHaveLength(1)
    // 2026-11-21 08:00Z is Pacific midnight.
    t.advance(Date.parse('2026-11-21T08:00:00Z') - Date.parse('2026-11-20T10:00:00Z'))
    expect(text(await t.run())).toBe('g')
  })

  it('does not switch after output has started, and surfaces the failure', async () => {
    const t = await setup()
    t.providers.script('google', failAfter('TRANSPORT', 'connection reset'))
    t.providers.script('openrouter', ok('should not be used'))
    const chunks = await t.run()
    expect(text(chunks)).toBe('partial')
    expect(kind(chunks)).toBe('error')
    expect(failureOf(chunks)?.code).toBe('TRANSPORT')
    expect(t.providers.callsTo('openrouter')).toHaveLength(0)
  })

  it('emits usage before finish and nothing after', async () => {
    const t = await setup()
    t.providers.script('google', ok())
    const types = (await t.run()).map(chunk => chunk.type)
    expect(types.at(-1)).toBe('finish')
    expect(types.indexOf('usage')).toBeLessThan(types.indexOf('finish'))
    expect(types.filter(type => type === 'finish')).toHaveLength(1)
  })

  it('reports an exhausted chain as a QUOTA error carrying the earliest recovery', async () => {
    const t = await setup()
    t.providers.script('google', failBefore('QUOTA', 'quota exhausted'))
    t.providers.script('openrouter', failBefore('RATE_LIMIT', 'free-models-per-day limit', { status: 429 }))
    t.providers.script('mistral', failBefore('QUOTA', 'quota exhausted'))
    const chunks = await t.run()
    expect(kind(chunks)).toBe('error')
    const failure = failureOf(chunks)
    expect(failure?.code).toBe('QUOTA')
    expect(failure?.message).toContain('Earliest recovery')
    expect(failure?.message).toContain('google/gemini-4-hydrogen')
    expect(failure?.message).toContain('openrouter/')
    expect(failure?.providerRetryAfterMs).toBeGreaterThan(0)
    expect(t.events.at(-1)?.type).toBe('exhausted')
  })

  it('reports a short-lived exhaustion as RATE_LIMIT so the loop retries', async () => {
    const t = await setup()
    for (const route of ['google', 'openrouter', 'mistral']) {
      t.providers.script(route, failBefore('RATE_LIMIT', 'Too many requests', { status: 429, providerRetryAfterMs: 4000 }))
    }
    const failure = failureOf(await t.run())
    expect(failure?.code).toBe('RATE_LIMIT')
    expect(failure?.providerRetryAfterMs).toBe(4000)
  })

  it('treats an auth failure as a route-wide disable', async () => {
    const t = await setup(settings({
      chain: [
        { route: 'google', model: 'gemini-4-hydrogen', enabled: true },
        { route: 'google', model: 'gemini-3.8-flash', enabled: true },
        { route: 'mistral', model: 'mistral-small-latest', enabled: true },
      ],
    }))
    t.providers.script('google', failBefore('AUTH', 'bad key', { status: 401 }))
    t.providers.script('mistral', ok('m'))
    expect(text(await t.run())).toBe('m')
    // The second google entry was never tried: a bad key breaks every model on the route.
    expect(t.providers.callsTo('google')).toHaveLength(1)
    expect(t.tracker.state('google').status).toBe('disabled')
  })

  it('keeps quota per model on Gemini: one exhausted model does not block its sibling', async () => {
    const t = await setup(settings({
      chain: [
        { route: 'google', model: 'gemini-4-hydrogen', enabled: true },
        { route: 'google', model: 'gemini-3.8-flash', enabled: true },
      ],
    }))
    t.providers.script('google', failBefore('QUOTA', 'quota'), ok('flash'))
    expect(text(await t.run())).toBe('flash')
    expect(t.providers.callsTo('google').map(call => call.model)).toEqual(['gemini-4-hydrogen', 'gemini-3.8-flash'])
  })

  it('skips an entry for this request only when it cannot honor an option', async () => {
    const t = await setup()
    t.providers.script('google', failBefore('UNSUPPORTED_OPTION', 'stop is not supported'))
    t.providers.script('openrouter', ok('o'))
    expect(text(await t.run({ stop: ['END'] }))).toBe('o')
    expect(t.tracker.state('google').status).toBe('ok')
  })

  it('stops with an abort result when the signal fires', async () => {
    const t = await setup()
    t.providers.script('google', { hang: true })
    const controller = new AbortController()
    const pending = t.run({ signal: controller.signal })
    setTimeout(() => controller.abort(), 10)
    const chunks = await pending
    expect(kind(chunks)).toBe('aborted')
    expect(t.providers.callsTo('openrouter')).toHaveLength(0)
  })

  it('does not forward a reasoning effort that belongs to the virtual model', async () => {
    const t = await setup()
    t.providers.script('google', ok())
    await t.run({ reasoningEffort: 'high' as never })
    expect(t.providers.callsTo('google')[0]?.reasoningEffort).toBeUndefined()
  })

  it('sticky policy stays on the entry that last worked', async () => {
    const t = await setup(settings({ switchPolicy: 'sticky' }))
    t.providers.script('google', failBefore('RATE_LIMIT', 'rl', { providerRetryAfterMs: 1000 }))
    t.providers.script('openrouter', ok('o1'), ok('o2'))
    await t.run()
    t.advance(2000) // google is available again
    t.providers.script('google', ok('g'))
    expect(text(await t.run())).toBe('o2')
    const priority = await setup(settings({ switchPolicy: 'priority' }))
    priority.providers.script('google', failBefore('RATE_LIMIT', 'rl', { providerRetryAfterMs: 1000 }))
    priority.providers.script('openrouter', ok('o1'))
    await priority.run()
    priority.advance(2000)
    priority.providers.script('google', ok('g'))
    expect(text(await priority.run())).toBe('g')
  })
})

describe('no-billing guard', () => {
  it('never calls a model without the :free suffix on OpenRouter', async () => {
    const t = await setup(settings({ chain: [{ route: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b', enabled: true }] }))
    t.providers.script('openrouter', ok('paid!'))
    const failure = failureOf(await t.run())
    expect(failure?.code).toBe('INVALID_CONFIG')
    expect(t.providers.callsTo('openrouter')).toHaveLength(0)
  })

  it('never calls Gemini models Google lists as not free', async () => {
    const t = await setup(settings({ chain: [{ route: 'google', model: 'gemini-4-carbon', enabled: true }] }))
    t.providers.script('google', ok('paid!'))
    expect(failureOf(await t.run())?.code).toBe('INVALID_CONFIG')
    expect(t.providers.callsTo('google')).toHaveLength(0)
  })

  it('refuses routes whose account billing was not confirmed', async () => {
    const t = await setup(settings({ confirm: [] }))
    t.providers.script('google', ok('g'))
    t.providers.script('openrouter', ok('o'))
    // Google and Mistral are unconfirmed; OpenRouter :free rejects at the limit so it needs no confirmation.
    expect(text(await t.run())).toBe('o')
    expect(t.providers.callsTo('google')).toHaveLength(0)
    expect(t.providers.callsTo('mistral')).toHaveLength(0)
  })

  it('applies a settings change on the very next request', async () => {
    const t = await setup(settings({ confirm: [] }))
    t.providers.script('google', ok('g'))
    t.providers.script('openrouter', ok('o'))
    expect(text(await t.run())).toBe('o')
    t.state.settings = settings({ confirm: ['google'] })
    expect(text(await t.run())).toBe('g')
  })

  it('disables a route for good if the provider asks for payment', async () => {
    const t = await setup()
    t.providers.script('google', failBefore('HTTP_402', 'payment required', { status: 402 }))
    t.providers.script('openrouter', ok('o'))
    expect(text(await t.run())).toBe('o')
    t.advance(30 * 86_400_000)
    expect(t.tracker.state('google').status).toBe('disabled')
  })

  it('skips providers that train on free-tier data for sensitive requests', async () => {
    const t = await setup(settings({ sensitive: true }))
    t.providers.script('google', ok('g'))
    const failure = failureOf(await t.run())
    // Every shipped preset may use free-tier data, so a sensitive request has nowhere to go.
    expect(failure).toBeDefined()
    expect(t.providers.calls).toHaveLength(0)
  })
})

describe('tools and context requirements', () => {
  it('reports the smallest context window in the usable chain', async () => {
    const t = await setup()
    const info = await t.router.resolveModel('free-auto', 'auto')
    // google 1M, openrouter nemotron 1M, mistral-small 128k -> 128k
    expect(info.context?.contextWindow).toBe(128_000)
  })

  it('drops the context bound when the small model leaves the chain', async () => {
    const t = await setup(settings({ chain: [{ route: 'google', model: 'gemini-4-hydrogen', enabled: true }] }))
    expect((await t.router.resolveModel('free-auto', 'auto')).context?.contextWindow).toBe(1_000_000)
  })

  it('advertises auto first', async () => {
    const t = await setup()
    expect((await t.router.listModels('free-auto')).map(model => model.id)[0]).toBe('auto')
  })
})

describe('cross-provider history', () => {
  it('gives a provider its own replay state back and strips other providers', async () => {
    const t = await setup()
    t.providers.script('google', ok('first', { sig: 'google-signature' }))
    const first = await t.run()
    const finish = finishOf(first)
    expect(finish?.type === 'finish' && finish.replayState?.response).toMatchObject({ dshFreeModels: { route: 'google', model: 'gemini-4-hydrogen' } })
    const replay = finish?.type === 'finish' ? finish.replayState : undefined

    const assistant = createAssistantMessage({
      content: [{ type: 'text', text: 'first' }],
      source: { provider: 'free-auto', model: 'auto', replayState: replay },
    })
    const user = createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } } as never)

    // Next turn lands on google again: it receives its own signature, unwrapped.
    t.providers.script('google', ok('second'))
    await t.run({ messages: [user, assistant, user] })
    const toGoogle = t.providers.callsTo('google').at(-1)?.messages.find(message => message.role === 'assistant')
    expect(toGoogle && 'source' in toGoogle && toGoogle.source).toMatchObject({ provider: 'google', model: 'gemini-4-hydrogen', replayState: { response: { sig: 'google-signature' } } })

    // Google refuses this time; OpenRouter must get plain content, with no foreign signature.
    t.providers.script('google', failBefore('QUOTA', 'quota'))
    t.providers.script('openrouter', ok('third'))
    await t.run({ messages: [user, assistant, user] })
    const toOpenRouter = t.providers.callsTo('openrouter').at(-1)?.messages.find(message => message.role === 'assistant')
    const source = toOpenRouter && 'source' in toOpenRouter ? toOpenRouter.source : undefined
    expect(source).toMatchObject({ kind: 'model', provider: 'google' })
    expect(source && 'replayState' in source).toBe(false)
  })
})

describe('status report', () => {
  it('reports usage and exhaustion without leaking anything but counters', async () => {
    const { buildStatus } = await import('../src/status.ts')
    const { PRESETS } = await import('@dsh-free-models/presets')
    const t = await setup()
    t.providers.script('google', failBefore('QUOTA', 'quota'))
    t.providers.script('openrouter', ok('o'))
    await t.run()
    const report = buildStatus('free-auto', PRESETS, t.tracker, Date.now())
    const google = report.providers.find(p => p.route === 'google')
    const gModel = google?.models.find(m => m.id === 'gemini-4-hydrogen')
    expect(gModel?.status).toBe('exhausted')
    expect(google?.status).toBe('ok') // sibling Gemini models still have quota
    const openrouter = report.providers.find(p => p.route === 'openrouter')
    expect(gModel?.until).toBeGreaterThan(0)
    expect(openrouter?.usage.requests).toBe(1)
    expect(JSON.stringify(report)).not.toMatch(/sk-|AIza|Bearer/)
  })
})

describe('same route, different model', () => {
  it('does not hand one Gemini model another model\'s signature', async () => {
    const t = await setup(settings({
      chain: [
        { route: 'google', model: 'gemini-4-hydrogen', enabled: true },
        { route: 'google', model: 'gemini-3.8-flash', enabled: true },
      ],
    }))
    t.providers.script('google', ok('first', { sig: 'A' }))
    const finish = finishOf(await t.run())
    const replay = finish?.type === 'finish' ? finish.replayState : undefined
    const assistant = createAssistantMessage({ content: [{ type: 'text', text: 'first' }], source: { provider: 'free-auto', model: 'auto', replayState: replay } })
    const user = createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } } as never)
    t.providers.script('google', failBefore('QUOTA', 'quota'), ok('second'))
    await t.run({ messages: [user, assistant, user] })
    const [toA, toB] = t.providers.callsTo('google').slice(-2)
    const own = toA?.messages.find(m => m.role === 'assistant')
    const other = toB?.messages.find(m => m.role === 'assistant')
    expect(own && 'source' in own && own.source).toMatchObject({ model: 'gemini-4-hydrogen', replayState: { response: { sig: 'A' } } })
    expect(other && 'source' in other && 'replayState' in other.source).toBe(false)
  })
})

describe('re-enabling a disabled route', () => {
  it('retries an auth-disabled route after the retry window without a restart', async () => {
    const t = await setup()
    t.providers.script('google', failBefore('AUTH', 'bad key', { status: 401 }))
    t.providers.script('openrouter', ok('o'))
    await t.run()
    expect(t.tracker.state('google').status).toBe('disabled')
    t.advance(61 * 60_000)
    t.providers.script('google', ok('g'))
    expect(text(await t.run())).toBe('g')
  })

  it('resetRoute clears a payment-disabled route and its per-model keys', async () => {
    const t = await setup()
    t.tracker.recordFailure('google', 'billing', { code: 'HTTP_402' })
    t.tracker.recordFailure('google/gemini-4-hydrogen', 'quota-daily', { code: 'QUOTA' })
    t.advance(30 * 86_400_000)
    expect(t.tracker.state('google').status).toBe('disabled')
    t.tracker.resetRoute('google')
    expect(t.tracker.state('google').status).toBe('ok')
    expect(t.tracker.state('google/gemini-4-hydrogen').status).toBe('ok')
  })

  it('reset endpoint needs the header, refuses other origins and unknown routes', async () => {
    const { resetResource } = await import('../src/status.ts')
    const cleared: string[] = []
    const serve = resetResource(route => route === 'google', route => { cleared.push(route) })
    const post = (headers: Record<string, string>, body: unknown) => serve(new Request('http://localhost:3000/free-models/reset', { method: 'POST', headers: { host: 'localhost:3000', ...headers }, body: JSON.stringify(body) }))
    expect((await post({}, { route: 'google' })).status).toBe(403)
    expect((await post({ 'x-free-models': '1', origin: 'http://evil.example' }, { route: 'google' })).status).toBe(403)
    expect((await post({ 'x-free-models': '1' }, { route: 'nope' })).status).toBe(400)
    expect(cleared).toEqual([])
    expect((await post({ 'x-free-models': '1', origin: 'http://localhost:3000' }, { route: 'google' })).status).toBe(200)
    expect(cleared).toEqual(['google'])
    expect((await serve(new Request('http://localhost:3000/free-models/reset'))).status).toBe(405)
  })
})

const errorText = (chunks: StreamChunk[]): string => failureOf(chunks)?.message ?? ''

describe('picking one model by name', () => {
  it('lists auto plus each free preset model, and never a paid one', async () => {
    const t = await setup()
    const models = await t.ctx.llm.listModels('free-auto')
    const ids = models.map(model => model.id)
    expect(ids[0]).toBe('auto')
    expect(ids).toContain('zhipu/glm-4.7-flash')
    expect(ids).toContain('zhipu-intl/glm-4.7-flash')
    expect(ids).not.toContain('zhipu/glm-5.3-flash')
    expect(ids).not.toContain('zhipu/glm-4.7-flashx')
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('calls only that model, even when it is off in the chain, and does not fall back', async () => {
    const t = await setup()
    t.providers.script('zhipu', ok('from zhipu'))
    // zhipu is not in the test chain at all, so this also shows `enabled` and the chain are ignored.
    const chunks = await t.run({ model: 'zhipu/glm-4.7-flash' })
    expect(text(chunks)).toBe('from zhipu')
    expect(t.providers.callsTo('zhipu')[0]?.model).toBe('glm-4.7-flash')
    expect(t.providers.callsTo('google')).toHaveLength(0)
  })

  it('reports the failure instead of switching when the chosen model is out of quota', async () => {
    const t = await setup()
    t.providers.script('google', failBefore('QUOTA', 'quota exhausted'))
    t.providers.script('openrouter', ok('should not be used'))
    expect(failureOf(await t.run({ model: 'google/gemini-4-hydrogen' }))?.code).toMatch(/QUOTA|RATE_LIMIT/)
    expect(t.providers.callsTo('openrouter')).toHaveLength(0)
  })

  it('refuses a paid model before any request leaves', async () => {
    const t = await setup()
    t.providers.script('zhipu', ok('no'))
    expect(errorText(await t.run({ model: 'zhipu-intl/glm-4.7-flashx' }))).toMatch(/paid model/)
    expect(errorText(await t.run({ model: 'zhipu/glm-4.7-flashx' }))).toMatch(/not on the free-tier list/)
    expect(errorText(await t.run({ model: 'zhipu/GLM-5.3-Flash' }))).toMatch(/paid model/)
    expect(t.providers.callsTo('zhipu')).toHaveLength(0)
  })

  it('refuses a model that is not on the free list, and an id that is not route/model', async () => {
    const t = await setup()
    expect(errorText(await t.run({ model: 'google/some-paid-model' }))).toMatch(/not on the free-tier list/)
    expect(errorText(await t.run({ model: 'nonsense' }))).toMatch(/no model/)
    expect(t.providers.calls).toHaveLength(0)
  })

  it('still needs confirmedNoBilling for routes that depend on account billing', async () => {
    const t = await setup(settings({ confirm: [] }))
    t.providers.script('google', ok('no'))
    expect(errorText(await t.run({ model: 'google/gemini-4-hydrogen' }))).toMatch(/confirm the account has no paid plan/)
    expect(t.providers.callsTo('google')).toHaveLength(0)
  })

  it('keeps openrouter ids that contain slashes and only allows :free ones', async () => {
    const t = await setup()
    t.providers.script('openrouter', ok('or'))
    const id = 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free'
    expect(text(await t.run({ model: id }))).toBe('or')
    expect(t.providers.callsTo('openrouter')[0]?.model).toBe('nvidia/nemotron-3-ultra-550b-a55b:free')
    expect(errorText(await t.run({ model: 'openrouter/some/model' }))).toMatch(/./)
  })

  it('names the credential when the route has no adapter', async () => {
    const t = await setup()
    expect(errorText(await t.run({ model: 'modelscope/Qwen/Qwen3.5-27B' }))).toMatch(/credential/i)
  })

  it('still honors the sensitive-requests switch for a chosen model', async () => {
    const t = await setup(settings({ sensitive: true }))
    t.providers.script('nvidia', ok('no'))
    expect(errorText(await t.run({ model: 'nvidia/nvidia/nemotron-3-ultra-550b-a55b' }))).toMatch(/improve its products/)
    expect(t.providers.callsTo('nvidia')).toHaveLength(0)
  })
})
