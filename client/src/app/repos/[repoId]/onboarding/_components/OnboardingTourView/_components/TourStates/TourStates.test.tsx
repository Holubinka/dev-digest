/**
 * Every state of this page that is not a tour. Three of these are the only
 * place a reader learns why generating is refused, and they lead to three
 * different actions — so the tests assert on the STRINGS that render, not on
 * "some text is there": a copy change that quietly reintroduced a promise about
 * waiting would otherwise pass.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import { ApiError } from "@/lib/api";
import { TourStates } from "./TourStates";

afterEach(cleanup);

const onGenerate = vi.fn();

const render = (over: Partial<React.ComponentProps<typeof TourStates>> = {}) =>
  renderWithProviders(
    <TourStates
      blocked={null}
      hasTour={false}
      isPending={false}
      error={null}
      onGenerate={onGenerate}
      {...over}
    />,
    { onboarding: messages },
  );

describe("TourStates — nothing generated yet", () => {
  it("offers the Generate action and describes the five sections this page builds", () => {
    onGenerate.mockClear();
    render();

    // `generate.title` and `generate.cta` are the same sentence, so the control
    // is queried by role rather than by text.
    const body = screen.getByText(messages.generate.body);
    for (const fragment of [
      "architecture overview",
      "critical paths",
      "run it locally",
      "reading path",
      "first tasks",
    ]) {
      expect(body.textContent?.toLowerCase()).toContain(fragment);
    }
    // The five this feature does NOT build (R3, § D11).
    expect(body).not.toHaveTextContent(/key modules|conventions & gotchas/i);

    fireEvent.click(screen.getByRole("button", { name: messages.generate.cta }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("fires nothing on mount", () => {
    onGenerate.mockClear();
    render();
    expect(onGenerate).not.toHaveBeenCalled();
  });
});

describe("TourStates — a refused generation", () => {
  const cases = [
    ["index_missing", messages.refusal.noIndex],
    ["index_failed", messages.refusal.indexFailed],
    ["language_unsupported", messages.refusal.unsupportedLanguage],
  ] as const;

  it.each(cases)("shows %s its own text and no other's", (reason, copy) => {
    render({ blocked: reason });

    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();
    expect(screen.getByText(copy.body)).toBeInTheDocument();
    for (const other of cases) {
      if (other[1] !== copy) expect(screen.queryByText(other[1].title)).toBeNull();
    }
  });

  it("promises nothing about waiting when there is no ready index", () => {
    // `IndexStatus` has no "building" member, so "it is nearly ready" is a
    // promise the system cannot keep (AC-84). Asserted against the rendered
    // string so a copy change cannot quietly reintroduce one.
    render({ blocked: "index_missing" });

    const body = screen.getByText(messages.refusal.noIndex.body).textContent ?? "";
    expect(body).not.toMatch(/wait|shortly|in progress|building|try again soon|almost/i);
  });

  it("does not offer the Generate action in a state that would refuse it", () => {
    render({ blocked: "index_failed" });

    expect(screen.queryByRole("button", { name: messages.generate.cta })).toBeNull();
  });

  it("shows the same three texts after a press, keyed on the 409 code", () => {
    render({
      error: new ApiError("blocked", 409, "onboarding_language_unsupported"),
    });

    expect(
      screen.getByRole("heading", { name: messages.refusal.unsupportedLanguage.title }),
    ).toBeInTheDocument();
  });
});

describe("TourStates — a failed generation", () => {
  it("keeps the reason beside the tour and never claims the tour is gone", () => {
    render({
      hasTour: true,
      error: new ApiError("Upstream model timed out", 502, "external_service_error"),
    });

    expect(screen.getByText(messages.generateFailed)).toBeInTheDocument();
    expect(screen.getByText("Upstream model timed out")).toBeInTheDocument();
  });

  it("gives a changed index its own sentence, and not the gate's", () => {
    render({
      hasTour: true,
      error: new ApiError("index changed", 409, "onboarding_index_changed"),
    });

    expect(screen.getByText(messages.generateIndexChanged)).toBeInTheDocument();
    expect(screen.queryByText(messages.generateFailed)).toBeNull();
    expect(screen.queryByText(messages.refusal.noIndex.title)).toBeNull();
    // Nothing to wait for: pressing again works immediately.
    expect(messages.generateIndexChanged).not.toMatch(/wait|shortly|in progress/i);
  });

  it("sends a missing model configuration to Settings instead of showing a raw error", () => {
    render({ error: new ApiError("no model", 500, "config_error") });

    expect(screen.getByText(messages.notConfigured)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: messages.notConfiguredLink })).toHaveAttribute(
      "href",
      "/settings/models",
    );
    expect(screen.queryByText("no model")).toBeNull();
  });

  it("leaves the Generate action reachable after a failure", () => {
    onGenerate.mockClear();
    render({ error: new ApiError("boom", 502, "external_service_error") });

    const cta = screen.getByRole("button", { name: messages.generate.cta });
    expect(cta).toBeEnabled();
    fireEvent.click(cta);
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });
});

describe("TourStates — a generation in flight", () => {
  it("says so beside an existing tour, and captions nothing as the new one", () => {
    render({ hasTour: true, isPending: true });

    // The ToastProvider in `renderWithProviders` is also a `status`, so the note
    // is queried by its own text.
    expect(screen.getByText(messages.generate.generating)).toBeInTheDocument();
    expect(screen.queryByText(messages.generateFailed)).toBeNull();
  });

  it("shows the running state in the empty screen's own control", () => {
    render({ isPending: true });

    expect(
      screen.getByRole("button", { name: messages.generate.generating }),
    ).toBeInTheDocument();
  });
});
