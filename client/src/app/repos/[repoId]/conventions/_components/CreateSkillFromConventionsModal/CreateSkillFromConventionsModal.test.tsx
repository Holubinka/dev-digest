import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { Skill } from "@devdigest/shared";
import messages from "@/../messages/en/conventions.json";
import skillsMessages from "@/../messages/en/skills.json";
import { ApiError } from "@/lib/api";
import { renderWithProviders } from "@/test/render";
import { convention } from "@/test/conventions";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }));

const hooks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutateAsync: hooks.create, isPending: false }),
}));

import { CreateSkillFromConventionsModal } from "./CreateSkillFromConventionsModal";

const REPO = "Holubinka/dev-digest";

/**
 * Two accepted rules in different categories, and one rejected. The rejected
 * one is the point of the fixture: `composeSkillBody` must leave it out, or the
 * reject button was a lie.
 */
const CANDIDATES = [
  convention({ id: "a", status: "accepted" }),
  convention({
    id: "b",
    status: "accepted",
    category: "typing",
    rule: "Row types come from `db/rows.ts`, never re-declared per module.",
    evidence_path: "src/db/rows.ts",
    evidence_line: 12,
    evidence_end_line: 12,
    extra_evidence: [],
  }),
  convention({
    id: "c",
    status: "rejected",
    rule: "Every file opens with a banner comment.",
    evidence_path: "src/junk.ts",
    extra_evidence: [],
  }),
];

/** `skills` rides along because the body editor lives in that namespace. */
function renderModal(over: { onClose?: () => void } = {}) {
  const onClose = over.onClose ?? vi.fn();
  renderWithProviders(
    <CreateSkillFromConventionsModal
      candidates={CANDIDATES}
      repoName={REPO}
      onClose={onClose}
    />,
    { conventions: messages, skills: skillsMessages },
  );
  return { onClose };
}

function bodyEditor(): HTMLTextAreaElement {
  return screen.getByLabelText("Skill body (Markdown)") as HTMLTextAreaElement;
}

/** The body of the one save the modal made, or a failure naming what is missing. */
function savedPayload() {
  const call = hooks.create.mock.calls[0];
  if (!call) throw new Error("useCreateSkill().mutateAsync was never called");
  return call[0];
}

beforeEach(() => {
  nav.push.mockReset();
  hooks.create.mockReset();
});
afterEach(cleanup);

describe("CreateSkillFromConventionsModal", () => {
  it("merges only the accepted rules, saves them as one skill, and opens it", async () => {
    hooks.create.mockResolvedValue({ id: "sk-9", name: "dev-digest-conventions" } as Skill);
    const { onClose } = renderModal();

    // The count in the banner is the accepted count, not the candidate count.
    expect(screen.getByRole("dialog")).toHaveTextContent(
      `Merged from 2 accepted conventions in ${REPO}.`,
    );

    const merged = bodyEditor().value;
    expect(merged).toContain("## error-handling");
    expect(merged).toContain("## typing");
    expect(merged).toContain("Row types come from `db/rows.ts`");
    expect(merged).toContain("`src/modules/skills/routes.ts:74`");
    expect(merged).not.toContain("Every file opens with a banner comment.");

    fireEvent.change(screen.getByDisplayValue("dev-digest-conventions"), {
      target: { value: "  house-rules  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    await waitFor(() => expect(hooks.create).toHaveBeenCalledTimes(1));
    const payload = savedPayload();
    expect(payload).toMatchObject({
      name: "house-rules",
      type: "convention",
      source: "extracted",
      enabled: true,
      // Provenance is the accepted rules' evidence, first site first — and the
      // rejected candidate's file is not in it.
      evidence_files: [
        "src/modules/skills/routes.ts",
        "src/modules/agents/routes.ts",
        "src/db/rows.ts",
      ],
    });
    expect(payload.body).toBe(merged);

    // Saved → said so → closed → landed on the new skill.
    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith("/skills/sk-9?tab=config"),
    );
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByText("Created “dev-digest-conventions”.")).toBeInTheDocument();
  });

  it("will not save a skill with a blank name, and stays open on the edit", () => {
    const { onClose } = renderModal();

    fireEvent.change(screen.getByDisplayValue("dev-digest-conventions"), {
      target: { value: "   " },
    });
    const submit = screen.getByRole("button", { name: "Create skill" });
    expect(submit).toBeDisabled();

    fireEvent.click(submit);
    expect(hooks.create).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps the user in the modal and says why when the save fails", async () => {
    hooks.create.mockRejectedValue(new ApiError("a skill with that name exists", 409));
    const { onClose } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    // The server's own 409 is what the user can act on, so it is what is shown.
    await waitFor(() =>
      expect(
        within(screen.getByRole("status")).getByText("a skill with that name exists"),
      ).toBeInTheDocument(),
    );
    // A failed save is not a completed one: the edits stay on screen.
    expect(onClose).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // A transport failure carries no message worth showing, so the generic line
    // stands in rather than leaking `socket hang up` at somebody.
    cleanup();
    hooks.create.mockRejectedValue(new Error("socket hang up"));
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    await waitFor(() => {
      const toasts = screen.getByRole("status");
      expect(within(toasts).getByText("Could not create the skill.")).toBeInTheDocument();
      expect(within(toasts).queryByText("socket hang up")).not.toBeInTheDocument();
    });
  });

});
