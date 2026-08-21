import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import { CommandRow } from "./CommandRow";

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(cleanup);

describe("CommandRow", () => {
  it("keeps the explanation outside the command, and copies only the command", () => {
    const command = 'grep -n "x" src/*.ts | head -3';
    const { container } = renderWithProviders(
      <CommandRow command={command} why="Finds the three places it is set" index={2} />,
      { onboarding: messages },
    );

    const code = container.querySelector("code") as HTMLElement;
    // The copy control sits beside it, so anything inside the `<code>` will be
    // read as part of the command — and pasted as part of it. `#` is not a
    // comment character in an interactive zsh, which is why the explanation is
    // a field and never a suffix.
    expect(code.textContent).toBe(command);
    expect(code.textContent).not.toContain("Finds the three places");
    expect(screen.getByText("Finds the three places it is set")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `Copy the command ${command}` }));
    expect(writeText).toHaveBeenCalledWith(command);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("names the file that authorised a setup command", () => {
    renderWithProviders(
      <CommandRow command="cp .env.example .env" why="Adds the keys" sourcePath=".env.example" />,
      { onboarding: messages },
    );

    expect(screen.getByText("from .env.example")).toBeInTheDocument();
  });
});
