import { describe, expect, it } from 'vitest'

/**
 * Real provider calls. Skipped unless LIVE_TEST=1. Each call is one tiny request on your own free keys,
 * and counts against your daily allowance. Keys come from the environment, never from this repo.
 */
const live = process.env.LIVE_TEST === '1'

describe.skipIf(!live)('live free-tier smoke test', () => {
  it('OpenRouter :free answers a one-word prompt', async () => {
    const key = process.env.OPENROUTER_API_KEY
    if (!key) return
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'google/gemma-4-31b-it:free', max_tokens: 8, messages: [{ role: 'user', content: 'Say ok' }] }),
    })
    expect([200, 429]).toContain(response.status)
    if (response.status === 200) expect((await response.json() as { choices: unknown[] }).choices.length).toBeGreaterThan(0)
  })

  it('Gemini answers a one-word prompt', async () => {
    const key = process.env.GEMINI_API_KEY
    if (!key) return
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Say ok' }] }], generationConfig: { maxOutputTokens: 8 } }),
    })
    expect([200, 429]).toContain(response.status)
  })
})
