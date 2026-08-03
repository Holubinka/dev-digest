import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../../lib/toast";

const hooks = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("../../../../../../lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: hooks.mutate, isPending: false }),
}));

import { ConfigTab } from "./ConfigTab";

const SKILL: Skill = {
  id: "sk1",
  name: "uncovered-branch-rubric",
  description: "List every branch the diff adds.",
  type: "rubric",
  source: "manual",
  body: "# Rubric\nList every branch.",
  enabled: true,
  version: 3,
  evidence_files: null,
};

function renderTab(skill: Skill = SKILL) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <ConfigTab skill={skill} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => hooks.mutate.mockReset());
afterEach(cleanup);

describe("ConfigTab", () => {
  it("opens on what the skill currently is", () => {
    renderTab();
    expect(screen.getByDisplayValue("uncovered-branch-rubric")).toBeInTheDocument();
    expect(screen.getByDisplayValue("List every branch the diff adds.")).toBeInTheDocument();
    expect(screen.getByLabelText("Skill body (Markdown)")).toHaveValue(
      "# Rubric\nList every branch.",
    );
  });

  it("saves all four fields in one request", () => {
    renderTab();
    fireEvent.change(screen.getByDisplayValue("uncovered-branch-rubric"), {
      target: { value: "renamed-rubric" },
    });
    fireEvent.change(screen.getByLabelText("Skill body (Markdown)"), {
      target: { value: "# Renamed" },
    });
    fireEvent.click(screen.getByText("Save skill"));

    expect(hooks.mutate).toHaveBeenCalledTimes(1);
    expect(hooks.mutate.mock.calls[0]![0]).toEqual({
      id: "sk1",
      patch: {
        name: "renamed-rubric",
        description: "List every branch the diff adds.",
        type: "rubric",
        body: "# Renamed",
      },
    });
  });

  /** The tab stays mounted while the left column changes selection, so
      without the reset the previous skill's body is edited into the new one. */
  it("reloads the form when a different skill is selected under it", () => {
    const { rerender } = renderTab();
    fireEvent.change(screen.getByDisplayValue("uncovered-branch-rubric"), {
      target: { value: "half-typed" },
    });

    rerender(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <ToastProvider>
          <ConfigTab skill={{ ...SKILL, id: "sk2", name: "test-smell-catalogue" }} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );

    expect(screen.getByDisplayValue("test-smell-catalogue")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("half-typed")).not.toBeInTheDocument();
  });

  it("marks the body unsaved as soon as it differs from what was stored", () => {
    renderTab();
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Skill body (Markdown)"), {
      target: { value: "# Edited" },
    });
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });
});
