/**
 * ExportWizard — the four steps that put an agent into a repository's CI.
 *
 * The two write hooks are mocked at the module boundary and their `mutateAsync`
 * is a resolved promise, so the tests state what the API answered and assert
 * what the reader sees. `fireEvent`, not `userEvent`, which is not a dependency
 * here (`client/INSIGHTS.md`).
 *
 * A click that awaits a mutation settles one microtask after `fireEvent`
 * returns, so every such test ends on a `findBy`/`waitFor` for what the
 * resolution changed rather than on the mock's call count
 * (`client/INSIGHTS.md` — "not wrapped in act(...)").
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/../messages/en/ci.json";
import type { CiExport, CiFile } from "@/lib/types";

const exportCi = vi.fn();
const downloadZip = vi.fn();

/**
 * `useMutation` in miniature, and the state is the whole point of it.
 *
 * A rejected `mutateAsync` must ALSO re-render the component with `isError`
 * set — that is how a failed request reaches the screen in the real hook, and a
 * mock with `isError: false` hardcoded cannot fail that way. It is what let a
 * failed regeneration stay invisible while the wizard kept a hand edit the
 * reader had just confirmed the loss of.
 *
 * `useState` is legal in here: these are called from the component's own body.
 */
vi.mock("@/lib/hooks/ci", async () => {
  const { useState } = await import("react");
  const useMutationLike = (send: (body: unknown) => Promise<unknown>) => {
    const [error, setError] = useState<unknown>(null);
    return {
      mutateAsync: (body: unknown) =>
        send(body).then(
          (data) => {
            setError(null);
            return data;
          },
          (err: unknown) => {
            setError(err);
            throw err;
          },
        ),
      isPending: false,
      isError: error !== null,
      error,
    };
  };
  return {
    useExportCi: () => useMutationLike(exportCi),
    useDownloadCiZip: () => useMutationLike(downloadZip),
  };
});
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repos: REPOS, reposLoaded: true, activeRepo: REPOS[0] }),
}));

const REPOS = vi.hoisted(() =>
  ["acme/payments-api", "acme/billing-worker"].map((full_name, i) => ({
    id: `r${i + 1}`,
    workspace_id: "w1",
    owner: full_name.split("/")[0]!,
    name: full_name.split("/")[1]!,
    full_name,
    default_branch: "main",
    clone_path: null,
    last_polled_at: null,
    created_by: null,
  })),
);

const { ExportWizard } = await import("./ExportWizard");

afterEach(() => {
  cleanup();
  exportCi.mockReset();
  downloadZip.mockReset();
});

const WORKFLOW = ".github/workflows/devdigest-review-security-reviewer.yml";
const MANIFEST = ".devdigest/agents/security-reviewer.yaml";
const GENERATED_WORKFLOW = "name: DevDigest Review\non:\n  pull_request:\n";

/**
 * A bundle with N skill files, in the order and with the `editable` flags
 * `server/src/modules/ci/generate/bundle.ts` really emits.
 *
 * THE FLAGS ARE THE POINT. This fixture used to mark everything but the workflow
 * `editable: false`, which no server ever produces — the bundle marks the
 * manifest, every skill and `memory.jsonl` editable too, and only `runner.mjs`
 * and `.gitattributes` generated. That single disagreement is what let AC-20
 * ship broken: the reducer picked the default file with
 * `find((f) => f.editable)`, which is the MANIFEST in a real bundle and the
 * workflow only in this fixture, so the test passed and the Preview step opened
 * on the wrong file.
 *
 * `role` is now the same kind of load-bearing detail, and `WORKFLOW` carries the
 * agent's slug because the real path does (AC-135). A fixture that gave every
 * file the same role, or that kept the old constant path, would let a reducer
 * matching on either one pass here and fail against a real bundle.
 */
