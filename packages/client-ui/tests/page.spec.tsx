import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FreeModelsPage } from '../src/client/Page.tsx'
import type { PageProps } from '../src/client/Page.tsx'
import { en } from '../src/client/locales.ts'
import { createStatusSource } from '../src/client/status-source.ts'
import type { StatusReport } from '../src/client/model.ts'

const report: StatusReport = {
  route: 'free-auto', generatedAt: 0,
  providers: [{
    route: 'openrouter', displayName: 'OpenRouter (:free models)', status: 'exhausted', until: 3_600_000, usage: { requests: 50, tokens: 0 },
    limits: { requestsPerDay: 50 }, overage: 'reject', trainsOnFreeTierData: true, billingNotice: 'Only :free models are used.',
    keyUrl: 'https://openrouter.ai/settings/keys', docsUrl: '', verifiedAt: '2026-11-20', apiKeyEnv: 'OPENROUTER_API_KEY',
    models: [{ id: 'x:free', name: 'X', contextWindow: 1, unverified: true, status: 'ok', requests: 0 }],
  }],
}

const props = (over: Partial<PageProps> = {}): PageProps => ({
  t: key => en[key],
  useConfig: select => select({ status: 'ready', writable: true, value: { chain: [{ route: 'google', model: 'g', enabled: true }, { route: 'openrouter', model: 'x:free', enabled: false }], confirmedNoBilling: { google: true } } }),
  useReport: select => select({ report, failed: false }),
  write: () => {}, reset: () => {}, now: () => 0, ...over,
})

describe('FreeModelsPage', () => {
  it('renders chain, status, usage and billing confirmation', () => {
    const html = renderToStaticMarkup(<FreeModelsPage {...props()} />)
    expect(html).toContain('Fallback order')
    expect(html).toContain('<code>google</code>')
    expect(html).toContain('Allowance used')
    expect(html).toContain('50 / 50')
    expect(html).toContain('OPENROUTER_API_KEY')
    expect(html).not.toContain('Confirm to enable this provider') // OpenRouter needs no confirmation
    expect(html).toContain('(unverified)')
  })
  it('shows a hint instead of data when status is unavailable, and disables edits when unwritable', () => {
    const html = renderToStaticMarkup(<FreeModelsPage {...props({
      useReport: select => select({ report: undefined, failed: true }),
      useConfig: select => select({ status: 'loading', writable: false, value: undefined }),
    })} />)
    expect(html).toContain('Usage is not available')
    expect(html).toContain('disabled=""')
  })
})

describe('billing confirmation and re-enable', () => {
  const gem = { ...report.providers[0]!, route: 'google', displayName: 'Google Gemini', overage: 'depends-on-account-billing', status: 'disabled' as const, reason: 'credential missing, invalid or not authorized' }
  it('asks confirmation only where billing depends on the account, and offers re-enable with the reason', () => {
    const html = renderToStaticMarkup(<FreeModelsPage {...props({ useReport: select => select({ report: { ...report, providers: [gem] }, failed: false }), useConfig: select => select({ status: 'ready', writable: true, value: { chain: [] } }) })} />)
    expect(html).toContain('Confirm to enable this provider')
    expect(html).toContain('Try again')
    expect(html).toContain('credential missing')
  })
})

describe('provider cards for the optional providers', () => {
  const cf = {
    ...report.providers[0]!, route: 'cloudflare-workers-ai', displayName: 'Cloudflare Workers AI', overage: 'depends-on-account-billing', trainsOnFreeTierData: false,
    status: 'ok' as const, offByDefault: true, requirements: 'Needs a Free plan account.',
    extraCredentials: [{ env: 'CLOUDFLARE_ACCOUNT_ID', hint: 'Dashboard, Account ID.' }],
  }
  const ms = { ...report.providers[0]!, route: 'modelscope', displayName: 'ModelScope', status: 'ok' as const, trainsOnFreeTierData: false, offByDefault: true, customRoute: { api: 'openai-completions', baseURL: 'https://api-inference.modelscope.cn/v1/' } }
  it('shows the extra credential, the setup URL and the off-by-default note', () => {
    const html = renderToStaticMarkup(<FreeModelsPage {...props({ useReport: select => select({ report: { ...report, providers: [cf, ms] }, failed: false }) })} />)
    expect(html).toContain('CLOUDFLARE_ACCOUNT_ID')
    expect(html).toContain('Needs a Free plan account.')
    expect(html).toContain('https://api-inference.modelscope.cn/v1/')
    expect(html).toContain('Not in the default chain')
  })
})

describe('status source', () => {
  it('polls only while subscribed and keeps the last report on failure', async () => {
    let calls = 0
    let fail = false
    const source = createStatusSource(async () => { calls += 1; if (fail) throw new Error('x'); return report }, 5)
    expect(calls).toBe(0)
    const stop = source.subscribe(() => {})
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(source.getSnapshot().report).toBe(report)
    fail = true
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(source.getSnapshot()).toMatchObject({ report, failed: true })
    stop()
    const seen = calls
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(calls).toBe(seen)
  })
})
