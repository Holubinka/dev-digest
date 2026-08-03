import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/conventions.json";
import { convention } from "@/test/conventions";
import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

/**
 * The card is where a candidate stops being a model's opinion and becomes
 * something a person can check: the quote has to link to the commit it was read
 * at, and the three verbs have to reach the caller.
 */
function renderCard(over: Parameters<typeof convention>[0] = {}, props = {}) {
  const onStatus = vi.fn();
  const onRule = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionCard
        candidate={convention(over)}
        repoFullName="Holubinka/dev-digest"
        onStatus={onStatus}
        onRule={onRule}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onStatus, onRule };
}

describe("ConventionCard", () => {
  it("links the evidence to the commit the scan read it at", () => {
    renderCard();
    const link = screen.getByText(/routes\.ts:74$/).closest("a");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/Holubinka/dev-digest/blob/d227ec8/src/modules/skills/routes.ts#L74",
    );
  });

  it("shows the repository’s own code as the quote", () => {
    renderCard();
    expect(screen.getByText('throw new NotFoundError("Skill not found");')).toBeInTheDocument();
  });

  it("lists the other places the rule was verified", () => {
    renderCard();
    expect(screen.getByText(/agents\/routes\.ts:148$/)).toBeInTheDocument();
  });

  it("renders no link when the scan recorded no commit", () => {
    renderCard({ head_sha: null });
    expect(screen.getByText(/skills\/routes\.ts:74$/).closest("a")).toBeNull();
  });

  it("accepts a pending candidate and un-accepts an accepted one", () => {
    const { onStatus } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onStatus).toHaveBeenCalledWith("accepted");

    cleanup();
    const second = renderCard({ status: "accepted" });
    fireEvent.click(screen.getByRole("button", { name: "Accepted" }));
    expect(second.onStatus).toHaveBeenCalledWith("pending");
  });

  it("rejects a candidate", () => {
    const { onStatus } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onStatus).toHaveBeenCalledWith("rejected");
  });

  it("edits the rule text and reports the trimmed value once", () => {
    const { onRule } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Edit this rule" }));

    const box = screen.getByPlaceholderText("Reword the rule…");
    fireEvent.change(box, { target: { value: "  Handlers throw AppError subclasses.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onRule.mock.calls).toEqual([["Handlers throw AppError subclasses."]]);
    expect(screen.queryByPlaceholderText("Reword the rule…")).toBeNull();
  });

  it("leaves the rule alone when the edit is cancelled", () => {
    const { onRule } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Edit this rule" }));
    fireEvent.change(screen.getByPlaceholderText("Reword the rule…"), {
      target: { value: "something else" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onRule).not.toHaveBeenCalled();
    expect(screen.getByText(/Route handlers throw AppError subclasses/)).toBeInTheDocument();
  });

  it("shows the confidence the scan settled on", () => {
    renderCard({ confidence: 0.86 });
    expect(screen.getByText("86%")).toBeInTheDocument();
  });
});
