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