function bundle(skillCount: number): CiFile[] {
  const files: CiFile[] = [
    { path: MANIFEST, contents: "name: Security", editable: true, role: "manifest" },
  ];
  for (let i = 0; i < skillCount; i++) {
    files.push({
      path: `.devdigest/skills/skill-${i}.md`,
      contents: "# Skill",
      editable: true,
      role: "skill",
    });
  }
  files.push({ path: ".devdigest/memory.jsonl", contents: "", editable: true, role: "memory" });
  files.push({
    path: ".devdigest/runner.mjs",
    contents: "// runner",
    editable: false,
    role: "runner",
  });
  files.push({
    path: ".devdigest/.gitattributes",
    contents: "runner.mjs linguist-generated=true\n",
    editable: false,
    role: "gitattributes",
  });
  files.push({ path: WORKFLOW, contents: GENERATED_WORKFLOW, editable: true, role: "workflow" });
  return files;
}

/** The path every publication removes today (AC-146), as the server reports it. */
const LEGACY_WORKFLOW = ".github/workflows/devdigest-review.yml";

function answer(
  files: CiFile[],
  prUrl: string | null = null,
  removals: string[] = [LEGACY_WORKFLOW],
): CiExport {
  return {
    installation: {
      id: "ci1",
      agent_id: "ag1",
      repo: "acme/payments-api",
      target_type: "gha",
      installed_at: "2026-08-26T00:00:00.000Z",
      agent_version: 3,
    },
    files,
    removals,
    pr_url: prUrl,
  };
}

function renderWizard(onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <ExportWizard
        agentId="ag1"
        agentName="Security Reviewer"
        initialRepo={null}
        installedRepos={[]}
        onClose={onClose}
      />
    </NextIntlClientProvider>,
  );
  return onClose;
}

/** Target → Preview, which is where the bundle is generated. */
async function toPreview(files: CiFile[]) {
  exportCi.mockResolvedValue(answer(files));
  renderWizard();
  fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
  // The workflow's path is on screen twice — the list row and the editor
  // header — so wait on the list label, which is unique to this step.
  await screen.findByText("FILES TO CREATE");
}

describe("ExportWizard — Target (AC-12, AC-13)", () => {
  it("marks the three unimplemented targets and changes nothing when one is activated", () => {
    renderWizard();

    const circle = screen.getByText("CircleCI").closest("button")!;
    expect(circle).toHaveAttribute("aria-disabled", "true");
    expect(within(circle).getByText("not implemented")).toBeInTheDocument();
    // Focusable, so a keyboard reader meets the mark instead of skipping it.
    expect(circle).not.toBeDisabled();

    const gha = screen.getByText("GitHub Actions").closest("button")!;
    expect(gha).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(circle);
    fireEvent.keyDown(circle, { key: "Enter" });
    fireEvent.keyDown(circle, { key: " " });

    // Neither the selection nor the step moved.
    expect(gha).toHaveAttribute("aria-pressed", "true");
    expect(circle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("FILES TO CREATE")).toBeNull();
  });
});

describe("ExportWizard — Install (AC-38)", () => {
  it("derives the file count from the generated list, with zero skills", async () => {
    // Five files: manifest, memory, runner, .gitattributes, workflow.
    await toPreview(bundle(0));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ })); // → Configure
    fireEvent.click(screen.getByRole("button", { name: /Continue/ })); // → Install

    expect(
      screen.getByText(/titled “Add DevDigest CI review” with the 5 generated files/),
    ).toBeInTheDocument();
  });

  it("counts a bundle with two skills as seven, not as a constant", async () => {
    await toPreview(bundle(2));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(screen.getByText(/with the 7 generated files/)).toBeInTheDocument();
  });

  it("names the legacy workflow it will delete, and says the same commit does it (AC-145)", async () => {
    await toPreview(bundle(0));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    // The PATH, from the server's own `removals` — the client holds no copy of
    // it — and the fact that the deletion rides the commit that writes the files
    // above it (AC-146), so the repo is never left with two workflows or none.
    const path = screen.getByText(".github/workflows/devdigest-review.yml");
    expect(path.parentElement).toHaveTextContent("The same commit also removes");
  });

  it("says nothing about deletions when the bundle removes nothing", async () => {
    // A repository that never held the legacy file still gets `removals: []` on
    // some future publication, and a step that named a path anyway would be
    // promising a deletion that is not going to happen.
    exportCi.mockResolvedValue(answer(bundle(0), null, []));
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByText("FILES TO CREATE");
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(screen.queryByText(/The same commit also removes/)).toBeNull();
  });

  it("says plainly that a zip leaves DevDigest blind to the repo's runs (AC-119)", async () => {
    await toPreview(bundle(0));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(screen.getByText(/DevDigest will not see this repository’s runs/)).toBeInTheDocument();
  });

  it("names the one step it cannot do once the PR is open (AC-45)", async () => {
    await toPreview(bundle(0));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    exportCi.mockResolvedValue(answer(bundle(0), "https://github.com/acme/payments-api/pull/7"));
    fireEvent.click(screen.getByRole("button", { name: /^Install$/ }));

    const link = await screen.findByRole("link", { name: /View pull request/ });
    expect(link).toHaveAttribute("href", "https://github.com/acme/payments-api/pull/7");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      screen.getByText(/add OPENROUTER_API_KEY under Settings → Secrets and variables → Actions/),
    ).toBeInTheDocument();
  });
});

