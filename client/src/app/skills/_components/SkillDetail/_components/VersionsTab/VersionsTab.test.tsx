import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillVersion } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../../lib/toast";

const hooks = vi.hoisted(() => ({ useSkillVersions: vi.fn(), restore: vi.fn() }));
vi.mock("../../../../../../lib/hooks/skills", () => ({
  useSkillVersions: hooks.useSkillVersions,
  useRestoreSkillVersion: () => ({ mutate: hooks.restore, isPending: false }),
}));

import { VersionsTab } from "./VersionsTab";

const SKILL = { id: "sk1", name: "rubric", version: 3 } as Skill;

const VERSIONS: SkillVersion[] = [
  { skill_id: "sk1", version: 3, body: "one\nTHREE", created_at: "2026-08-01T10:00:00.000Z" },
  { skill_id: "sk1", version: 2, body: "one\ntwo", created_at: "2026-07-30T10:00:00.000Z" },
  { skill_id: "sk1", version: 1, body: "one", created_at: "2026-07-29T10:00:00.000Z" },
];

function renderTab(data: SkillVersion[] | undefined = VERSIONS, rest: Record<string, unknown> = {}) {
  hooks.useSkillVersions.mockReturnValue({ data, isLoading: false, isError: false, ...rest });
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <VersionsTab skill={SKILL} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  hooks.useSkillVersions.mockReset();
  hooks.restore.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("VersionsTab", () => {
  it("lists every recorded change, newest first, and says which is live", () => {
    renderTab();
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("current")).toBeInTheDocument();
    expect(screen.getByText("initial version")).toBeInTheDocument();
  });

  it("counts each version's change against the one before it", () => {
    renderTab();
    // v3 replaced "two" with "THREE"; v2 and v1 each only added a line.
    expect(screen.getByText("+1 −1")).toBeInTheDocument();
    expect(screen.getAllByText("+1 −0")).toHaveLength(2);
  });

  it("shows the actual lines only once the diff is asked for", () => {
    renderTab();
    expect(screen.queryByText(/THREE/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Diff")[0]!);
    expect(screen.getByText("compared with v2")).toBeInTheDocument();
    expect(screen.getByText(/THREE/)).toBeInTheDocument();
  });

  it("restores only after the user confirms, and never offers it for the live version", () => {
    renderTab();
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    // Two rows are restorable — v2 and v1 — and the current v3 is not.
    const buttons = screen.getAllByText("Restore");
    expect(buttons).toHaveLength(2);

    fireEvent.click(buttons[0]!);
    expect(hooks.restore).not.toHaveBeenCalled();

    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    fireEvent.click(buttons[0]!);
    expect(hooks.restore).toHaveBeenCalledWith(
      { id: "sk1", version: 2 },
      expect.anything(),
    );
  });

  it("says so plainly when nothing has been recorded yet", () => {
    renderTab([]);
    expect(screen.getByText("No history yet.")).toBeInTheDocument();
  });
});
