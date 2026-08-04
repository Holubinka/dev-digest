/* ConventionsView — the Conventions screen: run a scan, judge what comes back,
   turn what survived into a skill. The list is the whole screen; there is no
   detail pane, because a candidate is one sentence and its evidence. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import { useConventions, useExtractConventions, useUpdateConvention } from "@/lib/hooks/conventions";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useToast } from "@/lib/toast";
import { ConventionCard } from "../ConventionCard";
import { CreateSkillFromConventionsModal } from "../CreateSkillFromConventionsModal";
import { SKELETON_ROWS } from "./constants";
import { s } from "./styles";

export function ConventionsView({ repoId }: { repoId: string }) {
  const t = useTranslations("conventions");
  const toast = useToast();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, error, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention(repoId);
  const [creating, setCreating] = React.useState(false);

  const repoName = activeRepo?.full_name ?? repoId;
  const candidates = data?.candidates ?? [];
  const accepted = candidates.filter((c) => c.status === "accepted");

  const runScan = () =>
    extract.mutate(undefined, {
      onError: (e) =>
        toast.error(e instanceof ApiError ? e.message : t("page.extractionFailed")),
    });

  const setStatus = (id: string, status: ConventionCandidate["status"]) =>
    update.mutate({ id, patch: { status } });

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      {creating && (
        <CreateSkillFromConventionsModal
          candidates={candidates}
          repoName={repoName}
          onClose={() => setCreating(false)}
        />
      )}

      <div className="dd-page" style={s.page}>
        <div className="dd-page-header" style={s.header}>
          <div>
            <h1 style={s.title}>
              {t("page.headingPrefix")}
              <span className="mono" style={s.repo}>
                {repoName}
              </span>
            </h1>
            <p style={s.subtitle}>
              {data?.scan
                ? t("page.scanSummary", {
                    files: data.scan.sample_files,
                    model: data.scan.model,
                  })
                : t("page.subtitle")}
            </p>
          </div>
          <Button
            kind="secondary"
            icon="RefreshCw"
            onClick={runScan}
            loading={extract.isPending}
            disabled={extract.isPending}
          >
            {extract.isPending ? t("page.scanning") : data?.scan ? t("page.rescan") : t("page.runExtraction")}
          </Button>
        </div>

        {candidates.length > 0 && (
          <div className="dd-toolbar" style={s.toolbar}>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={accepted.length === 0 || update.isPending}
              onClick={() => accepted.forEach((c) => setStatus(c.id, "pending"))}
            >
              {t("page.deselectAll")}
            </Button>
            <span className="dd-toolbar-count" style={s.count}>
              {t("page.acceptedCount", { accepted: accepted.length, total: candidates.length })}
            </span>
            <Button
              kind="primary"
              size="sm"
              icon="Sparkles"
              disabled={accepted.length === 0}
              onClick={() => setCreating(true)}
            >
              {t("page.createSkill")}
            </Button>
          </div>
        )}

        {isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={120} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("page.loadError")}
            body={error instanceof ApiError ? error.message : t("page.loadError")}
            onRetry={() => refetch()}
          />
        ) : candidates.length === 0 ? (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={runScan}
            ctaLoading={extract.isPending}
          />
        ) : (
          candidates.map((c) => (
            <ConventionCard
              key={c.id}
              candidate={c}
              repoFullName={activeRepo?.full_name}
              pending={update.isPending}
              onStatus={(status) => setStatus(c.id, status)}
              onRule={(rule) => update.mutate({ id: c.id, patch: { rule } })}
            />
          ))
        )}
      </div>
    </AppShell>
  );
}
