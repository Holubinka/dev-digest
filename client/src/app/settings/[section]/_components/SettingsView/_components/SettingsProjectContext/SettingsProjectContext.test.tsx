/**
 * Settings → Project Context. Two controls over two workspace keys.
 *
 * The assertion that matters is the FIRST one: with nothing stored, both fields
 * show the value in effect rather than an empty box. An empty box reads as
 * "nothing is configured" for a feature that is in fact scanning three folders.
 *
 * `fireEvent`, not `userEvent`: the latter is not a dependency of this project.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/../messages/en/settings.json";
import type { Settings } from "@/lib/types";

const mutate = vi.fn();
let stored: Partial<Settings>;

vi.mock("@/lib/hooks", () => ({
  useSettings: () => ({ data: stored }),
  useUpdateSettings: () => ({ mutate }),
}));

const { SettingsProjectContext } = await import("./SettingsProjectContext");

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

function renderPanel(settings: Partial<Settings> = {}) {
  stored = settings;
  return render(
    <NextIntlClientProvider locale="en" messages={{ settings: messages }}>
      <SettingsProjectContext />
    </NextIntlClientProvider>,
  );
}

describe("SettingsProjectContext", () => {
  it("shows the spec defaults as the values IN EFFECT when nothing is stored", () => {
    renderPanel({});
    expect(screen.getByLabelText("Scan folders")).toHaveValue("specs, docs, insights");
    expect(screen.getByLabelText("Token budget")).toHaveValue("16000");
    // …and says they are defaults rather than choices.
    expect(screen.getAllByText("default")).toHaveLength(2);
  });

  it("shows a stored value, without the default marker", () => {
    renderPanel({ context_scan_roots: ["handbook"], context_token_budget: 8000 });
    expect(screen.getByLabelText("Scan folders")).toHaveValue("handbook");
    expect(screen.getByLabelText("Token budget")).toHaveValue("8000");
    expect(screen.queryByText("default")).toBeNull();
  });

  it("round-trips a budget through PUT /settings", () => {
    renderPanel({});
    const budget = screen.getByLabelText("Token budget");
    fireEvent.change(budget, { target: { value: "24000" } });
    fireEvent.blur(budget);
    expect(mutate).toHaveBeenCalledWith({ context_token_budget: 24000 });
  });

  it("saves the folders as a cleaned array, not as the raw string", () => {
    renderPanel({});
    const roots = screen.getByLabelText("Scan folders");
    fireEvent.change(roots, { target: { value: " docs , , handbook/team ,/specs/ " } });
    fireEvent.blur(roots);
    expect(mutate).toHaveBeenCalledWith({
      context_scan_roots: ["docs", "handbook/team", "specs"],
    });
  });

  it("refuses a budget that is not a positive whole number, and saves nothing", () => {
    renderPanel({});
    const budget = screen.getByLabelText("Token budget");
    fireEvent.change(budget, { target: { value: "-5" } });
    expect(screen.getByText("Enter a positive whole number.")).toBeInTheDocument();
    fireEvent.blur(budget);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("saves nothing when a field is blurred unchanged", () => {
    renderPanel({ context_token_budget: 16000 });
    fireEvent.blur(screen.getByLabelText("Token budget"));
    fireEvent.blur(screen.getByLabelText("Scan folders"));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("says that changing the folders does not re-scan anything", () => {
    renderPanel({});
    expect(screen.getByText(/does not re-scan anything/)).toBeInTheDocument();
    expect(screen.getByText(/press Rescan on a repository/)).toBeInTheDocument();
  });
});
