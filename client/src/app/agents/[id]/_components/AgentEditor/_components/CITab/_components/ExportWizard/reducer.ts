/**
 * The wizard's whole session state, in one reducer.
 *
 * Everything the four steps collect lives here and nowhere else, which is what
 * makes AC-7 true by construction: the modal owns this state, closing it
 * unmounts the modal, and nothing is written anywhere until `Install` fires a
 * request. It is also what makes AC-5 free — `Back` moves `step` and touches no
 * other field, so every choice of the session survives it.
 *
 * Pure, and deliberately so: the network calls are the component's, because a
 * reducer that fetched could not be read as "what did the user choose".
 */
import type { CiFile } from "@/lib/types";
import { FALLBACK_BASE, TRIGGERS } from "./constants";

/**
 * The one file in the bundle the wizard treats specially, found by what it IS.
 *
 * It is the file the Preview step opens on (AC-20) and the only one whose hand
 * edit is sent back for publication (AC-31). It cannot be found by path: the
 * path carries the agent's slug (AC-135), so there is no constant to compare
 * against — and it cannot be found by `editable` either, because the bundle
 * marks the manifest, every skill and `memory.jsonl` editable too and the
 * workflow is LAST, so `find((f) => f.editable)` opened the Preview on the
 * manifest. `role` is in the contract for exactly this.
 */
function workflowFile(files: CiFile[]): CiFile | undefined {
  return files.find((f) => f.role === "workflow");
}

export type PostAs = "github_review" | "pr_comment" | "none";

/**
 * The two ways the bundle reaches the repository (AC-36). The names are
 * `CiExportInput.action`'s own, so the Install step's choice IS the field the
 * request carries — no translation table between the card and the body.
 */
export type InstallAction = "open_pr" | "files";

/** The one Configure change that can cost a hand edit (AC-31, AC-32). */
export type ConfigChange =
  | { kind: "trigger"; event: string }
  | { kind: "postAs"; value: PostAs };

export interface WizardState {
  step: number;
  /** "owner/name" of the target repo (AC-8); "" until one is chosen. */
  repo: string;
  /** The branch the pull request is cut from (AC-8). */
  base: string;
  /** The chosen `pull_request` types, always in `TRIGGERS` order. */
  triggers: string[];
  postAs: PostAs;
  /** The generated bundle. Empty until the Target step's `Continue`. */
  files: CiFile[];
  /** Paths publishing will DELETE, as the server reported them (AC-145, AC-146). */
  removals: string[];
  selectedPath: string | null;
  /** Hand edits to editable files, by path. Cleared on every regeneration. */
  edits: Record<string, string>;
  /** A Configure change waiting for the AC-32 confirmation. */
  pendingChange: ConfigChange | null;
  /** Which of the two Install cards is chosen (AC-36). */
  installAction: InstallAction;
  /** The pull request `Install` opened or updated (AC-45). */
  prUrl: string | null;
  /** The zip was handed to the browser (AC-44). */
  zipped: boolean;
}

export type WizardAction =
  | { type: "repo"; repo: string; base: string }
  | { type: "step"; step: number }
  | { type: "files"; files: CiFile[]; removals: string[] }
  | { type: "select"; path: string }
  | { type: "edit"; path: string; contents: string }
  | { type: "config"; triggers: string[]; postAs: PostAs }
  | { type: "requestConfig"; change: ConfigChange }
  | { type: "cancelConfig" }
  | { type: "installAction"; value: InstallAction }
  | { type: "installed"; prUrl: string | null }
  | { type: "zipped" };

export function initialState(repo: string, base: string): WizardState {
  return {
    step: 0,
    repo,
    base: base || FALLBACK_BASE,
    // AC-27: three chips, the first two selected.
    triggers: ["opened", "synchronize"],
    // AC-29: `GitHub review` is the recommended one and the selected one.
    postAs: "github_review",
    files: [],
    removals: [],
    selectedPath: null,
    edits: {},
    pendingChange: null,
    // AC-36: "Open a PR with these files" carries `recommended` and is the
    // choice the step opens on.
    installAction: "open_pr",
    prUrl: null,
    zipped: false,
  };
}

