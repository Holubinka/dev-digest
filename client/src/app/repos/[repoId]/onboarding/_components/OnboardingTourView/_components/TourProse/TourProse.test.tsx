import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TourProse } from "./TourProse";
import { linkifyVerifiedPaths } from "./helpers";

afterEach(cleanup);

const SHA = "1122334455667788990011223344556677889900";
const REPO = "acme/payments-api";
const blob = (path: string) => `https://github.com/acme/payments-api/blob/${SHA}/${path}`;

const prose = (body: string, verified: string[], sha: string | null = SHA) =>
  render(
    <TourProse body={body} verifiedPaths={verified} repoFullName={REPO} indexSha={sha} />,
  );

describe("TourProse", () => {
  it("links a verified path, bare and inside a code span", () => {
    prose("Requests enter through src/server.ts, then `src/api/public/index.ts` routes them.", [
      "src/server.ts",
      "src/api/public/index.ts",
    ]);

    expect(screen.getByRole("link", { name: "src/server.ts" })).toHaveAttribute(
      "href",
      blob("src/server.ts"),
    );
    expect(screen.getByRole("link", { name: "src/api/public/index.ts" })).toHaveAttribute(
      "href",
      blob("src/api/public/index.ts"),
    );
  });

  it("leaves an unverified path as text, however much it looks like one", () => {
    // The whole of AC-39: nothing is matched by pattern, so a path the server
    // did not prove exists cannot become a link no matter how it is spelled.
    prose("It also touches src/ghost.ts and `src/phantom.ts`.", ["src/server.ts"]);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/src\/ghost\.ts/)).toBeInTheDocument();
  });

  it("does not reach inside a fenced code block", () => {
    prose("Read this:\n\n```sh\ncat src/server.ts\n```\n", ["src/server.ts"]);

    // "No link" alone is a vacuous assertion — a fence renders its contents
    // literally, so the link SYNTAX would sit there in plain sight instead.
    // What the fence guard buys is the block reading as it was written.
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector("pre")?.textContent).toContain("cat src/server.ts");
    expect(document.querySelector("pre")?.textContent).not.toContain("](");
  });

  it("treats a fence the server's truncation left unclosed as code to the end", () => {
    // The server cuts `body` at `MAX_BODY_CHARS` and computes `verified_paths`
    // off the CUT text, so a fence with no closer is not a rare shape — it is
    // the shape truncation produces, together with the paths to link inside it.
    const body = "Read this:\n\n```sh\ncat src/server.ts\nnode src/app.ts";

    expect(linkifyVerifiedPaths(body, ["src/server.ts", "src/app.ts"])).toBe(body);

    prose(body, ["src/server.ts", "src/app.ts"]);
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector("pre")?.textContent).toContain("cat src/server.ts");
    expect(document.querySelector("pre")?.textContent).not.toContain("](");
  });

  it("does not reach inside a four-space indented code block", () => {
    // The other way markdown spells a code block, and the one the fence
    // pattern never saw at all: `    node src/app.ts` came back as
    // `    node [src/app.ts](src/app.ts)`, beside a control that copies it.
    const body = "Run it:\n\n    node src/app.ts\n";

    expect(linkifyVerifiedPaths(body, ["src/app.ts"])).toBe(body);

    prose(body, ["src/app.ts"]);
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector("pre")?.textContent).toContain("node src/app.ts");
    expect(document.querySelector("pre")?.textContent).not.toContain("](");
  });

  it("does not let a stray backtick close itself on the fence below it", () => {
    // A code span closes on a run of EXACTLY its own length. Taking the next
    // run of any length let the lone backtick swallow the opening fence, and
    // the whole block arrived at the scanner as prose.
    const body = "Install with `pnpm, then:\n\n```sh\ncat src/server.ts\n```\n";

    expect(linkifyVerifiedPaths(body, ["src/server.ts"])).toBe(body);

    prose(body, ["src/server.ts"]);
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector("pre")?.textContent).toContain("cat src/server.ts");
    expect(document.querySelector("pre")?.textContent).not.toContain("](");
  });

  it("does not link a verified path that is only the start of a longer one", () => {
    prose("Everything under src/api/public/index.ts is public.", ["src/api"]);

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("resolves a markdown link the model wrote with a repo-relative href", () => {
    prose("See [the bootstrap](src/server.ts) and [the ghost](src/ghost.ts).", ["src/server.ts"]);

    expect(screen.getByRole("link", { name: "the bootstrap" })).toHaveAttribute(
      "href",
      blob("src/server.ts"),
    );
    expect(screen.queryByRole("link", { name: "the ghost" })).toBeNull();
  });

  it("links nothing at all when the tour names no index sha", () => {
    // `''` is slice B's "there is no index"; a link built on it names no commit.
    prose("Requests enter through src/server.ts.", ["src/server.ts"], "");

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/src\/server\.ts/)).toBeInTheDocument();
  });

  it("keeps embedded HTML as text, because it is still the one untrusted renderer", () => {
    prose('Careful: <img src=x onerror=alert(1)> lives in src/server.ts.', ["src/server.ts"]);

    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(document.body.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("renders nothing for an empty body", () => {
    const { container } = prose("   \n  ", ["src/server.ts"]);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("linkifyVerifiedPaths", () => {
  it("refuses a path it cannot spell inside a markdown link", () => {
    // A `)` would close the construct early and turn the rest of the line into
    // something the model did not write.
    const body = "see src/we(ird).ts here";
    expect(linkifyVerifiedPaths(body, ["src/we(ird).ts"])).toBe(body);
  });

  it("leaves an existing markdown link untouched", () => {
    const body = "[label](src/server.ts)";
    expect(linkifyVerifiedPaths(body, ["src/server.ts"])).toBe(body);
  });
});
