import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { PreviewTab } from "./PreviewTab";

afterEach(cleanup);

const SKILL: Skill = {
  id: "sk1",
  name: "Uncovered branch rubric",
  description: "",
  type: "rubric",
  source: "manual",
  body: "# Rubric\n\nIntro.\n\n1. First step\n2. Second step\n\n- a bullet\n\n| h |\n|---|\n| c |\n",
  enabled: true,
  version: 1,
  evidence_files: null,
};

function renderTab(skill: Skill = SKILL) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <PreviewTab skill={skill} />
    </NextIntlClientProvider>,
  );
}

describe("PreviewTab", () => {
  it("renders the body as real Markdown structure, not flattened text", () => {
    const { container } = renderTab();
    // The structure is what `.dd-md` styling hangs off — a rubric written as an
    // ordered procedure has to come out as an ordered list.
    expect(container.querySelector(".dd-md h1")?.textContent).toBe("Rubric");
    expect(container.querySelectorAll(".dd-md ol > li")).toHaveLength(2);
    expect(container.querySelectorAll(".dd-md ul > li")).toHaveLength(1);
    expect(container.querySelector(".dd-md table")).not.toBeNull();
  });

  it("shows the verbatim block the agent receives, beside the rendered one", () => {
    renderTab();
    expect(screen.getByText("Rendered")).toBeInTheDocument();
    expect(screen.getByText("As the agent receives it")).toBeInTheDocument();
    // Verbatim: the raw "1." survives, unlike in the rendered half.
    expect(screen.getByText(/^# Rubric/)).toHaveTextContent("1. First step");
  });

  it("says so plainly when there is no body yet", () => {
    renderTab({ ...SKILL, body: "   " });
    expect(screen.getByText("This skill has no body yet.")).toBeInTheDocument();
  });
});
