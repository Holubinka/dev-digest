import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import { CopyButton } from "./CopyButton";

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(cleanup);

describe("CopyButton", () => {
  it("is reachable by name, and hands over exactly the string it was given", async () => {
    const text = 'pnpm dev # http://localhost:3000';
    renderWithProviders(<CopyButton text={text} label="Copy the command pnpm dev" />, {
      onboarding: messages,
    });

    const button = screen.getByRole("button", { name: "Copy the command pnpm dev" });
    fireEvent.click(button);

    expect(writeText).toHaveBeenCalledWith(text);
    await waitFor(() => expect(button).toHaveAttribute("title", messages.copied));
  });

  it("claims nothing when there is no clipboard to write to", () => {
    // `navigator.clipboard` is undefined outside a secure context, and optional
    // chaining short-circuits the whole chain — so the control must simply do
    // nothing rather than show a tick for a copy that never happened.
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    renderWithProviders(<CopyButton text="pnpm dev" label="Copy the command pnpm dev" />, {
      onboarding: messages,
    });

    const button = screen.getByRole("button", { name: "Copy the command pnpm dev" });
    expect(() => fireEvent.click(button)).not.toThrow();
    expect(button).toHaveAttribute("title", "Copy the command pnpm dev");
  });
});
