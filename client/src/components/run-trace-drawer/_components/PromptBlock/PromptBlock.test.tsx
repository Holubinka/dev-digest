import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/../messages/en/runs.json";
import { PromptBlock } from "./PromptBlock";

afterEach(cleanup);

function renderBlock(text: string, label = "Skills (dynamic)") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <PromptBlock label={label} text={text} color="var(--accent)" />
    </NextIntlClientProvider>,
  );
}

describe("PromptBlock token badge", () => {
  it("sizes the block without needing it expanded", () => {
    renderBlock("x".repeat(400));
    expect(screen.getByText("≈100 tok")).toBeInTheDocument();
    // The body itself is still collapsed.
    expect(screen.queryByText("x".repeat(400))).not.toBeInTheDocument();
  });

  it("rounds up, so a short block never reads as free", () => {
    renderBlock("abc");
    expect(screen.getByText("≈1 tok")).toBeInTheDocument();
  });

  it("shows zero for an empty slot rather than hiding the badge", () => {
    renderBlock("");
    expect(screen.getByText("≈0 tok")).toBeInTheDocument();
  });
});
