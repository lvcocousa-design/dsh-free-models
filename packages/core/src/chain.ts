import { checkEntry } from './guard.ts'
import type { GuardSettings } from './guard.ts'
import type { QuotaTracker } from './quota.ts'
import type { ChainEntry, FreeModel, ProviderPreset } from './types.ts'

/** Key the quota tracker uses for an entry: the route itself, or `route/model` when limits are per model. */
export function quotaKey(preset: Pick<ProviderPreset, 'route' | 'quotaScope'>, model: string): string {
  return preset.quotaScope === 'model' ? `${preset.route}/${model}` : preset.route
}

export interface Requirements {
  /** The request declares tools. */
  needsTools: boolean
  /** Skip models smaller than this many tokens. */
  minContext: number
  /** Entries (`route/model`) to leave out for this request only (already failed, or unsuitable). */
  exclude?: ReadonlySet<string>
  /** Routes the user does not want sensitive code sent to. */
  sensitive?: boolean
}

export interface Candidate {
  entry: ChainEntry
  preset: ProviderPreset
  model: FreeModel | undefined
}

export type SkipReason =
  | 'disabled'
  | 'excluded'
  | 'guard'
  | 'no-tools'
  | 'small-context'
  | 'cooling'
  | 'exhausted'
  | 'route-disabled'
  | 'trains-on-data'

export interface Skip {
  route: string
  model: string
  reason: SkipReason
  detail: string
}

export interface Selection {
  candidates: Candidate[]
  skipped: Skip[]
}

/**
 * Walk the chain in order and keep the entries that may be called right now.
 * Order is the user's order; nothing here reorders.
 */
export function selectCandidates(
  chain: readonly ChainEntry[],
  presets: ReadonlyMap<string, ProviderPreset>,
  tracker: QuotaTracker,
  guard: GuardSettings,
  requirements: Requirements,
): Selection {
  const candidates: Candidate[] = []
  const skipped: Skip[] = []
  for (const entry of chain) {
    const skip = (reason: SkipReason, detail: string): void => {
      skipped.push({ route: entry.route, model: entry.model, reason, detail })
    }
    if (!entry.enabled) { skip('disabled', 'turned off in settings'); continue }
    if (requirements.exclude?.has(`${entry.route}/${entry.model}`)) { skip('excluded', 'already tried for this request'); continue }
    const verdict = checkEntry(entry, presets, guard)
    if (!verdict.ok) { skip('guard', verdict.detail); continue }
    const preset = presets.get(entry.route)
    if (preset === undefined) continue
    if (requirements.sensitive === true && preset.trainsOnFreeTierData) {
      skip('trains-on-data', `${preset.displayName} may use free-tier prompts to improve its products`)
      continue
    }
    const model = verdict.model
    if (requirements.needsTools && model !== undefined && !model.tools) { skip('no-tools', 'model has no tool calling'); continue }
    if (model !== undefined && model.contextWindow < requirements.minContext) {
      skip('small-context', `${model.contextWindow} tokens is below the ${requirements.minContext} minimum`)
      continue
    }
    const routeState = tracker.state(entry.route)
    if (routeState.status === 'disabled') { skip('route-disabled', routeState.reason ?? 'disabled'); continue }
    const state = tracker.state(quotaKey(preset, entry.model))
    if (state.status === 'disabled') { skip('route-disabled', state.reason ?? 'disabled'); continue }
    if (state.status === 'exhausted') { skip('exhausted', state.reason ?? 'allowance spent'); continue }
    if (state.status === 'cooling') { skip('cooling', state.reason ?? 'cooling down'); continue }
    candidates.push({ entry, preset, model })
  }
  return { candidates, skipped }
}
