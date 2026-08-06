import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "@/../messages/en/agents.json";
import { ToastProvider } from "@/lib/toast";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }));

import { CreateAgentModal } from "./CreateAgentModal";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  nav.push.mockReset();
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({ id: "ag-new", name: "Security Reviewer" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        <ToastProvider>
          <CreateAgentModal onClose={() => {}} />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function promptBox(): HTMLTextAreaElement {
  return screen.getByDisplayValue(/You are a code reviewer/) as HTMLTextAreaElement;
}

describe("CreateAgentModal", () => {
  it("sends the form and opens the agent it made", async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText("Security Reviewer"), {
      target: { value: "  Test Quality Reviewer  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(sent).toMatchObject({
      name: "Test Quality Reviewer",
      provider: "openai",
      model: "gpt-4.1",
    });
    expect(sent.system_prompt).toContain("You are a code reviewer");
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/agents/ag-new?tab=config"));
  });

  it("names an unnamed agent rather than refusing to create it", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(sent.name).toBe("New Agent");
  });

  /**
   * The message is not this modal's job — `lib/providers.tsx` gives the
   * `QueryClient` a `MutationCache.onError` that toasts every failed mutation,
   * and a `toast.error` here would print the same sentence twice. What the modal
   * owes is to catch the rejection: `onClick` cannot await `submit`, so before
   * the catch existed a failed create was an unhandled rejection, which vitest
   * reports as an error for the whole file even when the assertions pass.
   */
  it("survives a failed create without navigating away from the typed prompt", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error: { message: "model is not available for this provider" } }),
    });
    renderModal();
    fireEvent.change(promptBox(), { target: { value: "Review only the tests." } });

    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Review only the tests.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
  });
});
