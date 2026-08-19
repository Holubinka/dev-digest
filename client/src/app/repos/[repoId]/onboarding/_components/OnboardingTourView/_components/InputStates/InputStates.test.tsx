/**
 * What went into the tour, and what the index could not say about itself.
 */
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import type { OnboardingIndexState, OnboardingInput } from "@/lib/types";
import { InputStates } from "./InputStates";
import { IndexNotes } from "./IndexNotes";

afterEach(cleanup);

const TOUR_SHA = "2f8b7e19c6f559e335efb170098af90d8a688a25";
const HEAD_SHA = "9a1c4d70bb2e5f3a6c8d90e1f2a3b4c5d6e7f809";

const indexState = (over: Partial<OnboardingIndexState> = {}): OnboardingIndexState => ({
  last_indexed_sha: TOUR_SHA,
  files_indexed: 656,
  files_skipped: 0,
  status: "full",
  ...over,
});

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

describe("IndexNotes", () => {
  it("names BOTH index states when the envelope says the tour is stale", () => {
    renderWithProviders(
      <IndexNotes stale tourIndexState={indexState()} currentIndexSha={HEAD_SHA} />,
      { onboarding: messages },
    );

    const note = screen.getByText(/This tour was built from index/);
    expect(note).toHaveTextContent("2f8b7e1");
    expect(note).toHaveTextContent("9a1c4d7");
    // Information, not a button: nothing regenerates on its own (§ D22).
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says nothing about staleness when the envelope says it is not stale", () => {
    renderWithProviders(
      <IndexNotes
        stale={false}
        tourIndexState={indexState()}
        currentIndexSha={HEAD_SHA}
      />,
      { onboarding: messages },
    );

    expect(screen.queryByText(/This tour was built from index/)).toBeNull();
  });

  it("counts the skipped files of a partial index, in both plural branches", () => {
    renderWithProviders(
      <IndexNotes
        stale={false}
        tourIndexState={indexState({ status: "partial", files_skipped: 1 })}
        currentIndexSha={TOUR_SHA}
      />,
      { onboarding: messages },
    );
    expect(screen.getByText(/This index is incomplete: 1 file was skipped/)).toBeInTheDocument();
    cleanup();

    renderWithProviders(
      <IndexNotes
        stale={false}
        tourIndexState={indexState({ status: "partial", files_skipped: 12 })}
        currentIndexSha={TOUR_SHA}
      />,
      { onboarding: messages },
    );
    expect(
      screen.getByText(/This index is incomplete: 12 files were skipped/),
    ).toBeInTheDocument();
  });

  it("says nothing about incompleteness for a full index", () => {
    renderWithProviders(
      <IndexNotes stale={false} tourIndexState={indexState()} currentIndexSha={TOUR_SHA} />,
      { onboarding: messages },
    );

    expect(screen.queryByText(/This index is incomplete/)).toBeNull();
  });
});
