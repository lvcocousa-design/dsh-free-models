import type { ChainEntry, FreeModel, Overage, ProviderPreset } from './types.ts'

export interface GuardSettings {
  /** Global switch. When true (the default), nothing that could bill is ever sent. */
  forbidBillableCalls: boolean
  /** Routes the user confirmed have no paid plan or billing attached. */
  confirmedNoBilling: ReadonlySet<string>
  /** Routes the user explicitly allowed to bill, one by one. Only honored if forbidBillableCalls is false. */
  allowBilling: ReadonlySet<string>
}

export type GuardVerdict = { ok: true; model: FreeModel | undefined } | { ok: false; reason: GuardReason; detail: string }

export type GuardReason =
  | 'unknown-route'
  | 'denied-model'
  | 'not-free-model'
  | 'missing-suffix'
  | 'billing-unconfirmed'
  | 'may-bill'

/**
 * Decide, before any request leaves the machine, whether a chain entry may be called.
 *
 * This runs per request and cannot be bypassed from the UI: a disabled switch there
 * only changes the settings this function reads.
 */
export function checkEntry(
  entry: Pick<ChainEntry, 'route' | 'model'>,
  presets: ReadonlyMap<string, ProviderPreset>,
  settings: GuardSettings,
): GuardVerdict {
  const preset = presets.get(entry.route)
  if (preset === undefined) {
    return { ok: false, reason: 'unknown-route', detail: `route "${entry.route}" has no free-tier preset` }
  }
  if (preset.deniedModels?.includes(entry.model)) {
    return { ok: false, reason: 'denied-model', detail: `${entry.route}/${entry.model} is a paid model` }
  }
  if (preset.requiredModelSuffix !== undefined && !entry.model.endsWith(preset.requiredModelSuffix)) {
    return {
      ok: false,
      reason: 'missing-suffix',
      detail: `${entry.route} models must end with "${preset.requiredModelSuffix}" to be free; got "${entry.model}"`,
    }
  }
  const model = preset.models.find(candidate => candidate.id === entry.model)
  // Hand-added models are allowed only on routes whose free status is decided by an id rule.
  if (model === undefined && preset.requiredModelSuffix === undefined) {
    return {
      ok: false,
      reason: 'not-free-model',
      detail: `${entry.route}/${entry.model} is not on the free-tier list for ${entry.route}`,
    }
  }
  const overage: Overage = model?.overage ?? preset.overage
  if (overage === 'bills') {
    if (settings.forbidBillableCalls || !settings.allowBilling.has(entry.route)) {
      return { ok: false, reason: 'may-bill', detail: `${entry.route}/${entry.model} bills once the free allowance is used` }
    }
    return { ok: true, model }
  }
  if (overage === 'depends-on-account-billing' && !settings.confirmedNoBilling.has(entry.route)) {
    return {
      ok: false,
      reason: 'billing-unconfirmed',
      detail: `${entry.route}: confirm the account has no paid plan or billing attached before it is used`,
    }
  }
  return { ok: true, model }
}
