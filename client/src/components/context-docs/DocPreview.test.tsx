/**
 * DocPreview — the third surface an untrusted document reaches (`AC-7`, `R12`).
 *
 * The other two are the reading pane and its `Preview` mode, which are the same
 * component and are asserted in `ProjectContextView.test.tsx`. This file exists
 * because the tab preview held ONLY by happening to render `DocumentReader`
 * today: nothing failed if a later edit swapped it for a bare `Markdown`, a
 * `rehype-raw`, or a `dangerouslySetInnerHTML`. That swap is what these
 * assertions catch.
 *
 * `container.querySelector`, not an RTL query, and deliberately: what is being
 * asserted is that an ELEMENT was never created. An `<img>` with no `alt` has
 * the `presentation` role, so `queryByRole("img")` would miss exactly the tag
 * this is about. Same reasoning as the page's own XSS block.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SpecFile } from "@/lib/types";
import messages from "../../../messages/en/context.json";

vi.mock("@/lib/hooks/context", () => ({ useContextDoc: () => docQuery }));

// Assigned per test, read by the mock above.
let docQuery: {
  data: SpecFile | undefined;
  error: unknown;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => void;
};

const { DocPreview } = await import("./DocPreview");

afterEach(cleanup);

function renderPreview(content: string) {
  docQuery = {
    data: {
      path: "docs/hostile.md",
      content,
      size: 120,
      updated_at: null,
      root: "docs",
      kind: "docs",
      tokens: 40,
      used_by_agents: 0,
    },
    error: null,
    isError: false,
    isSuccess: true,
    refetch: () => {},
  };
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <DocPreview repoId="repo-1" path="docs/hostile.md" onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("DocPreview — an untrusted document cannot execute here either", () => {
  it("renders embedded HTML as TEXT — no element, no onerror attribute", () => {
    const { container } = renderPreview('Before <img src=x onerror="alert(1)"> after');
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    // The tag survives as characters, which is the proof rather than the
    // problem: it is inside a text node, so `innerHTML` shows it escaped.
    expect(screen.getByText(/<img src=x onerror="alert\(1\)">/)).toBeInTheDocument();
  });

  it("never puts a javascript: URL in an href, and the link text still reads", () => {
    const { container } = renderPreview("[click me](javascript:alert(1))");
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByText("click me")).toBeInTheDocument();
  });

  it("renders no image element for a data: source, and still shows the alt text", () => {
    const { container } = renderPreview("![alt text](data:text/html;base64,PHNjcmlwdD4=)");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("alt text")).toBeInTheDocument();
  });

  it("still renders an ordinary https link as a link", () => {
    renderPreview("[docs](https://example.com/x)");
    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
      "href",
      "https://example.com/x",
    );
  });
});
