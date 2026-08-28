/* CiRunsPage — the agent reviews that ran inside a repository's CI, ingested
   from the artifact each workflow run uploaded (SPEC-05 § CI Runs page).

   NOTHING HERE POLLS ON A TIMER (AC-122). Opening the page is one trigger and
   the Refresh button is the other; `useCiRuns` fires the unforced poll from its
   `queryFn`, so the once-per-open behaviour comes from the query cache rather
   than from an effect with a mount guard. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { errorMessage } from "@/lib/api";
import { useCiRuns, useRefreshCiRuns } from "@/lib/hooks/ci";
import { relativeTime } from "@/lib/relative-time";
import { RunRow } from "./_components/RunRow";
import { COLUMN_KEYS, RIGHT_ALIGNED, SKELETON_ROWS } from "./constants";
import { s } from "./styles";

export function CiRunsPage() {
  const t = useTranslations("ci");
  const page = useCiRuns();
  const refresh = useRefreshCiRuns();

  // One source for the rows: the forced refresh writes its answer into this
  // query's cache (`useRefreshCiRuns`), so there is no second list to choose
  // between and no way for the two to disagree.
  const runs = page.data?.runs ?? [];
  const pollErrors = page.data?.errors ?? [];
  const lastPolled = page.data?.last_polled_at ?? null;

  // AC-83: a failure never empties the table. It is a banner ABOVE whatever was
  // fetched last, and the rows below it stay exactly where they were.
  const failure = refresh.isError
    ? errorMessage(refresh.error)
    : page.isError && runs.length > 0
      ? errorMessage(page.error)
      : null;

  const ago = relativeTime(lastPolled);
  const polledLabel = !lastPolled
    ? t("runs.neverPolled")
    : ago === "now"
      ? t("runs.lastPolledNow")
      : t("runs.lastPolled", { time: ago });

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <div className="dd-page" style={s.page}>
        <div className="dd-page-header" style={s.header}>
          <div>
            <h1 style={s.title}>{t("runs.title")}</h1>
            <p style={s.subtitle}>{t("runs.subtitle")}</p>
          </div>
          <div style={s.actions}>
            {/* AC-84: the time of the last SUCCESSFUL poll, which the server
                tracks per repository — a failed attempt does not move it. */}
            <span style={s.polled}>{polledLabel}</span>
            <Button
              kind="secondary"
              icon="RefreshCw"
              loading={refresh.isPending}
              disabled={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              {refresh.isPending ? t("runs.refreshing") : t("runs.refresh")}
            </Button>
          </div>
        </div>

        {(pollErrors.length > 0 || failure) && (
          <div role="alert" style={s.banner}>
            <Icon.AlertTriangle size={15} style={s.bannerIcon} />
            <div>
              <div style={s.bannerTitle}>{t("runs.pollErrorsTitle")}</div>
              {pollErrors.map((e) => (
                <div key={e.repo} style={s.bannerLine}>
                  {t("runs.pollError", { repo: e.repo, reason: e.reason })}
                </div>
              ))}
              {failure && <div style={s.bannerLine}>{failure}</div>}
            </div>
          </div>
        )}

        <div style={s.tableCard}>
          <div style={s.headRow}>
            {COLUMN_KEYS.map((key) => (
              <div key={key} style={s.headCell(RIGHT_ALIGNED.has(key))}>
                {t(`runs.table.${key}`)}
              </div>
            ))}
          </div>

          {page.isLoading ? (
            <div style={s.loadingStack}>
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <Skeleton key={i} height={28} />
              ))}
            </div>
          ) : runs.length === 0 && page.isError ? (
            <ErrorState
              title={t("runs.loadError")}
              body={errorMessage(page.error)}
              onRetry={() => void page.refetch()}
            />
          ) : runs.length === 0 ? (
            /* AC-82: an empty state, and not one invented row. */
            <EmptyState icon="Workflow" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
          ) : (
            runs.map((run) => <RunRow key={run.id} run={run} />)
          )}
        </div>
      </div>
    </AppShell>
  );
}
