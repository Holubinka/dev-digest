import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../lib/toast";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }));

import { CreateSkillModal } from "./CreateSkillModal";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  nav.push.mockReset();
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: "sk-new", name: "uncovered-branch-rubric", version: 1 }),
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
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <ToastProvider>
          <CreateSkillModal onClose={() => {}} />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("CreateSkillModal", () => {
  it("asks for everything a skill is, not just a name", () => {
    renderModal();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Skill body (Markdown)")).toBeInTheDocument();
    // The caption is the whole point of that field: it says a description is an
    // interface, not a summary.
    expect(screen.getByText(/decide the skill applies/)).toBeInTheDocument();
  });

  it("will not create a nameless skill", () => {
    renderModal();
    expect(screen.getByText("Create skill").closest("button")).toBeDisabled();
  });

  it("will not create one with an empty body either", () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText("uncovered-branch-rubric"), {
      target: { value: "my-rule" },
    });
    fireEvent.change(screen.getByLabelText("Skill body (Markdown)"), {
      target: { value: "   " },
    });
    expect(screen.getByText("Create skill").closest("button")).toBeDisabled();
  });

  it("sends all four fields, then opens the skill it made", async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText("uncovered-branch-rubric"), {
      target: { value: "  my-rule  " },
    });
    fireEvent.change(screen.getByPlaceholderText(/Flag every branch/), {
      target: { value: "Flag X." },
    });
    fireEvent.change(screen.getByLabelText("Skill body (Markdown)"), {
      target: { value: "# My rule\nDo the thing." },
    });
    fireEvent.click(screen.getByText("Create skill"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(sent).toEqual({
      name: "my-rule",
      description: "Flag X.",
      type: "rubric",
      body: "# My rule\nDo the thing.",
    });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/skills/sk-new?tab=config"));
  });
});
