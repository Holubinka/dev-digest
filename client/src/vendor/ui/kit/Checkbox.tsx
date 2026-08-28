import React from "react";
import { Icon } from "../icons";

/* A DELIBERATE EDIT TO A VENDORED FILE — the third this session, and the reason
   is one line of it: `flexShrink: 0` on the box.

   THE BOX IS A FLEX ITEM WITH A 16px BASIS AND NO SHRINK GUARD, so whenever the
   `label` beside it is wider than the row, the browser takes the overflow out of
   BOTH children in proportion to their base size. The label absorbs most of it
   and the box absorbs the rest — 16px wide becomes ~10px, and with `borderRadius:
   4` a 10×16 box reads on screen as a narrow upright oval rather than a checkbox.
   The PR page's agent picker hit it at `MENU_WIDTH = 300` on the one row whose
   description is long enough to overflow (screenshot, 2026-08-26).

   `minWidth: 0` on the label does NOT prevent this — it lets the label shrink,
   which is necessary and not sufficient: shrinkage is still distributed across
   every item that has a shrink factor, and the box has one until told otherwise.
   `AgentMonogram` sits in the same rows and stays square precisely because it
   already declares `flexShrink: 0` (`components/agent-monogram/styles.ts:12`).

   Fixed in the primitive rather than worked around in the caller because no
   consumer of a checkbox wants a squashed one, and Configure run builds the same
   agent rows out of the same component — its container is simply wide enough that
   the bug has not yet been visible there. One edit, both screens, no behaviour
   change for anyone. `vendor/ui` exists in a single copy; there is nothing to
   mirror this into. */

/** REAL controlled checkbox (styled). */
export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label?: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 14,
        color: "var(--text-secondary)",
        cursor: "pointer",
      }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange?.(!checked)}
        style={{
          width: 16,
          height: 16,
          flexShrink: 0,
          borderRadius: 4,
          border: "1.5px solid " + (checked ? "var(--accent)" : "var(--border-strong)"),
          background: checked ? "var(--accent)" : "transparent",
          display: "grid",
          placeItems: "center",
          padding: 0,
        }}
      >
        {checked && <Icon.Check size={11} style={{ color: "#fff" }} />}
      </button>
      {label}
    </label>
  );
}
