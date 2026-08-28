import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { AgentListItem } from "@devdigest/shared";
import { useAgentSelection } from "./agent-selection";

/* `defaultSelection` and `isAllSelected` already have direct coverage via
   `ConfigureRunView/helpers.test.ts` (which imports the same functions from
   this module). What is untested is the HOOK's runtime behaviour: the
   ceiling guard on `toggle`, and the fact that a rejected tick must not
   write the current selection back into `picked`. */

const agent = (id: string, enabled = true): AgentListItem =>
  ({
    id,
    name: id,
    description: "",
    provider: "openai",
    model: "gpt-test",
    system_prompt: "",
    output_schema: null,
    enabled,
    version: 1,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skill_count: 0,
  }) as AgentListItem;

describe("useAgentSelection", () => {
  it("ticking past the ceiling is a true no-op — it does not freeze the default against a later reload", () => {
    const initial = Array.from({ length: 12 }, (_, i) => agent(`a${i}`));
    const { result, rerender } = renderHook(({ agents }) => useAgentSelection(agents), {
      initialProps: { agents: initial },
    });

    // The default caps at MAX_AGENTS_PER_MULTI_RUN (10 of the 12 enabled agents).
    expect(result.current.selected).toHaveLength(10);
    expect(result.current.atCeiling).toBe(true);

    // a10 and a11 were never ticked by the default. Ticking one at the ceiling
    // must change nothing on screen.
    act(() => result.current.toggle("a10"));
    expect(result.current.selected).toHaveLength(10);
    expect(result.current.selected).not.toContain("a10");

    // The real assertion: `picked` must still be `null` after the rejected
    // tick. If `toggle` had written `selected` back (`setPicked(selected)`),
    // it would freeze the ten ids that were the default under the OLD agents
    // list. Prove it did not by reloading the agents list with a new enabled
    // agent at the front and checking the default follows it in.
    const reloaded = [agent("a-new"), ...initial];
    rerender({ agents: reloaded });
    expect(result.current.selected).toContain("a-new");
  });

  it("unticking still works at the ceiling, and drops the ceiling immediately", () => {
    const agents = Array.from({ length: 10 }, (_, i) => agent(`a${i}`));
    const { result } = renderHook(() => useAgentSelection(agents));

    expect(result.current.atCeiling).toBe(true);

    act(() => result.current.toggle("a0"));

    expect(result.current.selected).not.toContain("a0");
    expect(result.current.selected).toHaveLength(9);
    expect(result.current.atCeiling).toBe(false);
  });

  it("keeps `selected` in the agents list's own order, not the order agents were clicked in (AC-46)", () => {
    const agents = [agent("a"), agent("b"), agent("c")];
    const { result } = renderHook(() => useAgentSelection(agents));

    act(() => result.current.setSelection([]));
    act(() => result.current.toggle("c"));
    act(() => result.current.toggle("a"));
    act(() => result.current.toggle("b"));

    expect(result.current.selected).toEqual(["a", "b", "c"]);
  });
});
