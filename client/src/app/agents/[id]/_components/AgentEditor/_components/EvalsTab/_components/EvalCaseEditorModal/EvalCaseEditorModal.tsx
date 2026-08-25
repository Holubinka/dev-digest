/* EvalCaseEditorModal — name, the fixed input in three tabs (diff · files · PR
   meta) and `expected_output` as editable JSON (AC-18), with the save blocked
   while that JSON does not satisfy the expectation contract (AC-19) and a
   «Run on save» switch that runs the case and shows the result inline (AC-20).

   The form is a separate component below, mounted only once the case has
   loaded and keyed by its id, so the draft is seeded from props by `useState`
   rather than synced into state by an effect. A `useEffect` that copies server
   data into a form is the classic way to lose a keystroke to a refetch. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, Modal, Tabs, Textarea, TextInput, Toggle } from "@devdigest/ui";
import { formatCost } from "@/components/run-cost-badge";
import type { EvalCase, EvalRunResult } from "@/lib/types";
import {
  useCreateEvalCase,
  useEvalCase,
  useRunEvalCase,
  useUpdateEvalCase,
} from "@/lib/hooks/eval";
import { FINDING_SKELETON, filesInDiff, parseExpectations, pct } from "../../helpers";
import { s } from "./styles";

export function EvalCaseEditorModal({
  agentId,
  agentName,
  caseId,
  onClose,
}: {
  agentId: string;
  agentName: string;
  /** `null` opens an empty editor — the mockup's «New eval case». */
  caseId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const query = useEvalCase(caseId);

  if (caseId && query.isLoading) {
    return (
      <Modal width={1040} title={t("caseEditor.newCase")} onClose={onClose}>
        <div style={s.loading}>{t("dashboard.loading")}</div>
      </Modal>
    );
  }
  if (caseId && !query.data) {
    return (
      <Modal width={1040} title={t("caseEditor.newCase")} onClose={onClose}>
        <div style={s.loading}>{t("caseEditor.loadError")}</div>
      </Modal>
    );
  }

  return (
    <CaseForm
      key={caseId ?? "new"}
      agentId={agentId}
      agentName={agentName}
      existing={query.data ?? null}
      onClose={onClose}
    />
  );
}

/** `input_meta` is `unknown` in the contract; this is the shape the server writes. */
function readMeta(meta: unknown): { title: string; body: string } {
  if (!meta || typeof meta !== "object") return { title: "", body: "" };
  const m = meta as { title?: unknown; body?: unknown };
  return {
    title: typeof m.title === "string" ? m.title : "",
    body: typeof m.body === "string" ? m.body : "",
  };
}

