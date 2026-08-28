import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/../messages/en/runs.json";
import type { AgentColumn, Conflict, ConflictTake } from "@devdigest/shared";
import { ConflictsSection } from "./ConflictsSection";

/* What this file guards is the thing every gate is blind to: the SHAPE of a take
   that has no opinion. Lint, typecheck and a snapshot all pass on a section that
   renders a crashed agent as one that looked and passed — the markup is
   identical, only the word is a lie. */

afterEach(cleanup);

const column = (over: Partial<AgentColumn> & { run_id: string }): AgentColumn =>
  ({
    agent_id: over.run_id,
    agent_name: over.run_id,
    agent_deleted: false,
    provider: null,
    model: null,
    status: "done",
    error: null,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: null,
    cost_usd: null,
    findings: [],
    ...over,
  }) as AgentColumn;

const take = (
  runId: string,
  verdict: ConflictTake["verdict"],
  note: string | null = null,
): ConflictTake => ({
  run_id: runId,
  agent_id: runId,
  persona: runId.toUpperCase(),
  verdict,
  note,
});

const position = (takes: ConflictTake[]): Conflict => ({
  file: "src/middleware/ratelimit.ts",
  start_line: 28,
  end_line: 28,
  title: "Magic number 3600",
  takes,
});

function renderSection(props: Partial<React.ComponentProps<typeof ConflictsSection>> = {}) {
  const merged: React.ComponentProps<typeof ConflictsSection> = {
    positions: [],
    columns: [],
    onlyConflicts: false,
    rerunPending: false,
    // No repo and no sha by default: the position header then renders its
    // `file:line` as plain text, which is the pre-link behaviour every
    // assertion below was written against. A test that wants the link passes
    // both.
    repoFullName: null,
    headSha: null,
    onToggle: vi.fn(),
    onConfigure: vi.fn(),
    onRunAgain: vi.fn(),
    ...props,
  };
  return {
    ...render(
      <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
        <ConflictsSection {...merged} />
      </NextIntlClientProvider>,
    ),
    props: merged,
  };
}

/** The cell one run speaks through, scoped by the same key the take joins on. */
function takeCell(container: HTMLElement, runId: string): HTMLElement {
  const el = container.querySelector(`[data-take-run="${runId}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no take rendered for ${runId}`);
  return el;
}

describe("ConflictsSection — the three take renderings", () => {
  it("tells a flag, a look-and-pass and a run that never got there apart", () => {
    const { container } = renderSection({
      positions: [
        position([
          take("flagger", "SUGGESTION", "Extract for readability."),
          take("silent", "ignored"),
          take("crashed", "not_reviewed"),
        ]),
      ],
      columns: [
        column({ run_id: "flagger" }),
        column({ run_id: "silent" }),
        column({ run_id: "crashed", status: "failed" }),
      ],
    });

    // Flagged: the severity, and the note taken from its rationale (AC-72).
    const flagger = takeCell(container, "flagger");
    expect(within(flagger).getByText("SUGGESTION")).toBeInTheDocument();
    expect(within(flagger).getByText("Extract for readability.")).toBeInTheDocument();

    // Looked and passed: the words, and NO note — none exists (D1, AC-71).
    const silent = takeCell(container, "silent");
    expect(within(silent).getByText("did not flag")).toBeInTheDocument();
    expect(silent.textContent).toBe("SILENTdid not flag");

    // Never got there: the run's state, no note (AC-122), and never the words
    // `did not flag` (AC-124).
    const crashed = takeCell(container, "crashed");
    expect(within(crashed).getByText("run failed")).toBeInTheDocument();
    expect(within(crashed).queryByText("did not flag")).not.toBeInTheDocument();
    expect(crashed.textContent).toBe("CRASHEDrun failed");
  });

  /* The marker has to differ in SHAPE and not only in shade (AC-121): a reader
     who cannot separate two greys still has to see that these are two answers. */
  it("draws the no-opinion marker as a ring and the silent one as a filled dot", () => {
    const { container } = renderSection({
      positions: [position([take("silent", "ignored"), take("crashed", "not_reviewed")])],
      columns: [column({ run_id: "silent" }), column({ run_id: "crashed", status: "cancelled" })],
    });

    const dot = takeCell(container, "silent").querySelector("span");
    const ring = takeCell(container, "crashed").querySelector("span");

    expect(dot).toHaveStyle({ background: "var(--text-muted)" });
    expect(ring).toHaveStyle({ background: "transparent" });
    expect(ring?.style.border).toContain("dashed");
  });

  it.each([
    ["queued", "queued"],
    ["running", "reviewing"],
    ["failed", "run failed"],
    ["cancelled", "run cancelled"],
  ] as const)(
    "never says `did not flag` on a %s run, and captions it %s (AC-123, AC-124)",
    (status, word) => {
      const { container } = renderSection({
        // Two columns, though only `r1` has a take: with ONE agent the section
        // is the "nobody to compare with" text and draws no take at all (D25,
        // AC-136). The bystander is what keeps this case about the CAPTION.
        positions: [position([take("r1", "not_reviewed")])],
        columns: [column({ run_id: "r1", status }), column({ run_id: "bystander" })],
      });

      expect(within(takeCell(container, "r1")).getByText(word)).toBeInTheDocument();
      expect(screen.queryByText("did not flag")).not.toBeInTheDocument();
    },
  );
});

