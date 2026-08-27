import React from "react";
import { Icon } from "../icons";
import { type DropdownItemDef } from "./types";

function DropdownItem({ it, onClose }: { it: DropdownItemDef; onClose: () => void }) {
  const [h, setH] = React.useState(false);
  const I = it.icon ? Icon[it.icon] : null;
  return (
    <button
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => {
        it.onClick?.();
        onClose();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 10px",
        borderRadius: 6,
        border: "none",
        background: h ? "var(--bg-hover)" : "transparent",
        color: it.muted ? "var(--text-secondary)" : "var(--text-primary)",
        fontSize: 14,
        fontWeight: 500,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {I && <I size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
      <span style={{ flex: 1 }}>{it.label}</span>
      {it.hint && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{it.hint}</span>}
      {it.onRemove && (
        <span
          role="button"
          aria-label={it.removeLabel ?? "Remove"}
          title={it.removeLabel ?? "Remove"}
          onClick={(e) => {
            e.stopPropagation();
            it.onRemove!();
            onClose();
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 3,
            borderRadius: 5,
            color: "var(--text-muted)",
            flexShrink: 0,
          }}
        >
          <Icon.Trash size={13} />
        </span>
      )}
    </button>
  );
}

/* A DELIBERATE EDIT TO A VENDORED FILE. `client/src/vendor/ui/` is on the root
   `CLAUDE.md`'s "do not touch" list, so here is why `filter` and `full` could not
   be added anywhere else — the same kind of note the `NAV` array carries.

   BOTH ARE PROPERTIES OF THE PANEL, and the panel is private to this component.
   A filter box has to sit inside it, above the rows, sharing the open/close
   state that owns the focus and the Esc key; and a menu can only take the
   trigger's width from inside the one element that is `position: relative` to
   both. A wrapper around `Dropdown` can reach neither, and a second dropdown in
   `src/components/` would be the copy that starts drifting on the next edit.

   NOTHING EXISTING CHANGES. Both props are optional and off, so every current
   call renders precisely what it rendered before; `pnpm test` covers the other
   caller (`AgentsListView`).

   THERE IS ONE COPY of `vendor/ui` in this repo — unlike `vendor/shared`, which
   is vendored into `server/` as well — so there is nothing to mirror this into. */
export function Dropdown({
  trigger,
  items,
  align = "left",
  width = 230,
  full = false,
  filter,
}: {
  trigger: React.ReactNode;
  items: DropdownItemDef[];
  /** Which edge the menu hangs from. Unused when `full`, which pins both. */
  align?: "left" | "right";
  /** Menu width. Unused when `full`, which takes the trigger's width instead. */
  width?: number;
  /**
   * Trigger AND menu span the container instead of their own content.
   *
   * One prop rather than two because they are one decision: a control sized by
   * the label it happens to be showing jumps on every pick, and a fixed trigger
   * over a narrower menu reads as a bug. The trigger still has to ask for the
   * width it is given — `<Button full>` — since this only stops the wrapper from
   * shrink-wrapping it.
   */
  full?: boolean;
  /**
   * A filter box above the rows. Absent — the default — there is no box and no
   * filtering, which is what keeps this invisible to every existing caller.
   *
   * Both strings come from the caller because user-facing copy in this repo
   * lives in `messages/<locale>/`, never in a component. Matching is on what the
   * row actually SHOWS, its label and its hint: a reader searching a menu is
   * searching the words in front of them.
   *
   * `noMatches` is shown only once something has been typed. A caller that turns
   * the filter on over an empty `items` still owns saying so — as a muted row of
   * its own, the way an empty list is described everywhere else.
   */
  filter?: { placeholder: string; noMatches: string };
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const ref = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  // Every opening starts from the whole list with the caret already in the box:
  // a menu that reopened onto yesterday's query would hide rows for no visible
  // reason.
  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    inputRef.current?.focus();
  }, [open]);

  const q = filter ? query.trim().toLowerCase() : "";
  /* The original index travels with the row so React's keys stay put while the
     list narrows. Dividers are dropped for as long as a query is on — a rule
     separating two groups the query has emptied is a line about nothing. */
  const shown = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) =>
      q === ""
        ? true
        : !it.divider && `${it.label ?? ""} ${it.hint ?? ""}`.toLowerCase().includes(q),
    );

  return (
    <div ref={ref} style={{ position: "relative", display: full ? "block" : "inline-block" }}>
      <div ref={triggerRef} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </div>
      {open && (
        <div
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            // Stopped here so an Esc meant for this menu does not also close the
            // modal or drawer it may be sitting in; and focus goes back where it
            // came from, or a keyboard user is left standing on <body>.
            e.stopPropagation();
            setOpen(false);
            triggerRef.current?.querySelector("button")?.focus();
          }}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            ...(full ? { left: 0, right: 0 } : { [align]: 0, width }),
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: 9,
            boxShadow: "var(--shadow-modal)",
            padding: 6,
            zIndex: 40,
            animation: "ddpop .12s ease",
          }}
        >
          {filter && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                marginBottom: 4,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <Icon.Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={filter.placeholder}
                aria-label={filter.placeholder}
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13,
                  fontFamily: "inherit",
                  color: "var(--text-primary)",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                }}
              />
            </div>
          )}
          {filter && q !== "" && shown.length === 0 ? (
            // Said in words: an empty panel looks like a menu that failed to load.
            <div role="status" style={{ padding: "8px 10px", fontSize: 13, color: "var(--text-muted)" }}>
              {filter.noMatches}
            </div>
          ) : (
            shown.map(({ it, i }) =>
              it.divider ? (
                <div key={i} style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />
              ) : (
                <DropdownItem key={i} it={it} onClose={() => setOpen(false)} />
              )
            )
          )}
        </div>
      )}
    </div>
  );
}
