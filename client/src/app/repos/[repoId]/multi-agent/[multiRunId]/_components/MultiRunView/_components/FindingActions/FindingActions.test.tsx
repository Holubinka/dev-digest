import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import runs from "@/../messages/en/runs.json";
import prReview from "@/../messages/en/prReview.json";
import type { FindingRecord } from "@devdigest/shared";

/* The one OUTBOUND untrusted flow of this feature: text a model wrote about an
   untrusted diff, published to GitHub under the reader's name. What is asserted
   here is the gate (nothing leaves without a second, explicit press) and the
   two things that must survive a refusal — the typed text and the reason. */

const comment = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null as unknown,
  data: null as unknown,
}));
vi.mock("@/lib/hooks/reviews", () => ({ useCreatePrComment: () => comment }));

import { ApiError } from "@/lib/api";
import { FindingActions } from "./FindingActions";

const FINDING = {
  id: "f1",
  file: "src/middleware/ratelimit.ts",
  start_line: 52,
  end_line: 61,
  severity: "WARNING",
  title: "Retry-After header omitted on 429",
  rationale: "The 429 response has no Retry-After header, so clients cannot back off.",
  confidence: 0.81,
  category: "bug",
} as unknown as FindingRecord;

function renderActions(props: Partial<React.ComponentProps<typeof FindingActions>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs, prReview }}>
      <FindingActions
        finding={FINDING}
        prId="pr-1"
        prStatus="open"
        headMoved={false}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  comment.mutate.mockReset();
  comment.isPending = false;
  comment.isError = false;
  comment.error = null;
  comment.data = null;
});
afterEach(cleanup);

describe("FindingActions", () => {
  /* AC-62. This used to assert `toBeDisabled()`, which pinned the MECHANISM
     rather than the behaviour — and the mechanism was the defect: a `disabled`
     button leaves the tab order and receives no mouse events, so it could not
     tell a reader why it would not press. It is now inert via `aria-disabled`,
     still bound to no handler, and it carries its own explanation. */
  it("renders Learn and Turn into eval case inert, wired to nothing (AC-62)", () => {
    renderActions();

    for (const name of ["Learn", "Turn into eval case"]) {
      const btn = screen.getByRole("button", { name });
      expect(btn).toHaveAttribute("aria-disabled", "true");
      // Focusable on purpose — that is how a keyboard reaches the explanation.
      expect(btn).not.toBeDisabled();
      expect(btn).toHaveAttribute("aria-describedby");
      // Nothing is bound, so pressing it cannot start anything.
      fireEvent.click(btn);
    }
    expect(comment.mutate).not.toHaveBeenCalled();
  });

  it("prefills the reply from the rationale and sends nothing until it is confirmed", () => {
    renderActions();

    // Closed: no field, and nothing sent.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reply to author" }));
    const field = screen.getByRole("textbox");
    expect(field).toHaveValue(FINDING.rationale); // AC-101
    expect(comment.mutate).not.toHaveBeenCalled(); // AC-104

    fireEvent.change(field, { target: { value: "Please add Retry-After here." } });
    expect(comment.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    // AC-102: the finding's own file and its START line, not the end of the range.
    expect(comment.mutate).toHaveBeenCalledWith({
      path: "src/middleware/ratelimit.ts",
      line: 52,
      body: "Please add Retry-After here.",
    });
  });

  /* The draft is model-written text about an untrusted diff. Editing it is the
     sanitisation, and a reader who does not know whose words these are has no
     reason to edit anything. */
  it("says whose words are in the field, and describes the field with it", () => {
    renderActions();

    fireEvent.click(screen.getByRole("button", { name: "Reply to author" }));

    const notice = screen.getByText(runs.page.finding.replyWarnAgentText);
    const field = screen.getByRole("textbox");
    expect(notice.id).not.toBe("");
    expect(field).toHaveAttribute("aria-describedby", notice.id);

    // Only the reader's own empty field carries none of the model's words.
    fireEvent.change(field, { target: { value: "" } });
    expect(screen.queryByText(runs.page.finding.replyWarnAgentText)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-describedby");
  });

  it("keeps the typed text and shows the returned reason when GitHub refuses (AC-106, AC-107)", () => {
    comment.isError = true;
    comment.error = new ApiError("line is outside the diff", 502, "github_comment_failed");
    renderActions();

    fireEvent.click(screen.getByRole("button", { name: "Reply to author" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "my words" } });

    expect(screen.getByRole("alert")).toHaveTextContent("line is outside the diff");
    expect(screen.getByRole("textbox")).toHaveValue("my words");
  });

  it("warns about the PR's state before anything is sent (AC-108)", () => {
    renderActions({ prStatus: "merged" });

    fireEvent.click(screen.getByRole("button", { name: "Reply to author" }));

    expect(screen.getByText(/is merged — GitHub is expected to refuse/)).toBeInTheDocument();
    expect(comment.mutate).not.toHaveBeenCalled();
  });

  it("warns that the line may have moved when the PR head is not the one reviewed (AC-109)", () => {
    renderActions({ headMoved: true });

    fireEvent.click(screen.getByRole("button", { name: "Reply to author" }));

    expect(screen.getByText(runs.page.finding.replyWarnLineShift)).toBeInTheDocument();
  });

  it("confirms with a link to the comment it posted (AC-105)", () => {
    comment.data = { html_url: "https://github.com/acme/api/pull/482#discussion_r1" };
    renderActions();

    fireEvent.click(screen.getByRole("button", { name: "Reply to author" }));

    expect(screen.getByRole("link", { name: "View on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/pull/482#discussion_r1",
    );
  });
});
