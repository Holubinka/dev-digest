/**
 * InheritedGroup — preview on a row that stays read-only in every other
 * respect (AC-54).
 *
 * The point of the assertion below is the pair: the row gains a way to READ the
 * document and gains nothing else. Preview is not a back door to attaching a
 * document the skill owns — that is still done on the skill.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { InheritedContextDoc, SpecFile } from "@/lib/types";
import messages from "../../../../../../../../../../messages/en/context.json";

vi.mock("@/lib/hooks/context", () => ({ useContextDoc: () => docQuery }));

let docQuery: {
  data: SpecFile | undefined;
  error: unknown;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => void;
};

const { InheritedGroup } = await import("./InheritedGroup");

afterEach(cleanup);

const INHERITED: InheritedContextDoc[] = [
  {
    path: "specs/public-api.md",
    tokens: 60,
    skill_id: "s1",
    skill_name: "House rules",
    also_attached: false,
  },
];

function renderGroup() {
  docQuery = {
    data: {
      path: "specs/public-api.md",
      content: "# Public API\n\nEvery endpoint this service answers.",
      size: 120,
      updated_at: null,
      root: "specs",
      kind: "specs",
      tokens: 60,
      used_by_agents: 1,
    },
    error: null,
    isError: false,
    isSuccess: true,
    refetch: () => {},
  };
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <InheritedGroup repoId="repo-1" inherited={INHERITED} />
    </NextIntlClientProvider>,
  );
}

describe("InheritedGroup", () => {
  it("previews an inherited document without making the row editable", () => {
    renderGroup();
    const row = screen.getByTitle("specs/public-api.md").closest("div")!;

    // Still read-only: reading changes nothing, attaching would.
    expect(within(row).queryByRole("checkbox")).toBeNull();
    expect(within(row).queryByLabelText("Move up")).toBeNull();
    expect(within(row).queryByLabelText("Move down")).toBeNull();

    fireEvent.click(within(row).getByLabelText("Preview specs/public-api.md"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Public API" })).toBeInTheDocument();
    expect(within(dialog).getByText("Every endpoint this service answers.")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
