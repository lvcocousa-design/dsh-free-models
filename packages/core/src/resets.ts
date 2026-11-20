import type { ResetPolicy } from './types.ts'

const DAY_MS = 86_400_000

/** Offset of `timeZone` from UTC at `instant`, in ms (positive east of UTC). */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant))
  const get = (type: string): number => Number(parts.find(part => part.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(instant / 1000) * 1000
}

/** The next local midnight strictly after `now` in `timeZone`, as epoch ms. Handles DST transitions. */
export function nextLocalMidnight(now: number, timeZone: string): number {
  const offset = zoneOffsetMs(now, timeZone)
  const localNow = now + offset
  const localNextMidnight = Math.floor(localNow / DAY_MS) * DAY_MS + DAY_MS
  // The offset at the target instant can differ from the offset now (DST). Re-derive once.
  let candidate = localNextMidnight - offset
  const offsetThen = zoneOffsetMs(candidate, timeZone)
  if (offsetThen !== offset) candidate = localNextMidnight - offsetThen
  return candidate
}

/** When a daily allowance next resets. `unknown` assumes the worst case, 24 hours from now. */
export function nextDailyReset(policy: ResetPolicy, now: number): number {
  switch (policy) {
    case 'pacific-midnight': return nextLocalMidnight(now, 'America/Los_Angeles')
    case 'utc-midnight': return (Math.floor(now / DAY_MS) + 1) * DAY_MS
    case 'unknown': return now + DAY_MS
  }
}
