import { MAX_DOC_CHARS } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import type { ContextDocKind, SpecFile } from "@/lib/types";

/** A local, human-readable timestamp; the raw ISO string when it will not parse. */
export function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** One document in a group: the document itself, and its path below the group's root. */
export type DocGroupRow = { doc: SpecFile; label: string };

/**
 * One scan root and the documents found under it.
 *
 * `kind` is `null` when the rows disagree, which only `.devdigest` can do: there
 * the root is a container and the segment BELOW it names the kind, so
 * `.devdigest/specs/a.md` is `specs` while `.devdigest/notes.md` is `other`.
 * Every other root labels all of its documents the same way.
 */
export type DocGroup = {
  root: string;
  kind: ContextDocKind | null;
  rows: DocGroupRow[];
};

/**
 * The document list, grouped by the root the SCAN assigned each document to.
 *
 * `doc.root` is the grouping key and the path is never re-parsed to find one:
 * the server picks the longest matching root, so a workspace configuring both
 * `docs` and `docs/adr` has exactly one right answer per document, and a prefix
 * test here would put `docs/adr/0001.md` in both groups.
 *
 * Groups come out in the order the roots appear in `roots` — the workspace's own
 * order. A root that is no longer configured but still carries scanned rows
 * (settings changed, no rescan yet) keeps its documents rather than dropping
 * them, in first-appearance order after the configured ones.
 */
export function groupByRoot(documents: SpecFile[], roots: string[]): DocGroup[] {
  const byRoot = new Map<string, DocGroupRow[]>();
  for (const doc of documents) {
    const rows = byRoot.get(doc.root);
    const row = { doc, label: labelUnder(doc.path, doc.root) };
    if (rows) rows.push(row);
    else byRoot.set(doc.root, [row]);
  }

  const ordered = [...roots.filter((root) => byRoot.has(root))];
  for (const root of byRoot.keys()) if (!ordered.includes(root)) ordered.push(root);

  return ordered.map((root) => {
    const rows = byRoot.get(root) ?? [];
    return { root, kind: sharedKind(rows), rows };
  });
}

/** The path below its group's root — `adr/0001.md` for `docs/adr/0001.md` under `docs`. */
function labelUnder(path: string, root: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

/** The one kind all the rows carry, or `null` if they carry more than one. */
function sharedKind(rows: DocGroupRow[]): ContextDocKind | null {
  const first = rows[0]?.doc.kind ?? null;
  return rows.every((row) => row.doc.kind === first) ? first : null;
}

/**
 * Longer than a save may write, so the editor has to refuse it before the
 * request rather than after.
 *
 * The reader serves a document WHOLE up to 400 KB while a write is refused above
 * `MAX_DOC_CHARS`, so everything between the two caps is listed, opens, and used
 * to offer an Edit whose every Save came back `400 too_large`.
 *
 * CODE POINTS, because that is what `persistWrite` measures. `String.length`
 * counts UTF-16 units, so a document of 40 000 emoji would read as 80 000 here
 * and lock an editor the server would have accepted (`server/INSIGHTS.md`). The
 * cheap comparison first is exact rather than an approximation: a string can
 * never hold more code points than UTF-16 units, so one at or below the cap in
 * units is at or below it in code points too — and it keeps the spread off the
 * 400 KB documents this is asked about on every keystroke.
 */
export function overSaveCap(content: string | null | undefined): boolean {
  if (!content || content.length <= MAX_DOC_CHARS) return false;
  return [...content].length > MAX_DOC_CHARS;
}

/** The surface a failed write came from: each answers a different set of codes. */
export type WriteSurface = "create" | "upload" | "save";

/**
 * The message key for a refused write, or `null` when the failure is not one of
 * the write path's own answers — a network error or a 500, which the global
 * mutation toast already reports in the server's words.
 *
 * A `switch` rather than a lookup object: `err.code` is a string off the wire,
 * and `({} as Record<string, string>).constructor` is truthy.
 */
export function writeErrorKey(err: unknown, surface: WriteSurface): string | null {
  if (!(err instanceof ApiError)) return null;
  if (surface === "save") return saveErrorKey(err.code);
  switch (err.code) {
    case "already_exists":
      return "create.exists";
    case "invalid_path":
      return surface === "upload" ? "upload.invalidType" : "create.invalidPath";
    case "too_large":
      return "create.tooLarge";
    case "binary_content":
      return "upload.binary";
    case "clone_not_ready":
      return "write.cloneNotReady";
    default:
      return null;
  }
}

/**
 * A save's own answers, and ONLY the codes a save can return.
 *
 * It overwrites a document the user picked from the list, so every create-surface
 * string is wrong here: nobody typed a path, so "use a relative path under
 * `.devdigest/`" is advice about something that never happened, and nothing can
 * already exist at a path `saveDoc` requires a scanned row for. The one
 * `invalid_path` a save produces is `writeZone(..., 'save')` → `outside_roots`:
 * the document's root has left `context_scan_roots` since it was scanned.
 */
function saveErrorKey(code: string | undefined): string | null {
  switch (code) {
    case "invalid_path":
      return "reader.saveOutsideRoots";
    case "too_large":
      return "reader.tooLongToSave";
    case "clone_not_ready":
      return "write.cloneNotReady";
    default:
      return null;
  }
}
