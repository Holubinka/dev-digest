/* TourHeader — who the tour is for, what it was built from, and the two things
   a reader can do with it.

   THE HEADING USES THE SHORT NAME (`payments-api`) and the breadcrumb carries
   the full slug, exactly as the mockup draws them. The name is ACCENT MONO
   inside the sans heading, which is why the message is a prefix and not
   `Onboarding for {repo}`: next-intl 3.26 takes no `ReactNode` for a plain
   placeholder, so a single ICU string can only produce one flat run of text.
   `ConventionsView` splits `Conventions in ` the same way.

   EVERY NUMBER HERE ARRIVES FROM THE RESPONSE. `files_indexed` is printed as it
   came and captioned "index of N files" — never "N files in the repository":
   the indexer stops at its own ceiling, and an honest number under a dishonest
   caption is worse than either (AC-75, AC-81). Nothing on this page is counted
   client-side (AC-78).

   `relativeTime` reads `Date.now()`, so it is not pure for a given input. It is
   safe here and only here: this component renders inside the branch that has a
   resolved `tour`, the query has no server-side prefetch and no `initialData`,
   so Next's server pass never reaches it and there is no second render to
   disagree with (next-best-practices § Hydration Errors). Do not lift this call
   into a component that renders before the data arrives.

   The relative string is "now" for anything under a minute, which is exactly
   when a reader has just pressed Regenerate — so "last refreshed now ago" would
   be the FIRST thing they read. `provenanceJustNow` exists for that minute. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { relativeTime } from "@/lib/relative-time";
import { ShareLinkButton } from "./ShareLinkButton";
import { s } from "./styles";

export function TourHeader({
  repoFullName,
  filesIndexed,
  generatedAt,
  activeAnchor,
  onRegenerate,
  regenerating,
}: {
  /** `owner/repo`; the heading shows the half after the slash. */
  repoFullName: string;
  /** `tour.index_state.files_indexed`, as it arrived. */
  filesIndexed: number;
  /** `tour.generated_at` — an ISO timestamp, never a preformatted "2h ago". */
  generatedAt: string;
  /** The section `Share link` names when the URL carries no fragment. */
  activeAnchor: string;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const t = useTranslations("onboarding");
  const shortName = repoFullName.split("/").pop() ?? repoFullName;
  const ago = relativeTime(generatedAt);

  return (
    <div className="dd-page-header" style={s.header}>
      <div>
        <h1 style={s.title}>
          {t("headingPrefix")}
          <span className="mono" style={s.repo}>
            {shortName}
          </span>
        </h1>
        <p style={s.provenance}>
          {ago === "now"
            ? t("provenanceJustNow", { count: filesIndexed })
            : t("provenance", { count: filesIndexed, ago })}
        </p>
      </div>
      <div style={s.actions}>
        {/* Disabled by its own in-flight mutation and by NOTHING else. A retry
            disabled by the state it recovers from is absent exactly when it is
            needed (`client/INSIGHTS.md:460-475`) — including when the read says
            generating is blocked, where the press is what produces the 409 the
            state maps to its own text. */}
        <Button
          kind="secondary"
          icon="RefreshCw"
          onClick={onRegenerate}
          loading={regenerating}
          disabled={regenerating}
        >
          {regenerating ? t("regenerating") : t("regenerate")}
        </Button>
        <ShareLinkButton activeAnchor={activeAnchor} />
      </div>
    </div>
  );
}
