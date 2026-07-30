# Findings on the Run Row — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain `N finding(s)` text on each settled run row in the PR timeline with per-severity chips and a hover/focus card scoped to that run.

**Architecture:** Extract the PR list's existing chips-plus-card widget into a presentational `FindingsPreview` under `client/src/components/`, then drive it from two thin adapters — `FindingsCell` (list, `PrMeta`) and a new `RunFindings` (timeline, `FindingRecord[]`). `FindingsTab` already joins reviews to runs by `run_id`; it passes a `Map<run_id, FindingRecord[]>` down to `RunHistory`. Client-only: no endpoint, contract or migration changes.

**Tech Stack:** Next.js 15 App Router (client components), React 19, TypeScript, Vitest 2 + jsdom + Testing Library, `next-intl`, typed `CSSProperties` in colocated `styles.ts`.

**Spec:** [`client/specs/L05-findings-on-the-run-row.md`](../../../client/specs/L05-findings-on-the-run-row.md)

## Global Constraints

- All work happens in `client/`. Use **pnpm**, never npm. Run commands from `client/`.
- Repo files are **English**. No exceptions, including comments and commit messages.
- Styling: typed `CSSProperties` objects in a colocated `styles.ts` — not Tailwind utility classes. Follow the surrounding component.
- Every component that renders in the browser is `"use client"`.
- **Never write a second severity tally.** `SEV` in `vendor/ui/primitives/tokens.ts` has no fallback, so a `findings.severity` value outside the contract crashes the route. Reuse `countBySeverity` from `SeverityFilterBar/helpers.ts`, which drops unknown values.
- Severity levels are exactly three, worst first: `CRITICAL`, `WARNING`, `SUGGESTION` (`vendor/shared/contracts/findings.ts:11`).
- Preview cap is **3**, matching the server's `LIST_FINDINGS_PREVIEW` (`server/src/modules/pulls/routes.ts:19`).
- Do not touch `src/vendor/**` — vendored copies.
- Test command: `pnpm exec vitest run <path>`. Full suite: `pnpm exec vitest run`.
- Typecheck: `pnpm exec tsc --noEmit -p tsconfig.json` (baseline is currently clean — keep it that way).

---

### Task 1: Shared `FindingsPreview` component

Pure addition. Nothing consumes it yet, so the list keeps working untouched. Code is lifted from `FindingsCell` so the two stay behaviourally identical before Task 2 deletes the original.

**Files:**
- Create: `client/src/components/findings-preview/FindingsPreview.tsx`
- Create: `client/src/components/findings-preview/styles.ts`
- Create: `client/src/components/findings-preview/helpers.ts`
- Create: `client/src/components/findings-preview/index.ts`
- Test: `client/src/components/findings-preview/FindingsPreview.test.tsx`
- Test: `client/src/components/findings-preview/helpers.test.ts`

**Interfaces:**
- Consumes: `@devdigest/ui` (`Icon`, `SEV`, `SeverityBadge`, `CategoryTag`, `ConfidenceNum`, types `Severity`, `Category`), `@devdigest/shared` (`ListFinding`).
- Produces:
  - `interface SeverityCount { sev: Severity; n: number | null }`
  - `function FindingsPreview(props: { counts: SeverityCount[]; findings: ListFinding[]; header: string; ariaLabel: string; extra?: React.ReactNode }): JSX.Element`
  - `function shortPath(file: string, budget?: number): string`
  - `function lineRef(startLine: number, endLine: number): string`
  - `const PATH_BUDGET_CHARS = 46`
  - `const CARD_WIDTH = 380`
  - Barrel `@/components/findings-preview` re-exports all of the above.

- [ ] **Step 1: Create the helpers, moved verbatim from `FindingsCell/helpers.ts`**

Create `client/src/components/findings-preview/helpers.ts`:

```ts
/** Longest `file` string the hover card shows before eliding folders. */
export const PATH_BUDGET_CHARS = 46;

/**
 * Shorten a repo path from the LEFT, at a folder boundary: the filename is what
 * identifies a finding, so it is the part that must survive. A path that fits is
 * returned untouched.
 *
 * `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`
 * → `…/FindingsPanel/FindingsPanel.tsx`
 *
 * The card also clips with `text-overflow: ellipsis`, but only this keeps the
 * informative end of the path — CSS would drop the filename instead.
 */
export function shortPath(file: string, budget: number = PATH_BUDGET_CHARS): string {
  if (file.length <= budget) return file;
  const parts = file.split("/");
  let out = parts[parts.length - 1] ?? file;
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = `${parts[i]}/${out}`;
    if (next.length + 2 > budget) break;
    out = next;
  }
  return `…/${out}`;
}

/** `file:line` as the card shows it — a range only when the lines differ. */
export function lineRef(startLine: number, endLine: number): string {
  return startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
}
```

- [ ] **Step 2: Write the failing helper test**

Create `client/src/components/findings-preview/helpers.test.ts` — these four cases move here from `FindingsCell.test.tsx`, because the function moved:

```ts
import { describe, it, expect } from "vitest";
import { shortPath } from "./helpers";

describe("shortPath", () => {
  it("leaves a path that already fits", () => {
    expect(shortPath("src/config.ts", 46)).toBe("src/config.ts");
  });

  it("keeps the filename and as many trailing folders as fit in the budget", () => {
    const out = shortPath("client/src/app/repos/[repoId]/pulls/_components/FindingsCell/FindingsCell.tsx", 46);
    expect(out).toBe("…/_components/FindingsCell/FindingsCell.tsx");
    expect(out.length).toBeLessThanOrEqual(46);
  });

  it("drops a folder that would blow the budget", () => {
    expect(shortPath("client/src/app/repos/[repoId]/pulls/_components/FindingsCell/FindingsCell.tsx", 34)).toBe(
      "…/FindingsCell/FindingsCell.tsx",
    );
  });

  it("keeps the filename even when the filename alone is too long", () => {
    expect(shortPath("a/b/an-extremely-long-file-name-that-alone-exceeds-the-budget.ts", 20)).toBe(
      "…/an-extremely-long-file-name-that-alone-exceeds-the-budget.ts",
    );
  });
});
```

- [ ] **Step 3: Run the helper test**

Run: `cd client && pnpm exec vitest run src/components/findings-preview/helpers.test.ts`
Expected: PASS (4 tests) — the implementation was written in Step 1 because it is a verbatim move, not new behaviour.

- [ ] **Step 4: Create the styles, moved from `FindingsCell/styles.ts`**

Create `client/src/components/findings-preview/styles.ts`. Identical to the original except that the card width becomes a named export, because the component needs the same number to decide when to flip the card left:

```ts
import type { CSSProperties } from "react";

/** Card width, shared with the component's viewport-edge calculation. */
export const CARD_WIDTH = 380;

/** Co-located styles for the severity chips and their hover card. */
export const s = {
  cell: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    minWidth: 0,
  } satisfies CSSProperties,
  chip: (color: string, empty: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontVariantNumeric: "tabular-nums",
    color: empty ? "var(--text-muted)" : color,
    opacity: empty ? 0.5 : 1,
  }),
  // Fixed, not absolute: <main> scrolls with `overflow: auto`, which would clip
  // a card anchored inside the row — most visibly on the last one.
  card: (top: number, left: number): CSSProperties => ({
    position: "fixed",
    top,
    left,
    zIndex: 60,
    width: CARD_WIDTH,
    padding: "10px 0 4px",
    borderRadius: 10,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    boxShadow: "0 12px 32px rgba(0,0,0,.28)",
    pointerEvents: "none",
  }),
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "0 14px 8px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  item: (first: boolean): CSSProperties => ({
    padding: "9px 14px",
    borderTop: first ? "none" : "1px solid var(--border)",
  }),
  itemTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    // Without this the category tag is squeezed to nothing by a long title.
    flexWrap: "nowrap",
  } satisfies CSSProperties,
  itemTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  itemMetaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "4px 0 0",
    // A flex item will not shrink below its content unless min-width is 0, so a
    // long repo path would otherwise push straight through the card's edge.
    minWidth: 0,
  } satisfies CSSProperties,
  itemFile: {
    display: "inline-flex",
    fontSize: 12,
    color: "var(--accent-text)",
    minWidth: 0,
  } satisfies CSSProperties,
  /** Only the folders give way — the filename is elided in `shortPath` first. */
  itemPath: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  /** `:45-52` is the actionable half of a citation; it never shrinks. */
  itemLine: { flexShrink: 0 } satisfies CSSProperties,
  itemConfidence: { flexShrink: 0 } satisfies CSSProperties,
  itemRationale: {
    margin: "5px 0 0",
    fontSize: 12,
    lineHeight: 1.45,
    color: "var(--text-secondary)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
} as const;
```

- [ ] **Step 5: Write the failing component test**

Create `client/src/components/findings-preview/FindingsPreview.test.tsx`. Note there is **no** `NextIntlClientProvider` — the component takes rendered strings, which is the point of making it presentational:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ListFinding } from "@devdigest/shared";
import { FindingsPreview, type SeverityCount } from "./FindingsPreview";

afterEach(cleanup);

const COUNTS: SeverityCount[] = [
  { sev: "CRITICAL", n: 1 },
  { sev: "WARNING", n: 2 },
  { sev: "SUGGESTION", n: 0 },
];

const LABEL = "1 critical, 2 warning, 0 suggestion";

const FINDING: ListFinding = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 12,
  end_line: 12,
  confidence: 0.98,
  rationale: "Line 12 contains a literal sk_live_ Stripe key.",
};

function renderPreview(over: Partial<React.ComponentProps<typeof FindingsPreview>> = {}) {
  return render(
    <FindingsPreview
      counts={COUNTS}
      findings={[FINDING]}
      header="3 finding(s)"
      ariaLabel={LABEL}
      {...over}
    />,
  );
}