describe("ExportWizard — Back (AC-5)", () => {
  it("restores the previous step with the session's choices intact", async () => {
    await toPreview(bundle(0));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ })); // → Configure

    // Change something on Configure, then walk back and forward again.
    fireEvent.click(screen.getByText("pull_request:reopened"));
    await waitFor(() => expect(exportCi).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("radio", { name: /PR comment/ }));
    await waitFor(() => expect(exportCi).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole("button", { name: /Back/ })); // → Preview
    expect(screen.getByText("FILES TO CREATE")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Continue/ })); // → Configure

    expect(screen.getByRole("radio", { name: /PR comment/ })).toBeChecked();
    const reopened = screen.getByText("pull_request:reopened").closest("button")!;
    expect(reopened).toHaveTextContent("pull_request:reopened");
    // The request the wizard would now send carries all three triggers.
    expect(exportCi).toHaveBeenLastCalledWith(
      expect.objectContaining({
        triggers: ["opened", "synchronize", "reopened"],
        post_as: "pr_comment",
      }),
    );
  });

  it("blocks Continue with a visible reason when the last trigger is cleared (AC-28)", async () => {
    await toPreview(bundle(0));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ })); // → Configure

    fireEvent.click(screen.getByText("pull_request:opened"));
    // One trigger left, so that click DID regenerate; wait for it, or the
    // dispatch after the await lands outside `act` (`client/INSIGHTS.md`).
    await waitFor(() => expect(exportCi).toHaveBeenCalledTimes(2));
    // Clearing the last one regenerates nothing — there is no valid bundle to
    // ask for, and the previous one stays on screen.
    fireEvent.click(screen.getByText("pull_request:synchronize"));
    expect(exportCi).toHaveBeenCalledTimes(2);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Select at least one trigger to continue.",
    );
    expect(screen.getByRole("button", { name: /Continue/ })).toBeDisabled();
  });
});

