/**
 * The page as a whole: the five sections in the mockup's order, the rail beside
 * them, and every state that is not a tour — including the one where the read
 * says generating is refused and the saved tour is shown anyway.
 *
 * `fireEvent`, not `userEvent`, which is not a dependency here
 * (`client/INSIGHTS.md:1078`).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import {
  installIntersectionObserver,
  type FakeIntersectionObserver,
} from "@/test/intersection-observer";
import { ApiError } from "@/lib/api";
import type { OnboardingPage, OnboardingRecord, OnboardingSection } from "@/lib/types";

/* `useSearchParams` and `useRouter` are here for FirstTasksSection, which reads
   `?task=` and rewrites it: the whole tree renders in this file, so a member
   missing from this factory is an error thrown from a section rather than from
   the view under test (`client/INSIGHTS.md`, the two-specifiers entry). */
vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-1" }),
  usePathname: () => "/repos/repo-1/onboarding",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: () => {} }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>repo not found</div> }));
vi.mock("@/lib/repo-context", () => ({
  useRepoNotFound: () => repoNotFound,
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/payments-api" } }),
}));
vi.mock("@/lib/hooks/onboarding", () => ({
  useOnboardingTour: () => pageQuery,
  useGenerateOnboardingTour: () => generateMutation,
}));

let repoNotFound = false;
let pageQuery: {
  data: OnboardingPage | undefined;
  isError: boolean;
  error?: unknown;
  refetch: () => void;
};
let generateMutation: { mutate: () => void; isPending: boolean; error: unknown };
const generateMutate = vi.fn();

const { OnboardingTourView } = await import("./OnboardingTourView");

const TOUR_SHA = "2f8b7e19c6f559e335efb170098af90d8a688a25";
const HEAD_SHA = "9a1c4d70bb2e5f3a6c8d90e1f2a3b4c5d6e7f809";

const section = (kind: OnboardingSection["kind"], body = "Prose."): OnboardingSection => ({
  kind,
  title: `The model's own ${kind} heading`,
  body,
  links: [],
  verified_paths: [],
  state: body === "" ? "empty" : "ready",
  empty_reason: body === "" ? "model_returned_nothing" : null,
});

const record = (over: Partial<OnboardingRecord> = {}): OnboardingRecord => ({
  sections: [
    section("architecture"),
    section("critical_paths"),
    section("how_to_run"),
    section("reading_path"),
    section("first_tasks"),
  ],
  flows: [{ title: "A request", steps: [{ path: "src/server.ts", note: "App bootstrap" }] }],
  reading_path: [{ path: "src/server.ts", reason: "The whole lifecycle in one file" }],
  tasks: [
    {
      title: "Add a readiness probe",
      path: "src/health.ts",
      why: "Small",
      complexity: "low",
      steps: [],
      impact: "",
      verification: "",
    },
  ],
  setup_commands: [],
  packages: [
    {
      name: "@devdigest/api",
      path: "server",
      manager: "pnpm",
      install_command: "pnpm install",
      commands: [{ script: "dev", command: "pnpm dev", why: "Starts the API" }],
    },
  ],
  env_vars: [{ name: "DATABASE_URL", source_path: ".env.example" }],
  env_vars_truncated: true,
  package_scan: { depth: 2, excluded_dirs: ["node_modules"], found: 1, shown: 1, bounded: false },
  inputs: [
    { id: "repo_map", status: "included", tokens: 1514, detail: null, omitted: [], shortened: [] },
  ],
  dropped: {
    unknown_path: 0,
    unknown_script: 0,
    manager_mismatch: 0,
    unknown_complexity: 0,
    unknown_section: 0,
  },
  sample_files: 19,
  sample_truncated: false,
  chains_supplied: 20,
  longest_chain_files: 5,
  budget: 40000,
  input_tokens_counted: 23507,
  system_tokens: 1180,
  tokenizer: "cl100k_base",
  attempts: 1,
  tokens_in: 23507,
  duration_ms: 104216,
  provider: "openai",
  model: "gpt-5",
  cost_usd: 0.12,
  index_state: {
    last_indexed_sha: TOUR_SHA,
    files_indexed: 656,
    files_skipped: 0,
    status: "full",
  },
  generated_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  ...over,
});

const envelope = (over: Partial<OnboardingPage> = {}): OnboardingPage => ({
  tour: record(),
  index: {
    last_indexed_sha: TOUR_SHA,
    files_indexed: 656,
    files_skipped: 0,
    status: "full",
    updated_at: new Date().toISOString(),
  },
  stale: false,
  generate_blocked: null,
  ...over,
});

const setup = (
  data: OnboardingPage | undefined,
  mutation: Partial<typeof generateMutation> = {},
) => {
  pageQuery = { data, isError: false, refetch: () => {} };
  generateMutation = { mutate: generateMutate, isPending: false, error: null, ...mutation };
};

afterEach(() => {
  cleanup();
  repoNotFound = false;
  generateMutate.mockClear();
  window.history.replaceState({}, "", "/repos/repo-1/onboarding");
});

