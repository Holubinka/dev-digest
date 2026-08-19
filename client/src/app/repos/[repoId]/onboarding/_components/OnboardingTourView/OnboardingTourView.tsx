/* OnboardingTourView — the Onboarding Tour screen: what the tour was built
   from, the five sections in the order `SECTION_ORDER` fixes, the rail that
   navigates them, and every state that is not a tour.

   THE ONLY COMPONENT ON THIS PAGE THAT OWNS DATA. It calls the two hooks and
   the repo context; everything below it takes props. That is what lets each
   section be asserted on a hand-written fixture and what keeps the number of
   places that know about the wire at one.

   THE ACTIVE SECTION IS WHAT THE SCROLL SAYS, AND THE URL BREAKS THE TIE.
   `useScrollSpy` reports the section covering the top of the reading area and
   the rail follows it; the fragment the reader clicked wins for as long as its
   own section is still there, so a click cannot be overruled a frame later by
   the card below it. Nothing here writes the fragment back: a `pushState` per
   section passed fills the back button with places nobody asked to go, and a
   `replaceState` per section still rewrites the entry the reader arrived on.

   Plan 14 put a scrollspy in § Out of scope (Recommendation 1, not taken) and
   this is a deliberate reversal, asked for on 2026-08-18 after the built page
   was read: with five long cards, a rail that only moves on a click marks
   "Architecture overview" at every scroll position but one.

   The fragment is read in an effect and never during render — `window` does
   not exist on Next's server pass, and the two renders would disagree.

   THE BRANCH ORDER IS LOAD-BEARING AND NONE OF THEM MASKS ANOTHER. A disabled
   TanStack v5 query reports `isLoading === false` with `data === undefined`, so
   "we have not asked yet" must land in a real branch rather than in a skeleton
   that never resolves (`client/INSIGHTS.md:1133-1159`). And a failed refetch of
   a query that already holds data must not replace the tour with an error —
   the error page is for the case where there is nothing to show. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import { useGenerateOnboardingTour, useOnboardingTour } from "@/lib/hooks/onboarding";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import type { OnboardingRecord, OnboardingSectionKind } from "@/lib/types";
import { SECTION_ANCHORS, SECTION_ORDER } from "./_components/sections";
import { ArchitectureSection } from "./_components/ArchitectureSection";
import { CriticalPathsSection } from "./_components/CriticalPathsSection";
import { RunLocallySection } from "./_components/RunLocallySection";
import { ReadingPathSection } from "./_components/ReadingPathSection";
import { FirstTasksSection } from "./_components/FirstTasksSection";
import { TourHeader } from "./_components/TourHeader";
import { OnThisPageRail } from "./_components/OnThisPageRail";
import { TourStates } from "./_components/TourStates";
import { IndexNotes, InputStates } from "./_components/InputStates";
import { useScrollSpy } from "./hooks/useScrollSpy";
import { SKELETON_ROWS } from "./constants";
import { activeSectionFrom, anchorFromHash, sectionFor } from "./helpers";
import { s } from "./styles";

export function OnboardingTourView({ repoId }: { repoId: string }) {
  const t = useTranslations("onboarding");
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isError, error, refetch } = useOnboardingTour(repoId);
  const generate = useGenerateOnboardingTour(repoId);

  const [hash, setHash] = React.useState<string | null>(null);
  React.useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const tour = data?.tour ?? null;
  const sectionsMounted = tour !== null;

  /* The fragment is what the reader ASKED for and the spy is where they now
     are; `null` from either means it has nothing to say, and the first section
     is the answer only when both are silent. */
  const askedFor = anchorFromHash(hash);
  const scrolledTo = useScrollSpy(SECTION_ANCHORS, askedFor, sectionsMounted);
  const activeAnchor = scrolledTo ?? activeSectionFrom(hash);

  /* The jump to a section named by the URL, keyed on the target AND on whether
     the sections are on screen. Keyed on the target alone it runs against the
     tree that is about to be replaced and scrolls nowhere
     (`client/INSIGHTS.md:545-566`). The ref makes it idempotent per target, so
     a later re-render cannot drag a reader who has scrolled away back up.

     KEYED ON WHAT THE URL SAYS, NEVER ON `activeAnchor`. The active section
     now moves with the scroll, and an effect that scrolls to it would chase
     its own tail: every section the reader passed would become a target and
     scroll itself to the top, one card at a time, for as long as the page had
     anywhere left to go. */
  const jumped = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (!sectionsMounted) return;
    if (!askedFor) return;
    if (jumped.current.has(askedFor)) return;
    jumped.current.add(askedFor);
    document.getElementById(askedFor)?.scrollIntoView?.({ block: "start" });
  }, [askedFor, sectionsMounted]);

  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [{ label: repoName, mono: true }, { label: t("title") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (isError && data === undefined) {
    return (
      <AppShell crumb={crumb}>
        <div className="dd-page" style={s.page}>
          <ErrorState
            title={t("loadError.title")}
            body={error instanceof ApiError ? error.message : t("unknownError")}
            onRetry={() => refetch()}
          />
        </div>
      </AppShell>
    );
  }

  if (data === undefined) {
    return (
      <AppShell crumb={crumb}>
        <div className="dd-page" style={s.page}>
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={120} />
            ))}
          </div>
        </div>
      </AppShell>
    );
  }

  const states = (
    <TourStates
      blocked={data.generate_blocked}
      hasTour={tour !== null}
      isPending={generate.isPending}
      error={generate.error}
      onGenerate={() => generate.mutate()}
    />
  );

  if (tour === null) {
    return (
      <AppShell crumb={crumb}>
        <div className="dd-page" style={s.page}>
          <h1 style={s.bareTitle}>
            {t("headingPrefix")}
            <span className="mono" style={s.bareTitleRepo}>
              {repoName.split("/").pop() ?? repoName}
            </span>
          </h1>
          {states}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div className="dd-page" style={s.page}>
        {/* EVERYTHING BUT THE RAIL IS ONE COLUMN, and the header is in it: the
            mockup starts the heading, the provenance line and the two buttons
            on the same vertical as the cards, with the rail alone in its own
            narrower column to their left. A header outside this grid starts at
            the rail's edge instead, which reads as content pushed 228px right
            of where the design puts it.

            DOM ORDER IS THE STACKING ORDER at 900px, where the grid collapses
            to one column and every child is auto-placed. Heading, notes, rail,
            cards — the title before its table of contents, and the same order
            a screen reader is given on any width. */}
        <div className="dd-tour-layout">
          <TourHeader
            repoFullName={repoName}
            filesIndexed={tour.index_state.files_indexed}
            generatedAt={tour.generated_at}
            activeAnchor={activeAnchor}
            onRegenerate={() => generate.mutate()}
            regenerating={generate.isPending}
          />

          {/* `display`, `gap` and the margin live on `.dd-tour-notes` so its
              `:empty` rule can hide it: an empty flex box still contributes its
              own margin, and an inline `display` would beat the stylesheet. */}
          <div className="dd-tour-notes">
            <IndexNotes
              stale={data.stale}
              tourIndexState={tour.index_state}
              currentIndexSha={data.index.last_indexed_sha}
            />
            {states}
          </div>

          <OnThisPageRail activeAnchor={activeAnchor} />

          <div style={s.sections}>
            {SECTION_ORDER.map((section) => (
              <SectionSlot
                key={section.kind}
                kind={section.kind}
                tour={tour}
                repoFullName={activeRepo?.full_name}
                indexSha={tour.index_state.last_indexed_sha}
              />
            ))}
          </div>

          <InputStates inputs={tour.inputs} />
        </div>
      </div>
    </AppShell>
  );
}

