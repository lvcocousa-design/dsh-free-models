import type { FailureClass, FailureFacts } from './types.ts'

const DAILY_HINT = /\b(per[\s_-]+day|daily|requests?[\s_-]+per[\s_-]+day|rpd|tokens?[\s_-]+per[\s_-]+day|tpd|free[\s_-]+(?:models?[\s_-]+)?(?:per[\s_-]+day|daily)|resource[\s_-]*exhausted|quota)\b|每日|当日|今日/i
const BILLING_HINT = /\b(billing|payment|insufficient[\s_-]+(?:credits?|balance|funds)|add[\s_-]+credits?|out[\s_-]+of[\s_-]+credits?)\b|余额不足|欠费|请充值|资源包/i

/**
 * Reduce a provider failure to the decision policy needs.
 *
 * Order matters: billing is checked before quota, because a 402 or a message
 * about credits must disable the route rather than be waited out.
 */
export function classifyFailure(facts: FailureFacts): FailureClass {
  const code = facts.code
  const status = facts.status ?? statusFromCode(code)
  const message = facts.message ?? ''

  if (code === 'ABORTED') return 'aborted'
  if (status === 402 || code === 'HTTP_402') return 'billing'
  if (code === 'ACCOUNT_QUOTA') return 'billing'
  if (code === 'CONTEXT_WINDOW_EXCEEDED') return 'context'
  if (code === 'QUOTA') return BILLING_HINT.test(message) ? 'billing' : 'quota-daily'
  if (code === 'RATE_LIMIT' || status === 429) {
    if (BILLING_HINT.test(message)) return 'billing'
    // Providers answer both daily and per-minute exhaustion with 429; the text is the only tell.
    return DAILY_HINT.test(message) && !/\bper[\s_-]+minute\b|\brpm\b|\btpm\b/i.test(message)
      ? 'quota-daily'
      : 'rate-minute'
  }
  // The route is not declared in dsh at all (custom routes such as zhipu need a one-time setup).
  if (code === 'NO_ADAPTER') return 'auth'
  if (code === 'AUTH' || code === 'INVALID_CREDENTIAL' || code === 'MISSING_CREDENTIAL'
    || code === 'ACCOUNT_SIGN_IN_REQUIRED' || code === 'ACCOUNT_TOKEN_INVALID'
    || status === 401 || status === 403) return 'auth'
  if (code === 'UNSUPPORTED_OPTION' || code === 'UNKNOWN_MODEL' || code === 'MODEL_UNSUPPORTED'
    || code === 'CONTENT_REFUSED' || status === 404 || status === 400 || status === 422) return 'unsupported'
  if (code === 'SERVER' || code === 'TIMEOUT' || code === 'TRANSPORT' || code === 'EMPTY_RESPONSE'
    || code === 'MALFORMED_RESPONSE' || (status !== undefined && status >= 500)) return 'transient'
  return 'fatal'
}

function statusFromCode(code: string): number | undefined {
  const match = /^HTTP_(\d{3})$/.exec(code)
  return match === null ? undefined : Number(match[1])
}