function CaseForm({
  agentId,
  agentName,
  existing,
  onClose,
}: {
  agentId: string;
  agentName: string;
  existing: EvalCase | null;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const seedMeta = readMeta(existing?.input_meta);

  const [name, setName] = React.useState(existing?.name ?? "");
  const [diff, setDiff] = React.useState(existing?.input_diff ?? "");
  const [prTitle, setPrTitle] = React.useState(seedMeta.title);
  const [prBody, setPrBody] = React.useState(seedMeta.body);
  const [expectedText, setExpectedText] = React.useState(() =>
    existing ? JSON.stringify(existing.expected_output ?? [], null, 2) : "[]",
  );
  const [inputTab, setInputTab] = React.useState("diff");
  const [runOnSave, setRunOnSave] = React.useState(false);

  const create = useCreateEvalCase(agentId);
  const update = useUpdateEvalCase();
  const run = useRunEvalCase(agentId);

  // Derived during render, never mirrored into state: the badge, the files list
  // and the save gate are all one function of the two textareas.
  const parsed = parseExpectations(expectedText);
  const files = filesInDiff(diff);
  const saving = create.isPending || update.isPending;
  const canSave = parsed.ok && name.trim() !== "" && !saving && !run.isPending;

  const body = () => ({
    name: name.trim(),
    input_diff: diff,
    input_meta: { title: prTitle, body: prBody },
    expected_output: parsed.ok ? parsed.value : [],
  });

  const save = async () => {
    if (!canSave) return;
    const saved = existing
      ? await update.mutateAsync({ caseId: existing.id, body: body() })
      : await create.mutateAsync(body());
    // AC-20: a successful save with the switch on runs THIS case immediately and
    // leaves the result on screen. The modal stays open — the result is the
    // reason the switch exists.
    if (runOnSave) await run.mutateAsync(saved.id);
    else onClose();
  };

  const addSkeleton = () => {
    const current = parsed.ok ? parsed.value : [];
    setExpectedText(JSON.stringify([...current, FINDING_SKELETON], null, 2));
  };

  return (
    <Modal
      width={1040}
      title={
        existing ? t("caseEditor.caseTitle", { name: existing.name }) : t("caseEditor.newCase")
      }
      subtitle={t("caseEditor.subtitle", { agent: agentName })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <label style={s.runOnSave}>
            <Toggle on={runOnSave} onChange={setRunOnSave} size={16} />
            {t("caseEditor.runOnSave")}
          </label>
          <div style={s.footerRight}>
            <Button kind="ghost" size="sm" onClick={onClose}>
              {t("caseEditor.cancel")}
            </Button>
            <Button
              kind="secondary"
              size="sm"
              icon="Play"
              disabled={!existing || run.isPending || saving}
              loading={run.isPending}
              onClick={() => existing && run.mutate(existing.id)}
            >
              {run.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
            </Button>
            <Button
              kind="primary"
              size="sm"
              icon="Check"
              disabled={!canSave}
              loading={saving}
              onClick={() => void save()}
            >
              {saving ? t("caseEditor.saving") : t("caseEditor.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="dd-eval-case-cols" style={s.cols}>
        <div style={s.colLeft}>
          <div style={s.label}>
            {t("caseEditor.nameLabel")} <span style={{ color: "var(--crit)" }}>*</span>
          </div>
          <TextInput
            value={name}
            onChange={setName}
            mono
            placeholder={t("caseEditor.namePlaceholder")}
            aria-label={t("caseEditor.nameLabel")}
          />
          {name.trim() === "" && <div style={s.error}>{t("caseEditor.nameRequired")}</div>}

          <div style={{ ...s.label, marginTop: 20 }}>{t("caseEditor.inputLabel")}</div>
          <div style={s.inputTabs}>
            <Tabs
              pad="0"
              value={inputTab}
              onChange={setInputTab}
              tabs={[
                { key: "diff", label: t("caseEditor.tabs.diff") },
                { key: "files", label: t("caseEditor.tabs.files") },
                { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
              ]}
            />
          </div>

          {inputTab === "diff" && (
            <Textarea
              value={diff}
              onChange={setDiff}
              rows={16}
              mono
              placeholder={t("caseEditor.diffPlaceholder")}
            />
          )}

          {inputTab === "files" && (
            <>
              <ul style={s.filesList}>
                {files.length === 0 ? (
                  <li style={s.fileRow}>{t("caseEditor.filesEmpty")}</li>
                ) : (
                  files.map((f) => (
                    <li key={f} className="mono" style={s.fileRow}>
                      {f}
                    </li>
                  ))
                )}
              </ul>
              {/* D13: derived from the diff, never edited — so there is no
                  input here, only the list and the sentence saying why. */}
              <div style={s.hint}>{t("caseEditor.filesHint")}</div>
            </>
          )}

          {inputTab === "prMeta" && (
            <>
              <div style={s.label}>{t("caseEditor.titleLabel")}</div>
              <TextInput
                value={prTitle}
                onChange={setPrTitle}
                placeholder={t("caseEditor.titlePlaceholder")}
                aria-label={t("caseEditor.titleLabel")}
              />
              <div style={{ ...s.label, marginTop: 16 }}>{t("caseEditor.bodyLabel")}</div>
              <Textarea
                value={prBody}
                onChange={setPrBody}
                rows={9}
                placeholder={t("caseEditor.bodyPlaceholder")}
              />
            </>
          )}
        </div>

        <div style={s.colRight}>
          <div style={s.expectedHead}>
            <span style={{ ...s.label, marginBottom: 0 }}>{t("caseEditor.expectedOutput")}</span>
            {parsed.ok ? (
              <Badge color="var(--ok)" icon="Check">
                {t("caseEditor.validJson")}
              </Badge>
            ) : (
              <Badge color="var(--crit)" icon="AlertTriangle">
                {t("caseEditor.invalidJson")}
              </Badge>
            )}
            <div style={s.expectedActions}>
              <Button kind="ghost" size="sm" icon="Plus" onClick={addSkeleton}>
                {t("caseEditor.findingSkeleton")}
              </Button>
            </div>
          </div>
          <Textarea
            value={expectedText}
            onChange={setExpectedText}
            rows={18}
            mono
            placeholder="[]"
          />
          {/* AC-19: say what is wrong, not just that something is. `role=alert`
              because the sentence appears while the reader is typing in the
              textarea and is never scrolled to. */}
          {!parsed.ok && (
            <div role="alert" style={s.error}>
              {t("caseEditor.expectedError", { reason: parsed.reason })}
            </div>
          )}

          {run.data && <ResultStrip result={run.data} />}
        </div>
      </div>
    </Modal>
  );
}

function ResultStrip({ result }: { result: EvalRunResult }) {
  const t = useTranslations("eval");
  const r = result.result;
  const passed = r.traces_passed === r.traces_total;
  const Mark = passed ? Icon.CheckCircle : Icon.XCircle;
  return (
    <div style={s.resultStrip(passed)}>
      <Mark size={16} style={{ color: passed ? "var(--ok)" : "var(--crit)" }} />
      <span style={s.resultTitle}>
        {passed ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}
      </span>
      <span style={s.resultMeta}>
        {t("caseEditor.resultSummary", {
          recall: pct(r.recall),
          precision: pct(r.precision),
          citation: pct(r.citation_accuracy),
          duration: (r.duration_ms / 1000).toFixed(1),
        })}
      </span>
      <span className="mono" style={s.resultMeta}>
        {formatCost(r.cost_usd)}
      </span>
    </div>
  );
}
