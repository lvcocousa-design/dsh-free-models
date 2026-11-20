import type { Message, RequestMessage } from '@deepseek-ai/dsh-llm'

/** Marker key inside the response half of a ReplayEnvelope that this router wrote. */
export const REPLAY_MARK = 'dshFreeModels'

export interface WrappedReplay {
  route: string
  model: string
  inner: unknown
}

interface Envelope { response?: unknown; blocks?: readonly unknown[] }

/** Wrap a provider's replay envelope so the router can tell later which route produced it. */
export function wrapReplay(route: string, model: string, envelope: Envelope): Envelope {
  const wrapped: WrappedReplay = { route, model, inner: envelope.response }
  return {
    response: { [REPLAY_MARK]: wrapped },
    ...envelope.blocks === undefined ? {} : { blocks: envelope.blocks },
  }
}

function unwrap(state: unknown): { wrapped: WrappedReplay; blocks?: readonly unknown[] } | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const envelope = state as Envelope
  const response = envelope.response
  if (typeof response !== 'object' || response === null) return undefined
  const wrapped = (response as Record<string, unknown>)[REPLAY_MARK] as WrappedReplay | undefined
  if (wrapped === undefined || typeof wrapped.route !== 'string' || typeof wrapped.model !== 'string') return undefined
  return { wrapped, ...envelope.blocks === undefined ? {} : { blocks: envelope.blocks } }
}

/**
 * Prepare conversation history for one underlying route.
 *
 * Assistant messages produced by this router carry a wrapped replay state. Thinking
 * signatures and response ids are provider specific, so:
 * - a message the target route and model produced is handed back as that route's own
 *   message, with its original replay state, so the provider sees a normal history;
 * - a message produced by a different route or model loses its replay state, and the provider
 *   receives it as plain content.
 */
export function historyFor(messages: readonly RequestMessage[], route: string, model: string): RequestMessage[] {
  return messages.map((message): RequestMessage => {
    if (message.role !== 'assistant') return message
    const source = message.source
    if (source.replayState === undefined) return message
    const found = unwrap(source.replayState)
    if (found === undefined) {
      // Not ours (some other adapter's state under some other route): never forward it blindly.
      return { ...message, source: { kind: 'model', provider: source.provider, model: source.model } } as Message
    }
    // Signatures can be tied to the exact model, so a different model on the same route gets plain content too.
    if (found.wrapped.route === route && found.wrapped.model === model) {
      return {
        ...message,
        source: {
          kind: 'model',
          provider: route,
          model: found.wrapped.model,
          replayState: { response: found.wrapped.inner, ...found.blocks === undefined ? {} : { blocks: found.blocks } },
        },
      } as Message
    }
    return {
      ...message,
      source: { kind: 'model', provider: found.wrapped.route, model: found.wrapped.model },
    } as Message
  })
}
