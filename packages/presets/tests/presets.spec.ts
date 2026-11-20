import { describe, expect, it } from 'vitest'
import { DEFAULT_CHAIN, PRESETS, presetMap } from '@dsh-free-models/presets'
import { checkEntry } from '@dsh-free-models/core'

describe('preset validation', () => {
  it('has unique routes and complete metadata', () => {
    expect(new Set(PRESETS.map(p => p.route)).size).toBe(PRESETS.length)
    for (const p of PRESETS) {
      expect(p.apiKeyEnv).toMatch(/^[A-Z][A-Z0-9_]+$/)
      expect(p.keyUrl).toMatch(/^https:\/\//)
      expect(p.docsUrl).toMatch(/^https:\/\//)
      expect(p.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(p.billingNotice.length).toBeGreaterThan(20)
      expect(p.models.length).toBeGreaterThan(0)
      expect(new Set(p.models.map(m => m.id)).size).toBe(p.models.length)
    }
  })

  it('never lists a denied model or a model that violates its suffix rule', () => {
    for (const p of PRESETS) for (const m of p.models) {
      expect(p.deniedModels ?? []).not.toContain(m.id)
      if (p.requiredModelSuffix) expect(m.id.endsWith(p.requiredModelSuffix)).toBe(true)
    }
  })

  it('keeps providers that bill on their own out of the default chain', () => {
    const presets = presetMap()
    for (const entry of DEFAULT_CHAIN) {
      const preset = presets.get(entry.route)!
      expect(preset.overage).not.toBe('bills')
      const model = preset.models.find(m => m.id === entry.model)
      expect(model, `${entry.route}/${entry.model}`).toBeDefined()
      expect(model!.overage).not.toBe('bills')
      expect(model!.tools).toBe(true)
      expect(model!.contextWindow).toBeGreaterThanOrEqual(128_000)
    }
  })

  it('does not put Cerebras or GitHub Models anywhere', () => {
    expect(PRESETS.map(p => p.route)).not.toContain('cerebras')
    expect(PRESETS.map(p => p.route)).not.toContain('github')
  })
})