describe("ExportWizard — regenerating over a hand edit (AC-31, AC-32)", () => {
  it("warns before discarding an edit, and cancelling keeps both the edit and the setting", async () => {
    await toPreview(bundle(0));

    // Edit the workflow by hand on the Preview step.
    const editor = screen.getByLabelText(WORKFLOW);
    fireEvent.change(editor, { target: { value: "name: Edited by hand\n" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ })); // → Configure

    expect(exportCi).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("radio", { name: /None \(exit code only\)/ }));

    const dialog = screen.getByRole("alertdialog", { name: "Regenerate the workflow?" });
    expect(within(dialog).getByText(/You edited .* by hand/)).toHaveTextContent(
      WORKFLOW,
    );
    // Nothing regenerated while the question is open.
    expect(exportCi).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(exportCi).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("radio", { name: /GitHub review/ })).toBeChecked();
  });

  it("regenerates and drops the edit when the warning is confirmed", async () => {
    await toPreview(bundle(0));

    const editor = screen.getByLabelText(WORKFLOW);
    fireEvent.change(editor, { target: { value: "name: Edited by hand\n" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    fireEvent.click(screen.getByRole("radio", { name: /None \(exit code only\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    await waitFor(() => expect(exportCi).toHaveBeenCalledTimes(2));
    expect(exportCi).toHaveBeenLastCalledWith(expect.objectContaining({ post_as: "none" }));

    fireEvent.click(screen.getByRole("button", { name: /Back/ })); // → Preview
    // The server's text is back; the hand edit is gone.
    expect(screen.getByLabelText(WORKFLOW)).toHaveValue(
      "name: DevDigest Review\non:\n  pull_request:\n",
    );
  });
});

describe("ExportWizard — the file Preview opens on (AC-20)", () => {
  it("selects the workflow, not the first editable file in the bundle", async () => {
    // Two skills, so there are four editable files ahead of the workflow in the
    // list. The manifest is the first of them, and picking the default by the
    // `editable` flag lands on it.
    await toPreview(bundle(2));

    // The textarea IS the selected file — one is rendered, for the selection.
    expect(screen.getByLabelText(WORKFLOW)).toHaveValue(GENERATED_WORKFLOW);
    expect(screen.queryByLabelText(MANIFEST)).toBeNull();
  });
});

describe("ExportWizard — publishing the hand edit (AC-31, AC-55)", () => {
  const EDITED = "name: Edited by hand\non:\n  pull_request:\n";

  /** Preview → edit the workflow → Configure → Install, with nothing regenerated. */
  async function editThenReachInstall() {
    await toPreview(bundle(0));
    fireEvent.change(screen.getByLabelText(WORKFLOW), { target: { value: EDITED } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ })); // → Configure
    fireEvent.click(screen.getByRole("button", { name: /Continue/ })); // → Install
  }

  it("sends the edited workflow with Install, so the PR carries what was typed", async () => {
    await editThenReachInstall();

    exportCi.mockResolvedValue(answer(bundle(0), "https://github.com/acme/payments-api/pull/7"));
    fireEvent.click(screen.getByRole("button", { name: /^Install$/ }));

    await screen.findByRole("link", { name: /View pull request/ });
    expect(exportCi).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "open_pr", workflow: EDITED }),
    );
  });

  it("sends it on the zip path too — both routes take the same body (AC-44)", async () => {
    await editThenReachInstall();

    fireEvent.click(screen.getByText("Copy files as a zip"));
    downloadZip.mockResolvedValue(1024);
    fireEvent.click(screen.getByRole("button", { name: /^Install$/ }));

    await waitFor(() => expect(downloadZip).toHaveBeenCalledTimes(1));
    expect(downloadZip).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "files", workflow: EDITED }),
    );
  });

  it("never sends it on a regeneration — that request exists to discard it (AC-32)", async () => {
    await toPreview(bundle(0));
    fireEvent.change(screen.getByLabelText(WORKFLOW), { target: { value: EDITED } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ })); // → Configure

    fireEvent.click(screen.getByRole("radio", { name: /None \(exit code only\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(exportCi).toHaveBeenCalledTimes(2));

    // Carrying the edit here would hand the same text back and make the warning
    // the reader just confirmed a lie.
    expect(exportCi.mock.calls[1]![0]).not.toHaveProperty("workflow", EDITED);
  });

  it("sends no workflow at all when nothing was edited", async () => {
    await toPreview(bundle(0));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    exportCi.mockResolvedValue(answer(bundle(0), "https://github.com/acme/payments-api/pull/7"));
    fireEvent.click(screen.getByRole("button", { name: /^Install$/ }));

    await screen.findByRole("link", { name: /View pull request/ });
    expect(exportCi.mock.calls.at(-1)![0].workflow).toBeUndefined();
  });

  it("does not publish an edit to another file as the workflow", async () => {
    // The manifest is editable in a real bundle, so `edits` can hold an entry
    // that is not the workflow's. `workflow` is the only override the contract
    // has, and sending the manifest's text in it would commit the wrong file's
    // contents to the workflow file.
    await toPreview(bundle(0));
    fireEvent.click(screen.getByText(MANIFEST));
    fireEvent.change(screen.getByLabelText(MANIFEST), {
      target: { value: "name: Edited manifest" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ })); // → Configure
    fireEvent.click(screen.getByRole("button", { name: /Continue/ })); // → Install

    exportCi.mockResolvedValue(answer(bundle(0), "https://github.com/acme/payments-api/pull/7"));
    fireEvent.click(screen.getByRole("button", { name: /^Install$/ }));

    await screen.findByRole("link", { name: /View pull request/ });
    expect(exportCi.mock.calls.at(-1)![0].workflow).toBeUndefined();
  });
});

