import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { QuotaTracker } from '@dsh-free-models/core'
import { PRESETS, presetMap } from '@dsh-free-models/presets'
import { FREE_ROUTE, FreeRouterAdapter } from '../src/index.ts'
import { settings } from './harness.ts'

/**
 * Real dsh pi-ai adapter, real HTTP, local stand-ins for the providers. This pins the actual error codes
 * pi-ai produces for a provider's 429 against the router's classification.
 */
const servers: Server[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() })))
})

const textStream = (text: string): string => [
  { choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] },
  { choices: [{ delta: { content: text }, index: 0, finish_reason: null }] },
  { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } },
].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'

async function provider(handler: (count: number) => { status: number; body: string; sse?: boolean }): Promise<{ url: string; hits: () => number }> {
  let count = 0
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      count += 1
      const reply = handler(count)
      response.writeHead(reply.status, { 'content-type': reply.sse === true ? 'text/event-stream' : 'application/json' })
      response.end(reply.body)
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { url: `http://127.0.0.1:${port}`, hits: () => count }
}

async function build(urls: { openrouter: string; groq: string }) {
  vi.stubEnv('FM_OR_KEY', 'k1')
  vi.stubEnv('FM_GROQ_KEY', 'k2')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, {
    providers: {
      openrouter: { apiKeyEnv: 'FM_OR_KEY', baseURL: urls.openrouter },
      groq: { apiKeyEnv: 'FM_GROQ_KEY', baseURL: urls.groq },
    },
  })
  const router = new FreeRouterAdapter({
    stream: options => ctx.llm.stream(options),
    settings: () => settings({
      chain: [
        { route: 'openrouter', model: 'google/gemma-4-31b-it:free', enabled: true },
        { route: 'groq', model: 'openai/gpt-oss-120b', enabled: true },
      ],
      confirm: ['groq'],
    }),
    presets: presetMap(PRESETS),
    tracker: new QuotaTracker(PRESETS.map(p => ({ route: p.route, resetPolicy: p.resetPolicy, limits: p.limits }))),
  })
  ctx.llm.registerAdapter([FREE_ROUTE], router)
  const run = async (): Promise<StreamChunk[]> => {
    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({
      provider: FREE_ROUTE, model: 'auto',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } as never)],
    })) chunks.push(chunk)
    return chunks
  }
  return { ctx, run }
}

const text = (chunks: StreamChunk[]): string => chunks.flatMap(c => c.type === 'text-delta' ? [c.text] : []).join('')

