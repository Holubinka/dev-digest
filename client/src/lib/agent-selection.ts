/* agent-selection.ts — the tick state behind "which agents should review this?".

   TWO SCREENS START THE SAME RUN: the PR page's `RunReviewDropdown` and the
   `Configure run` view. They draw the choice differently — a menu of checkbox
   rows against a grid of cards — but the state machine underneath is one thing:
   which agents are ticked, whether the ceiling has been reached, and what a
   click on one agent does. It was written out twice and the two copies were
   identical apart from the projection below, which is exactly the shape that
   starts disagreeing on the first edit.

   Not in `lib/hooks/`: that folder is the TanStack Query layer, and every
   `@/lib/hooks` import pulls its barrel in. This hook touches no endpoint, so it
   sits beside `theme.tsx`'s `useTheme` and `repo-context.tsx`'s
   `useRepoNotFound` — the other stateful, request-free hooks two route trees
   share. */
"use client";

import React from "react";
import { MAX_AGENTS_PER_MULTI_RUN } from "@devdigest/shared";
import type { AgentListItem } from "@devdigest/shared";

/**
 * The selection both entry points open with: every ENABLED agent and no
 * disabled one (AC-9), capped at the ceiling a single request may name (AC-30)
 * so the default can never be a body the server refuses.
 *
 * One rule for both screens on purpose: an entry point that pre-ticks a
 * different set than the other entry point to the same run is a difference the
 * reader has to explain to themselves.
 */
export function defaultSelection(agents: AgentListItem[]): string[] {
  return agents
    .filter((a) => a.enabled)
    .slice(0, MAX_AGENTS_PER_MULTI_RUN)
    .map((a) => a.id);
}

export interface AgentSelection {
  /** The ticked agent ids, in the agents list's own order. */
  selected: string[];
  /** No further agent may be added — AC-30's ceiling is reached. */
  atCeiling: boolean;
  /** Tick or untick one agent; ticking past the ceiling is a no-op. */
  toggle: (agentId: string) => void;
  /** Replace the whole selection — "Select all" / "Clear all". */
  setSelection: (agentIds: string[]) => void;
}

/**
 * THE TICKS ARE NOT DERIVED FROM THE QUERY. `picked === null` means "nobody has
 * touched them yet", so the default follows the agents list as it loads instead
 * of freezing whatever the cache answered first, and no query data is ever
 * copied into `useState` (`frontend-architecture` § 5).
 *
 * KEPT IN THE AGENTS LIST'S OWN ORDER, which is the stable order AC-46 fixes for
 * every surface of this feature. Deriving it by walking `agents` also drops ids
 * of agents that no longer exist, and it is what lets the wave estimate break
 * ties among agents with no run history deterministically (AC-152).
 *
 * `agents` is read on every render, so hand it in as a stable reference —
 * both call sites memoize `agents ?? []`.
 */
export function useAgentSelection(agents: AgentListItem[]): AgentSelection {
  const [picked, setPicked] = React.useState<string[] | null>(null);

  const selected = React.useMemo(() => {
    const chosen = new Set(picked ?? defaultSelection(agents));
    return agents.filter((a) => chosen.has(a.id)).map((a) => a.id);
  }, [picked, agents]);

  const atCeiling = selected.length >= MAX_AGENTS_PER_MULTI_RUN;

  const toggle = (agentId: string) => {
    // Return rather than `setPicked(selected)`: writing the current selection
    // back would flip `picked` from null to an array, and "nobody has touched
    // them yet" is what lets the default follow the agents list as it loads. A
    // click that changes nothing on screen must not quietly freeze the ticks.
    if (atCeiling && !selected.includes(agentId)) return;
    setPicked(
      selected.includes(agentId)
        ? selected.filter((id) => id !== agentId)
        : [...selected, agentId],
    );
  };

  return { selected, atCeiling, toggle, setSelection: setPicked };
}
