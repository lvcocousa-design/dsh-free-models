/**
 * Browser half of the free-models settings page. It registers one `settings.section`, shown while the Host
 * serves the router's settings namespace (the profile entry id, `llm-free-router`).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pull in the ctx.locale / ctx.configForms / slots merges.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { FreeModelsPage } from './Page.tsx'
import type { PageSnapshot } from './Page.tsx'
import { en, zh } from './locales.ts'
import type { FreeModelsKey } from './locales.ts'
import { createStatusSource } from './status-source.ts'
import type { StatusReport } from './model.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.freeModels': FreeModelsKey
  }
}

const NS = 'settings.freeModels'
/** Profile entry id of the llm-free-router plugin. Give the entry this id in your profile. */
const ENTRY_ID = 'llm-free-router'
const STATUS_URL = '/free-models/status'

export const inject = ['slots', 'locale', 'configForms']

export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS) as (key: FreeModelsKey) => string
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'free-models-ui: dictionaries')
  const form = ctx.configForms.get<Record<string, unknown>>(ENTRY_ID)
  const config = {
    getSnapshot: (): PageSnapshot => {
      const s = form.getSnapshot()
      return { status: s.status, value: s.value as PageSnapshot['value'], writable: s.writable }
    },
    subscribe: (listener: () => void) => form.subscribe(listener),
  }
  // getSnapshot must return a stable reference between changes.
  let last: { source: ReturnType<typeof form.getSnapshot>; view: PageSnapshot } | undefined
  config.getSnapshot = () => {
    const s = form.getSnapshot()
    if (last?.source !== s) last = { source: s, view: { status: s.status, value: s.value as PageSnapshot['value'], writable: s.writable } }
    return last.view
  }
  const status = createStatusSource(async () => {
    const response = await fetch(STATUS_URL, { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) throw new Error(`status ${response.status}`)
    return await response.json() as StatusReport
  })
  const write = (field: string, value: unknown): void => { void form.set(field, value) }

  ctx.effect(() => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'free-models',
    order: 11,
    label: () => t('nav'),
    inject: () => ({ hooks: { config, report: status }, write, t, now: () => Date.now() }),
  }, FreeModelsPage as never))), 'free-models-ui: settings page')
}
