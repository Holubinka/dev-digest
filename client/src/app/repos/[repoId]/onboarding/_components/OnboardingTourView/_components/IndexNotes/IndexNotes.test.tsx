/**
 * What the index could not say about itself — the notes above the tour.
 */
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import type { OnboardingIndexState } from "@/lib/types";
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
