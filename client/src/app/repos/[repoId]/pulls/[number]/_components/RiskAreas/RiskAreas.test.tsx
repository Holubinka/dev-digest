import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RiskBriefRefLine } from "@/lib/types";
import type { Risk } from "@devdigest/shared";
import messages from "@/../messages/en/brief.json";
import { RiskAreas } from "./RiskAreas";
import { riskChip, RISK_ICON_FALLBACK } from "./constants";

/**
 * RISK AREAS is presentational — `OverviewTab` owns the query and hands the
 * fields down — so this file needs `NextIntlClientProvider` and nothing else: no
 * query client, no `fetch` mock, no router.
 *
 * Everything it renders except its own labels is MODEL OUTPUT reaching it
 * through `src/lib/api.ts`, which does not validate at runtime. That is why the
 * hostile cases below are ordinary tests rather than a separate security file.
 *
 * Three of them are here because `PrBriefCard.test.tsx` held them and that file
 * is deleted: the `link_sha: null` degradation (AC-27), the URL-rule refusals
 * (AC-15) and "model output is text, never markup".
 */
afterEach(cleanup);

const INDEX = "1122334455667788990011223344556677889900";
const HEAD = "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432";

const RISKS: Risk[] = [
  {
    kind: "security",
    title: "Auth surface touched",
    explanation: "The limiter runs before the session is resolved.",
    severity: "high",
    file_refs: ["src/middleware/ratelimit.ts"],
  },
  {
    kind: "new dependency",
    title: "New dependency: ioredis",
    explanation: "A second client library joins the runtime.",
    severity: "medium",
    file_refs: ["package.json"],
  },
  {
    kind: "performance",
    title: "Adds Redis round-trip per request",
    explanation: "Every public request now waits on a network hop.",
    severity: "low",
    file_refs: [],
  },
];

/** Only `src/middleware/ratelimit.ts` came through the blast answer. */
const REF_LINES: RiskBriefRefLine[] = [
  { ref: "src/middleware/ratelimit.ts", line: 12, source: "blast_symbol" },
];

