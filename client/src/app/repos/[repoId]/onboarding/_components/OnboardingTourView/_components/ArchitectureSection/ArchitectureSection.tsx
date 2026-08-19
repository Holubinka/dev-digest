/* ArchitectureSection — the model's prose about the system, and the diagram it
   drew of it.

   THE DIAGRAM IS ONLY EVER THIS SECTION'S. `diagram` is `.optional()` on the
   contract and only `architecture` carries one; no other section component
   imports `MermaidDiagram`, which is what keeps that true.

   A diagram that does not parse takes nothing with it (AC-12): `MermaidDiagram`
   returns `null` on junk rather than letting mermaid inject its "Syntax error"
   graphic, and the prose beside it is rendered independently of it. An empty or
   whitespace-only string is not handed over at all — an empty frame is worse
   than no frame.

   THE CAPTION AND THE FRAME FOLLOW THE DIAGRAM, NOT THE STRING. A non-empty
   `diagram` is not a diagram: the prompt forbids fencing it and nothing strips
   the fences, `MAX_DIAGRAM_CHARS` cuts one mid-line, and either way mermaid
   refuses it. Gated on `chart !== ""` the card printed "The diagram is how the
   model described this system…" with nothing above it — and, on a section whose
   body was also empty, that orphan line was the ONLY thing it printed, because
   the same non-empty string was holding the empty state off. So the outcome is
   asked of the component that knows it, and a section left with neither prose
   nor a drawn diagram falls through to its empty state.

   No box is a control. Nothing wraps the diagram in a link and nothing binds an
   `onClick`: the nodes are labels the model wrote, not paths anyone verified
   (AC-13).

   This used to add that mermaid's own `click` directives are inert under
   `securityLevel: "strict"`. They are not, and the correction matters more than
   the claim did. Measured against mermaid 11.15.0: strict strips `javascript:`
   and `call`, but `click A "https://host/x"` still renders `<a href>` around the
   node with no `rel` and no `target`, and `A@{ img: … }` renders `<image href>`
   that mermaid fetches on paint. Five such escapes were measured, and naming them
   one by one is what failed: three of the five defeated a denylist built from the
   first two. What keeps this surface safe is the SERVER, and it is an ALLOWLIST —
   `groundSections` accepts a `flowchart`/`graph` header and statements that draw a
   node or an edge, and drops everything else whole. Nothing the renderer does is
   load-bearing here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import type { OnboardingSection } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { TourProse } from "../TourProse";
import { s } from "./styles";

export function ArchitectureSection({
  section,
  repoFullName,
  indexSha,
}: {
  section: OnboardingSection;
  repoFullName: string | null | undefined;
  indexSha: string | null | undefined;
}) {
  const t = useTranslations("onboarding");
  const chart = (section.diagram ?? "").trim();
  const hasBody = section.body.trim() !== "";

  // The outcome carries the chart it belongs to, so a section handed a new
  // diagram is back to "waiting" rather than showing the old one's verdict.
  const [outcome, setOutcome] = React.useState<{ chart: string; drawn: boolean } | null>(null);
  const diagram =
    chart === ""
      ? "none"
      : outcome?.chart !== chart
        ? "waiting"
        : outcome.drawn
          ? "drawn"
          : "refused";

  return (
    <SectionCard kind="architecture">
      {!hasBody && (diagram === "none" || diagram === "refused") && (
        <p style={s.empty}>{t("empty.architecture")}</p>
      )}
      <TourProse
        body={section.body}
        verifiedPaths={section.verified_paths}
        repoFullName={repoFullName}
        indexSha={indexSha}
      />
      {chart !== "" && (
        <div style={diagram === "drawn" ? s.diagram : undefined}>
          <MermaidDiagram
            chart={chart}
            onRendered={(drawn) => setOutcome({ chart, drawn })}
          />
          {diagram === "drawn" && <p style={s.note}>{t("diagramNote")}</p>}
        </div>
      )}
    </SectionCard>
  );
}
