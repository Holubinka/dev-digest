import { describe, it, expect } from "vitest";
import { MAX_DOC_CHARS } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import type { SpecFile } from "@/lib/types";
import { formatWhen, groupByRoot, overSaveCap, writeErrorKey } from "./helpers";

describe("formatWhen", () => {
  it("returns null for a null timestamp, and the raw string when it will not parse", () => {
    expect(formatWhen(null)).toBeNull();
    expect(formatWhen("not a date")).toBe("not a date");
  });

  it("formats a real ISO timestamp into something local", () => {
    expect(formatWhen("2026-08-13T00:00:00.000Z")).toContain("2026");
  });
});

const doc = (path: string, root: string, kind: SpecFile["kind"] = "docs"): SpecFile => ({
  path,
  content: null,
  size: 10,
  updated_at: null,
  root,
  kind,
  tokens: 3,
  used_by_agents: 0,
});

describe("groupByRoot", () => {
  it("puts one group per root, in the workspace's configured order", () => {
    const groups = groupByRoot(
      [doc("docs/a.md", "docs"), doc("specs/b.md", "specs", "specs"), doc("docs/c.md", "docs")],
      ["specs", "docs", "insights"],
    );
    expect(groups.map((g) => g.root)).toEqual(["specs", "docs"]);
    expect(groups[1]!.rows.map((r) => r.label)).toEqual(["a.md", "c.md"]);
  });

  it("labels a row with the path BELOW its root, however deep", () => {
    const groups = groupByRoot([doc("docs/adr/2026/0001.md", "docs")], ["docs"]);
    expect(groups[0]!.rows[0]!.label).toBe("adr/2026/0001.md");
  });

  /**
   * The case the old row layout could not show at all. `docs` and `docs/adr` are
   * both configured, the server assigned `docs/adr/0001.md` to the LONGER match,
   * and grouping by `doc.root` is what keeps it out of the `docs` group — a
   * prefix test on the path would put it in both.
   */
  it("gives a document under nested roots to the longest match only", () => {
    const groups = groupByRoot(
      [doc("docs/a.md", "docs"), doc("docs/adr/0001.md", "docs/adr")],
      ["docs", "docs/adr"],
    );
    expect(groups.map((g) => g.root)).toEqual(["docs", "docs/adr"]);
    expect(groups[0]!.rows.map((r) => r.label)).toEqual(["a.md"]);
    expect(groups[1]!.rows.map((r) => r.label)).toEqual(["0001.md"]);
  });

  it("carries the kind on the group when its rows agree, and null when they do not", () => {
    const groups = groupByRoot(
      [
        doc("docs/a.md", "docs"),
        doc(".devdigest/specs/x.md", ".devdigest", "specs"),
        doc(".devdigest/notes.md", ".devdigest", "other"),
      ],
      ["docs", ".devdigest"],
    );
    expect(groups[0]!.kind).toBe("docs");
    // `.devdigest` is a container: the segment below it names the kind, so one
    // badge on the header would be wrong for one of these two rows.
    expect(groups[1]!.kind).toBeNull();
  });

  it("keeps documents whose root is no longer configured rather than dropping them", () => {
    // Settings changed and nothing has rescanned yet: the rows are still real
    // files, and a list that silently loses them is worse than one that is out
    // of date.
    const groups = groupByRoot([doc("docs/a.md", "docs"), doc("old/b.md", "old")], ["docs"]);
    expect(groups.map((g) => g.root)).toEqual(["docs", "old"]);
  });
});

describe("overSaveCap", () => {
  it("is false for nothing loaded and for a document a save would accept", () => {
    expect(overSaveCap(null)).toBe(false);
    expect(overSaveCap(undefined)).toBe(false);
    expect(overSaveCap("")).toBe(false);
    // Exactly the cap is still writable: the server refuses ABOVE it.
    expect(overSaveCap("a".repeat(MAX_DOC_CHARS))).toBe(false);
  });

  it("is true one code point past the cap, which is where Save starts failing", () => {
    expect(overSaveCap("a".repeat(MAX_DOC_CHARS + 1))).toBe(true);
  });

  /**
   * The counter has to be the SERVER's. `persistWrite` measures `[...content]`,
   * so a document of 40 000 emoji is 40 000 code points and saves — while
   * `String.length` sees 80 000 UTF-16 units and would lock the editor on a
   * document nothing refuses (`server/INSIGHTS.md`).
   */
  it("counts code points and not UTF-16 units", () => {
    expect(overSaveCap("😀".repeat(MAX_DOC_CHARS))).toBe(false);
    expect(overSaveCap("😀".repeat(MAX_DOC_CHARS + 1))).toBe(true);
  });
});

describe("writeErrorKey", () => {
  const err = (code: string) => new ApiError("nope", 400, code);

  it("names the refusal a write can actually answer with", () => {
    expect(writeErrorKey(err("already_exists"), "create")).toBe("create.exists");
    expect(writeErrorKey(err("too_large"), "create")).toBe("create.tooLarge");
    expect(writeErrorKey(err("binary_content"), "upload")).toBe("upload.binary");
    expect(writeErrorKey(err("clone_not_ready"), "create")).toBe("write.cloneNotReady");
  });

  it("reads invalid_path as the question the surface actually asked", () => {
    // The same server code, three different mistakes: a typed path that breaks
    // the rules, a picked file that is not a .md at all, and a document whose
    // root the workspace has since dropped from its scan roots.
    expect(writeErrorKey(err("invalid_path"), "create")).toBe("create.invalidPath");
    expect(writeErrorKey(err("invalid_path"), "upload")).toBe("upload.invalidType");
    expect(writeErrorKey(err("invalid_path"), "save")).toBe("reader.saveOutsideRoots");
  });

  /**
   * A save answers with its own subset, and NOTHING from the create surface: it
   * overwrites a document the user opened from the list, so "pick another name"
   * and "use a path under .devdigest/" are advice about a path nobody typed.
   */
  it("answers a save with the codes a save can actually return", () => {
    expect(writeErrorKey(err("too_large"), "save")).toBe("reader.tooLongToSave");
    expect(writeErrorKey(err("clone_not_ready"), "save")).toBe("write.cloneNotReady");
    // `writeFile` overwrites on this path, so `exists` cannot come back — and a
    // save is not an upload, so neither can `binary_content`.
    expect(writeErrorKey(err("already_exists"), "save")).toBeNull();
    expect(writeErrorKey(err("binary_content"), "save")).toBeNull();
  });

  it("returns null for anything that is not one of the write path's own answers", () => {
    // A 500 or a dropped connection is not a property of what was typed, and the
    // global mutation toast already reports it in the server's own words.
    expect(writeErrorKey(err("internal_error"), "create")).toBeNull();
    expect(writeErrorKey(new Error("offline"), "upload")).toBeNull();
    expect(writeErrorKey(null, "create")).toBeNull();
  });
});