function renderSection(props: Partial<React.ComponentProps<typeof RiskAreas>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <RiskAreas
        risks={RISKS}
        riskLevel="high"
        refLines={REF_LINES}
        linkSha={INDEX}
        headSha={HEAD}
        indexMatchesHead
        repoFullName="acme/payments-api"
        intentFreshness="fresh"
        intentComputedAt="2026-08-15T10:00:00.000Z"
        isLoading={false}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

/** The row a title belongs to — the scope every per-row assertion needs. */
const row = (title: string) => screen.getByText(title).closest("li") as HTMLElement;

/** Which lucide icon rendered, e.g. `lucide-shield`. */
const iconClasses = (el: HTMLElement) =>
  [...el.querySelectorAll("svg")].map((svg) => svg.getAttribute("class") ?? "").join(" ");

describe("RiskAreas — the loaded risks", () => {
  it("shows the level as a word, every title and every reference", () => {
    renderSection();

    // The WORD, not a colour: a reader who cannot see the badge's fill still
    // learns the level.
    expect(screen.getByText("Risk areas")).toBeInTheDocument();
    expect(screen.getAllByText("high")).not.toHaveLength(0);
    expect(screen.getByText("Auth surface touched")).toBeInTheDocument();
    expect(screen.getByText("New dependency: ioredis")).toBeInTheDocument();
    expect(screen.getByText("Adds Redis round-trip per request")).toBeInTheDocument();
  });

  it("renders the risks in the order the server sent them, worst first", () => {
    renderSection();
    const titles = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");

    expect(titles[0]).toContain("Auth surface touched");
    expect(titles[1]).toContain("New dependency: ioredis");
    expect(titles[2]).toContain("Adds Redis round-trip per request");
  });

  it("gives every row an icon chosen by the risk's own kind", () => {
    renderSection();

    expect(iconClasses(row("Auth surface touched"))).toContain("lucide-shield");
    expect(iconClasses(row("New dependency: ioredis"))).toContain("lucide-boxes");
    expect(iconClasses(row("Adds Redis round-trip per request"))).toContain("lucide-zap");
  });

  it("gives a kind nothing maps the fallback icon, never an empty slot", () => {
    renderSection({
      risks: [{ ...RISKS[0]!, kind: "quantum flux", title: "Unmapped" }],
    });

    // Scoped to the row: the section heading carries the same icon, so an
    // unscoped query would pass against a row with no icon at all.
    expect(iconClasses(row("Unmapped"))).toContain("lucide-triangle-alert");
  });

  it("keeps the explanation behind a disclosure and the rest of the row outside it", () => {
    renderSection();
    const first = row("Auth surface touched");
    const details = first.querySelector("details") as HTMLElement;
    const summary = first.querySelector("summary") as HTMLElement;

    // CONTAINMENT, never visibility: jsdom flips `details.open` on a summary
    // click but does not hide the closed content, so an assertion about what is
    // "visible" here cannot fail (`client/INSIGHTS.md:890-906`).
    expect(details).not.toBeNull();
    expect(
      within(details).getByText("The limiter runs before the session is resolved."),
    ).toBeInTheDocument();
    expect(
      within(summary).queryByText("The limiter runs before the session is resolved."),
    ).not.toBeInTheDocument();

    // Level, title and references stay outside the disclosure (AC-54).
    expect(within(summary).getByText("high")).toBeInTheDocument();
    expect(within(summary).getByText("Auth surface touched")).toBeInTheDocument();
    expect(first.querySelector("details a")).toBeNull();
    expect(within(first).getByText(/ratelimit\.ts/)).toBeInTheDocument();
  });

  it("says there are no risks beside the level rather than showing an empty list", () => {
    renderSection({ risks: [], riskLevel: "low" });

    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
    expect(screen.getByText("low")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("shows five rows and a disclosure carrying the hidden count when six arrive", () => {
    const six: Risk[] = Array.from({ length: 6 }, (_, i) => ({
      ...RISKS[0]!,
      title: `Risk number ${i + 1}`,
      file_refs: [],
    }));
    renderSection({ risks: six });

    // The five that stand open are the first five, in order.
    const open = screen.getByText("Risk number 1").closest("ul") as HTMLElement;
    expect(within(open).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("1 more risk areas")).toBeInTheDocument();
    // The sixth is on the page, behind the disclosure — never dropped in silence.
    expect(screen.getByText("Risk number 6")).toBeInTheDocument();
    expect(screen.getByText("Risk number 6").closest("details")).not.toBe(
      screen.getByText("Risk number 1").closest("details"),
    );
  });
});

describe("RiskAreas — model output is text, never markup", () => {
  it("renders an HTML payload in a title as characters and mounts no element from it", () => {
    const payload = '<img src=x onerror="alert(1)"> **bold** [link](javascript:alert(2))';
    const { container } = renderSection({
      risks: [{ ...RISKS[0]!, title: payload, file_refs: [] }],
    });

    expect(screen.getByText(payload)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    // The markdown half matters as much: `<Markdown>` sits two blocks away in
    // the same tab, and reaching for it here is exactly the mistake.
    expect(container.querySelector("strong")).toBeNull();
  });
});

describe("RiskAreas — the line a reference carries", () => {
  it("shows `:line` for a reference the blast answer admitted, and none for the rest", () => {
    renderSection();

    expect(screen.getByText("src/middleware/ratelimit.ts:12")).toBeInTheDocument();
    // `package.json` came in through the changed-file list, so there is no
    // measured line — and no placeholder stands in for one (AC-60, AC-62).
    expect(screen.getByText("package.json")).toBeInTheDocument();
    expect(screen.queryByText(/package\.json:/)).not.toBeInTheDocument();
  });

  it("puts the same line in the link's target as in its text", () => {
    renderSection();

    expect(screen.getByRole("link", { name: "src/middleware/ratelimit.ts:12" })).toHaveAttribute(
      "href",
      `https://github.com/acme/payments-api/blob/${HEAD}/src/middleware/ratelimit.ts#L12`,
    );
  });

  it("links a risk reference at the head, the commit the file exists at", () => {
    // DIVERGENCE from AC-27, decided 2026-08-20 against a measurement. `link_sha`
    // is the commit the INDEX sits at; the index tracks the default branch, so
    // `index_matches_head` is false for every brief of every PR, and a path the
    // PR ADDS is absent from that tree — every such link was a 404. The old
    // rule's reason survives where it belongs: the `:line` suffix is still gated
    // on `indexMatchesHead`, so a head link never carries a line the index
    // cannot vouch for. `BlastRadiusCard` still links at `link_sha` and must.
    renderSection();
    const link = screen.getByRole("link", { name: "src/middleware/ratelimit.ts:12" });

    expect(link.getAttribute("href")).toContain(HEAD);
    expect(link.getAttribute("href")).not.toContain(INDEX);
  });

  it("still links when the repo has no index at all", () => {
    // `link_sha` null used to mean "no link". It means "no indexed commit", and
    // the file is still at the head — which is the version under review.
    renderSection({ linkSha: null, indexMatchesHead: false });
    const link = screen.getByRole("link", { name: "src/middleware/ratelimit.ts" });

    expect(link.getAttribute("href")).toContain(HEAD);
    expect(link.getAttribute("href")).not.toContain("#L");
  });

  it("shows no `:line` anywhere when the index is behind the head, populated or not", () => {
    renderSection({ indexMatchesHead: false });

    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
    expect(screen.queryByText("src/middleware/ratelimit.ts:12")).not.toBeInTheDocument();
    // And the target must not carry one either: the text and the link say the
    // same thing, or the reference is wrong in one of them.
    expect(
      screen.getByRole("link", { name: "src/middleware/ratelimit.ts" }).getAttribute("href"),
    ).not.toContain("#L");
    // The section says WHY, once, rather than leaving the numbers to vanish
    // without explanation (AC-26).
    expect(screen.getByText(/code index at commit 1122334/i)).toBeInTheDocument();
  });

  it("shows no `:line` when the entry is not an integer the app could use", () => {
    // `src/lib/api.ts` validates nothing at runtime, so this shape can arrive.
    renderSection({
      refLines: [
        { ref: "src/middleware/ratelimit.ts", line: 0, source: "blast_symbol" },
      ] as RiskBriefRefLine[],
    });

    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
    expect(screen.queryByText(/ratelimit\.ts:/)).not.toBeInTheDocument();
  });
});

describe("RiskAreas — what may become a link", () => {
  it("renders every reference as text when there is no commit to link them at", () => {
    // The gate is `head_sha` now: with no commit at all there is nothing to link
    // to, and the path stays as text.
    const { container } = renderSection({ headSha: null, linkSha: null, indexMatchesHead: false });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("github.com");
    // Losing the anchor must not lose the path.
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
    expect(screen.getByText("package.json")).toBeInTheDocument();
  });

  it("shows no `:line` when there is no commit the number could belong to", () => {
    // The two gates are INDEPENDENT (AC-61 says "index_matches_head is false OR
    // link_sha is null"), so this case pins the second one on its own: with the
    // first still satisfied, a `lineFor` that only checked freshness would print
    // a number measured at a commit that does not exist.
    renderSection({ linkSha: null, indexMatchesHead: true });

    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
    expect(screen.queryByText("src/middleware/ratelimit.ts:12")).not.toBeInTheDocument();
    // The reference still LINKS — `head_sha` is what a link needs now — and the
    // point of this case is that it carries no line, because `link_sha` is what
    // a NUMBER needs and there is none. The two gates stayed independent; only
    // the one the link hangs on moved.
    expect(
      screen.getByRole("link", { name: "src/middleware/ratelimit.ts" }).getAttribute("href"),
    ).not.toContain("#L");
  });

  it("renders no link when the repository name has not loaded yet", () => {
    renderSection({ repoFullName: null });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("src/middleware/ratelimit.ts:12")).toBeInTheDocument();
  });

  it.each([
    ["a dot segment", "src/../../../etc/passwd"],
    ["a control character", `src/middle${String.fromCodePoint(9)}ware.ts`],
    ["a scheme", "javascript:alert(1)"],
  ])("refuses to link a reference carrying %s", (_label, ref) => {
    // Membership is granted deliberately: this is the case where grounding says
    // yes and the URL rules must still say no (AC-15).
    renderSection({ risks: [{ ...RISKS[0]!, file_refs: [ref] }] });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // An identity normalizer, because RTL's default collapses the very TAB one
    // of these cases is about — matching the collapsed form would pass against
    // a section that had silently dropped the character.
    expect(screen.getByText(ref, { normalizer: (value) => value })).toBeInTheDocument();
  });
});

describe("RiskAreas — what the brief rests on", () => {
  it("marks the intent as derived from an earlier state when it is stale", () => {
    renderSection({ intentFreshness: "stale" });
    expect(
      screen.getByText(/derived from an earlier state of the pull request/i),
    ).toBeInTheDocument();
  });

  it("says the intent's age could not be compared rather than implying it is fresh", () => {
    renderSection({ intentFreshness: "unknown" });

    expect(screen.getByText(/age could not be compared with this commit/i)).toBeInTheDocument();
    // The failure this guards is `unknown` rendering as the `fresh` branch —
    // i.e. silently, which is indistinguishable from a confident answer.
    expect(
      screen.queryByText(/derived from an earlier state of the pull request/i),
    ).not.toBeInTheDocument();
  });

  it("says nothing about intent age when it is fresh", () => {
    renderSection({ intentFreshness: "fresh" });

    expect(
      screen.queryByText(/derived from an earlier state of the pull request/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/age could not be compared with this commit/i),
    ).not.toBeInTheDocument();
  });

  it("says nothing about intent age when `unknown` means there was no intent at all", () => {
    renderSection({ intentFreshness: "unknown", intentComputedAt: null });
    expect(
      screen.queryByText(/age could not be compared with this commit/i),
    ).not.toBeInTheDocument();
  });
});

describe("RiskAreas — the states that are not a list of risks", () => {
  it("keeps the section and its heading while the brief is being computed", () => {
    const { container } = renderSection({ risks: null, riskLevel: null, isLoading: true });

    expect(screen.getByText("Risk areas")).toBeInTheDocument();
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("The brief for this state has not been computed.")).not.toBeInTheDocument();
  });

  it("keeps the section and says the brief is missing when there is none", () => {
    renderSection({ risks: null, riskLevel: null });

    expect(screen.getByText("Risk areas")).toBeInTheDocument();
    expect(screen.getByText("The brief for this state has not been computed.")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

/**
 * The dictionary itself, moved here with D18: the intent's own `risk_areas` chip
 * row is gone and `Risk.kind` is the free string this now answers. The cases are
 * verbatim model output taken from `pr_intent` on this workspace — the exact-match
 * table this replaced resolved only two of them and gave the rest the same
 * triangle, which is the whole defect.
 */
describe("RiskAreas — the icon dictionary", () => {
  it("resolves an unmapped phrase to the fallback rather than to `undefined`", () => {
    expect(riskChip("quantum flux").icon).toBe(RISK_ICON_FALLBACK);
  });

  it.each(["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"])(
    "resolves the inherited key %s to the fallback icon",
    (key) => {
      // `"constructor" in OBJ` is true, so an allowlist built with `in` is not
      // one (`client/INSIGHTS.md:594-618`). Naming the inherited keys is what
      // makes this fail before the fix.
      expect(riskChip(key).icon).toBe(RISK_ICON_FALLBACK);
    },
  );

  it("still maps a known kind, case- and space-insensitively", () => {
    expect(riskChip("  Security ").icon).toBe("Shield");
    expect(riskChip("security").icon).not.toBe(RISK_ICON_FALLBACK);
  });

  it.each([
    ["public API", "Code"],
    ["client-server contract", "Code"],
    ["performance", "Zap"],
    ["tests", "FlaskConical"],
    ["PR list grid layout", "Layers"],
    ["Text overflow in findings cell", "Layers"],
    ["Client-side conventions UI (new page, modals, shell integration)", "Layers"],
    ["Conventions extraction pipeline (model hallucination, quote verification gates)", "Workflow"],
    ["Feature models configuration", "Wrench"],
  ])("maps the real phrase %j to %s", (phrase, icon) => {
    expect(riskChip(phrase).icon).toBe(icon);
  });

  it("lets an earlier rule win: a security phrase that also mentions the API", () => {
    expect(riskChip("auth bypass on the public API").icon).toBe("Shield");
  });

  /**
   * A budget is a size, not a secret. `kind: "token budget"` arrived on live data
   * (PR #20, 2026-08-17) and matched the credential rule on the bare word `token`,
   * so a risk about how much prompt an input may occupy rendered as a padlock in
   * the critical tone. The pair below is the whole fix: the budget rule has to sit
   * before the credential one, and moving it back turns both of these red.
   */
  it.each([
    ["token budget", "Gauge"],
    ["rate limit", "Gauge"],
    ["quota exhaustion", "Gauge"],
  ])("reads %j as a size, not a credential", (phrase, icon) => {
    expect(riskChip(phrase).icon).toBe(icon);
  });

  it.each([
    ["leaked token", "Lock"],
    ["credential leak", "Lock"],
    ["secret in the diff", "Lock"],
  ])("still reads %j as a credential", (phrase, icon) => {
    expect(riskChip(phrase).icon).toBe(icon);
  });

  it("does not match a keyword buried inside a longer word", () => {
    // \b is what keeps `ui` out of "building" and `job` out of "jobless".
    expect(riskChip("building the sidebar").icon).toBe(RISK_ICON_FALLBACK);
  });

  /**
   * Tint is a signal, and a signal every icon carries is not one. These pin the
   * restraint as much as the colours: only the irreversible families are tinted,
   * and the tokens are the theme's own — a literal hex here would mean a second
   * copy of `SEV` (`client/INSIGHTS.md:307-338`).
   */
  it.each([
    ["auth surface touched", "var(--crit)", "var(--crit-bg)"],
    ["secret rotation", "var(--crit)", "var(--crit-bg)"],
    ["migration drops a column", "var(--warn)", "var(--warn-bg)"],
  ])("tints %j as an irreversible risk", (phrase, color, bg) => {
    expect(riskChip(phrase)).toMatchObject({ color, bg });
  });

  it.each(["performance", "public API", "tests", "quantum flux"])(
    "leaves %j on the neutral default",
    (phrase) => {
      expect(riskChip(phrase)).toMatchObject({
        color: "var(--text-secondary)",
        bg: "var(--bg-hover)",
      });
    },
  );
});
