/**
 * `NAV` and `SHORTCUTS` are two hand-maintained arrays, and `SHORTCUTS` is NOT
 * derived from `NAV.items[].gKey` — `ShortcutsHelp.tsx` renders it in the `?`
 * modal. Add a row to `NAV` alone and the shortcut works while never appearing
 * in the help; add it to `SHORTCUTS` alone and the help lies.
 *
 * This is the one check that catches either half being forgotten.
 */
import { describe, it, expect } from "vitest";
import { NAV, SETTINGS_ITEM, SHORTCUTS } from "./nav";

const navItems = NAV.flatMap((group) => group.items);

describe("nav — every g-shortcut is in both registries", () => {
  /**
   * `SETTINGS_ITEM` is deliberately not in this loop. It declares `gKey: ","`
   * and `SHORTCUTS` has no `g ,` row — a gap that predates this feature and is
   * not this change's to close. Reported rather than fixed, so that widening
   * the loop later is a decision somebody takes on purpose.
   */
  it("lists a `g <key>` entry for every nav item that declares one", () => {
    const documented = new Set(SHORTCUTS.map((s) => s.keys));
    for (const item of navItems) {
      if (!item.gKey) continue;
      expect(documented, `${item.label} declares g ${item.gKey}`).toContain(`g ${item.gKey}`);
    }
  });

  it("gives no two items the same g-shortcut", () => {
    const keys = [...navItems, SETTINGS_ITEM].map((i) => i.gKey).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("nav — Onboarding Tour", () => {
  const workspace = NAV.find((g) => g.section === "WORKSPACE")?.items ?? [];
  const row = navItems.find((item) => item.key === "onboarding-tour");

  it("sits in WORKSPACE with the key `activeKeyFor` and shell.json already use", () => {
    // `key: "onboarding-tour"` is load-bearing twice over: `activeKeyFor()`
    // returns it for a repo-scoped /onboarding path, and
    // `messages/en/shell.json` holds `nav.onboarding-tour`. A different key
    // leaves the row unhighlighted and its label untranslated.
    expect(workspace.map((i) => i.key)).toContain("onboarding-tour");
    expect(row?.href).toBe("/repos/:repoId/onboarding");
  });

  it("sits between Pull Requests and Project Context, the order the mockup fixes", () => {
    // Placement, not presence. The sidebar renders this array in order, so the
    // only thing that can hold the mockup's order is an index assertion —
    // "the row exists" passes with it drawn last.
    const keys = workspace.map((i) => i.key);
    expect(keys.indexOf("pulls")).toBeLessThan(keys.indexOf("onboarding-tour"));
    expect(keys.indexOf("onboarding-tour")).toBeLessThan(keys.indexOf("context"));
  });

  it("is reachable by `g o`, and the `?` modal says so", () => {
    expect(row?.gKey).toBe("o");
    expect(SHORTCUTS).toContainEqual({
      keys: "g o",
      label: "Go to Onboarding Tour",
      group: "Navigation",
    });
  });
});

describe("nav — Project Context", () => {
  const row = navItems.find((item) => item.key === "context");

  it("sits in the WORKSPACE group with the key `activeKeyFor` and shell.json already use", () => {
    // `key: "context"` is load-bearing: `activeKeyFor()` returns "context" for a
    // /context path, and `messages/en/shell.json` holds `nav.context`. A
    // different key leaves the sidebar item inert and the label untranslated.
    expect(NAV.find((g) => g.section === "WORKSPACE")?.items.map((i) => i.key)).toContain(
      "context",
    );
    expect(row?.href).toBe("/repos/:repoId/context");
  });

  it("is reachable by `g d`, and the `?` modal says so", () => {
    expect(row?.gKey).toBe("d");
    expect(SHORTCUTS).toContainEqual({
      keys: "g d",
      label: "Go to Project Context",
      group: "Navigation",
    });
  });
});

describe("nav — Multi-Agent Review", () => {
  const global = NAV.find((g) => g.section === "GLOBAL")?.items ?? [];
  const row = navItems.find((item) => item.key === "multi-agent");

  it("gives GLOBAL exactly one row, the one AC-90 names", () => {
    // Presence AND count. The mockup
    // (`specs/assets/SPEC-05-multi-agent-review-configure-run.png`) draws four
    // GLOBAL rows — Memory, Agent Performance and CI Runs beside this one — and
    // SPEC-05 § N7 puts all three out of scope. "Contains the row" passes with a
    // dead link shipped next to it; this does not.
    expect(global.map((i) => i.key)).toEqual(["multi-agent"]);
    expect(row?.label).toBe("Multi-Agent Review");
  });

  it("uses the key `activeKeyFor` and shell.json already fixed", () => {
    // `activeKeyFor()` returns "multi-agent" for any /multi-agent path and
    // `messages/en/shell.json` holds `nav.multi-agent`. A different key leaves
    // the row unhighlighted (AC-91) and its label untranslated.
    expect(row?.href).toBe("/repos/:repoId/multi-agent");
    expect(row?.icon).toBe("Users");
  });

  it("is reachable by `g m`, and the `?` modal says so", () => {
    expect(row?.gKey).toBe("m");
    expect(SHORTCUTS).toContainEqual({
      keys: "g m",
      label: "Go to Multi-Agent Review",
      group: "Navigation",
    });
  });
});
