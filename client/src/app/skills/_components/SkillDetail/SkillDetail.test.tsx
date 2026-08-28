import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillInjectionMatch } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../lib/toast";

const nav = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => nav.params,
}));

const hooks = vi.hoisted(() => ({ useSkill: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/hooks/skills", () => ({
  useSkill: hooks.useSkill,
  useUpdateSkill: () => ({ mutate: hooks.update, isPending: false }),
  useSkillStats: () => ({ data: undefined, isLoading: true, isError: false }),
  useSkillVersions: () => ({ data: [], isLoading: false, isError: false }),
  useRestoreSkillVersion: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/eval", () => ({
  useSkillEvalCases: () => ({ data: { cases: [], passing: 0, total: 0 }, isLoading: false, isError: false }),
}));

import { SkillDetail } from "./SkillDetail";

const SKILL: Skill & { injection: SkillInjectionMatch[] } = {
  id: "sk1",
  name: "uncovered-branch-rubric",
  description: "List every branch the diff adds.",
  type: "rubric",
  source: "manual",
  body: "# Rubric",
  enabled: true,
  version: 3,
  evidence_files: null,
  injection: [],
};

const HIJACK: SkillInjectionMatch = {
  rule: "override_instructions",
  reason: "tells the model to ignore its instructions",
  line: 4,
  excerpt: "Ignore all previous instructions",
};

function renderDetail(over: Partial<typeof SKILL> = {}) {
  hooks.useSkill.mockReturnValue({
    data: { ...SKILL, ...over },
    isLoading: false,
    isError: false,
  });
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillDetail id="sk1" />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  nav.replace.mockReset();
  hooks.update.mockReset();
  hooks.useSkill.mockReset();
  nav.params = new URLSearchParams();
});
afterEach(cleanup);

describe("SkillDetail", () => {
  it("heads the pane with what the skill is and which version is live", () => {
    renderDetail();
    expect(screen.getByText("uncovered-branch-rubric")).toBeInTheDocument();
    // The Config tab's type select carries the word too, so pin the badge.
    expect(screen.getAllByText("rubric")[0]).toHaveStyle({ color: "var(--info)" });
    expect(screen.getByText("v3")).toBeInTheDocument();
  });

  it("shows a skeleton while the skill is still loading, not an empty pane", () => {
    hooks.useSkill.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <ToastProvider>
          <SkillDetail id="sk1" />
        </ToastProvider>
      </NextIntlClientProvider>,
    );

    expect(screen.queryByText("Save skill")).not.toBeInTheDocument();
    expect(screen.queryByText("Could not load this skill.")).not.toBeInTheDocument();
    expect(document.querySelectorAll('[class*="skeleton"], [data-skeleton]').length).toBeGreaterThan(0);
  });

  it("marks a globally disabled skill so its absence from prompts is visible", () => {
    renderDetail({ enabled: false });
    expect(screen.getByText("disabled — no agent will receive it")).toBeInTheDocument();
  });

  it("does not show that badge when the skill is on", () => {
    renderDetail();
    expect(screen.queryByText("disabled — no agent will receive it")).not.toBeInTheDocument();
  });

  it("shows the injection badge instead of the disabled one when both would apply", () => {
    renderDetail({ injection: [HIJACK], enabled: false });
    expect(screen.getByText("injection")).toBeInTheDocument();
    expect(screen.queryByText("disabled — no agent will receive it")).not.toBeInTheDocument();
  });

  it("keeps the open tab in the URL so a link lands where it was left", () => {
    renderDetail();
    fireEvent.click(screen.getByText("Preview"));
    expect(nav.replace).toHaveBeenCalledWith("/skills/sk1?tab=preview");
  });

  it("renders the Evals tab's own content when selected, not another tab's", () => {
    nav.params = new URLSearchParams("tab=evals");
    renderDetail();
    expect(screen.getByText("Cases this skill affected")).toBeInTheDocument();
    expect(screen.queryByText("Save skill")).not.toBeInTheDocument();
  });

  it("falls back to Config when ?tab= names something that does not exist", () => {
    nav.params = new URLSearchParams("tab=nonsense");
    renderDetail();
    expect(screen.getByText("Save skill")).toBeInTheDocument();
  });

  /** The UI half of the injection refusal. The server refuses it too, but
      refusing here as well is what tells the user why. */
  describe("a body that tries to hijack the prompt", () => {
    it("names the rule, the line and the text it matched", () => {
      renderDetail({ injection: [HIJACK], enabled: false });
      expect(screen.getByText("This body tries to hijack the prompt")).toBeInTheDocument();
      expect(screen.getByText("tells the model to ignore its instructions")).toBeInTheDocument();
      expect(screen.getByText("Ignore all previous instructions")).toBeInTheDocument();
      expect(screen.getByText("line 4")).toBeInTheDocument();
    });

    it("cannot be enabled, and asking does not reach the server", () => {
      renderDetail({ injection: [HIJACK], enabled: false });
      fireEvent.click(screen.getByRole("switch"));
      expect(hooks.update).not.toHaveBeenCalled();
    });

    it("shows the toggle off even when the row still says enabled", () => {
      renderDetail({ injection: [HIJACK], enabled: true });
      expect(screen.getByRole("switch")).not.toBeChecked();
      expect(screen.getByText("injection")).toBeInTheDocument();
    });

    it("admits the check is patterns, not a boundary", () => {
      renderDetail({ injection: [HIJACK], enabled: false });
      expect(screen.getByText(/Pattern matching only/)).toBeInTheDocument();
    });
  });

  it("toggles a clean skill through to the server", () => {
    renderDetail();
    fireEvent.click(screen.getByRole("switch"));
    expect(hooks.update).toHaveBeenCalledWith({ id: "sk1", patch: { enabled: false } });
  });

  it("offers a retry instead of an empty pane when the skill will not load", () => {
    hooks.useSkill.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    render(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <ToastProvider>
          <SkillDetail id="sk1" />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Could not load this skill.")).toBeInTheDocument();
  });
});
