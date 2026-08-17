import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import { PRRow } from "./PRRow";

/* The SCORE cell, and what it is allowed to claim.
   The list and the PR page read the same reviews, and until `score_state`
   existed they answered differently: PR #21 showed a score of 100 in the list
   while its own page said the state had not been reviewed, because the list took
   the newest review whatever commit it ran on. These cases pin the three things
   the cell now draws — no score, a score for this state, a score for another
   one — and that the third stays VISIBLE, marked rather than hidden. */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const fetchMock = vi.fn();

beforeEach(() => {
  push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [],
    text: async () => "[]",
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BASE: PrMeta = {
  id: "pr1",
  number: 21,
  title: "Add rate limiting to public API endpoints",
  author: "marisa.koch",
  branch: "feat/rate-limit-public",
  base: "main",
  head_sha: "83af705",
  additions: 247,
  deletions: 38,
  files_count: 9,
  status: "needs_review",
  opened_at: null,
  updated_at: null,
  score: null,
  score_state: "none",
  cost_usd: null,
  findings_critical: null,
  findings_warning: null,
  findings_suggestion: null,
  findings_top: null,
};

/**
 * The SCORE cell, queried by its column rather than by its text.
 *
 * Four cells in this row render `—` for a PR nothing has run against — SCORE,
 * FINDINGS, COST and UPDATED — so a bare `getByText("—")` would neither find the
 * right one nor stay true when a neighbour changes. The index is the column
 * order in `COLUMN_KEYS`; reordering the table is meant to fail here.
 */
function scoreCell(container: HTMLElement) {
  const cells = container.querySelector("div")!.children;
  return cells[3] as HTMLElement;
}

function renderRow(pr: PrMeta) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <PRRow pr={pr} repoId="repo1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...view, score: within(scoreCell(view.container)) };
}

const MARKER = "earlier";
const HINT =
  "This score comes from an earlier state of the pull request, not from its current commit.";

describe("PRRow score cell", () => {
  it("shows a dash when no review supplied a score", () => {
    const { score } = renderRow(BASE);
    expect(score.getByText("—")).toBeInTheDocument();
    expect(score.queryByText(MARKER)).not.toBeInTheDocument();
  });

  it("shows the score bare when the review ran on the PR's current state", () => {
    const { score } = renderRow({ ...BASE, score: 100, score_state: "current" });
    expect(score.getByText("100")).toBeInTheDocument();
    expect(score.queryByText(MARKER)).not.toBeInTheDocument();
  });

  /**
   * The case the whole change exists for. Its fixture differs from the one above
   * in `score_state` alone — a fixture whose review sits on the current head
   * cannot see this defect, and neither can one with no score at all.
   */
  it("marks a score that came from an earlier state, and still shows the number", () => {
    const { score } = renderRow({ ...BASE, score: 100, score_state: "earlier" });
    expect(score.getByText("100")).toBeInTheDocument();
    expect(score.getByText(MARKER)).toBeInTheDocument();
  });

  /**
   * A tint is not a marker: `CircularScore` already colours itself by value, so a
   * reader who cannot separate two greens would be told nothing. The marker is a
   * word — readable as text, and announced by a screen reader — with the full
   * sentence on the element as its tooltip (SPEC-02 AC-4 doctrine).
   */
  it("states the marker in words, not by colour alone", () => {
    const { score } = renderRow({ ...BASE, score: 100, score_state: "earlier" });
    const marker = score.getByText(MARKER);
    expect(marker).toHaveAttribute("title", HINT);
    expect(marker.textContent!.trim().length).toBeGreaterThan(0);
  });

  /**
   * The field is `nullish` on the contract and `src/lib/api.ts` validates
   * nothing, so an older API — or any response that predates this field —
   * arrives as `undefined`. That must read as "nothing claimed", not as a
   * marker on every reviewed row.
   */
  it("says nothing about the state when the payload carries no score_state", () => {
    const { score_state: _dropped, ...withoutField } = { ...BASE, score: 100 };
    const { score } = renderRow(withoutField as PrMeta);
    expect(score.getByText("100")).toBeInTheDocument();
    expect(score.queryByText(MARKER)).not.toBeInTheDocument();
  });
});
