/**
 * The header: who the tour is for, the two facts of its provenance, and the two
 * controls the mockup draws.
 *
 * `fireEvent`, not `userEvent` — the latter is not a dependency of this project
 * (`client/INSIGHTS.md:1078`).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import { TourHeader } from "./TourHeader";

const writeText = vi.fn(() => Promise.resolve());
const onRegenerate = vi.fn();

const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

beforeEach(() => {
  writeText.mockClear();
  onRegenerate.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(cleanup);

const render = (over: Partial<React.ComponentProps<typeof TourHeader>> = {}) =>
  renderWithProviders(
    <TourHeader
      repoFullName="acme/payments-api"
      filesIndexed={656}
      generatedAt={iso(2 * HOUR)}
      activeAnchor="critical-paths"
      onRegenerate={onRegenerate}
      regenerating={false}
      {...over}
    />,
    { onboarding: messages },
  );

describe("TourHeader", () => {
  it("heads the page with the SHORT repo name, as the mockup does", () => {
    render();

    expect(
      screen.getByRole("heading", { level: 1, name: "Onboarding for payments-api" }),
    ).toBeInTheDocument();
    // The full slug belongs to the breadcrumb, which the view owns.
    expect(screen.queryByText(/acme\/payments-api/)).toBeNull();
  });

  it("sets the repo name apart inside the heading, as the mockup draws it", () => {
    // The mockup has `payments-api` in accent mono inside "Onboarding for
    // payments-api", and one ICU string cannot carry that: next-intl 3.26 takes
    // no `ReactNode` for a plain placeholder. So the key is a prefix and the
    // name is its own element — the shape `ConventionsView` already uses. The
    // accessible name is unchanged, which is what this asserts alongside.
    render();

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Onboarding for payments-api",
    });
    const repo = within(heading).getByText("payments-api");

    expect(repo).toHaveClass("mono");
    expect(repo.getAttribute("style")).toContain("--accent-text");
  });

  it("prints the index's file count as it arrived, captioned as the index's", () => {
    render();

    const line = screen.getByText(/Generated from index of/);
    expect(line).toHaveTextContent("Generated from index of 656 files · last refreshed 2h ago");
    // AC-75/AC-81: never "656 files in the repository". The indexer stops at
    // its own ceiling, and the honest number under that caption would be a lie.
    expect(line).not.toHaveTextContent(/files in the repository/);
  });

  it("counts one file in the singular branch too", () => {
    // A hard-coded "{count} files" satisfies a plural assertion forever
    // (`client/INSIGHTS.md:400-433`), so both branches are asserted.
    render({ filesIndexed: 1 });

    expect(screen.getByText(/Generated from index of/)).toHaveTextContent(
      "Generated from index of 1 file ·",
    );
  });

  it("says 'refreshed just now' rather than 'now ago' in the minute after a regeneration", () => {
    render({ generatedAt: iso(1000) });

    expect(screen.getByText(/Generated from index of/)).toHaveTextContent(
      "· refreshed just now",
    );
    expect(screen.queryByText(/now ago/)).toBeNull();
  });

  it("regenerates on a press, and is disabled by its own in-flight mutation only", () => {
    render();

    const button = screen.getByRole("button", { name: "Regenerate" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onRegenerate).toHaveBeenCalledTimes(1);

    // A fresh mount rather than `rerender`: the latter re-renders the element
    // WITHOUT the provider wrapper `renderWithProviders` built, and
    // `useTranslations` then has no context.
    cleanup();
    render({ regenerating: true });
    expect(screen.getByRole("button", { name: "Regenerating…" })).toBeDisabled();
  });

  it("copies the current URL with the active section's anchor, and nothing else", async () => {
    window.history.replaceState({}, "", "/repos/r1/onboarding");
    render();

    const share = screen.getByRole("button", { name: "Share link" });
    fireEvent.click(share);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/repos/r1/onboarding#critical-paths`,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Link copied" })).toBeInTheDocument(),
    );
  });
});
