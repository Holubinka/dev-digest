/* SmartDiffViewer — the PR's files grouped by role (core / wiring / boilerplate),
   riskiest first, boilerplate collapsed.

   Two different jumps, deliberately: the "N findings" badge in a file header
   scrolls the diff to the first line that file cites, and a severity chip ON a
   line opens that particular finding in the Agent runs tab, where it can be
   read, accepted or dismissed.

   Nothing here calls a model: the grouping arrives from GET /pulls/:id/smart-diff,
   which derives it from pr_files and findings. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import {
  FileCard,
  lineDomId,
  type DiffCommentApi,
  type LineAdornment,
} from "@/components/diff-viewer";
import { severityColor } from "@/components/severity-badge";
import {
  defaultOpenFor,
  fileFindingSummary,
  findingsByFileLine,
  gutterColours,
} from "./helpers";
import { roleDotFor, s } from "./styles";

/**
 * `severity` is a plain `text` column, so a value outside the contract can
 * reach here. Both lookups fall back rather than indexing blind — a missing
 * i18n key throws in next-intl, and a missing icon name renders `undefined` as
 * a component, which is the route-killing "Element type is invalid".
 */
const CHIP = {
  CRITICAL: { icon: "AlertOctagon", key: "smartDiff.chipCritical" },
  WARNING: { icon: "AlertTriangle", key: "smartDiff.chipWarning" },
  SUGGESTION: { icon: "Lightbulb", key: "smartDiff.chipSuggestion" },
} as const;

type ChipSeverity = keyof typeof CHIP;

function chipFor(severity: string): (typeof CHIP)[ChipSeverity] {
  return Object.hasOwn(CHIP, severity) ? CHIP[severity as ChipSeverity] : CHIP.WARNING;
}

interface SmartDiffViewerProps {
  smartDiff: SmartDiff;
  /** Source of the patch text — the contract carries paths, not diffs. */
  files: PrFile[];
  findings: FindingRecord[];
  commenting?: DiffCommentApi;
  /** Opens a finding where it lives: the Agent runs tab, Review runs list. */
  onOpenFinding?: (findingId: string) => void;
}

export function SmartDiffViewer({
  smartDiff,
  files,
  findings,
  commenting,
  onOpenFinding,
}: SmartDiffViewerProps) {
  const t = useTranslations("prReview");
  const byPath = React.useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const cited = React.useMemo(() => findingsByFileLine(findings), [findings]);

  // Explicit toggles only. A path absent here falls back to its role default, so
  // re-fetching the Smart Diff never re-collapses a file the reviewer opened.
  const [toggled, setToggled] = React.useState<Record<string, boolean>>({});
  // Expanding is a render away from scrolling, so the target is parked here and
  // the effect below runs once the line actually exists in the DOM.
  const [pending, setPending] = React.useState<{ path: string; line: number } | null>(null);

  React.useEffect(() => {
    if (!pending) return;
    document
      .getElementById(lineDomId(pending.path, pending.line))
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    setPending(null);
  }, [pending]);

  const { too_big: tooBig, total_lines: totalLines, proposed_splits: splits } =
    smartDiff.split_suggestion;

  return (
    <div style={s.wrap}>
      {tooBig && (
        <div style={s.callout}>
          <div style={s.calloutTitle}>{t("smartDiff.largeTitle", { lines: totalLines })}</div>
          <div style={s.calloutBody}>{t("smartDiff.largeBody")}</div>
          {splits.length > 0 && (
            <ul style={s.splitList}>
              {splits.map((split) => (
                <li key={split.name}>
                  {split.name} — {t("smartDiff.filesCount", { count: split.files.length })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {smartDiff.groups.map((group) => (
        <section key={group.role} style={s.group}>
          <header style={s.groupHeader}>
            <span style={roleDotFor(group.role)} />
            <span style={s.groupLabel}>{t(`smartDiff.${group.role}Label`)}</span>
            <span style={s.groupHint}>{t(`smartDiff.${group.role}Hint`)}</span>
            <span style={s.groupCount}>
              {t("smartDiff.filesCount", { count: group.files.length })}
            </span>
          </header>

          {group.files.map((entry) => {
            const file: PrFile = byPath.get(entry.path) ?? {
              path: entry.path,
              additions: entry.additions,
              deletions: entry.deletions,
              patch: null,
            };
            const lines = cited.get(entry.path);
            const summary = lines ? fileFindingSummary(lines) : null;
            // Every line the finding covers is listed, and FileCard draws each
            // key once — on the first line it actually renders. So a finding
            // spanning a block gets ONE chip rather than the same control
            // repeated down the block, and the chip still appears when the
            // range starts above the hunk. The gutter keeps marking every line,
            // which is what shows how far the finding reaches.
            const chips = new Map<number, LineAdornment[]>();
            if (lines) {
              for (const [line, list] of lines) {
                chips.set(
                  line,
                  list.map((f) => {
                    const chip = chipFor(f.severity);
                    const label = t(chip.key);
                    return {
                      key: f.id,
                      node: (
                        <button
                          type="button"
                          style={s.bareButton}
                          title={t("smartDiff.jumpToFinding")}
                          aria-label={`${label}: ${f.title}`}
                          onClick={() => onOpenFinding?.(f.id)}
                        >
                          <Badge
                            color={severityColor(f.severity)}
                            bg="transparent"
                            icon={chip.icon}
                          >
                            {label}
                          </Badge>
                        </button>
                      ),
                    };
                  }),
                );
              }
            }

            return (
              <FileCard
                key={entry.path}
                file={file}
                // `defaultOpen` seeds the role rule; `open` stays undefined —
                // and so uncontrolled — until the badge or the reader actually
                // toggles this path, which avoids flipping modes mid-life.
                {...(defaultOpenFor(group.role) !== undefined
                  ? { defaultOpen: defaultOpenFor(group.role) }
                  : {})}
                {...(toggled[entry.path] !== undefined
                  ? { open: toggled[entry.path] }
                  : {})}
                onOpenChange={(next) =>
                  setToggled((prev) => ({ ...prev, [entry.path]: next }))
                }
                {...(commenting ? { commenting } : {})}
                {...(lines
                  ? { highlights: gutterColours(lines), lineRight: chips }
                  : {})}
                {...(summary
                  ? {
                      afterPath: (
                        <span style={s.fileDot} title={t("smartDiff.fileHasFindings")} />
                      ),
                      right: (
                        <button
                          type="button"
                          style={s.bareButton}
                          title={t("smartDiff.jumpToLine")}
                          onClick={(e) => {
                            // The badge sits INSIDE the card header, whose own
                            // onClick toggles the card — without this, opening
                            // a collapsed file also closes it again.
                            e.stopPropagation();
                            setToggled((prev) => ({ ...prev, [entry.path]: true }));
                            setPending({ path: entry.path, line: summary.firstLine });
                          }}
                        >
                          <Badge color="var(--crit)" bg="var(--crit-bg)" icon="AlertOctagon">
                            {t("smartDiff.findingsCount", { count: summary.count })}
                          </Badge>
                        </button>
                      ),
                    }
                  : {})}
              />
            );
          })}
        </section>
      ))}
    </div>
  );
}
