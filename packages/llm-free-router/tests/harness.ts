import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, LlmError, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { QuotaTracker } from '@dsh-free-models/core'
import { PRESETS, presetMap } from '@dsh-free-models/presets'
import { FreeRouterAdapter, FREE_ROUTE } from '../src/index.ts'
import type { RouterEvent, RouterSettings } from '../src/index.ts'

export type Script = StreamChunk[] | { throws: Error } | { hang: true }

export const ok = (text = 'hi', replay?: unknown): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
  { type: 'finish', reason: { kind: 'stop' } as never, ...replay === undefined ? {} : { replayState: { response: replay, blocks: [{ b: 1 }] } } },
]

export const failBefore = (code: string, message: string, extra: { status?: number; providerRetryAfterMs?: number } = {}): StreamChunk[] => [
  { type: 'usage', usage: { inputTokens: 3, outputTokens: 0 } },
  { type: 'finish', reason: { kind: 'error', failure: { code, message, ...extra } } },
]

export const failAfter = (code: string, message: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'partial' },
  { type: 'finish', reason: { kind: 'error', failure: { code, message } } },
]

/** Stand-in for the pi-ai adapter: serves several routes from per-route scripted responses. */
export class FakeProviders extends LlmAdapter {
  readonly calls: GenerateOptions[] = []
  readonly scripts = new Map<string, Script[]>()

  script(route: string, ...scripts: Script[]): void {
    this.scripts.set(route, scripts)
  }

  callsTo(route: string): GenerateOptions[] {
    return this.calls.filter(call => call.provider === route)
  }

  override async * stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    this.calls.push(options)
    const queue = this.scripts.get(options.provider)
    const script = queue?.length === 1 ? queue[0] : queue?.shift()
    if (script === undefined) throw new LlmError(`no script for ${options.provider}`, 'INVALID_REQUEST')
    if ('throws' in script) throw script.throws
    if ('hang' in script) {
      await new Promise<void>((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new LlmError('aborted', 'ABORTED'))))
      return
    }
    yield * script
  }
}

export const settings = (overrides: Partial<RouterSettings> & { confirm?: string[] } = {}): RouterSettings => {
  const { confirm = ['google', 'mistral', 'groq'], ...rest } = overrides
  return {
    chain: [
      { route: 'google', model: 'gemini-4-hydrogen', enabled: true },
      { route: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free', enabled: true },
      { route: 'mistral', model: 'mistral-small-latest', enabled: true },
    ],
    minContext: 128_000,
    sensitive: false,
    switchPolicy: 'priority',
    guard: { forbidBillableCalls: true, confirmedNoBilling: new Set(confirm), allowBilling: new Set() },
    ...rest,
  }
}

export async function setup(initial: RouterSettings = settings(), start = Date.parse('2026-11-20T10:00:00Z')) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const providers = new FakeProviders()
  ctx.llm.registerAdapter(['google', 'openrouter', 'mistral', 'groq'], providers)
  let now = start
  const events: RouterEvent[] = []
  const state = { settings: initial }
  const tracker = new QuotaTracker(
    PRESETS.map(preset => ({ route: preset.route, resetPolicy: preset.resetPolicy, limits: preset.limits })),
    { clock: () => now },
  )
  const router = new FreeRouterAdapter({
    stream: options => ctx.llm.stream(options),
    settings: () => state.settings,
    presets: presetMap(PRESETS),
    tracker,
    now: () => now,
    onEvent: event => events.push(event),
  })
  ctx.llm.registerAdapter([FREE_ROUTE], router)
  const run = async (overrides: Partial<GenerateOptions> = {}): Promise<StreamChunk[]> => {
    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({
      provider: FREE_ROUTE, model: 'auto', messages: [createUserMessage({ content: [{ type: 'text', text: 'q' }], source: { kind: 'user' } } as never)],
      ...overrides,
    })) chunks.push(chunk)
    return chunks
  }
  return { ctx, providers, router, tracker, events, state, run, advance: (ms: number) => { now += ms }, createAssistantMessage }
}

export const finishOf = (chunks: StreamChunk[]) => chunks.filter(chunk => chunk.type === 'finish').at(-1)