/**
 * The trigger set after toggling one event, normalised back into `TRIGGERS`
 * order so the chips never reorder under the reader and the generated `types:`
 * list is stable between two runs that picked the same set.
 */
function toggleTrigger(current: string[], event: string): string[] {
  const next = current.includes(event)
    ? current.filter((t) => t !== event)
    : [...current, event];
  return TRIGGERS.filter((t) => next.includes(t));
}

/** The config a pending change resolves to, without applying it. */
export function resolveChange(
  state: WizardState,
  change: ConfigChange,
): { triggers: string[]; postAs: PostAs } {
  return change.kind === "trigger"
    ? { triggers: toggleTrigger(state.triggers, change.event), postAs: state.postAs }
    : { triggers: state.triggers, postAs: change.value };
}

/** Whether the reader has hand-edited anything the next regeneration would lose. */
export function hasEdits(state: WizardState): boolean {
  return Object.keys(state.edits).length > 0;
}

/** The path named in the AC-32 warning: the first file that was edited. */
export function firstEditedPath(state: WizardState): string {
  return Object.keys(state.edits)[0] ?? "";
}

/** The contents shown for a file: the reader's edit if there is one. */
export function contentsOf(state: WizardState, file: CiFile): string {
  return state.edits[file.path] ?? file.contents;
}

/**
 * The hand-edited workflow `Install` must publish, or `undefined` (AC-31, AC-55).
 *
 * Only this one path is sent back. The other editable files in the bundle can be
 * edited in the Preview step too, but the contract carries a `workflow` field and
 * nothing else — publishing an edited manifest is not a criterion, and inventing
 * a channel for it here would be a shape the server does not accept.
 *
 * `regenerate` deliberately does NOT use this: a Configure change regenerates
 * precisely BECAUSE the edit is being discarded (AC-32), so sending the edit back
 * would hand the same text out again and the warning would be a lie.
 */
export function editedWorkflow(state: WizardState): string | undefined {
  const workflow = workflowFile(state.files);
  return workflow && state.edits[workflow.path];
}

export function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "repo":
      // A different repo invalidates the bundle: the manifest and the install
      // text both name it. Regeneration is the caller's next move.
      return { ...state, repo: action.repo, base: action.base || FALLBACK_BASE };
    case "step":
      return { ...state, step: action.step };
    case "files": {
      // AC-20: the workflow is selected by default, and it is found by its ROLE.
      const workflow = workflowFile(action.files) ?? action.files[0];
      return {
        ...state,
        files: action.files,
        removals: action.removals,
        selectedPath: workflow?.path ?? null,
        edits: {},
      };
    }
    case "select":
      return { ...state, selectedPath: action.path };
    case "edit":
      return { ...state, edits: { ...state.edits, [action.path]: action.contents } };
    case "config":
      return {
        ...state,
        triggers: action.triggers,
        postAs: action.postAs,
        pendingChange: null,
        // THE EDIT IS DISCARDED HERE, with the setting that discards it — not
        // when a regenerated bundle comes back. AC-32's dialog promises the hand
        // edits will be lost; clearing them on the `files` dispatch alone kept
        // that promise only when the request succeeded, and a regeneration that
        // failed (offline, 500, the 10/min export limit) left the NEW triggers
        // beside the OLD edit. Install then published that edit — carrying the
        // previous `types:` list — against a config it no longer matched.
        edits: {},
      };
    case "requestConfig":
      return { ...state, pendingChange: action.change };
    case "cancelConfig":
      return { ...state, pendingChange: null };
    case "installAction":
      return { ...state, installAction: action.value, zipped: false };
    case "installed":
      return { ...state, prUrl: action.prUrl };
    case "zipped":
      return { ...state, zipped: true };
    default:
      return state;
  }
}
