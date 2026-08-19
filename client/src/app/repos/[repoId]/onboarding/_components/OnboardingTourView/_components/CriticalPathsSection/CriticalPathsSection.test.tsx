import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import type { OnboardingFlow } from "@/lib/types";
import { CriticalPathsSection } from "./CriticalPathsSection";

afterEach(cleanup);

const SHA = "1122334455667788990011223344556677889900";
const REPO = "acme/payments-api";

const REQUEST: OnboardingFlow = {
  title: "An authenticated request",
  steps: [
    { path: "src/server.ts", note: "App bootstrap + middleware chain" },
    { path: "src/api/public/index.ts", note: "Public router — unauthenticated surface" },
  ],
};
const WEBHOOK: OnboardingFlow = {
  title: "A Stripe webhook",
  steps: [{ path: "src/webhooks/stripe.ts", note: "Signature check" }],
};

const render = (flows: OnboardingFlow[], sha: string | null = SHA) =>
  renderWithProviders(
    <CriticalPathsSection flows={flows} repoFullName={REPO} indexSha={sha} />,
    { onboarding: messages },
  );

describe("CriticalPathsSection", () => {
  it("draws one flow flat, exactly as the mockup has it — no flow label", () => {
    render([REQUEST]);

    expect(screen.getByText("src/server.ts")).toBeInTheDocument();
    expect(screen.getByText(/App bootstrap \+ middleware chain/)).toBeInTheDocument();
    expect(screen.queryByText(REQUEST.title)).toBeNull();
    // The visible word is `Open` on every row; the ACCESSIBLE name names the
    // file, or a screen reader gets four identical controls.
    expect(screen.getAllByRole("link", { name: /on GitHub$/ })).toHaveLength(2);
    expect(screen.getAllByText(messages.open)).toHaveLength(2);
  });

  it("labels each flow once there is more than one, so two chains do not read as one", () => {
    render([REQUEST, WEBHOOK]);

    expect(screen.getByText(REQUEST.title)).toBeInTheDocument();
    expect(screen.getByText(WEBHOOK.title)).toBeInTheDocument();
  });

  it("opens the file at the tour's own index sha", () => {
    render([WEBHOOK]);

    expect(
      screen.getByRole("link", { name: "Open src/webhooks/stripe.ts on GitHub" }),
    ).toHaveAttribute(
      "href",
      `https://github.com/acme/payments-api/blob/${SHA}/src/webhooks/stripe.ts`,
    );
  });

  it("shows no control at all when there is no sha to build one at", () => {
    // `''` is "there is no index"; a dead `Open` is worse than none (AC-27).
    render([REQUEST], "");

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("src/server.ts")).toBeInTheDocument();
  });

  it("shows no control for a path the URL rules refuse, and keeps the path as text", () => {
    const hostile = `src/${String.fromCodePoint(9)}server.ts`;
    render([{ title: "t", steps: [{ path: hostile, note: "n" }, { path: "../../etc/passwd", note: "n" }] }]);

    expect(screen.queryByRole("link")).toBeNull();
    // Identity normalizer, or RTL collapses the character under test
    // (`client/INSIGHTS.md:1866-1879`).
    expect(screen.getByText(hostile, { normalizer: (v) => v })).toBeInTheDocument();
    expect(screen.getByText("../../etc/passwd")).toBeInTheDocument();
  });

  it("keeps its card and says so when there is no chain, and lists no ranked file instead", () => {
    render([]);

    expect(screen.getByText(messages.empty.critical_paths)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: messages.section.criticalPaths }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

});
