/* MultiAgentLandingView — what /repos/:repoId/multi-agent shows.

   A repo has at most one "latest" comparison, and the address bar should end on
   the PERMANENT link to it rather than on a route whose meaning changes with the
   next run. So a hit is a `router.replace` to that multi-run's own URL (no
   history entry: nobody asked to visit this page), and a miss is the AC-94 empty
   state that leads to Configure run.

   THE BRANCH ORDER IS LOAD-BEARING. `isError` is checked before `isLoading`
   because a failed query reports neither loading nor data, and a repo with no
   multi-runs answers `200` with `null` — an absence, not an error — which is
   why `data === null` is a real branch and not the fallthrough of a skeleton
   that never resolves (`client/INSIGHTS.md:1133-1159`). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import { useLatestMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useRepoNotFound } from "@/lib/repo-context";
import { s } from "./styles";

export function MultiAgentLandingView({ repoId }: { repoId: string }) {
  const t = useTranslations("runs");
  const router = useRouter();
  const repoNotFound = useRepoNotFound(repoId);
  const { data, isLoading, isError, error, refetch } = useLatestMultiAgentRun(repoId);

  const latestId = data?.id ?? null;
  const configureHref = `/repos/${repoId}/multi-agent/configure`;

  // Navigation is the one external system a render may not touch, so the jump
  // lives in an effect and is keyed on the id it jumps to.
  React.useEffect(() => {
    if (!latestId) return;
    router.replace(`/repos/${repoId}/multi-agent/${encodeURIComponent(latestId)}`);
  }, [latestId, repoId, router]);

  const crumb = [{ label: t("page.crumb") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("page.loadFailed.title")}
          body={error instanceof ApiError ? error.message : undefined}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  // The redirect is queued but the new route has not painted yet: keep the
  // skeleton rather than flashing the empty state at a repo that has runs.
  if (isLoading || latestId) {
    return (
      <AppShell crumb={crumb}>
        <div className="dd-page" style={s.loading}>
          <Skeleton height={28} width={320} />
          <Skeleton height={180} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <EmptyState
        icon="Users"
        title={t("page.empty.title")}
        body={t("page.empty.body")}
        cta={t("page.empty.cta")}
        onCta={() => router.push(configureHref)}
      />
    </AppShell>
  );
}