describe("ConflictsSection — the toggle", () => {
  /* A REAL conflict since 2026-08-27: two agents flagged the same lines at
     different severities. One flag beside a silent finished agent is agreement
     and the toggle keeps it out of nothing. */
  const conflicting = position([take("r1", "WARNING", "shifted"), take("r2", "CRITICAL", "worse")]);
  const lonely: Conflict = {
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 45,
    title: "N+1 query",
    takes: [take("r1", "CRITICAL", "n+1"), take("r3", "not_reviewed")],
  };
  const columns = [
    column({ run_id: "r1" }),
    column({ run_id: "r2" }),
    column({ run_id: "r3", status: "failed" }),
  ];

  it("shows a lonely finding WITH its no-opinion takes while off (AC-75, AC-128)", () => {
    const { container } = renderSection({ positions: [conflicting, lonely], columns });

    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(within(takeCell(container, "r3")).getByText("run failed")).toBeInTheDocument();
  });

  it("hides the lonely one when the toggle asks for conflicts only (AC-76, AC-127)", () => {
    const { props } = renderSection({ positions: [conflicting, lonely], columns });

    fireEvent.click(screen.getByRole("switch"));
    expect(props.onToggle).toHaveBeenCalledWith(true);

    // The toggle is URL state owned upstream, so re-render with it on.
    cleanup();
    renderSection({ positions: [conflicting, lonely], columns, onlyConflicts: true });

    expect(screen.getByText("Magic number 3600")).toBeInTheDocument();
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
  });
});

describe("ConflictsSection — the four empty states", () => {
  /* AC-132's order, on four fixtures, each of which also satisfies a LATER
     condition — which is what makes the order testable at all. */
  it("says there is nobody to compare with when the multi-run had one agent (AC-110)", () => {
    renderSection({ positions: [], columns: [column({ run_id: "r1", status: "failed" })] });

    expect(screen.getByText(messages.conflicts.empty.oneAgentTitle)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure run" })).toBeInTheDocument();
  });

  /**
   * The middle number spans `running` AND `queued`, so it may not be read in
   * either state's word: `RUN_STATE_META` calls `running` "reviewing", and this
   * sentence used to say "still running" over a column headed `queued`. AC-125
   * wants one state named by one word everywhere, which a count of two states
   * can only honour by naming neither.
   */
  it("gives the three numbers when fewer than two runs finished (AC-129, AC-130)", () => {
    renderSection({
      positions: [],
      columns: [
        column({ run_id: "r1" }),
        column({ run_id: "r2", status: "running" }),
        column({ run_id: "r3", status: "failed" }),
        column({ run_id: "r4", status: "cancelled" }),
      ],
    });

    expect(screen.getByText(messages.conflicts.empty.unfinishedTitle)).toBeInTheDocument();
    expect(screen.getByText("1 finished · 1 still going · 2 never got there.")).toBeInTheDocument();
    expect(screen.queryByText(/still running/)).not.toBeInTheDocument();
    // One run is still going, so the re-run is not offered yet (AC-131).
    expect(screen.queryByRole("button", { name: "Run again" })).not.toBeInTheDocument();
  });

  it("offers the re-run once nothing is running any more (AC-131)", () => {
    const { props } = renderSection({
      positions: [],
      columns: [
        column({ run_id: "r1" }),
        column({ run_id: "r2", status: "failed" }),
        column({ run_id: "r3", status: "failed" }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect(props.onRunAgain).toHaveBeenCalled();
  });

  it("claims they found nothing only once two runs finished (AC-111)", () => {
    renderSection({
      positions: [],
      columns: [column({ run_id: "r1" }), column({ run_id: "r2" })],
    });

    expect(screen.getByText(messages.conflicts.empty.nothingFoundTitle)).toBeInTheDocument();
  });

  it("presents unanimity as the RESULT, not as missing data (AC-112)", () => {
    renderSection({
      positions: [position([take("r1", "WARNING", "x"), take("r2", "WARNING", "y")])],
      columns: [column({ run_id: "r1" }), column({ run_id: "r2" })],
      onlyConflicts: true,
    });

    expect(screen.getByText(messages.conflicts.empty.agreedTitle)).toBeInTheDocument();
  });

  /* AC-113: four reasons, four texts. Asserted on the message file itself
     because the rule is about the STRINGS, and a component test only ever sees
     the one it rendered. */
  it("shares no string between the four reasons", () => {
    const texts = Object.values(messages.conflicts.empty);

    expect(texts).toHaveLength(8);
    expect(new Set(texts).size).toBe(8);
  });
});

describe("ConflictsSection — a live multi-run", () => {
  it("renders from the first open with the not-final mark while a run is going (AC-133, D24)", () => {
    renderSection({
      positions: [position([take("r1", "WARNING", "already"), take("r2", "not_reviewed")])],
      columns: [column({ run_id: "r1" }), column({ run_id: "r2", status: "running" })],
    });

    expect(screen.getByText(messages.conflicts.notFinal)).toBeInTheDocument();
    expect(screen.getByText("Magic number 3600")).toBeInTheDocument();
  });

  it("drops the mark once every run is terminal", () => {
    renderSection({
      positions: [position([take("r1", "WARNING", "a"), take("r2", "ignored")])],
      columns: [column({ run_id: "r1" }), column({ run_id: "r2", status: "cancelled" })],
    });

    expect(screen.queryByText(messages.conflicts.notFinal)).not.toBeInTheDocument();
  });
});
