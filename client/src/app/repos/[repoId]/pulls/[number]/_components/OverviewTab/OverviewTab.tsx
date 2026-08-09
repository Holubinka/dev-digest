"use client";

import React from "react";
import { Markdown, SectionLabel } from "@devdigest/ui";
import { usePrIntent, useRecomputeIntent } from "@/lib/hooks/core";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { IntentCard } from "../IntentCard";
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
      <div style={s.cardRow}>
        <IntentCard
          intent={intent}
          isLoading={isLoading}
          isError={isError}
          onRecompute={() => recompute.mutate()}
          recomputing={recompute.isPending}
        />
        <BlastRadiusCard prId={prId} />
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
