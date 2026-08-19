import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import type { OnboardingTaskComplexity } from "@/lib/types";
import { ComplexityBadge } from "./ComplexityBadge";

afterEach(cleanup);

describe("ComplexityBadge", () => {
  it("carries the level as a word, so colour is never the only signal", () => {
    for (const [level, label] of [
      ["low", messages.complexity.low],
      ["medium", messages.complexity.medium],
      ["high", messages.complexity.high],
    ] as const) {
      cleanup();
      renderWithProviders(<ComplexityBadge complexity={level} />, { onboarding: messages });
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders nothing for a level outside the three, and throws nothing", () => {
    // The server already rejected it and counted it in
    // `dropped.unknown_complexity`; one arriving anyway means the contract
    // moved. A task without a badge is a smaller loss than a section that
    // disappears (`client/INSIGHTS.md:1409`).
    expect(() =>
      renderWithProviders(<ComplexityBadge complexity={"trivial" as OnboardingTaskComplexity} />, {
        onboarding: messages,
      }),
    ).not.toThrow();

    // No badge at all, and in particular NOT normalised to `medium`: a level
    // the model never assigned, stamped on a task someone then picks up, is
    // worse than no level.
    expect(screen.queryByText(/complexity/i)).toBeNull();
  });
});
