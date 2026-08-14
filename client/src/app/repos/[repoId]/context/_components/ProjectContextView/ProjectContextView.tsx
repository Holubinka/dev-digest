/* ProjectContextView — the Project Context screen: every .md the scan found in
   this repository's clone, grouped by the root it was found under, and the one
   you selected, read or edited.

   Documents can be WRITTEN from here — created, uploaded, saved — and every one
   of those controls is in the action bar above the list, which is also the only
   Rescan on the page. What is still absent, and is absent by decision, is rename
   and delete: the clone is the source of truth for a tracked file, and DevDigest
   removing one is a change nobody asked git for. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";

import { useContextDoc, useContextDocs } from "@/lib/hooks/context";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { DocActionBar } from "./_components/DocActionBar";
import { DocList } from "./_components/DocList";
import { DocPanel } from "./_components/DocPanel";
import { formatWhen, groupByRoot } from "./helpers";
import { s } from "./styles";

export function ProjectContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("context");
  const router = useRouter();
  const search = useSearchParams();
  const repoNotFound = useRepoNotFound(repoId);
  const { activeRepo } = useActiveRepo();

  const page = useContextDocs(repoId);

  // The selection is in the URL, not in state: it is shareable, and a link to a
  // document should open on that document.
  const selectedPath = search.get("doc");
  const doc = useContextDoc(repoId, selectedPath);

  const select = (path: string) =>
    router.replace(`/repos/${repoId}/context?doc=${encodeURIComponent(path)}`);

  // The same two-segment crumb the Pull Requests screen uses: the repository in
  // mono, then the page. `?? repoId` keeps it readable for a stale :repoId, which
  // this screen can reach — it renders RepoNotFound below.
  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [{ label: repoName, mono: true }, { label: t("title") }];
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div className="dd-page dd-context-page" style={s.page}>
        <Body
          repoId={repoId}
          page={page}
          doc={doc}
          selectedPath={selectedPath}
          defaultBranch={activeRepo?.default_branch ?? null}
          onSelect={select}
          onRetry={() => void page.refetch()}
        />
      </div>
    </AppShell>
  );
}

/**
 * The four scan states, branched in ONE place and in order, so none can mask
 * another. Written against the fact that a DISABLED TanStack v5 query reports
 * `isLoading === false` — which is why "no repo / not enabled" is decided by the
 * data being absent rather than by a loading flag.
 */
function Body({
  repoId,
  page,
  doc,
  selectedPath,
  defaultBranch,
  onSelect,
  onRetry,
}: {
  repoId: string;
  page: ReturnType<typeof useContextDocs>;
  doc: ReturnType<typeof useContextDoc>;
  selectedPath: string | null;
  defaultBranch: string | null;
  onSelect: (path: string) => void;
  onRetry: () => void;
}) {
  const t = useTranslations("context");

  if (page.isError) return <ErrorState body={t("loadError")} onRetry={onRetry} />;
  if (!page.data) return <Skeleton height={240} />;

  const data = page.data;
  const roots = data.roots.join(", ");

  // Rendered in every state, disabled in the one where there is nothing to write
  // to: "you cannot do this yet, and here is why" is the answer R25 asks for,
  // and a control that vanishes says nothing at all.
  const actions = <DocActionBar repoId={repoId} disabled={data.state === "no_clone"} />;

  if (data.state === "no_clone") {
    return (
      <>
        {actions}
        <EmptyState
          icon="GitBranch"
          title={t("state.noCloneTitle")}
          body={t("state.noCloneBody")}
          cta={t("state.retry")}
          onCta={onRetry}
        />
      </>
    );
  }

  if (data.state === "scanning" && data.documents.length === 0) {
    return (
      <>
        {actions}
        <EmptyState
          icon="Search"
          title={t("state.scanningTitle")}
          body={t("state.scanningBody", { roots })}
        />
      </>
    );
  }

  if (data.state === "scanned" && data.documents.length === 0) {
    return (
      <>
        {actions}
        <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body", { roots })} />
        <Footer data={data} />
      </>
    );
  }

  return (
    <>
      {/* `failed` never replaces the list: the previous result is still the
          truth, and the failed attempt is shown beside it in the footer. */}
      {data.state === "failed" && (
        <ErrorState body={`${t("state.failedTitle")} — ${t("state.failedBody")}`} onRetry={onRetry} />
      )}
      <div className="dd-context-panes" style={s.panes}>
        <div className="dd-context-list" style={s.listPane}>
          <div style={s.listHead}>
            <SectionLabel>{t("title")}</SectionLabel>
            <span className="mono" style={s.listRoots}>
              {roots}
            </span>
          </div>
          <div style={s.listToolbar}>{actions}</div>
          <div style={s.listScroll}>
            <DocList
              groups={groupByRoot(data.documents, data.roots)}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          </div>
          <Footer data={data} />
        </div>
        <div style={s.readerPane}>
          {selectedPath === null ? (
            <span style={s.readerPlaceholder}>{t("reader.placeholder")}</span>
          ) : (
            /* `key` is the reset: selecting another document has to leave Edit
               mode and drop the draft, and a draft for one file must never be
               saved onto another. */
            <DocPanel
              key={selectedPath}
              repoId={repoId}
              path={selectedPath}
              entry={data.documents.find((document) => document.path === selectedPath)}
              doc={doc}
              defaultBranch={defaultBranch}
            />
          )}
        </div>
      </div>
    </>
  );
}

/** Scan output only: how many documents, and when they were counted. */
function Footer({ data }: { data: NonNullable<ReturnType<typeof useContextDocs>["data"]> }) {
  const t = useTranslations("context");
  const scannedAt = formatWhen(data.scanned_at);
  const failedAt = formatWhen(data.last_error_at);
  return (
    <div style={s.footer}>
      <span>{t("footer.files", { count: data.file_count })}</span>
      <span>{scannedAt ? t("footer.scannedAt", { when: scannedAt }) : t("footer.neverScanned")}</span>
      {data.bounded && <span>{t("footer.bounded", { count: data.file_count })}</span>}
      {data.state === "failed" && failedAt && (
        <span style={s.failedNote}>{t("footer.failedAt", { when: failedAt })}</span>
      )}
    </div>
  );
}