describe('free-auto over the real pi-ai adapter', () => {
  it('moves to the next provider when the first answers HTTP 429, and remembers it', async () => {
    const limited = await provider(() => ({ status: 429, body: JSON.stringify({ error: { message: 'Rate limit exceeded: free-models-per-day' } }) }))
    const working = await provider(() => ({ status: 200, body: textStream('from groq'), sse: true }))
    const { ctx, run } = await build({ openrouter: limited.url, groq: working.url })
    try {
      expect(text(await run())).toBe('from groq')
      expect(limited.hits()).toBe(1)
      // Daily exhaustion is remembered: the second request does not touch the first provider again.
      expect(text(await run())).toBe('from groq')
      expect(limited.hits()).toBe(1)
      expect(working.hits()).toBe(2)
    } finally { await ctx.fiber.dispose() }
  })

  it('shows an invalid-request error as is instead of replaying it on every provider', async () => {
    const bad = await provider(() => ({ status: 400, body: JSON.stringify({ error: { message: 'bad request' } }) }))
    const other = await provider(() => ({ status: 200, body: textStream('unused'), sse: true }))
    const { ctx, run } = await build({ openrouter: bad.url, groq: other.url })
    try {
      const finish = (await run()).at(-1)
      expect(finish).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_REQUEST' } } })
      expect(bad.hits()).toBe(1)
      expect(other.hits()).toBe(0)
    } finally { await ctx.fiber.dispose() }
  })

  it('reports an exhausted chain as a quota or rate-limit error with a recovery time', async () => {
    const a = await provider(() => ({ status: 429, body: JSON.stringify({ error: { message: 'free-models-per-day exceeded' } }) }))
    const b = await provider(() => ({ status: 429, body: JSON.stringify({ error: { message: 'Rate limit reached for requests per day (RPD)' } }) }))
    const { ctx, run } = await build({ openrouter: a.url, groq: b.url })
    try {
      const finish = (await run()).at(-1)
      const error = finish?.type === 'finish' && finish.reason.kind === 'error' ? finish.reason.failure : undefined
      expect(error?.code).toBe('QUOTA')
      expect(error?.message).toContain('Earliest recovery')
      expect(error?.providerRetryAfterMs).toBeGreaterThan(0)
    } finally { await ctx.fiber.dispose() }
  })

  describe('zhipu (China) and zhipu-intl as hand-declared pi-ai routes', () => {
    async function buildBoth(cn: string, intl: string, orUrl: string) {
      vi.stubEnv('FM_OR_KEY', 'k1'); vi.stubEnv('FM_CN_KEY', 'k2'); vi.stubEnv('FM_INTL_KEY', 'k3')
      const ctx = new Context()
      await ctx.plugin(LlmRuntime)
      const declared = (key: string, url: string) => ({
        apiKeyEnv: key, api: 'openai-completions', baseURL: url,
        models: [{ id: 'glm-4.7-flash', name: 'GLM-4.7-Flash', contextWindow: 200000 }],
      })
      await ctx.plugin(LlmPiAi, { providers: { openrouter: { apiKeyEnv: 'FM_OR_KEY', baseURL: orUrl }, zhipu: declared('FM_CN_KEY', cn), 'zhipu-intl': declared('FM_INTL_KEY', intl) } })
      const router = new FreeRouterAdapter({
        stream: options => ctx.llm.stream(options),
        settings: () => settings({
          chain: [
            { route: 'zhipu', model: 'glm-4.7-flash', enabled: true },
            { route: 'zhipu-intl', model: 'glm-4.7-flash', enabled: true },
            { route: 'openrouter', model: 'google/gemma-4-31b-it:free', enabled: true },
          ],
        }),
        presets: presetMap(PRESETS),
        tracker: new QuotaTracker(PRESETS.map(p => ({ route: p.route, resetPolicy: p.resetPolicy, limits: p.limits }))),
      })
      ctx.llm.registerAdapter([FREE_ROUTE], router)
      const run = async (): Promise<StreamChunk[]> => {
        const chunks: StreamChunk[] = []
        for await (const chunk of ctx.llm.stream({
          provider: FREE_ROUTE, model: 'auto',
          messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } as never)],
        })) chunks.push(chunk)
        return chunks
      }
      return { ctx, run }
    }
    const limited = () => ({ status: 429, body: JSON.stringify({ error: { code: '1302', message: 'Rate limit reached for requests' } }) })
    const fine = (name: string) => () => ({ status: 200, body: textStream(name), sse: true })

    it('falls back from the China route to the international route, and only then to OpenRouter', async () => {
      const cn = await provider(limited)
      const intl = await provider(fine('from intl'))
      const or = await provider(fine('from openrouter'))
      const { ctx, run } = await buildBoth(cn.url, intl.url, or.url)
      try {
        expect(text(await run())).toBe('from intl')
        expect(cn.hits()).toBe(1)
        expect(or.hits()).toBe(0)
      } finally { await ctx.fiber.dispose() }
    })

    it('reaches OpenRouter when both Zhipu routes refuse', async () => {
      const cn = await provider(limited)
      const intl = await provider(limited)
      const or = await provider(fine('from openrouter'))
      const { ctx, run } = await buildBoth(cn.url, intl.url, or.url)
      try {
        expect(text(await run())).toBe('from openrouter')
        expect([cn.hits(), intl.hits()]).toEqual([1, 1])
      } finally { await ctx.fiber.dispose() }
    })
  })

  describe('zhipu as a hand-declared pi-ai route', () => {
    async function buildZhipu(zhipuUrl: string | undefined, orUrl: string) {
      vi.stubEnv('FM_OR_KEY', 'k1')
      vi.stubEnv('FM_ZHIPU_KEY', 'k3')
      const ctx = new Context()
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(LlmPiAi, {
        providers: {
          openrouter: { apiKeyEnv: 'FM_OR_KEY', baseURL: orUrl },
          ...zhipuUrl === undefined ? {} : {
            zhipu: {
              apiKeyEnv: 'FM_ZHIPU_KEY', api: 'openai-completions', baseURL: zhipuUrl,
              models: [{ id: 'glm-4.7-flash', name: 'GLM-4.7-Flash', contextWindow: 200000 }],
            },
          },
        },
      })
      const router = new FreeRouterAdapter({
        stream: options => ctx.llm.stream(options),
        settings: () => settings({
          chain: [
            { route: 'zhipu', model: 'glm-4.7-flash', enabled: true },
            { route: 'openrouter', model: 'google/gemma-4-31b-it:free', enabled: true },
          ],
        }),
        presets: presetMap(PRESETS),
        tracker: new QuotaTracker(PRESETS.map(p => ({ route: p.route, resetPolicy: p.resetPolicy, limits: p.limits }))),
      })
      ctx.llm.registerAdapter([FREE_ROUTE], router)
      const run = async (): Promise<StreamChunk[]> => {
        const chunks: StreamChunk[] = []
        for await (const chunk of ctx.llm.stream({
          provider: FREE_ROUTE, model: 'auto',
          messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } as never)],
        })) chunks.push(chunk)
        return chunks
      }
      return { ctx, run }
    }

    it('serves from zhipu first when it answers', async () => {
      const zhipu = await provider(() => ({ status: 200, body: textStream('from zhipu'), sse: true }))
      const or = await provider(() => ({ status: 200, body: textStream('from openrouter'), sse: true }))
      const { ctx, run } = await buildZhipu(zhipu.url, or.url)
      try {
        expect(text(await run())).toBe('from zhipu')
        expect(or.hits()).toBe(0)
      } finally { await ctx.fiber.dispose() }
    })

    it('falls back when zhipu refuses over its concurrency limit (HTTP 429, Chinese message)', async () => {
      const zhipu = await provider(() => ({ status: 429, body: JSON.stringify({ error: { code: '1302', message: '您的账户已达到速率限制，请您控制请求频率' } }) }))
      const or = await provider(() => ({ status: 200, body: textStream('from openrouter'), sse: true }))
      const { ctx, run } = await buildZhipu(zhipu.url, or.url)
      try {
        expect(text(await run())).toBe('from openrouter')
        expect(zhipu.hits()).toBe(1)
      } finally { await ctx.fiber.dispose() }
    })

    it('falls back, and stops asking, when the zhipu route was never declared in dsh', async () => {
      const or = await provider(() => ({ status: 200, body: textStream('from openrouter'), sse: true }))
      const { ctx, run } = await buildZhipu(undefined, or.url)
      try {
        expect(text(await run())).toBe('from openrouter')
        expect(text(await run())).toBe('from openrouter')
        expect(or.hits()).toBe(2)
      } finally { await ctx.fiber.dispose() }
    })
  })
})
