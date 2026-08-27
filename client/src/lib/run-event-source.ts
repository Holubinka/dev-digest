/* run-event-source.ts — the low-level `EventSource` wiring shared by
   `useRunEvents` and `useMultiRunColumnEvents`.

   Only the wiring lives here: opening the connection, attaching one handler as
   both the default `message` listener and the per-`kind` listener. The two
   hooks stay separate — `useRunEvents` accumulates every run into one list,
   `useMultiRunColumnEvents` attributes per run and caps concurrent streams
   (AC-145, D27) — see the comment above `useMultiRunColumnEvents` for why
   that split is deliberate. */

import { API_BASE } from "./api";

/**
 * The server tags events with `kind` as the SSE `event:` name AND emits them
 * as default messages too in some clients — listen broadly.
 */
export const RUN_EVENT_KINDS = ["info", "tool", "result", "error"] as const;

/** Opens the SSE connection for one run's events and wires `onMessage` to both
 * the default `message` event and every kind in `RUN_EVENT_KINDS`. Callers own
 * `onerror`/`onclose`/cleanup. */
export function openRunEventSource(
  runId: string,
  onMessage: (ev: MessageEvent) => void,
): EventSource {
  const es = new EventSource(`${API_BASE}/runs/${runId}/events`);
  es.onmessage = onMessage;
  for (const kind of RUN_EVENT_KINDS) {
    es.addEventListener(kind, onMessage as EventListener);
  }
  return es;
}
