import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions, LlmFailure, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { checkEntry, classifyFailure, quotaKey, selectCandidates } from '@dsh-free-models/core'
import type {
  Candidate, ChainEntry, FailureClass, GuardSettings, ProviderPreset, QuotaTracker, Skip,
} from '@dsh-free-models/core'
import { FREE_MODEL, FREE_ROUTE } from './config.ts'
import { historyFor, wrapReplay } from './history.ts'

export interface RouterSettings {
  chain: readonly ChainEntry[]
  minContext: number
  guard: GuardSettings
  sensitive: boolean
  switchPolicy: 'priority' | 'sticky'
}

export type RouterEvent =
  | { type: 'switch'; from: string; to: string; because: FailureClass; message: string }
  | { type: 'failure'; entry: string; failure: FailureClass; message: string }
  | { type: 'exhausted'; attempts: readonly Attempt[]; skipped: readonly Skip[]; retryAt?: number }
  | { type: 'success'; entry: string }

export interface Attempt {
  entry: string
  failure: FailureClass
  message: string
}

export interface RouterDeps {
  /** Call an underlying route. In dsh this is `ctx.llm.stream`. */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  settings(): RouterSettings
  presets: ReadonlyMap<string, ProviderPreset>
  tracker: QuotaTracker
  now?: () => number
  onEvent?: (event: RouterEvent) => void
}

type AttemptResult = { kind: 'done' } | { kind: 'failed'; failure: LlmFailure }

/**
 * One virtual route that serves requests from the first available free-tier provider.
 *
 * Switching is only legal before the first content chunk of an attempt has been passed
 * on. After that, a failure is reported as the stream's own error so the loop's retry
 * logic can act on it; splicing two providers' output into one reply would corrupt it.
 */
export class FreeRouterAdapter extends LlmAdapter {
  private lastGood: string | undefined

