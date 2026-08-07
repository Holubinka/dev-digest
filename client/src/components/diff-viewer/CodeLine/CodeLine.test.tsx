import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CodeLine } from "./CodeLine";
import { lineDomId, type Line } from "../helpers";

/**
 * The two things Smart Diff added to a diff row: a stable DOM id so a badge can
 * scroll to a line, and a gutter marker in the severity's colour. Both are
 * addressing mechanisms — when they break they break silently
 * (`getElementById` returns null and the page simply does not move).
 */
afterEach(cleanup);

const add = (newNo: number, text = "const x = 1;"): Line => ({ kind: "add", text, newNo });
const del = (oldNo: number): Line => ({ kind: "del", text: "gone", oldNo });
const ctx = (oldNo: number, newNo: number): Line => ({ kind: "ctx", text: "same", oldNo, newNo });

function renderLine(ln: Line, props: Partial<React.ComponentProps<typeof CodeLine>> = {}) {
  return render(<CodeLine ln={ln} path="src/a.ts" threads={[]} {...props} />);
}

describe("CodeLine addressing", () => {
  // `getElementById`, matching what SmartDiffViewer actually calls. An id
  // interpolated into a `#…` selector is not equivalent: `lineDomId`
  // percent-encodes the path, and jsdom's selector parser does not accept the
  // escaped `%` that `CSS.escape` produces.
  it("ids an added line by its NEW-side number", () => {
    renderLine(add(28));
    expect(document.getElementById(lineDomId("src/a.ts", 28))).not.toBeNull();
  });

  it("ids a context line too — a finding can cite an unchanged line in the hunk", () => {
    renderLine(ctx(11, 28));
    expect(document.getElementById(lineDomId("src/a.ts", 28))).not.toBeNull();
  });

  it("leaves a deleted line unaddressed: it has no new-side number", () => {
    const { container } = renderLine(del(28));
    expect(container.querySelector("[id^='diff-line-']")).toBeNull();
  });

  it("keeps ids distinct per file, so two open cards cannot collide", () => {
    expect(lineDomId("src/a.ts", 28)).not.toBe(lineDomId("src/b.ts", 28));
  });

  it("survives a path with characters that would break a selector", () => {
    // Real paths in this repo contain `[repoId]`, and a lookup that built a
    // selector string instead of using getElementById would throw on it.
    const path = "src/app/repos/[repoId]/pulls/[number]/page.tsx";
    render(<CodeLine ln={add(3)} path={path} threads={[]} />);
    expect(document.getElementById(lineDomId(path, 3))).not.toBeNull();
  });
});

describe("CodeLine highlight and trailing slot", () => {
  it("marks the gutter in the colour it is given", () => {
    const { container } = renderLine(add(28), { highlightColor: "var(--crit)" });
    const row = container.querySelector<HTMLElement>("[id^='diff-line-']")!;
    expect(row.style.boxShadow).toContain("var(--crit)");
  });

  it("leaves an unmarked line with no inset shadow", () => {
    const { container } = renderLine(add(28));
    const row = container.querySelector<HTMLElement>("[id^='diff-line-']")!;
    expect(row.style.boxShadow).toBe("");
  });

  it("keeps the add/del tint while marking — the two styles must not fight", () => {
    const { container } = renderLine(add(28), { highlightColor: "var(--crit)" });
    const row = container.querySelector<HTMLElement>("[id^='diff-line-']")!;
    expect(row.style.background).not.toBe("");
    expect(row.style.boxShadow).not.toBe("");
  });

  it("renders trailing content, which is where the severity chips sit", () => {
    renderLine(add(28), { right: <span>blocker</span> });
    expect(screen.getByText("blocker")).toBeTruthy();
  });

  it("renders a hunk header without an id or a marker", () => {
    const { container } = renderLine({ kind: "hunk", text: "@@ -1,2 +1,3 @@" });
    expect(screen.getByText("@@ -1,2 +1,3 @@")).toBeTruthy();
    expect(container.querySelector("[id^='diff-line-']")).toBeNull();
  });
});
