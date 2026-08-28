import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { agentColor } from "@/lib/agent-color";
import { AgentMonogram } from "./AgentMonogram";
import { monogram } from "./helpers";

afterEach(cleanup);

const AGENTS = [
  { id: "3f1c2b8e-0000-4000-8000-000000000001", name: "Security" },
  { id: "3f1c2b8e-0000-4000-8000-000000000002", name: "Performance" },
  { id: "9a7d5c1f-0000-4000-8000-00000000000a", name: "Junior Mentor" },
];

function renderList(agents: { id: string; name: string }[]) {
  return render(
    <div>
      {agents.map((a) => (
        <span key={a.id} data-testid={a.id}>
          <AgentMonogram agentId={a.id} name={a.name} />
        </span>
      ))}
    </div>,
  );
}

function tileOf(agentId: string): HTMLElement {
  const el = screen.getByTestId(agentId).querySelector("[data-agent-monogram]");
  if (!(el instanceof HTMLElement)) throw new Error(`no tile rendered for ${agentId}`);
  return el;
}

describe("AgentMonogram", () => {
  /**
   * The whole reason the tile exists: the picker lists every agent and the
   * results list only the chosen ones, so anything derived from the POSITION
   * would repaint an agent between the two screens the colour connects.
   */
  it("gives one id the same letter and the same colour whatever the list order", () => {
    renderList(AGENTS);
    const first = AGENTS.map((a) => [tileOf(a.id).textContent, tileOf(a.id).style.color]);
    cleanup();

    renderList([...AGENTS].reverse());
    const reversed = AGENTS.map((a) => [tileOf(a.id).textContent, tileOf(a.id).style.color]);

    expect(reversed).toEqual(first);
  });

  it("paints the tile in that agent's own colour", () => {
    renderList(AGENTS);
    for (const a of AGENTS) {
      // jsdom normalises a hex colour into `rgb(...)`, so compare through the
      // same conversion rather than against the literal.
      const probe = document.createElement("span");
      probe.style.color = agentColor(a.id);
      probe.style.background = agentColor(a.id) + "1f";
      expect(tileOf(a.id).style.color).toBe(probe.style.color);
      // The tint is the same colour at 12%: jsdom parsing `#rrggbb1f` into an
      // `rgba()` at all is what says the 8-digit suffix is valid CSS and not a
      // string that silently paints nothing.
      expect(tileOf(a.id).style.background).toBe(probe.style.background);
      expect(tileOf(a.id).style.background).toMatch(/^rgba\(.+0\.12\)$/);
    }
  });

  it("shows the first letter, upper-cased", () => {
    renderList([{ id: "a1", name: "security reviewer" }]);
    expect(tileOf("a1")).toHaveTextContent("S");
  });

  /** The name is already beside every tile (AC-45), so the tile is decoration. */
  it("is hidden from the accessibility tree", () => {
    renderList(AGENTS);
    expect(tileOf(AGENTS[0]!.id)).toHaveAttribute("aria-hidden", "true");
  });
});

describe("monogram — names that are not plain ASCII", () => {
  it("keeps a non-Latin first character instead of transliterating it", () => {
    expect(monogram("Безпека")).toBe("Б");
    expect(monogram("安全レビュー")).toBe("安");
  });

  /**
   * `name[0]` returns ONE UTF-16 code unit, so an emoji name would render half a
   * surrogate pair — the replacement glyph — in every workspace that uses one.
   */
  it("keeps an astral character whole", () => {
    expect(monogram("🛡 Security")).toBe("🛡");
    expect(monogram("🛡 Security")).toHaveLength(2); // one code point, two code units
  });

  it("skips leading whitespace", () => {
    expect(monogram("   Security")).toBe("S");
  });

  it("renders nothing at all for a nameless agent rather than inventing a glyph", () => {
    expect(monogram("")).toBe("");
    expect(monogram("   ")).toBe("");
    renderList([{ id: "a1", name: "" }]);
    expect(tileOf("a1")).toBeEmptyDOMElement();
    expect(tileOf("a1").style.color).not.toBe("");
  });
});