  constructor(private readonly deps: RouterDeps) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Free models (auto fallback)' }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{
      provider,
      id: FREE_MODEL,
      name: 'Auto (free-tier fallback chain)',
      description: 'Uses the first available free-tier model in your chain.',
    }])
  }

  /** Context is the smallest window in the usable chain, so a switch can never overflow. */
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const { chain, guard } = this.deps.settings()
    const windows: number[] = []
    for (const entry of chain) {
      if (!entry.enabled) continue
      const verdict = checkEntry(entry, this.deps.presets, guard)
      const window = verdict.ok ? verdict.model?.contextWindow : undefined
      if (window !== undefined) windows.push(window)
    }
    return Promise.resolve({
      provider,
      id: model,
      name: model === FREE_MODEL ? 'Auto (free-tier fallback chain)' : model,
      ...windows.length === 0 ? {} : { context: { contextWindow: Math.min(...windows) } },
    })
  }

  override async * stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const settings = this.deps.settings()
    const requirements = {
      needsTools: (options.tools?.length ?? 0) > 0,
      minContext: settings.minContext,
      sensitive: settings.sensitive,
    }
    const exclude = new Set<string>()
    const attempts: Attempt[] = []
    const skippedAll: Skip[] = []
    let previous: string | undefined

    for (;;) {
      if (options.signal?.aborted === true) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'request aborted', code: 'ABORTED' } } }
        return
      }
      const selection = selectCandidates(settings.chain, this.deps.presets, this.deps.tracker, settings.guard, { ...requirements, exclude })
      if (attempts.length === 0) skippedAll.push(...selection.skipped)
      const candidate = this.pick(selection.candidates, settings.switchPolicy)
      if (candidate === undefined) break

      const key = `${candidate.entry.route}/${candidate.entry.model}`
      exclude.add(key)
      if (previous !== undefined && attempts.length > 0) {
        const last = attempts[attempts.length - 1]
        this.deps.onEvent?.({ type: 'switch', from: previous, to: key, because: last?.failure ?? 'fatal', message: last?.message ?? '' })
      }
      previous = key
      this.deps.tracker.recordRequest(quotaKey(candidate.preset, candidate.entry.model))

      const result: AttemptResult = yield * this.attempt(candidate, options)
      if (result.kind === 'done') return

      const failure = result.failure
      const failureClass = classifyFailure(failure)
      attempts.push({ entry: key, failure: failureClass, message: failure.message })
      this.deps.onEvent?.({ type: 'failure', entry: key, failure: failureClass, message: failure.message })
      if (failureClass === 'aborted') {
        yield { type: 'finish', reason: { kind: 'aborted', failure } }
        return
      }
      if (failureClass === 'fatal') {
        // An unrecognized failure may be a bug in the request, not in the route. Show it.
        yield { type: 'finish', reason: { kind: 'error', failure } }
        return
      }
      this.recordFailure(candidate, failureClass, failure)
    }

    throw this.exhausted(attempts, skippedAll, settings)
  }

  /** Pick the next candidate. `sticky` prefers the entry that last worked while it stays available. */
  private pick(candidates: readonly Candidate[], policy: 'priority' | 'sticky'): Candidate | undefined {
    if (policy === 'sticky' && this.lastGood !== undefined) {
      const same = candidates.find(candidate => `${candidate.entry.route}/${candidate.entry.model}` === this.lastGood)
      if (same !== undefined) return same
    }
    return candidates[0]
  }

  private recordFailure(candidate: Candidate, failureClass: FailureClass, failure: LlmFailure): void {
    const facts = {
      code: failure.code,
      message: failure.message,
      ...failure.status === undefined ? {} : { status: failure.status },
      ...failure.providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs: failure.providerRetryAfterMs },
    }
    switch (failureClass) {
      case 'auth':
      case 'billing':
        // Key problems affect every model on the route.
        this.deps.tracker.recordFailure(candidate.entry.route, failureClass, facts)
        break
      case 'quota-daily':
      case 'rate-minute':
      case 'transient':
        this.deps.tracker.recordFailure(quotaKey(candidate.preset, candidate.entry.model), failureClass, facts)
        break
      default:
        // unsupported / context: only this request is affected; the entry is already excluded.
        break
    }
  }

  private async * attempt(candidate: Candidate, options: GenerateOptions): AsyncGenerator<StreamChunk, AttemptResult> {
    const { route, model } = candidate.entry
    const key = `${route}/${model}`
    const { reasoningEffort: _dropped, ...rest } = options
    const inner = this.deps.stream({
      ...rest,
      provider: route,
      model,
      messages: historyFor(options.messages, route),
    })
    const held: StreamChunk[] = []
    let started = false
    let tokens = 0
    for await (const chunk of inner) {
      if (chunk.type === 'usage') {
        tokens += chunk.usage.inputTokens + chunk.usage.outputTokens
        if (started) yield chunk
        else held.push(chunk)
        continue
      }
      if (chunk.type !== 'finish') {
        if (!started) { started = true; yield * held.splice(0) }
        yield chunk
        continue
      }
      const reason = chunk.reason
      if (reason.kind === 'error' && !started) return { kind: 'failed', failure: reason.failure }
      yield * held.splice(0)
      if (tokens > 0) this.deps.tracker.recordUsage(quotaKey(candidate.preset, model), tokens)
      if (reason.kind === 'error') {
        // Failed after output began: no switching. Remember it so the next request avoids the route.
        const failureClass = classifyFailure(reason.failure)
        this.deps.onEvent?.({ type: 'failure', entry: key, failure: failureClass, message: reason.failure.message })
        this.recordFailure(candidate, failureClass, reason.failure)
        yield chunk
        return { kind: 'done' }
      }
      if (reason.kind !== 'aborted') {
        this.lastGood = key
        this.deps.onEvent?.({ type: 'success', entry: key })
      }
      yield chunk.replayState === undefined
        ? chunk
        : { ...chunk, replayState: wrapReplay(route, model, chunk.replayState) as typeof chunk.replayState }
      return { kind: 'done' }
    }
    // The stream ended without a terminal chunk, which the protocol forbids.
    const failure: LlmFailure = { message: `${key} ended its stream without a finish`, code: 'MALFORMED_RESPONSE' }
    if (!started) return { kind: 'failed', failure }
    yield * held.splice(0)
    yield { type: 'finish', reason: { kind: 'error', failure } }
    return { kind: 'done' }
  }

  /** Build the error for a request no entry could serve, with the code the loop should react to. */
  private exhausted(attempts: readonly Attempt[], skipped: readonly Skip[], settings: RouterSettings): LlmError {
    const keys = settings.chain.filter(entry => entry.enabled).map((entry) => {
      const preset = this.deps.presets.get(entry.route)
      return preset === undefined ? entry.route : quotaKey(preset, entry.model)
    })
    const now = (this.deps.now ?? Date.now)()
    const recovery = this.deps.tracker.earliestRecovery(keys)
    const waiting = recovery !== undefined && recovery > now
    const lines = [
      ...attempts.map(attempt => `- ${attempt.entry}: ${attempt.failure} (${attempt.message})`),
      ...skipped.map(skip => `- ${skip.route}/${skip.model}: skipped, ${skip.detail}`),
    ]
    const when = waiting ? ` Earliest recovery: ${new Date(recovery).toISOString()}.` : ''
    const header = 'No free-tier model in the chain can serve this request.'
    const message = `${header}${when}\n${lines.join('\n')}`.trim()
    this.deps.onEvent?.({ type: 'exhausted', attempts, skipped, ...waiting ? { retryAt: recovery } : {} })

    const classes = new Set<string>([...attempts.map(a => a.failure), ...skipped.map(s => s.reason)])
    if (waiting && (classes.has('quota-daily') || classes.has('exhausted'))) {
      return new LlmError(message, 'QUOTA', { providerRetryAfterMs: Math.max(1, recovery - now) })
    }
    if (waiting && (classes.has('rate-minute') || classes.has('cooling') || classes.has('transient'))) {
      return new LlmError(message, 'RATE_LIMIT', { providerRetryAfterMs: Math.max(1, recovery - now) })
    }
    if (classes.has('context')) return new LlmError(message, 'CONTEXT_WINDOW_EXCEEDED')
    if (classes.has('auth') || classes.has('billing') || classes.has('route-disabled')) return new LlmError(message, 'AUTH')
    if (classes.has('guard') || classes.has('disabled')) return new LlmError(message, 'INVALID_CONFIG')
    return new LlmError(message, 'MODEL_UNSUPPORTED')
  }
}
