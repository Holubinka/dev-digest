"use client";

import React from "react";
import { Markdown, SectionLabel } from "@devdigest/ui";
import { usePrIntent, useRecomputeIntent } from "@/lib/hooks/core";
import { IntentCard } from "../IntentCard";
import { PrBriefCard } from "../PrBriefCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
}

export function OverviewTab({ prBody, prId }: OverviewTabProps) {
  // The tab owns the data so `IntentCard` stays presentational.
  const { data: intent, isLoading, isError } = usePrIntent(prId);
  const recompute = useRecomputeIntent(prId);

  return (
    <>
      <PrBriefCard prId={prId} />

      <div style={s.cardRow}>
        <IntentCard
          intent={intent}
          isLoading={isLoading}
          isError={isError}
          onRecompute={() => recompute.mutate()}
          recomputing={recompute.isPending}
        />
        {/* BLAST RADIUS slot — reserved so the row is cut once, and rendering
            nothing until that card exists. No border, no placeholder copy. */}
        <div aria-hidden />
      </div>

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>
            <Markdown>{prBody}</Markdown>
          </div>
        </section>
      )}
    </>
  );
}
