import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import type { OnboardingSection } from "@/lib/types";
import { ArchitectureSection } from "./ArchitectureSection";
import { CriticalPathsSection } from "../CriticalPathsSection";

const SHA = "1122334455667788990011223344556677889900";
const REPO = "acme/payments-api";

beforeAll(() => {
  // mermaid measures every node before it lays one out, and jsdom has no
  // `getBBox` (`client/INSIGHTS.md`, "mermaid both parses and renders under
  // this jsdom suite"). Every box comes back the same size, so this proves the
  // chart REACHED mermaid and drew — never that the result is legible.
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
    ({ x: 0, y: 0, width: 100, height: 20 }) as DOMRect;
});

afterEach(cleanup);

/**
 * The mermaid output specifically. A bare `querySelector("svg")` finds the
 * lucide glyph in the card header instead, which makes every "no diagram"
 * assertion pass on a section that draws one — `mermaid.render` stamps the id
 * `MermaidDiagram.tsx` passes it, and that is the only svg here that is a
 * diagram.
 */
const mermaidSvg = (container: HTMLElement) =>
  container.querySelector('svg[id^="dd-mermaid"]');

const section = (over: Partial<OnboardingSection> = {}): OnboardingSection => ({
  kind: "architecture",
  title: "The model's own heading",
  body: "Requests enter through src/server.ts and are routed from there.",
  diagram: undefined,
  links: [],
  verified_paths: ["src/server.ts"],
  state: "ready",
  empty_reason: null,
  ...over,
});

const render = (over: Partial<OnboardingSection> = {}) =>
  renderWithProviders(
    <ArchitectureSection section={section(over)} repoFullName={REPO} indexSha={SHA} />,
    { onboarding: messages },
  );

describe("ArchitectureSection", () => {
  it("draws the prose, the diagram and the note that says the boxes are not paths", async () => {
    const { container } = render({ diagram: "graph TD;\n  client --> server;" });

    await waitFor(() => expect(mermaidSvg(container)).not.toBeNull());
    // The caption arrives with the drawn diagram rather than with the string:
    // `MermaidDiagram` reports the outcome, and the render that shows it is the
    // one after the svg lands.
    expect(await screen.findByText(messages.diagramNote)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "src/server.ts" })).toBeInTheDocument();
    // AC-13: no box is a control, so the diagram carries no anchor of its own.
    expect(mermaidSvg(container)?.querySelector("a")).toBeFalsy();
  });

  it("never renders the model's own section heading", () => {
    render();
    // AC-85: the page's heading is the UI's, in the UI's language. The model's
    // is stored as evidence and drawn nowhere.
    expect(screen.queryByText("The model's own heading")).toBeNull();
    expect(
      screen.getByRole("heading", { name: messages.section.architecture }),
    ).toBeInTheDocument();
  });

  it("keeps the prose but drops the caption when the diagram cannot be drawn", async () => {
    // A chart mermaid refuses. `MermaidDiagram` returns null rather than letting
    // mermaid inject its "Syntax error" graphic — and neither the section nor
    // the page goes with it (AC-12). The caption is FOR the diagram, though:
    // "The diagram is how the model described this system" printed with no
    // diagram under it describes nothing on the screen.
    const { container } = render({ diagram: '{"type":"Buffer","data":[1,2]}' });

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "src/server.ts" })).toBeInTheDocument(),
    );
    expect(screen.queryByText(messages.diagramNote)).toBeNull();
    expect(mermaidSvg(container)).toBeNull();
  });

  it("falls through to its empty state when neither prose nor a drawn diagram is left", async () => {
    // The prompt forbids fencing the diagram and nothing strips the fences, so
    // this is a shape the model reaches on its own — and `MAX_DIAGRAM_CHARS`
    // cutting one mid-line is another. With `chart !== ""` guarding the empty
    // state, a section with an empty body and an undrawable diagram rendered
    // the orphan caption and NOTHING else.
    const { container } = render({
      body: "",
      diagram: "```mermaid\ngraph TD;\n  client --> server;\n```",
    });

    expect(await screen.findByText(messages.empty.architecture)).toBeInTheDocument();
    expect(screen.queryByText(messages.diagramNote)).toBeNull();
    expect(mermaidSvg(container)).toBeNull();
  });

  it("draws no note and no frame for an absent, empty or whitespace diagram", () => {
    for (const diagram of [undefined, "", "   \n "]) {
      cleanup();
      const { container } = render({ diagram });
      expect(screen.queryByText(messages.diagramNote)).toBeNull();
      expect(mermaidSvg(container)).toBeNull();
    }
  });

  it("says so when the section came back with nothing, and keeps its card", () => {
    render({ body: "", diagram: undefined, state: "empty", empty_reason: "model_returned_nothing" });

    expect(screen.getByText(messages.empty.architecture)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: messages.section.architecture }),
    ).toBeInTheDocument();
  });

  it("is the only kind that carries a diagram at all", () => {
    // The other four take no `section` and so cannot be handed one: the
    // contract puts `diagram` on every `OnboardingSection`, and this is what
    // keeps a diagram on one card rather than five.
    const { container } = renderWithProviders(
      <CriticalPathsSection
        flows={[{ title: "Request", steps: [{ path: "src/server.ts", note: "bootstrap" }] }]}
        repoFullName={REPO}
        indexSha={SHA}
      />,
      { onboarding: messages },
    );

    expect(mermaidSvg(container)).toBeNull();
    expect(screen.queryByText(messages.diagramNote)).toBeNull();
  });
});
