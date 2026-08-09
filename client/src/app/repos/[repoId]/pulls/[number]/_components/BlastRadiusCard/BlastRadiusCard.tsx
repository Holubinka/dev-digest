"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, MonoLink, SectionLabel, Skeleton } from "@devdigest/ui";
import { githubBlobUrl } from "@/lib/github-urls";
import { useBlastRadius, useExplainBlast } from "@/lib/hooks/blast";
import type { BlastRadiusView, BlastSymbol } from "@/lib/types";
import { s } from "./styles";

/**
 * The abbreviated form git itself prints. `String.slice` is safe here and only
 * here: a commit id is `[0-9a-f]{40}`, so there is no surrogate pair to split
 * (the code-point rule in `server/INSIGHTS.md:164-176` is about text). A shorter
 * string is left alone rather than padded.
 */
const shortSha = (sha: string) => sha.slice(0, 7);

interface BlastRadiusCardProps {
  /**
   * Required, and nullable rather than optional: `OverviewTab` holds
   * `string | null`, and a prop with a default is invisible to `tsc` — which is
   * how a whole feature was disabled in silence twice
   * (`client/INSIGHTS.md:163-249`). There are no behaviour flags here at all.
   */
  prId: string | null;
}

/**
 * BLAST RADIUS on PR Detail → Overview: which symbols this PR changes, who calls
 * them, and which HTTP routes and crons sit downstream.
 *
 * Unlike `IntentCard` beside it, this card owns its data — `OverviewTab` passes
 * only the id — because nothing else on the tab needs the view.
 *
 * The `Explain` button is the only thing here that spends money, and it fires on
 * click and never on mount.
 */
export function BlastRadiusCard({ prId }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const { data: view, isLoading, isError } = useBlastRadius(prId);
  const explain = useExplainBlast(prId);

  // Four states, in this order, none of them masking another.
  if (isError) {
    return (
      <CardShell title={t("title")}>
        <p style={s.note}>{t("failed")}</p>
      </CardShell>
    );
  }

  if (isLoading && !view) {
    return (
      <CardShell title={t("title")}>
        <Skeleton height={16} style={s.skeletonRow} />
        <Skeleton width="70%" height={12} />
      </CardShell>
    );
  }

  // Where a DISABLED query lands. With no `prId` the query is `enabled: false`,
  // and a disabled TanStack v5 query reports `isLoading === false` with
  // `data === undefined` (`client/INSIGHTS.md:490-517`) — so "we have not asked
  // yet" falls through to here, the empty state, and never to the failure above.
  if (!view) {
    return (
      <CardShell title={t("title")}>
        <p style={s.note}>{t("unavailable")}</p>
      </CardShell>
    );
  }

  // Symbols were found and nothing calls them. Distinct from an unbacked index
  // above, which is why `status` is checked separately from emptiness.
  const noDownstream = view.symbols.length > 0 && view.totals.callers === 0;

  return (
    <CardShell title={t("title")}>
      {view.status !== "full" && <IndexBanner status={view.status} reason={view.reason} />}

      {/* The links below open `link_sha`, not the PR head. Saying so is the
          difference between a link that looks wrong and a link that is
          explained: at a stale index the line numbers are still correct — for
          the commit they came from. */}
      {!view.index_matches_head && view.link_sha && (
        <p style={s.hint}>{t("staleIndex", { sha: shortSha(view.link_sha) })}</p>
      )}

      <div style={s.statRow}>
        <Stat value={view.totals.symbols} label={t("stat.symbols")} />
        <Stat value={view.totals.callers} label={t("stat.callers")} />
        <Stat value={view.totals.endpoints} label={t("stat.endpoints")} />
        <Stat value={view.totals.crons} label={t("stat.crons")} />
      </div>

      {noDownstream && (
        <p style={s.hint}>{t("noDownstream", { count: view.symbols.length })}</p>
      )}

      <div style={s.symbolList}>
        {view.symbols.map((symbol, i) => (
          <SymbolDisclosure
            key={`${symbol.file}:${symbol.line}:${symbol.name}`}
            symbol={symbol}
            repoFullName={view.repo_full_name}
            linkSha={view.link_sha}
            // The first symbol with callers opens on load, so the card shows a
            // real call site without a click. Read once, at mount.
            defaultOpen={i === 0 && symbol.callers.length > 0}
          />
        ))}
      </div>

      {view.summary != null && <p style={s.summary}>{view.summary}</p>}
      {explain.isError && <p style={s.hint}>{t("explainFailed")}</p>}

      <div style={s.footer}>
        <Button
          kind="ghost"
          size="sm"
          icon="Sparkles"
          onClick={() => explain.mutate()}
          disabled={explain.isPending}
        >
          {explain.isPending ? t("explaining") : t("explain")}
        </Button>
      </div>
    </CardShell>
  );
}