const render = () =>
  renderWithProviders(<OnboardingTourView repoId="repo-1" />, { onboarding: messages });

const follows = (first: Element, second: Element) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("OnboardingTourView — the composition", () => {
  it("draws the five sections in the mockup's order, with the rail before them", () => {
    // An ORDER assertion, not five presence assertions: three presence
    // assertions passed for a whole round while a region sat in the wrong place
    // (`client/INSIGHTS.md:110-132`).
    setup(envelope());
    render();

    const headings = [
      "Architecture overview",
      "Critical paths",
      "How to run locally",
      "Guided reading path",
      "First tasks",
    ];
    // `getByRole` throws when one is missing, so this is presence AND order —
    // and the input list below the sections is a level-2 heading too, which is
    // why the five are named rather than swept up by level alone.
    const cards = headings.map((name) => screen.getByRole("heading", { level: 2, name }));
    for (let i = 0; i < cards.length - 1; i += 1) {
      expect(follows(cards[i]!, cards[i + 1]!)).toBe(true);
    }

    const rail = screen.getByRole("navigation", { name: "ON THIS PAGE" });
    expect(follows(rail, cards[0]!)).toBe(true);
    expect(within(rail).getAllByRole("link").map((a) => a.textContent)).toEqual(headings);
  });

  it("puts the header above the sections and the input list below them", () => {
    setup(envelope());
    render();

    const heading = screen.getByRole("heading", { level: 1 });
    const first = screen.getByRole("heading", { level: 2, name: "Architecture overview" });
    const last = screen.getByRole("heading", { level: 2, name: "First tasks" });
    const inputs = screen.getByText(messages.inputs.title);

    expect(follows(heading, first)).toBe(true);
    expect(follows(last, inputs)).toBe(true);
  });

  /* THE DEFECT THIS GUARDS: the header once sat OUTSIDE `.dd-tour-layout`, so
     it started at the rail's left edge instead of the cards', and the whole
     reading column read as pushed 228px right of the mockup. Being in the grid
     is what puts the heading, the cards and the input list on one vertical, and
     the DOM is the only half of that a unit test can hold — jsdom computes no
     grid columns, so the alignment itself is checked in a browser. */
  it("keeps the heading, the cards and the input list in the grid the rail sits beside", () => {
    setup(envelope());
    const { container } = render();

    const layout = container.querySelector(".dd-tour-layout");
    expect(layout).not.toBeNull();

    const heading = screen.getByRole("heading", { level: 1 });
    const card = screen.getByRole("heading", { level: 2, name: "Architecture overview" });
    const inputs = screen.getByText(messages.inputs.title);
    const rail = screen.getByRole("navigation", { name: "ON THIS PAGE" });

    for (const el of [heading, card, inputs, rail]) {
      expect(el.closest(".dd-tour-layout")).toBe(layout);
    }
  });

  it("keeps an empty section's card AND its rail entry", () => {
    setup(
      envelope({
        tour: record({
          sections: [
            section("architecture"),
            section("critical_paths", ""),
            section("how_to_run"),
            section("reading_path"),
            section("first_tasks"),
          ],
          flows: [],
        }),
      }),
    );
    render();

    expect(
      screen.getByRole("heading", { level: 2, name: "Critical paths" }),
    ).toBeInTheDocument();
    expect(screen.getByText(messages.empty.critical_paths)).toBeInTheDocument();
    const rail = screen.getByRole("navigation", { name: "ON THIS PAGE" });
    expect(within(rail).getByRole("link", { name: "Critical paths" })).toBeInTheDocument();
  });

  it("marks the section the URL's fragment names", () => {
    window.history.replaceState({}, "", "/repos/repo-1/onboarding#first-tasks");
    setup(envelope());
    render();

    const rail = screen.getByRole("navigation", { name: "ON THIS PAGE" });
    const current = within(rail)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current"));
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("First tasks");
  });
});