describe("ExportWizard — Preview (AC-21, AC-24)", () => {
  it("badges a generated file, refuses input on it, and never puts a huge one in the DOM", async () => {
    const files = bundle(0);
    const huge = "x".repeat(100_000);
    // Index 2 IS `.devdigest/runner.mjs` in `bundle()` — replacing any other
    // slot would put two rows with the same path in the list.
    files[2] = {
      path: ".devdigest/runner.mjs",
      contents: huge,
      editable: false,
      role: "runner",
    };
    await toPreview(files);

    fireEvent.click(screen.getByText(".devdigest/runner.mjs"));
    expect(screen.getByText("generated")).toBeInTheDocument();
    // No textarea for it, and the bytes are named instead of rendered.
    expect(screen.queryByLabelText(".devdigest/runner.mjs")).toBeNull();
    // "100000", not "100,000": a bare `{bytes}` in an ICU message is
    // stringified, not number-formatted — that needs `{bytes, number}`.
    expect(screen.getByText("100000 bytes")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(huge);
  });
});

/**
 * AC-32's confirmation says the hand edits will be lost. When the regeneration
 * it triggers then fails, they used to be neither lost nor kept honestly: the
 * config dispatch landed synchronously, `edits` was cleared only by the `files`
 * dispatch on success, and `Install` sent the stale text — publishing the OLD
 * `types:` list under the NEW settings, with nothing on screen saying so.
 *
 * The rate-limit path is not hypothetical: the export routes allow 10 requests a
 * minute and `applyChange` fires one on every chip toggle and every radio click.
 */
describe("ExportWizard — a regeneration that fails (AC-31, AC-32)", () => {
  const EDITED = "name: Edited by hand\non:\n  pull_request:\n    types: [opened]\n";

  /** Preview → hand-edit → Configure → confirm a change whose request then fails. */
  async function failedRegeneration() {
    await toPreview(bundle(0));
    fireEvent.change(screen.getByLabelText(WORKFLOW), { target: { value: EDITED } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ })); // → Configure

    exportCi.mockRejectedValueOnce(new Error("Too Many Requests"));
    fireEvent.click(screen.getByRole("radio", { name: /None \(exit code only\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(exportCi).toHaveBeenCalledTimes(2));
  }

  it("names the failure on the step it happened on", async () => {
    await failedRegeneration();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not regenerate the bundle: Too Many Requests",
    );
  });

  it("does not carry the discarded edit into Install", async () => {
    await failedRegeneration();
    fireEvent.click(screen.getByRole("button", { name: /Continue/ })); // → Install

    exportCi.mockResolvedValue(answer(bundle(0), "https://github.com/acme/payments-api/pull/7"));
    fireEvent.click(screen.getByRole("button", { name: /^Install$/ }));

    await screen.findByRole("link", { name: /View pull request/ });
    const sent = exportCi.mock.calls.at(-1)![0];
    // Both halves of the confirmation, in one request: the setting it applied
    // and the edit it discarded. Sending `workflow: EDITED` here would publish
    // the reader's old text under `post_as: "none"`, which no screen ever showed.
    expect(sent.workflow).toBeUndefined();
    expect(sent.post_as).toBe("none");
  });

  it("does not carry it into the zip either — the same body goes to both routes", async () => {
    await failedRegeneration();
    fireEvent.click(screen.getByRole("button", { name: /Continue/ })); // → Install

    fireEvent.click(screen.getByText("Copy files as a zip"));
    downloadZip.mockResolvedValue(1024);
    fireEvent.click(screen.getByRole("button", { name: /^Install$/ }));

    await waitFor(() => expect(downloadZip).toHaveBeenCalledTimes(1));
    expect(downloadZip.mock.calls.at(-1)![0].workflow).toBeUndefined();
  });

  it("clears the warning once a later regeneration succeeds", async () => {
    await failedRegeneration();

    fireEvent.click(screen.getByText("pull_request:reopened"));
    await waitFor(() => expect(exportCi).toHaveBeenCalledTimes(3));
    // Sticky is the failure mode to avoid here (`client/INSIGHTS.md` — "a
    // mutation's error is sticky"): a warning that outlives the failure it
    // describes trains the reader to ignore it.
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
