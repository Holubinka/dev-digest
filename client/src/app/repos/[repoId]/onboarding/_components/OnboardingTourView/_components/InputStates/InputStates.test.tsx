/**
 * What went into the tour.
 */
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import type { OnboardingInput } from "@/lib/types";
import { InputStates } from "./InputStates";

afterEach(cleanup);



describe("InputStates", () => {
  it("names every input and what happened to it, including the ceiling that cut one", () => {
    const inputs: OnboardingInput[] = [
      { id: "repo_map", status: "included", tokens: 1514, detail: null, omitted: [], shortened: [] },
      {
        id: "file_samples",
        status: "truncated",
        tokens: 17964,
        detail: "19 of 42 files",
        // The record names the 23 that did not ship; this component draws
        // `detail` and nothing else, which is the decision D18 made.
        omitted: ["src/legacy/util.ts"],
        shortened: [],
      },
      { id: "project_docs", status: "dropped", tokens: 3216, detail: null, omitted: [], shortened: [] },
    ];
    renderWithProviders(<InputStates inputs={inputs} />, { onboarding: messages });

    expect(screen.getByText(messages.inputs.title)).toBeInTheDocument();
    expect(screen.getByText(messages.inputs.id.repo_map)).toBeInTheDocument();
    expect(screen.getByText(messages.inputs.status.included)).toBeInTheDocument();
    expect(screen.getByText(messages.inputs.status.truncated)).toBeInTheDocument();
    expect(screen.getByText("19 of 42 files")).toBeInTheDocument();
    expect(screen.getByText(messages.inputs.status.dropped)).toBeInTheDocument();
  });

  it("shows an id it has no label for as the server's own word, not a message path", () => {
    renderWithProviders(
      <InputStates
        inputs={[
          {
            id: "constructor" as OnboardingInput["id"],
            status: "included",
            tokens: 0,
            detail: null,
            omitted: [],
            shortened: [],
          },
        ]}
      />,
      { onboarding: messages },
    );

    expect(screen.getByText("constructor")).toBeInTheDocument();
    expect(screen.queryByText(/inputs\.id\./)).toBeNull();
  });

  it("draws nothing at all when the record carries no inputs", () => {
    const { container } = renderWithProviders(<InputStates inputs={[]} />, {
      onboarding: messages,
    });

    expect(screen.queryByText(messages.inputs.title)).toBeNull();
    // The one element left is the ToastProvider's host, not an empty card.
    expect(container.querySelector("section")).toBeNull();
  });
});

