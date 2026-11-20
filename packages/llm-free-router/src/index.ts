import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { QuotaTracker } from '@dsh-free-models/core'
import type { GuardSettings } from '@dsh-free-models/core'
import { PRESETS, presetMap } from '@dsh-free-models/presets'
import { Config, FREE_MODEL, FREE_ROUTE } from './config.ts'
import { FreeRouterAdapter } from './router.ts'
import { RESET_PATH, STATUS_PATH, buildStatus, resetResource, statusResource } from './status.ts'
import type { RouterEvent, RouterSettings } from './router.ts'

export { Config, FREE_MODEL, FREE_ROUTE } from './config.ts'
export { FreeRouterAdapter } from './router.ts'
export type { Attempt, RouterDeps, RouterEvent, RouterSettings } from './router.ts'
export { RESET_PATH, STATUS_PATH, buildStatus, resetResource, statusResource } from './status.ts'
export type { ProviderStatus, StatusReport } from './status.ts'
export { historyFor, wrapReplay } from './history.ts'

export const name = 'llm-free-router'
export const inject = ['llm']

function truthyKeys(record: Record<string, boolean>): Set<string> {
  return new Set(Object.entries(record).filter(([, value]) => value).map(([key]) => key))
}

/** Read the current volatile settings. Called per request so edits apply immediately. */
export function readSettings(config: Config): RouterSettings {
  const guard: GuardSettings = {
    forbidBillableCalls: config.forbidBillableCalls.get(),
    confirmedNoBilling: truthyKeys(config.confirmedNoBilling.get()),
    allowBilling: truthyKeys(config.allowBilling.get()),
  }
  return {
    chain: config.chain.get(),
    minContext: config.minContext.get(),
    sensitive: config.sensitiveRequests.get(),
    switchPolicy: config.switchPolicy.get(),
    guard,
  }
}

export function apply(ctx: Context, config: Config): void {
  const presets = presetMap(PRESETS)
  const tracker = new QuotaTracker(
    PRESETS.map(preset => ({ route: preset.route, resetPolicy: preset.resetPolicy, limits: preset.limits })),
    { softLimitRatio: config.softLimitRatio.get() },
  )
  const adapter = new FreeRouterAdapter({
    stream: options => ctx.llm.stream(options),
    settings: () => readSettings(config),
    presets,
    tracker,
    onEvent: (event: RouterEvent) => {
      if (event.type === 'switch') ctx.logger.info(`free-models: switching ${event.from} -> ${event.to} (${event.because})`)
      else if (event.type === 'failure') ctx.logger.warn(`free-models: ${event.entry} failed: ${event.failure}`)
      else if (event.type === 'exhausted') ctx.logger.warn('free-models: every entry in the chain is unavailable')
    },
  })
  ctx.effect(() => ctx.llm.registerAdapter([FREE_ROUTE], adapter), 'free-models: register free-auto route')
  ctx.inject(['webServer'], (webCtx) => {
    const serve = statusResource(() => buildStatus(FREE_ROUTE, presets.values(), tracker, Date.now()))
    // Newer dsh builds take an `auth` field and enforce it; the 0.2.2-rc.5 server has no such field and
    // serves every route to whoever can reach it. The page only exposes counters and public preset text.
    const route = {
      kind: 'exact' as const,
      path: STATUS_PATH,
      auth: 'required',
      resource: async (request: Request) => config.statusPage.get()
        ? await serve(request)
        : new Response('disabled', { status: 404 }),
    }
    webCtx.effect(() => webCtx.webServer.register(route), 'free-models: status route')
    const reset = resetResource(known => presets.has(known), r => { tracker.resetRoute(r) })
    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact' as const, path: RESET_PATH, resource: reset }), 'free-models: reset route')
  })
}
