import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, within } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import type { OnboardingReadingStep } from "@/lib/types";
import { ReadingPathSection } from "./ReadingPathSection";

afterEach(cleanup);

const SHA = "1122334455667788990011223344556677889900";
const REPO = "acme/payments-api";

const STEPS: OnboardingReadingStep[] = [
  { path: "src/server.ts", reason: "See the whole request lifecycle in one file" },
  { path: "src/api/public/index.ts", reason: "Understand the public contract before touching it" },
];

const render = (steps: OnboardingReadingStep[], sha: string | null = SHA) =>
  renderWithProviders(<ReadingPathSection steps={steps} repoFullName={REPO} indexSha={sha} />, {
    onboarding: messages,
  });

describe("ReadingPathSection", () => {
  it("is an ordered list, in the order it was given, each file with its reason", () => {
    render(STEPS);

    const items = within(screen.getByRole("list"))
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");

    expect(items).toHaveLength(2);
    expect(items[0]).toContain("src/server.ts");
    expect(items[0]).toContain("See the whole request lifecycle in one file");
    expect(items[1]).toContain("src/api/public/index.ts");
  });

  it("makes each file open at the tour's own index sha", () => {
    render(STEPS);

    expect(screen.getByRole("link", { name: "src/server.ts" })).toHaveAttribute(
      "href",
      `https://github.com/acme/payments-api/blob/${SHA}/src/server.ts`,
    );
  });

  it("leaves every path as text when there is no sha", () => {
    render(STEPS, "");

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("src/server.ts")).toBeInTheDocument();
  });

  it("keeps its card and says so when nothing was ranked", () => {
    render([]);

    expect(screen.getByText(messages.empty.reading_path)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: messages.section.readingPath })).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
