import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FileRef } from "./FileRef";
import { fileHref } from "./helpers";

afterEach(cleanup);

const SHA = "1122334455667788990011223344556677889900";
const REPO = "acme/payments-api";

describe("fileHref — the one rule four sections share", () => {
  it("builds a blob URL at the TOUR's index sha", () => {
    expect(fileHref("src/server.ts", REPO, SHA)).toBe(
      `https://github.com/acme/payments-api/blob/${SHA}/src/server.ts`,
    );
  });

  it("refuses an empty sha, which is what 'no index at all' looks like", () => {
    // Slice B publishes `''` rather than null, so a `!= null` guard would pass
    // here and build a link naming no commit.
    expect(fileHref("src/server.ts", REPO, "")).toBeUndefined();
    expect(fileHref("src/server.ts", REPO, null)).toBeUndefined();
  });

  it("refuses an unknown repository and an unlinkable path", () => {
    expect(fileHref("src/server.ts", null, SHA)).toBeUndefined();
    expect(fileHref("../../etc/passwd", REPO, SHA)).toBeUndefined();
    expect(fileHref(`src/${String.fromCodePoint(9)}server.ts`, REPO, SHA)).toBeUndefined();
  });
});

describe("FileRef", () => {
  it("links a path it can link", () => {
    render(<FileRef path="src/server.ts" repoFullName={REPO} indexSha={SHA} />);

    expect(screen.getByRole("link", { name: "src/server.ts" })).toHaveAttribute(
      "href",
      `https://github.com/acme/payments-api/blob/${SHA}/src/server.ts`,
    );
  });

  it("renders plain text and NO control when it cannot", () => {
    // Never a `MonoLink` without an `href` — that is a `<button>` with nothing
    // behind it.
    const hostile = `src/${String.fromCodePoint(9)}server.ts`;
    render(<FileRef path={hostile} repoFullName={REPO} indexSha={SHA} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    // Identity normalizer: RTL's default collapses the very TAB under test
    // (`client/INSIGHTS.md:1866-1879`).
    expect(screen.getByText(hostile, { normalizer: (v) => v })).toBeInTheDocument();
  });
});