describe("OnboardingTourView — states", () => {
  it("shows the empty state, and asks for nothing until the button is pressed", () => {
    setup(envelope({ tour: null }));
    render();

    expect(generateMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("navigation", { name: "ON THIS PAGE" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: messages.generate.cta }));
    expect(generateMutate).toHaveBeenCalledTimes(1);
  });

  it("keeps the tour on screen when generating is refused — only the button is blocked", () => {
    setup(envelope({ generate_blocked: "index_failed" }));
    render();

    expect(screen.getByText(messages.refusal.indexFailed.body)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Architecture overview" }),
    ).toBeInTheDocument();
    // Reading is never blocked (AC-60).
    expect(screen.getByRole("navigation", { name: "ON THIS PAGE" })).toBeInTheDocument();
  });

  it("keeps the tour rendered after a failed regeneration and leaves the action pressable", () => {
    // `useMutation().error` is sticky: deriving "is there a tour" from it
    // empties the page for the rest of the mount (`client/INSIGHTS.md:626-645`).
    setup(envelope(), {
      error: new ApiError("Upstream model timed out", 502, "external_service_error"),
    });
    render();

    expect(
      screen.getByRole("heading", { level: 2, name: "Architecture overview" }),
    ).toBeInTheDocument();
    expect(screen.getByText(messages.generateFailed)).toBeInTheDocument();
    expect(screen.getByText("Upstream model timed out")).toBeInTheDocument();

    const regenerate = screen.getByRole("button", { name: messages.regenerate });
    expect(regenerate).toBeEnabled();
    fireEvent.click(regenerate);
    expect(generateMutate).toHaveBeenCalledTimes(1);
  });

  it("disables the action only while its own mutation is in flight", () => {
    setup(envelope(), { isPending: true });
    render();

    expect(screen.getByRole("button", { name: messages.regenerating })).toBeDisabled();
    expect(screen.getByText(messages.generate.generating)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Architecture overview" }),
    ).toBeInTheDocument();
  });

  it("sends a missing model configuration to Settings", () => {
    setup(envelope(), { error: new ApiError("no model", 500, "config_error") });
    render();

    expect(screen.getByRole("link", { name: messages.notConfiguredLink })).toHaveAttribute(
      "href",
      "/settings/models",
    );
  });

  it("names both index states when the envelope says the tour is stale", () => {
    setup(
      envelope({
        stale: true,
        index: {
          last_indexed_sha: HEAD_SHA,
          files_indexed: 700,
          files_skipped: 0,
          status: "full",
          updated_at: new Date().toISOString(),
        },
      }),
    );
    render();

    const note = screen.getByText(/This tour was built from index/);
    expect(note).toHaveTextContent("2f8b7e1");
    expect(note).toHaveTextContent("9a1c4d7");
  });

  it("shows the not-found screen for a repository that is not in the workspace", () => {
    repoNotFound = true;
    setup(envelope());
    render();

    expect(screen.getByText("repo not found")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("shows the load error with the server's own sentence, and a way to retry", () => {
    pageQuery = {
      data: undefined,
      isError: true,
      error: new ApiError("Cannot reach the DevDigest engine", 0, "network_error"),
      refetch: () => {},
    };
    generateMutation = { mutate: generateMutate, isPending: false, error: null };
    render();

    expect(screen.getByText(messages.loadError.title)).toBeInTheDocument();
    expect(screen.getByText("Cannot reach the DevDigest engine")).toBeInTheDocument();
  });

  it("does not fall into a skeleton that never resolves when nothing was asked for", () => {
    // A disabled TanStack v5 query reports `isLoading === false` with
    // `data === undefined` (`client/INSIGHTS.md:1133-1159`).
    setup(undefined);
    const { container } = render();

    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});

describe("OnboardingTourView — the rail follows the scroll", () => {
  /* jsdom has no `IntersectionObserver`, so these drive a fake one
     (`src/test/intersection-observer.ts`). `report()` IS the scroll: an
     assertion that never calls it passes with the whole scrollspy deleted. */
  let io: FakeIntersectionObserver;

  beforeEach(() => {
    io = installIntersectionObserver();
  });

  afterEach(() => io.restore());

  const marked = () => {
    const rail = screen.getByRole("navigation", { name: "ON THIS PAGE" });
    const current = within(rail)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current"));
    expect(current).toHaveLength(1);
    return current[0]!.textContent;
  };

  it("marks the section the reader scrolled to, and leaves the URL alone", () => {
    setup(envelope());
    render();

    expect(io.observedIds()).toEqual([
      "architecture",
      "critical-paths",
      "how-to-run",
      "reading-path",
      "first-tasks",
    ]);
    expect(marked()).toBe("Architecture overview");

    io.report(["reading-path", "first-tasks"]);
    expect(marked()).toBe("First tasks");

    // Scrolling back up: a section that left the band stops counting, which is
    // the half a callback that only ever ADDS would get wrong.
    io.report(["critical-paths"]);
    expect(marked()).toBe("Critical paths");

    // The highlight is state, not history. Writing the fragment on every
    // section a reader passes fills the back button with places nobody asked
    // to go.
    expect(window.location.hash).toBe("");
  });

  it("keeps the entry the reader clicked marked while its own section is in the band", async () => {
    setup(envelope());
    render();

    const rail = screen.getByRole("navigation", { name: "ON THIS PAGE" });
    fireEvent.click(within(rail).getByRole("link", { name: "Critical paths" }));
    await waitFor(() => expect(window.location.hash).toBe("#critical-paths"));

    // The jump puts the clicked card at the top of the band, and a short
    // section leaves the NEXT one inside it too. Last-one-wins alone would mark
    // "How to run locally" the instant after the reader asked for this one.
    io.report(["critical-paths", "how-to-run"]);
    expect(marked()).toBe("Critical paths");

    // Once it has scrolled out of the band the scroll decides again — the URL
    // is a preference, not a lock.
    io.report(["how-to-run", "reading-path"]);
    expect(marked()).toBe("Guided reading path");
  });
});
