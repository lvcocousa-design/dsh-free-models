import { describe, expect, it } from 'vitest'
import { checkEntry, classifyFailure } from '@dsh-free-models/core'
import { DEFAULT_CHAIN, PRESETS, presetMap } from '@dsh-free-models/presets'

const guard = { forbidBillableCalls: true, confirmedNoBilling: new Set<string>(), allowBilling: new Set<string>() }

describe('provider expansion', () => {
  it('puts Zhipu first and keeps the optional providers out of the default chain', () => {
    expect(DEFAULT_CHAIN.map(e => e.route)).toEqual(['zhipu', 'google', 'google', 'openrouter', 'openrouter', 'mistral'])
    const optional = PRESETS.filter(p => p.offByDefault === true).map(p => p.route).sort()
    expect(optional).toEqual(['cloudflare-workers-ai', 'modelscope', 'nvidia'])
    for (const route of optional) expect(DEFAULT_CHAIN.map(e => e.route)).not.toContain(route)
  })

  it('refuses the billed Zhipu Flash models, in any letter case', () => {
    const presets = presetMap()
    for (const model of ['glm-5.3-flash', 'GLM-5.3-Flash', 'glm-5.3-flashx', 'glm-4.6v-flashx']) {
      const verdict = checkEntry({ route: 'zhipu', model }, presets, guard)
      expect(verdict.ok, model).toBe(false)
    }
    expect(checkEntry({ route: 'zhipu', model: 'glm-4.7-flash' }, presets, guard).ok).toBe(true)
    expect(checkEntry({ route: 'zhipu', model: 'glm-4.5-air' }, presets, guard).ok).toBe(false)
  })

  it('never lists a model Cloudflare says needs a paid plan', () => {
    const cf = presetMap().get('cloudflare-workers-ai')!
    expect(cf.overage).toBe('depends-on-account-billing')
    expect(checkEntry({ route: cf.route, model: '@cf/zai-org/glm-5.3-flash' }, presetMap(), { ...guard, confirmedNoBilling: new Set([cf.route]) }).ok).toBe(false)
    expect(checkEntry({ route: cf.route, model: '@cf/zai-org/glm-4.7-flash' }, presetMap(), guard).ok).toBe(false)
    expect(checkEntry({ route: cf.route, model: '@cf/zai-org/glm-4.7-flash' }, presetMap(), { ...guard, confirmedNoBilling: new Set([cf.route]) }).ok).toBe(true)
    expect(cf.extraCredentials?.map(c => c.env)).toEqual(['CLOUDFLARE_ACCOUNT_ID'])
  })

  it('flags NVIDIA as using prompts and ModelScope and NVIDIA as limited use', () => {
    const presets = presetMap()
    expect(presets.get('nvidia')!.trainsOnFreeTierData).toBe(true)
    expect(presets.get('nvidia')!.requirements).toMatch(/not for production/i)
    expect(presets.get('modelscope')!.requirements).toMatch(/non-commercial/i)
  })

  it('declares custom routes only for providers dsh does not ship, over https', () => {
    for (const p of PRESETS) if (p.customRoute !== undefined) expect(p.customRoute.baseURL).toMatch(/^https:\/\//)
    expect(PRESETS.filter(p => p.customRoute !== undefined).map(p => p.route).sort()).toEqual(['modelscope', 'zhipu'])
  })

  it('understands Zhipu error wording', () => {
    expect(classifyFailure({ code: 'RATE_LIMIT', status: 429, message: '您的账户已达到速率限制，请您控制请求频率' })).toBe('rate-minute')
    expect(classifyFailure({ code: 'RATE_LIMIT', status: 429, message: '余额不足或无可用资源包,请充值。' })).toBe('billing')
    expect(classifyFailure({ code: 'NO_ADAPTER', message: 'no adapter registered for provider "zhipu"' })).toBe('auth')
  })
})
