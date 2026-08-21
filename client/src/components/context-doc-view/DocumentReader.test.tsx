import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DocumentReader } from "./DocumentReader";

/**
 * `resolvePath` is a REQUIRED prop, and these are the two behaviours it selects
 * between. The Project Context call sites pass `null` and must render exactly
 * as they did before it existed; the Onboarding Tour passes a resolver and gets
 * a repo-relative href turned into a URL — or refused, and left as text.
 */
afterEach(cleanup);

describe("DocumentReader with resolvePath={null} — the Project Context surfaces", () => {
  it("keeps an absolute link, a relative link and an escaped tag exactly as before", () => {
    render(
      <DocumentReader
        markdown={
          "[out](https://example.com/a) and [rel](docs/spec.md)\n\n<img src=x onerror=alert(1)>"
        }
        resolvePath={null}
      />,
    );

    expect(screen.getByRole("link", { name: "out" })).toHaveAttribute(
      "href",
      "https://example.com/a",
    );
    // A relative href has no protocol to check, so it was — and stays — a link.
    expect(screen.getByRole("link", { name: "rel" })).toHaveAttribute("href", "docs/spec.md");
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(document.body.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("still refuses a javascript: URL, which renders as text", () => {
    render(<DocumentReader markdown="[click](javascript:alert(1))" resolvePath={null} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("click")).toBeInTheDocument();
  });
});

describe("DocumentReader with a resolver — the tour surface", () => {
  it("resolves a repo-relative href and leaves an absolute one alone", () => {
    const resolvePath = vi.fn(
      (p: string) => (p === "src/server.ts" ? "https://github.com/a/b/blob/sha/src/server.ts" : undefined),
    );
    render(
      <DocumentReader
        markdown={"[a](src/server.ts) [b](src/ghost.ts) [c](https://example.com/x)"}
        resolvePath={resolvePath}
      />,
    );

    expect(screen.getByRole("link", { name: "a" })).toHaveAttribute(
      "href",
      "https://github.com/a/b/blob/sha/src/server.ts",
    );
    // Refused: the reader still sees what the document said, unclickable.
    expect(screen.queryByRole("link", { name: "b" })).toBeNull();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "c" })).toHaveAttribute("href", "https://example.com/x");
    // An `http(s)` URL never reaches the resolver — only a bare path does.
    expect(resolvePath).not.toHaveBeenCalledWith("https://example.com/x");
  });

  it("never offers a javascript: URL to the resolver", () => {
    const resolvePath = vi.fn(() => "https://github.com/a/b");
    render(<DocumentReader markdown="[click](javascript:alert(1))" resolvePath={resolvePath} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(resolvePath).not.toHaveBeenCalled();
  });
});