/**
 * One section, chosen by kind — so the five are drawn in `SECTION_ORDER`'s
 * order and that order is written down exactly once, in the same array the rail
 * maps.
 *
 * A `switch` over the contract union, with no default: a sixth kind is a
 * compile error here rather than a card that silently stops being drawn.
 */
function SectionSlot({
  kind,
  tour,
  repoFullName,
  indexSha,
}: {
  kind: OnboardingSectionKind;
  tour: OnboardingRecord;
  repoFullName: string | null | undefined;
  indexSha: string | null | undefined;
}) {
  switch (kind) {
    case "architecture":
      return (
        <ArchitectureSection
          section={sectionFor(tour.sections, "architecture")}
          repoFullName={repoFullName}
          indexSha={indexSha}
        />
      );
    case "critical_paths":
      return (
        <CriticalPathsSection
          flows={tour.flows}
          repoFullName={repoFullName}
          indexSha={indexSha}
        />
      );
    case "how_to_run":
      return (
        <RunLocallySection
          packages={tour.packages}
          setupCommands={tour.setup_commands}
          envVars={tour.env_vars}
          envVarsTruncated={tour.env_vars_truncated}
          packageScan={tour.package_scan}
        />
      );
    case "reading_path":
      return (
        <ReadingPathSection
          steps={tour.reading_path}
          repoFullName={repoFullName}
          indexSha={indexSha}
        />
      );
    case "first_tasks":
      return (
        <FirstTasksSection tasks={tour.tasks} repoFullName={repoFullName} indexSha={indexSha} />
      );
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
