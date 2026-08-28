/* AgentMonogram — the coloured square that stands in for an agent's avatar.

   The mockup (`specs/assets/SPEC-05-multi-agent-review-configure-run.png`) draws a
   30×30 tile carrying a per-agent ICON — a shield, a bolt, a lightbulb. `Agent`
   carries no icon field (`vendor/shared/contracts/knowledge.ts:733-748`), and the
   human chose on 2026-08-26 not to add one: it would be a contract change plus an
   editor plus the seeds, for a decoration. The tile is therefore the first
   character of the agent's name, in the colour `agentColor` already derives from
   its id — the same colour the picker row, the result column, the tab and the take
   use, which is the connection AC-44 asks the colour to make.

   Shared rather than colocated because two routes draw it: the PR page's picker
   and the Configure run cards (P4). */
"use client";

import React from "react";
import { agentColor } from "@/lib/agent-color";
import { monogram } from "./helpers";
import { s } from "./styles";

export function AgentMonogram({
  agentId,
  name,
  size = 30,
}: {
  /** The immutable id — the ONLY thing the colour is derived from. */
  agentId: string;
  name: string;
  size?: number;
}) {
  const color = agentColor(agentId);
  /**
   * Decorative on purpose. AC-45 already requires the agent's name to be visible
   * wherever the colour is used, so every caller renders the name beside this
   * tile — announcing its first letter again would read the name twice.
   */
  return (
    <span aria-hidden="true" data-agent-monogram style={s.square(size, color)}>
      {monogram(name)}
    </span>
  );
}
