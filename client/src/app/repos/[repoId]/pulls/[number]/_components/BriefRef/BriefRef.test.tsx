import { describe, it, expect, afterEach, vi } from "vitest";
// `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every existing client test uses `fireEvent`.
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RiskBriefRefLine } from "@/lib/types";
import messages from "@/../messages/en/brief.json";
import { BriefRef } from "./BriefRef";

/**
 * One reference, in both of the forms its two consumers ask for.
 *
 * `RiskAreas.test.tsx` and `ReviewFocusSection.test.tsx` each exercise one form
 * inside its own section. This file is the only place both stand side by side
 * against the SAME input, which is what the shared rules are about: the `:line`
 * suffix and the URL refusal have to answer identically whichever consumer asks,
 * and a rule that drifted between the two would pass both of those files.
 */
afterEach(cleanup);

const INDEX = "1122334455667788990011223344556677889900";
const PATH = "src/middleware/ratelimit.ts";

const REF_LINES: RiskBriefRefLine[] = [{ ref: PATH, line: 12, source: "blast_symbol" }];

function renderLink(props: Partial<React.ComponentProps<typeof BriefRef>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <BriefRef
        as="link"
        refValue={PATH}
        refLines={REF_LINES}
        linkSha={INDEX}
        indexMatchesHead
        repoFullName="acme/payments-api"
        {...(props as object)}
      />
    </NextIntlClientProvider>,
  );
}

function renderOpen(props: Partial<React.ComponentProps<typeof BriefRef>> = {}) {
  const onOpenFile = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <BriefRef
        as="open"
        refValue={PATH}
        refLines={REF_LINES}
        linkSha={INDEX}
        indexMatchesHead
        changedPaths={new Set([PATH])}
        onOpenFile={onOpenFile}
        {...(props as object)}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onOpenFile };
}

describe("BriefRef — the two forms of one reference", () => {
  it("links a risk reference at the index commit, with the same line in text and target", () => {
    renderLink();

    expect(screen.getByRole("link", { name: `${PATH}:12` })).toHaveAttribute(
      "href",
      `https://github.com/acme/payments-api/blob/${INDEX}/${PATH}#L12`,
    );
  });

  it("opens a focus reference in Files changed, at that same line, in one call", () => {
    const { onOpenFile } = renderOpen();

    fireEvent.click(screen.getByRole("button", { name: `${PATH}:12` }));
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith(PATH, 12);
  });

  it("degrades to text, never to a control with nothing behind it", () => {
    // No repo name, so no link can be built; and a path this PR did not change
    // has nothing for a click to open. `MonoLink` without an `href` renders a
    // `<button>` that does nothing, which is what this refuses.
    renderLink({ repoFullName: null });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(`${PATH}:12`)).toBeInTheDocument();

    cleanup();

    renderOpen({ changedPaths: new Set<string>() });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(`${PATH}:12`)).toBeInTheDocument();
  });
});

describe("BriefRef — the rules both forms answer the same way", () => {
  it.each([
    ["the index is behind the head", { indexMatchesHead: false }],
    ["no commit the number could belong to", { linkSha: null }],
    ["the blast answer measured nothing for it", { refLines: [] }],
    [
      "the number is not one the app could use",
      { refLines: [{ ref: PATH, line: 0, source: "blast_symbol" }] as RiskBriefRefLine[] },
    ],
    [
      "the number is past the bound the address bar shares",
      { refLines: [{ ref: PATH, line: 10_000_000, source: "blast_symbol" }] as RiskBriefRefLine[] },
    ],
  ])("carries no line when %s — as a link", (_label, props) => {
    renderLink(props);

    expect(screen.getByText(PATH)).toBeInTheDocument();
    expect(screen.queryByText(`${PATH}:12`)).not.toBeInTheDocument();
    // The target must not carry one either: the text and the link say the same
    // thing, or the reference is wrong in one of them.
    expect(screen.queryByRole("link")?.getAttribute("href") ?? "").not.toContain("#L");
  });

  it.each([
    ["the index is behind the head", { indexMatchesHead: false }],
    ["no commit the number could belong to", { linkSha: null }],
    ["the blast answer measured nothing for it", { refLines: [] }],
    [
      "the number is not one the app could use",
      { refLines: [{ ref: PATH, line: 0, source: "blast_symbol" }] as RiskBriefRefLine[] },
    ],
    [
      "the number is past the bound the address bar shares",
      { refLines: [{ ref: PATH, line: 10_000_000, source: "blast_symbol" }] as RiskBriefRefLine[] },
    ],
  ])("carries no line when %s — as a control", (_label, props) => {
    const { onOpenFile } = renderOpen(props);

    fireEvent.click(screen.getByRole("button", { name: PATH }));
    // The path ALONE — not `undefined` smuggled in as a second argument that
    // then reaches the URL as the string "undefined".
    expect(onOpenFile).toHaveBeenCalledWith(PATH);
    expect(onOpenFile.mock.calls[0]).toHaveLength(1);
  });

  it.each([
    ["a dot segment", "src/../../../etc/passwd"],
    ["a control character", `src/middle${String.fromCodePoint(9)}ware.ts`],
    ["a scheme", "javascript:alert(1)"],
  ])("refuses %s in either form, though the server grounded it", (_label, ref) => {
    // Membership in the grounding set says the model was shown the string. It
    // says nothing about whether the string is safe in a URL (AC-15).
    renderLink({ refValue: ref });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // An identity normalizer, because RTL's default collapses the very TAB one
    // of these cases is about — matching the collapsed form would pass against a
    // component that had silently dropped the character.
    expect(screen.getByText(ref, { normalizer: (value) => value })).toBeInTheDocument();

    cleanup();

    renderOpen({ refValue: ref, changedPaths: new Set([ref]) });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(ref, { normalizer: (value) => value })).toBeInTheDocument();
  });
});
