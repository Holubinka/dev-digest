import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/../messages/en/skills.json";
import { SkillBodyEditor } from "./SkillBodyEditor";

afterEach(cleanup);

function renderEditor(props: Partial<React.ComponentProps<typeof SkillBodyEditor>> = {}) {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillBodyEditor
        name="Uncovered branch rubric"
        value={"# Rubric\nList every branch."}
        dirty={false}
        onChange={onChange}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onChange };
}

describe("SkillBodyEditor", () => {
  it("derives the filename from the skill's name", () => {
    renderEditor();
    expect(screen.getByText("uncovered-branch-rubric.md")).toBeInTheDocument();
  });

  it("marks the body unsaved only while it differs from what was stored", () => {
    renderEditor();
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
    cleanup();
    renderEditor({ dirty: true });
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });

  it("states what the body costs, since that is what the skill adds to a prompt", () => {
    renderEditor({ value: "x".repeat(400) });
    expect(screen.getByText("100 tokens")).toBeInTheDocument();
  });

  /** The gutter is the reason this is not a plain textarea: an injection
      warning cites a line, and the user has to be able to find it. */
  it("numbers every line of the body", () => {
    renderEditor({ value: "one\ntwo\nthree" });
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("4")).not.toBeInTheDocument();
  });

  it("reports an edit rather than holding the body itself", () => {
    const { onChange } = renderEditor();
    fireEvent.change(screen.getByLabelText("Skill body (Markdown)"), {
      target: { value: "# Changed" },
    });
    expect(onChange).toHaveBeenCalledWith("# Changed");
  });
});