/** The frame every state shares, so the four never drift apart visually. */
function CardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={s.card}>
      <SectionLabel icon="Workflow">{title}</SectionLabel>
      {children}
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div style={s.stat}>
      <span className="tnum" style={s.statValue}>
        {value}
      </span>
      <span style={s.statLabel}>{label}</span>
    </div>
  );
}

/**
 * `partial` / `degraded` as a visible state carrying the server's own sentence.
 * `reason` is non-null whenever the status is not `full` by contract; the
 * fallback prints the status rather than an empty box if that ever stops holding.
 */
function IndexBanner({
  status,
  reason,
}: {
  status: BlastRadiusView["status"];
  reason: string | null;
}) {
  return (
    <div
      role="status"
      style={{
        ...s.banner,
        ...(status === "degraded" ? s.bannerDegraded : s.bannerPartial),
      }}
    >
      <Icon.AlertTriangle size={14} />
      <span>{reason ?? status}</span>
    </div>
  );
}

/**
 * One symbol, its callers and the endpoints they sit in.
 *
 * `<details>` rather than a button plus `useState`: the browser owns the open
 * state, so there is none to derive or sync here.
 */
function SymbolDisclosure({
  symbol,
  repoFullName,
  linkSha,
  defaultOpen,
}: {
  symbol: BlastSymbol;
  repoFullName: string;
  /**
   * The commit the lines belong to — `view.link_sha`, never `head_sha`. Null when
   * the index knows no commit, in which case every row degrades to plain text:
   * there is no commit at which these line numbers are true, and a link to the
   * head would open the wrong line rather than no line.
   */
  linkSha: string | null;
  defaultOpen: boolean;
}) {
  const t = useTranslations("blast");

  return (
    <details style={s.symbol} open={defaultOpen}>
      <summary style={s.disclosure}>
        <span style={s.symbolName}>{symbol.name}</span>
        <span className="mono" style={s.symbolSite}>
          {symbol.file}:{symbol.line}
        </span>
        <span style={s.callerCount}>{t("callerCount", { count: symbol.caller_count })}</span>
      </summary>

      {symbol.callers.length > 0 && (
        <ul style={s.callerList}>
          {symbol.callers.map((caller) => {
            const href = linkSha
              ? githubBlobUrl(repoFullName, linkSha, caller.file, caller.line)
              : undefined;
            const site = `${caller.file}:${caller.line}`;
            return (
              <li key={`${caller.file}:${caller.line}:${caller.symbol}`} style={s.callerRow}>
                {/* An unbuildable link degrades to plain text — never a
                    `MonoLink` without an `href`, which renders a <button> with
                    nothing behind it. */}
                {href ? (
                  <MonoLink href={href}>{site}</MonoLink>
                ) : (
                  <span className="mono" style={s.callerPlain}>
                    {site}
                  </span>
                )}
                <span style={s.callerSymbol}>{caller.symbol}</span>
              </li>
            );
          })}
        </ul>
      )}

      {symbol.truncated && (
        <p style={s.hint}>
          {t("truncated", { shown: symbol.callers.length, count: symbol.caller_count })}
        </p>
      )}

      {symbol.endpoints.length > 0 && (
        <div style={s.chipRow}>
          {symbol.endpoints.map((endpoint) => (
            // A Badge is a <span>. `Chip` renders a <button>, and a button with
            // no action is an accessibility defect.
            <Badge
              key={`${endpoint.file}:${endpoint.line}:${endpoint.label}`}
              icon={endpoint.kind === "cron" ? "Clock" : "Globe"}
              mono
            >
              {endpoint.label}
            </Badge>
          ))}
        </div>
      )}

      {/* The server caps this list — its length is set by how many routes the
          indexed repository declares, not by anything here — so the badges are a
          sample, and the count beside them is what stops the sample reading as
          the whole. Same contract as `truncated` above. */}
      {symbol.endpoints_truncated && (
        <p style={s.hint}>
          {t("endpointsTruncated", {
            shown: symbol.endpoints.length,
            count: symbol.endpoint_count,
          })}
        </p>
      )}
    </details>
  );
}
