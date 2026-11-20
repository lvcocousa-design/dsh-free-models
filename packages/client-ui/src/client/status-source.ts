import type { StatusReport } from './model.ts'
import type { StatusSnapshot } from './Page.tsx'

/**
 * A polled observable for the page. It fetches only while at least one listener is subscribed, every 15 s,
 * so a closed settings page costs nothing. The snapshot object changes identity only when the data does.
 */
export function createStatusSource(fetchStatus: () => Promise<StatusReport>, intervalMs = 15_000) {
  let snapshot: StatusSnapshot = { report: undefined, failed: false }
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | undefined
  const publish = (next: StatusSnapshot): void => { snapshot = next; for (const listener of listeners) listener() }
  const poll = async (): Promise<void> => {
    try { publish({ report: await fetchStatus(), failed: false }) } catch { publish({ report: snapshot.report, failed: true }) }
  }
  return {
    getSnapshot: (): StatusSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      if (listeners.size === 1) { void poll(); timer = setInterval(() => { void poll() }, intervalMs) }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer !== undefined) { clearInterval(timer); timer = undefined }
      }
    },
  }
}