describe("FindingsPreview", () => {
  it("renders one chip per count, under the caller's aria-label", () => {
    renderPreview();
    const group = screen.getByLabelText(LABEL);
    expect(group).toBeInTheDocument();
    expect(group.textContent).toBe("120");
  });

  it("lists the findings on hover, under the caller's header", () => {
    renderPreview();
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    expect(screen.getByText("3 finding(s)")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });

  it("opens the same card on keyboard focus", () => {
    renderPreview();
    fireEvent.focus(screen.getByLabelText(LABEL));
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });

  it("hides the card again on mouse leave", () => {
    renderPreview();
    const group = screen.getByLabelText(LABEL);
    fireEvent.mouseEnter(group);
    fireEvent.mouseLeave(group);
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
  });

  it("hides the card again on blur", () => {
    renderPreview();
    const group = screen.getByLabelText(LABEL);
    fireEvent.focus(group);
    fireEvent.blur(group);
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
  });

  it("opens no card when there is nothing to list", () => {
    renderPreview({ findings: [], header: "0 finding(s)" });
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    expect(screen.queryByText("0 finding(s)")).not.toBeInTheDocument();
  });

  it("renders the extra slot after the chips", () => {
    renderPreview({ extra: <span>blockers-slot</span> });
    expect(screen.getByText("blockers-slot")).toBeInTheDocument();
  });

  it("elides a long path from the left so it stays inside the card", () => {
    const long = "client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx";
    renderPreview({
      findings: [{ ...FINDING, file: long, start_line: 30, end_line: 45 }],
    });
    fireEvent.mouseEnter(screen.getByLabelText(LABEL));
    const shown = screen.getByTitle(`${long}:30-45`);
    expect(shown.textContent).toBe("…/_components/FindingsPanel/FindingsPanel.tsx:30-45");
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd client && pnpm exec vitest run src/components/findings-preview/FindingsPreview.test.tsx`
Expected: FAIL — `Failed to resolve import "./FindingsPreview"`.

- [ ] **Step 7: Write the component**

Create `client/src/components/findings-preview/FindingsPreview.tsx`:

```tsx
/* FindingsPreview — severity counts with a read-only card previewing the worst
   findings behind them, opened on hover or keyboard focus.

   Presentational on purpose: it takes already-translated strings and an
   already-ordered, already-capped list, so the PR list (PrMeta columns) and the
   timeline's run row (one run's FindingRecords) can both drive it without the
   component knowing either shape. */
"use client";

import React from "react";
import {
  Icon,
  SEV,
  SeverityBadge,
  CategoryTag,
  ConfidenceNum,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { ListFinding } from "@devdigest/shared";
import { lineRef, shortPath } from "./helpers";
import { CARD_WIDTH, s } from "./styles";

/** Gap between the trigger and the card, and the margin kept from the viewport edge. */
const CARD_OFFSET = 8;
const CARD_MARGIN = 12;
/** Rough card height used to decide whether it still fits below the trigger. */
const CARD_MAX_HEIGHT = 320;

export interface SeverityCount {
  sev: Severity;
  /** Rendered as 0 when null — callers that mean "no data" render something else. */
  n: number | null;
}

export function FindingsPreview({
  counts,
  findings,
  header,
  ariaLabel,
  extra,
}: {
  /** Worst severity first — the array order is the render order. */
  counts: SeverityCount[];
  /** Already ordered and capped by the caller. Empty means no card opens. */
  findings: ListFinding[];
  /** Card header, already translated. */
  header: string;
  /** Group label for screen readers, already translated. */
  ariaLabel: string;
  /** Rendered after the chips — the run row puts its blockers chip here. */
  extra?: React.ReactNode;
}) {
  const [anchor, setAnchor] = React.useState<{ top: number; left: number } | null>(null);

  const open = React.useCallback(
    (el: HTMLElement) => {
      if (findings.length === 0) return;
      const r = el.getBoundingClientRect();
      const below = r.bottom + CARD_OFFSET;
      const fitsBelow = below + CARD_MAX_HEIGHT < window.innerHeight;
      setAnchor({
        top: fitsBelow ? below : Math.max(CARD_MARGIN, r.top - CARD_OFFSET - CARD_MAX_HEIGHT),
        left: Math.min(r.left, window.innerWidth - CARD_WIDTH - CARD_MARGIN),
      });
    },
    [findings.length],
  );

  return (
    <div
      style={s.cell}
      tabIndex={0}
      aria-label={ariaLabel}
      onMouseEnter={(e) => open(e.currentTarget)}
      onFocus={(e) => open(e.currentTarget)}
      onMouseLeave={() => setAnchor(null)}
      onBlur={() => setAnchor(null)}
    >
      {counts.map(({ sev, n }) => {
        const meta = SEV[sev];
        const SevIcon = Icon[meta.icon];
        return (
          <span key={sev} style={s.chip(meta.c, !n)}>
            <SevIcon size={13} />
            {n ?? 0}
          </span>
        );
      })}
      {extra}

      {anchor && (
        <div style={s.card(anchor.top, anchor.left)} role="tooltip">
          <div style={s.cardHeader}>
            <Icon.AlertOctagon size={12} />
            {header}
          </div>
          {findings.map((f, i) => (
            <div key={f.id} style={s.item(i === 0)}>
              <div style={s.itemTitleRow}>
                <SeverityBadge severity={f.severity as Severity} compact />
                <span style={s.itemTitle}>{f.title}</span>
                <CategoryTag category={f.category as Category} />
              </div>
              <div style={s.itemMetaRow}>
                <span
                  className="mono"
                  style={s.itemFile}
                  title={`${f.file}:${lineRef(f.start_line, f.end_line)}`}
                >
                  <span style={s.itemPath}>{shortPath(f.file)}</span>
                  <span style={s.itemLine}>:{lineRef(f.start_line, f.end_line)}</span>
                </span>
                <span style={s.itemConfidence}>
                  <ConfidenceNum value={f.confidence} />
                </span>
              </div>
              <p style={s.itemRationale}>{f.rationale}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default FindingsPreview;
```

- [ ] **Step 8: Create the barrel**

Create `client/src/components/findings-preview/index.ts`:

```ts
export * from "./FindingsPreview";
export * from "./helpers";
export * from "./styles";
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd client && pnpm exec vitest run src/components/findings-preview`
Expected: PASS (12 tests — 8 component, 4 helper).

- [ ] **Step 10: Typecheck**

Run: `cd client && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no output.

- [ ] **Step 11: Commit**

```bash
git add client/src/components/findings-preview
git commit -m "feat(client): extract the findings chips + hover card into a shared component

The PR list's FINDINGS cell and the timeline's run row want the same widget over
different data, so lift it out before the second consumer exists. Presentational:
it takes translated strings and an ordered, capped list, so neither consumer's
shape leaks into it."
```

---

### Task 2: Point `FindingsCell` at the shared component

Deletes the duplication Task 1 created. The eight `FindingsCell` behaviour tests are the guard and must pass byte-identical; only the now-dead `shortPath` import and its describe block leave the file, because that function moved in Task 1.

**Files:**
- Modify: `client/src/app/repos/[repoId]/pulls/_components/FindingsCell/FindingsCell.tsx` (full rewrite, ~30 lines)
- Modify: `client/src/app/repos/[repoId]/pulls/_components/FindingsCell/styles.ts` (shrinks to the never-reviewed dash)
- Delete: `client/src/app/repos/[repoId]/pulls/_components/FindingsCell/helpers.ts`
- Modify: `client/src/app/repos/[repoId]/pulls/_components/FindingsCell/FindingsCell.test.tsx` (drop the `shortPath` import and its `describe`; leave everything else untouched)

**Interfaces:**
- Consumes: `FindingsPreview`, `SeverityCount` from `@/components/findings-preview` (Task 1).
- Produces: no API change — `FindingsCell({ pr }: { pr: PrMeta })` keeps its signature.

- [ ] **Step 1: Trim `FindingsCell/styles.ts` to the dash**

Replace the whole file with:

```ts
import type { CSSProperties } from "react";

/**
 * The chips and their card now live in `@/components/findings-preview`; what
 * stays here is the one thing that is the column's own business — how a PR
 * nobody has reviewed renders.
 */
export const s = {
  neverReviewed: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
```

- [ ] **Step 2: Rewrite `FindingsCell.tsx` as an adapter**

Replace the whole file with:

```tsx
/* FindingsCell — the list's FINDINGS column: one count per severity, plus a
   read-only card on hover/focus previewing the worst few findings behind them.
   Everything comes from the list payload, so hovering costs no request.

   The widget itself is shared with the PR timeline's run row; this file is only
   the adapter from `PrMeta` to it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FindingsPreview, type SeverityCount } from "@/components/findings-preview";
import type { PrMeta } from "@/lib/types";
import { FINDINGS_FIELDS } from "../../constants";
import { s } from "./styles";

export function FindingsCell({ pr }: { pr: PrMeta }) {
  const t = useTranslations("prReview");

  const counts: SeverityCount[] = FINDINGS_FIELDS.map(({ sev, field }) => ({
    sev,
    n: pr[field] ?? null,
  }));
  // null everywhere = never reviewed. Zeroes = reviewed and clean. The two are
  // different answers and the column says so.
  const reviewed = counts.some(({ n }) => n != null);
  const total = counts.reduce((sum, { n }) => sum + (n ?? 0), 0);

  if (!reviewed) return <div style={s.neverReviewed}>—</div>;

  return (
    <FindingsPreview
      counts={counts}
      findings={pr.findings_top ?? []}
      header={t("list.findings.total", { count: total })}
      ariaLabel={counts.map(({ sev, n }) => `${n ?? 0} ${sev.toLowerCase()}`).join(", ")}
    />
  );
}

export default FindingsCell;
```

- [ ] **Step 3: Delete the moved helpers**

```bash
git rm client/src/app/repos/\[repoId\]/pulls/_components/FindingsCell/helpers.ts
```

- [ ] **Step 4: Drop the moved tests from `FindingsCell.test.tsx`**

Two edits, nothing else in the file changes:

1. Delete the import line `import { shortPath } from "./helpers";`
2. Delete the entire trailing `describe("shortPath", () => { ... });` block (the last block in the file).

The eight `describe("FindingsCell", ...)` tests stay byte-identical — they are what proves the refactor changed nothing.

- [ ] **Step 5: Run the guard tests**

Run: `cd client && pnpm exec vitest run "src/app/repos/[repoId]/pulls/_components/FindingsCell"`
Expected: PASS (8 tests). If any of the eight fail, the refactor changed behaviour — fix the component, never the test.

- [ ] **Step 6: Run the full client suite and typecheck**

Run: `cd client && pnpm exec vitest run && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: all tests pass; no typecheck output.

- [ ] **Step 7: Commit**

```bash
git add -A client/src/app/repos/\[repoId\]/pulls/_components/FindingsCell
git commit -m "refactor(client): drive the list's FINDINGS cell from the shared preview

Same rendering, same eight behaviour tests, ~160 fewer lines of markup, styles
and path-eliding helpers. The cell keeps only what is its own business: how a PR
nobody has reviewed renders."
```

---

### Task 3: `RunFindings` — the run row's adapter

**Files:**
- Create: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunFindings/RunFindings.tsx`
- Create: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunFindings/helpers.ts`
- Create: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunFindings/styles.ts`
- Create: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunFindings/index.ts`
- Test: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunFindings/RunFindings.test.tsx`
- Modify: `client/messages/en/prReview.json` (two keys under `timeline`)

**Interfaces:**
- Consumes: `FindingsPreview`, `SeverityCount` (Task 1); `countBySeverity` and `SEVERITY_LEVELS` from `../SeverityFilterBar`.
- Produces:
  - `function RunFindings(props: { findings: FindingRecord[]; blockers: number | null }): JSX.Element`
  - `function topFindings(findings: FindingRecord[], limit: number): ListFinding[]`
  - `const RUN_FINDINGS_PREVIEW = 3`

- [ ] **Step 1: Add the two i18n keys**

In `client/messages/en/prReview.json`, extend the existing `timeline` block to read:

```json
  "timeline": {
    "goToReview": "Jump to this run’s findings below",
    "openTrace": "Open run trace & logs",
    "deleteRun": "Delete run",
    "findingsInRun": "{count} finding(s) in this run",
    "blockersHint": "{count} finding(s) trip this agent’s CI gate"
  },
```

Note the typographic apostrophe `’` in `blockersHint` — it matches the two keys above it.

- [ ] **Step 2: Write the failing helper + component test**

Create `client/src/app/repos/[repoId]/pulls/[number]/_components/RunFindings/RunFindings.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunFindings } from "./RunFindings";
import { topFindings } from "./helpers";

afterEach(cleanup);

function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "Line 12 contains a literal sk_live_ Stripe key.",
    confidence: 0.9,
    ...over,
  } as FindingRecord;
}

function renderRunFindings(findings: FindingRecord[], blockers: number | null = null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunFindings findings={findings} blockers={blockers} />
    </NextIntlClientProvider>,
  );
}

describe("RunFindings", () => {
  it("counts this run's findings by severity, worst first", () => {
    renderRunFindings([
      finding({ id: "a", severity: "CRITICAL" }),
      finding({ id: "b", severity: "WARNING" }),
      finding({ id: "c", severity: "WARNING" }),
    ]);
    expect(screen.getByLabelText("1 critical, 2 warning, 0 suggestion")).toBeInTheDocument();
  });

  it("shows dimmed zeros for a run that found nothing, and opens no card", () => {
    renderRunFindings([]);
    const group = screen.getByLabelText("0 critical, 0 warning, 0 suggestion");
    fireEvent.mouseEnter(group);
    expect(screen.queryByText("0 finding(s) in this run")).not.toBeInTheDocument();
  });

  it("heads the card with this run's total, not the previewed slice", () => {
    renderRunFindings([
      finding({ id: "a", severity: "CRITICAL" }),
      finding({ id: "b", severity: "WARNING" }),
      finding({ id: "c", severity: "WARNING" }),
      finding({ id: "d", severity: "SUGGESTION" }),
    ]);
    fireEvent.mouseEnter(screen.getByLabelText("1 critical, 2 warning, 1 suggestion"));
    expect(screen.getByText("4 finding(s) in this run")).toBeInTheDocument();
  });

  it("shows the blockers chip only when the CI gate tripped", () => {
    renderRunFindings([finding()], 2);
    expect(screen.getByLabelText("1 critical, 0 warning, 0 suggestion, 2 blockers")).toBeInTheDocument();
  });

  it("shows no blockers chip at zero or null", () => {
    renderRunFindings([finding()], 0);
    expect(screen.getByLabelText("1 critical, 0 warning, 0 suggestion")).toBeInTheDocument();
    cleanup();
    renderRunFindings([finding()], null);
    expect(screen.getByLabelText("1 critical, 0 warning, 0 suggestion")).toBeInTheDocument();
  });

  it("ignores a severity outside the contract instead of throwing", () => {
    expect(() =>
      renderRunFindings([finding({ id: "x", severity: "BOGUS" as FindingRecord["severity"] })]),
    ).not.toThrow();
    expect(screen.getByLabelText("0 critical, 0 warning, 0 suggestion")).toBeInTheDocument();
  });
});

describe("topFindings", () => {
  it("ranks worst severity first, then most confident", () => {
    const out = topFindings(
      [
        finding({ id: "sugg", severity: "SUGGESTION", confidence: 0.99 }),
        finding({ id: "warn-low", severity: "WARNING", confidence: 0.2 }),
        finding({ id: "warn-high", severity: "WARNING", confidence: 0.8 }),
        finding({ id: "crit", severity: "CRITICAL", confidence: 0.1 }),
      ],
      10,
    );
    expect(out.map((f) => f.id)).toEqual(["crit", "warn-high", "warn-low", "sugg"]);
  });

  it("caps the list at the limit", () => {
    const many = Array.from({ length: 9 }, (_, i) => finding({ id: `f${i}` }));
    expect(topFindings(many, 3)).toHaveLength(3);
  });

  it("drops a severity outside the contract rather than ranking it last", () => {
    const out = topFindings([finding({ id: "bad", severity: "BOGUS" as FindingRecord["severity"] })], 3);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd client && pnpm exec vitest run "src/app/repos/[repoId]/pulls/[number]/_components/RunFindings"`
Expected: FAIL — `Failed to resolve import "./RunFindings"`.

- [ ] **Step 4: Write the helpers**

Create `client/src/app/repos/[repoId]/pulls/[number]/_components/RunFindings/helpers.ts`:

```ts
import type { FindingRecord, ListFinding } from "@devdigest/shared";
import { SEVERITY_LEVELS } from "../SeverityFilterBar";

/**
 * How many findings the run row's card previews. Same number the server uses to
 * build `findings_top` for the PR list (`LIST_FINDINGS_PREVIEW`), so the two
 * cards show the same depth.
 */
export const RUN_FINDINGS_PREVIEW = 3;

/** Worst severity first — the index in the contract's own worst-first order. */
const RANK: Record<string, number> = Object.fromEntries(
  SEVERITY_LEVELS.map((level, i) => [level, i]),
);

/**
 * The findings worth previewing for one run: worst severity first, then most
 * confident — mirroring the server's `topFindings` so the list card and the run
 * card rank identically.
 *
 * Severities outside the contract are dropped rather than ranked last, for the
 * same reason the counting helper ignores them: `SEV` has no fallback and a
 * stray value would take the route down.
 */
export function topFindings(findings: FindingRecord[], limit: number): ListFinding[] {
  return findings
    .filter((f) => f.severity in RANK)
    .sort(
      (a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || b.confidence - a.confidence,
    )
    .slice(0, limit);
}
```

- [ ] **Step 5: Write the styles**

Create `client/src/app/repos/[repoId]/pulls/[number]/_components/RunFindings/styles.ts`:

```ts
import type { CSSProperties } from "react";

export const s = {
  /**
   * Blockers is a different axis from severity — it is the agent's CI gate, not
   * a severity bucket — so it sits behind a divider rather than in the row of
   * chips.
   */
  blockers: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    paddingLeft: 10,
    borderLeft: "1px solid var(--border)",
    color: "var(--crit)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,
} as const;
```

- [ ] **Step 6: Write the component**

Create `client/src/app/repos/[repoId]/pulls/[number]/_components/RunFindings/RunFindings.tsx`:

```tsx
/* RunFindings — one timeline row's severity readout: counts derived from that
   run's own findings, a card previewing its worst three, and the CI-gate
   blocker chip beside them. The widget is shared with the PR list; this file is
   the adapter from one run's `FindingRecord[]` to it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingsPreview, type SeverityCount } from "@/components/findings-preview";
import { SEVERITY_LEVELS, countBySeverity } from "../SeverityFilterBar";
import { RUN_FINDINGS_PREVIEW, topFindings } from "./helpers";
import { s } from "./styles";

export function RunFindings({
  findings,
  blockers,
}: {
  /** This run's findings — not the PR's. */
  findings: FindingRecord[];
  /** Findings that trip this agent's CI gate; not a severity bucket. */
  blockers: number | null;
}) {
  const t = useTranslations("prReview");

  // Reuse the filter bar's tally rather than writing a second one: it drops
  // severities outside the contract, and `SEV` has no fallback for them.
  const counts = React.useMemo(() => countBySeverity(findings), [findings]);
  const preview = React.useMemo(
    () => topFindings(findings, RUN_FINDINGS_PREVIEW),
    [findings],
  );

  const chips: SeverityCount[] = SEVERITY_LEVELS.map((sev) => ({ sev, n: counts[sev] }));
  const total = SEVERITY_LEVELS.reduce((sum, sev) => sum + counts[sev], 0);
  const gated = blockers ?? 0;

  const ariaLabel =
    chips.map(({ sev, n }) => `${n ?? 0} ${sev.toLowerCase()}`).join(", ") +
    (gated > 0 ? `, ${gated} blockers` : "");

  return (
    <FindingsPreview
      counts={chips}
      findings={preview}
      header={t("timeline.findingsInRun", { count: total })}
      ariaLabel={ariaLabel}
      extra={
        gated > 0 ? (
          <span style={s.blockers} title={t("timeline.blockersHint", { count: gated })}>
            <Icon.Shield size={13} />
            {gated}
          </span>
        ) : null
      }
    />
  );
}

export default RunFindings;
```

- [ ] **Step 7: Create the barrel**

Create `client/src/app/repos/[repoId]/pulls/[number]/_components/RunFindings/index.ts`:

```ts
export * from "./RunFindings";
export * from "./helpers";
```

- [ ] **Step 8: Confirm `SeverityFilterBar` re-exports what this task imports**

`RunFindings` imports `SEVERITY_LEVELS` and `countBySeverity` from `../SeverityFilterBar`. Check the barrel:

Run: `cat "client/src/app/repos/[repoId]/pulls/[number]/_components/SeverityFilterBar/index.ts"`

If either name is missing, add it — export from `./constants` and `./helpers` alongside whatever is already there. Do not deep-import past the barrel.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd client && pnpm exec vitest run "src/app/repos/[repoId]/pulls/[number]/_components/RunFindings"`
Expected: PASS (9 tests — 6 component, 3 helper).

- [ ] **Step 10: Typecheck**

Run: `cd client && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no output.

- [ ] **Step 11: Commit**

```bash
git add client/src/app/repos/\[repoId\]/pulls/\[number\]/_components/RunFindings client/messages/en/prReview.json
git commit -m "feat(client): add the run row's severity readout

Counts one run's own findings, previews its worst three, and keeps blockers as a
separate chip — it is the agent's CI gate, not a severity bucket, so two runs
with identical counts can still differ there."
```

---

### Task 4: Wire the readout into the timeline

**Files:**
- Modify: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:88-102` (props) and `:192-197` (the text line)
- Modify: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx` (build the map, pass it down)
- Test: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.test.tsx` (append one describe)

**Interfaces:**
- Consumes: `RunFindings` from `../RunFindings` (Task 3).
- Produces: `RunHistory` gains one **optional** prop, `findingsByRun?: Map<string, FindingRecord[]>`. Optional matters — the existing `RunHistory` tests render without it and must keep passing on the text fallback.

- [ ] **Step 1: Write the failing test**

Append to `client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.test.tsx`. Add `FindingRecord` to the existing type import from `@devdigest/shared`, then:

```tsx
describe("RunHistory — per-run findings", () => {
  const finding = (id: string, severity: string): FindingRecord =>
    ({
      id,
      severity,
      category: "security",
      title: `Finding ${id}`,
      file: "src/config.ts",
      start_line: 12,
      end_line: 12,
      rationale: "why",
      confidence: 0.9,
    }) as FindingRecord;

  function renderWithFindings(
    runs: RunSummary[],
    findingsByRun: Map<string, FindingRecord[]>,
  ) {
    return render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <RunHistory runs={runs} findingsByRun={findingsByRun} onOpenTrace={() => {}} />
      </NextIntlClientProvider>,
    );
  }

  it("shows severity chips for a settled run whose review is on the page", () => {
    renderWithFindings(
      [run({ status: "done", findings_count: 2, blockers: 0, score: 61 })],
      new Map([["run-1", [finding("a", "CRITICAL"), finding("b", "WARNING")]]]),
    );
    expect(screen.getByLabelText("1 critical, 1 warning, 0 suggestion")).toBeInTheDocument();
    expect(screen.queryByText("2 finding(s)")).not.toBeInTheDocument();
  });

  it("keeps the plain count when the run's review is not in the payload", () => {
    renderWithFindings(
      [run({ status: "done", findings_count: 2, blockers: 0, score: 61 })],
      new Map(),
    );
    // Zeros would claim the run was clean; the count is all we actually know.
    expect(screen.getByText("2 finding(s)")).toBeInTheDocument();
    expect(screen.queryByLabelText(/critical/)).not.toBeInTheDocument();
  });

  it("shows no chips on a run that has not settled", () => {
    renderWithFindings(
      [run({ status: "running", score: null, blockers: null })],
      new Map([["run-1", [finding("a", "CRITICAL")]]]),
    );
    expect(screen.queryByLabelText(/critical/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client && pnpm exec vitest run "src/app/repos/[repoId]/pulls/[number]/_components/RunHistory"`
Expected: FAIL — the first case cannot find the label, because `RunHistory` still renders text.

- [ ] **Step 3: Add the prop to `RunHistory`**

In `RunHistory.tsx`, add the import:

```tsx
import type { RunSummary, PrCommit, FindingRecord } from "@devdigest/shared";
import { RunFindings } from "../RunFindings";
```

Then extend the props — add to both the destructuring and the type:

```tsx
export function RunHistory({
  runs,
  commits = [],
  findingsByRun,
  onOpenTrace,
  onGoToReview,
  onDelete,
}: {
  runs: RunSummary[];
  commits?: PrCommit[];
  /**
   * That run's own findings, keyed by run_id. A run missing from the map keeps
   * the plain count: the per-severity split lives on the review, and rendering
   * zeros would claim the run was clean rather than admit we do not know.
   */
  findingsByRun?: Map<string, FindingRecord[]>;
  /** Open the trace + log drawer for a run (the logs icon). */
  onOpenTrace: (runId: string) => void;
  /** Jump to this run's inline review accordion below (clicking the agent name). */
  onGoToReview?: (runId: string) => void;
  onDelete?: (runId: string) => void;
}) {
```

- [ ] **Step 4: Swap the text line for the readout**

In `RunHistory.tsx`, replace this block (currently at `:192-197`):

```tsx
              {settled && (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {t("runStatus.findings", { count: r.findings_count ?? 0 })}
                  {(r.blockers ?? 0) > 0 ? t("runStatus.blockers", { count: r.blockers ?? 0 }) : ""}
                </div>
              )}
```

with:

```tsx
              {settled &&
                (findingsByRun?.has(r.run_id) ? (
                  <RunFindings findings={findingsByRun.get(r.run_id) ?? []} blockers={r.blockers} />
                ) : (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {t("runStatus.findings", { count: r.findings_count ?? 0 })}
                    {(r.blockers ?? 0) > 0 ? t("runStatus.blockers", { count: r.blockers ?? 0 }) : ""}
                  </div>
                ))}
```

- [ ] **Step 5: Run the `RunHistory` tests**

Run: `cd client && pnpm exec vitest run "src/app/repos/[repoId]/pulls/[number]/_components/RunHistory"`
Expected: PASS — 11 existing tests (they render without the map and land on the fallback) plus the 3 new ones.

- [ ] **Step 6: Feed the map from `FindingsTab`**

In `FindingsTab.tsx`, next to the existing `runById` memo (around `:78`), add:

```tsx
  // The timeline rows carry only a findings COUNT; the per-severity split lives
  // on the review. Both are already here — key the reviews by run so the rows
  // can show severity without another request.
  const findingsByRun = React.useMemo(() => {
    const map = new Map<string, FindingRecord[]>();
    for (const review of runs) {
      if (review.run_id) map.set(review.run_id, review.findings);
    }
    return map;
  }, [runs]);
```

Then pass it to `RunHistory` (around `:154`):

```tsx
          <RunHistory
            runs={prRuns ?? []}
            commits={prCommits}
            findingsByRun={findingsByRun}
            onOpenTrace={handleOpenTrace}
            onGoToReview={handleGoToReview}
            onDelete={handleDelete}
          />
```

`FindingRecord` is already imported in this file — check the import line and add it only if missing.

- [ ] **Step 7: Run the full client suite and typecheck**

Run: `cd client && pnpm exec vitest run && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: all tests pass; no typecheck output.

- [ ] **Step 8: Commit**

```bash
git add client/src/app/repos/\[repoId\]/pulls/\[number\]/_components/RunHistory client/src/app/repos/\[repoId\]/pulls/\[number\]/_components/FindingsTab
git commit -m "feat(client): show findings by severity on the timeline's run row

Comparing two runs of the same PR is the point of the timeline, and prose did not
support it. The reviews are already on the page and already joined to the runs by
run_id, so this costs no request. A run whose review is missing keeps the plain
count rather than claiming three zeros."
```

---

### Task 5: Mark the spec implemented

**Files:**
- Modify: `client/specs/L05-findings-on-the-run-row.md` (status line + any divergence)
- Modify: `client/specs/README.md` (index status)

- [ ] **Step 1: Verify the whole thing runs**

Run: `cd client && pnpm exec vitest run && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: green.

- [ ] **Step 2: Update the spec status**

In `client/specs/L05-findings-on-the-run-row.md`, change `**Status:** proposed 2026-07-30.` to `**Status:** implemented 2026-07-30.` and, if the build diverged from the spec, add one short paragraph under it saying how — following `L03`'s example. Do not rewrite the body to match the implementation; note the divergence instead (`specs/README.md`).

- [ ] **Step 3: Update the index**

In `client/specs/README.md`, change the `L05` row's status from `Proposed 2026-07-30` to `Implemented 2026-07-30`.

- [ ] **Step 4: Commit**

```bash
git add client/specs
git commit -m "docs(client): mark L05 implemented"
```

- [ ] **Step 5: Run the engineering-insights skill**

The root `CLAUDE.md` requires it before reporting a substantial task complete. It appends what this session learned to `client/INSIGHTS.md`.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Chips replace the text on settled rows | 4 |
| Card scoped to one run, on hover **and** focus | 1 (widget), 3 (data), 4 (wiring) |
| Trigger is the chip group, not the row | 1 — the group is the only element with `tabIndex`/handlers |
| Blockers as a separate chip, only when > 0 | 3 |
| Dimmed zeros for a clean run, no card | 1 (`s.chip(…, !n)`, empty-list guard), 3 (test) |
| Running/failed/cancelled unchanged | 4 (`settled &&` guard kept, test) |
| Missing review → old text | 4 (`findingsByRun?.has`, test) |
| Shared component, `FindingsCell` as adapter | 1, 2 |
| Reuse `countBySeverity` | 3 |
| Preview order + cap mirror the server | 3 (`topFindings`, `RUN_FINDINGS_PREVIEW = 3`) |
| Presentational, no i18n in the shared component | 1 (test renders with no provider) |
| Stray severity not counted, does not throw | 3 |
| `FindingsCell` behaviour tests unmodified | 2 |
| No server change | none — no task touches `server/` |

**Type consistency:** `SeverityCount` is defined once (Task 1) and consumed by name in Tasks 2 and 3. `topFindings` returns `ListFinding[]`, which is what `FindingsPreview.findings` takes; `FindingRecord` extends `Finding`, a structural superset of `ListFinding`, so the assignment holds without a cast. `findingsByRun` is spelled identically in Tasks 3 and 4.

**Known risk:** Task 3 Step 8 is a conditional — the `SeverityFilterBar` barrel may not re-export `countBySeverity`. It is checked rather than assumed because guessing wrong produces a confusing resolve error two steps later.
