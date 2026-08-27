import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, EvalRunResult } from "@/lib/types";
import messages from "../../../../../../../../../../messages/en/eval.json";

const hooks = vi.hoisted(() => ({
  useEvalCase: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  run: vi.fn(),
  runData: undefined as EvalRunResult | undefined,
}));

vi.mock("@/lib/hooks/eval", () => ({
  useEvalCase: hooks.useEvalCase,
  useCreateEvalCase: () => ({ mutateAsync: hooks.create, isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: hooks.update, isPending: false }),
  useRunEvalCase: () => ({
    mutate: hooks.run,
    mutateAsync: hooks.run,
    isPending: false,
    data: hooks.runData,
  }),
}));

import { EvalCaseEditorModal } from "./EvalCaseEditorModal";

const CASE: EvalCase = {
  id: "c1",
  owner_kind: "agent",
  owner_id: "ag1",
  name: "stripe-key-leak",
  input_diff:
    "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,6 +10,7 @@\n+  stripeKey: \"sk_live_x\"\n",
  input_files: ["src/config.ts"],
  input_meta: { title: "Add Stripe integration", body: "Wire up payments." },
  expected_output: [
    {
      file: "src/config.ts",
      start_line: 12,
      end_line: 12,
      polarity: "must_find",
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded Stripe secret key",
    },
  ],
  notes: null,
};

const RESULT: EvalRunResult = {
  run_id: "r1",
  case_id: "c1",
  result: {
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    traces_passed: 1,
    traces_total: 1,
    duration_ms: 1800,
    cost_usd: 0.02,
    per_trace: [{ name: "stripe-key-leak", pass: true, expected: null, actual: null }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  hooks.runData = undefined;
  hooks.useEvalCase.mockReturnValue({ data: CASE, isLoading: false });
  hooks.create.mockResolvedValue({ ...CASE, id: "cNew" });
  hooks.update.mockResolvedValue(CASE);
  hooks.run.mockResolvedValue(RESULT);
});
afterEach(cleanup);

/** Cleared by the `vi.clearAllMocks()` above, like every other spy in here. */
const onClose = vi.fn();

function renderModal(caseId: string | null = "c1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalCaseEditorModal
        agentId="ag1"
        agentName="Security Reviewer"
        caseId={caseId}
        onClose={onClose}
      />
    </NextIntlClientProvider>,
  );
}

/** AC-18: name, the input in three tabs, and `expected_output` as JSON. */
describe("EvalCaseEditorModal — the fixed input in three tabs", () => {
  it("opens on the diff, with the case name and the agent in the header", () => {
    renderModal();
    expect(screen.getByText("Eval case · stripe-key-leak")).toBeInTheDocument();
    expect(
      screen.getByText("Security Reviewer · simulate a PR and assert the expected output"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("stripe-key-leak");
    expect(screen.getByRole("button", { name: "Diff" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PR meta" })).toBeInTheDocument();
  });

  it("derives the Files tab from the diff and offers no way to edit it", () => {
    // D13: `input_files` is derived, never authored. A text field here would be
    // a second source for a value the diff already fixes.
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByText("src/config.ts")).toBeInTheDocument();
    expect(screen.getByText(/Derived from the diff/)).toBeInTheDocument();
  });

  it("shows the PR title and body the case was captured with", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "PR meta" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Add Stripe integration");
  });
});

/**
 * AC-19. Two different failures need two different sentences, and both must
 * stop the save: text that is not JSON, and JSON that is not an expectation
 * list. The second is the one `.strict()` exists for — an object with an
 * unknown field is REFUSED rather than silently saved trimmed.
 */
describe("EvalCaseEditorModal — a bad expected_output blocks the save", () => {
  const expectedBox = () => screen.getAllByRole("textbox").at(-1)!;

  it("badges valid JSON and lets the save through", () => {
    renderModal();
    expect(screen.getByText("valid JSON")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("blocks the save on text that is not JSON at all, and says so", () => {
    renderModal();
    fireEvent.change(expectedBox(), { target: { value: "{not json" } });
    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("alert").textContent).toMatch(/Expected output is not a valid/);
  });

  it("blocks the save on an expectation carrying an unknown field", () => {
    renderModal();
    fireEvent.change(expectedBox(), {
      target: {
        value: JSON.stringify([{ file: "a.ts", start_line: 1, end_line: 1, bogus: 1 }]),
      },
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("alert").textContent).toContain("bogus");
  });

  it("blocks the save on a nameless case", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

/** AC-20: with the switch on, a successful save runs the case straight away. */
describe("EvalCaseEditorModal — Run on save", () => {
  it("saves only, while the switch is off", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(hooks.update).toHaveBeenCalledTimes(1));
    expect(hooks.run).not.toHaveBeenCalled();
    // Saving with the switch off is the end of the task, so the editor closes —
    // the other half of the same `if`, and the half nothing else asserts.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("saves and then runs THAT case, once the switch is on", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(hooks.run).toHaveBeenCalledWith("c1"));
    // Order matters: running before the save would measure the old case.
    expect(hooks.update).toHaveBeenCalledTimes(1);
    // The modal STAYS OPEN — the result is the reason the switch exists, and
    // closing over it would throw away what the reader turned it on to see.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("runs the case the save CREATED, not a case id that did not exist yet", async () => {
    hooks.useEvalCase.mockReturnValue({ data: undefined, isLoading: false });
    renderModal(null);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "new-case" } });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(hooks.run).toHaveBeenCalledWith("cNew"));
  });

  it("leaves the run's result on screen in the editor", () => {
    hooks.runData = RESULT;
    renderModal();
    expect(screen.getByText("Last run passed")).toBeInTheDocument();
    expect(
      screen.getByText("recall 100% · precision 100% · citation 100% · 1.8s"),
    ).toBeInTheDocument();
    expect(screen.getByText("$0.020")).toBeInTheDocument();
  });

  it("says a failing run failed rather than reporting every run as passed", () => {
    hooks.runData = {
      ...RESULT,
      result: { ...RESULT.result, traces_passed: 0, recall: 0 },
    };
    renderModal();
    expect(screen.getByText("Last run failed")).toBeInTheDocument();
  });
});

/**
 * `CaseForm` seeds its whole draft from `existing` with `useState`, so mounting
 * it before the case has arrived would open an editor full of empty fields over
 * a case that is not empty — and Save would write that emptiness back. Both
 * guards exist to keep the form unmounted; nothing asserted either.
 */
describe("EvalCaseEditorModal — before the case has arrived", () => {
  it("shows a loading indicator and does NOT mount the form while the case loads", () => {
    hooks.useEvalCase.mockReturnValue({ data: undefined, isLoading: true });
    renderModal("c1");

    expect(screen.getByText(/^Loading/)).toBeInTheDocument();
    // The dangerous half: no field seeded from nothing, and no way to save it.
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("says the case could not be loaded when the request came back empty", () => {
    hooks.useEvalCase.mockReturnValue({ data: undefined, isLoading: false });
    renderModal("c1");

    expect(screen.getByText("Could not load this eval case.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("opens the empty form for a NEW case rather than calling it unloadable", () => {
    // Same `data: undefined`, opposite meaning: with no `caseId` there is
    // nothing to load, and the guards must let «New eval case» through.
    hooks.useEvalCase.mockReturnValue({ data: undefined, isLoading: false });
    renderModal(null);

    expect(screen.queryByText("Could not load this eval case.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });
});
