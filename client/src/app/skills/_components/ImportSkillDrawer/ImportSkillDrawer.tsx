/* ImportSkillDrawer — choose a file or a URL, read the draft, then save.
   Both routes converge on one preview screen, and NOTHING is written until the
   user presses save: the preview endpoints parse and return, they do not
   persist. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  Drawer,
  FormField,
  Icon,
  SelectInput,
  Tabs,
  TextInput,
} from "@devdigest/ui";
import type { Skill, SkillImportPreview } from "@devdigest/shared";
import {
  useCreateSkill,
  useImportSkillFile,
  useImportSkillUrl,
} from "../../../../lib/hooks/skills";
import { useToast } from "../../../../lib/toast";
import { TYPE_VALUES } from "@/components/skill-type";
import { SkillBodyEditor } from "@/components/skill-body-editor";
import { s } from "./styles";

export function ImportSkillDrawer({
  initialTab = "file",
  onClose,
}: {
  initialTab?: "file" | "url";
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const toast = useToast();
  const router = useRouter();
  const importFile = useImportSkillFile();
  const importUrl = useImportSkillUrl();
  const create = useCreateSkill();

  const [tab, setTab] = React.useState<string>(initialTab);
  const [url, setUrl] = React.useState("");
  const [draft, setDraft] = React.useState<SkillImportPreview | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<Skill["type"]>("custom");
  const [body, setBody] = React.useState("");
  const fileInput = React.useRef<HTMLInputElement>(null);

  /** Seed the editable fields from a parsed draft. */
  const accept = (preview: SkillImportPreview) => {
    setDraft(preview);
    setName(preview.name);
    setDescription(preview.description);
    setType(preview.type);
    setBody(preview.body);
  };

  const readFile = (file: File | undefined) => {
    if (file) importFile.mutate(file, { onSuccess: accept });
  };

  /**
   * A refused import needs saying HERE, not only in a toast.
   *
   * The `MutationCache` in `lib/providers.tsx` already toasts the server's
   * message, so no `onError` belongs on the mutations — a second one would be
   * the same sentence twice. But that toast is gone in four seconds and leaves
   * the drawer showing an upload box with no clue why nothing happened, and the
   * reasons here are ones the user has to act on: an oversized archive, a
   * non-Markdown body, a URL the SSRF guard refused. So the message is rendered
   * from the mutation's own error state, beside the control that caused it,
   * where it stays until the next attempt.
   */
  const failure = (error: unknown) => (
    <div style={s.failure} role="alert">
      <Icon.XCircle size={16} style={s.failureIcon} />
      <span style={s.failureText}>
        {error instanceof Error ? error.message : t("import.readFailed")}
      </span>
    </div>
  );

  /** Catch without reporting: the `MutationCache` in `lib/providers.tsx` already
   *  toasts a failed mutation, so a second message here would be the same
   *  sentence twice. The catch exists because `onClick` cannot await this. The
   *  early return matters more here than elsewhere — the preview is persisted
   *  nowhere, so closing on a failure would lose the import and every edit. */
  const save = async () => {
    if (!draft) return;
    let skill: Skill;
    try {
      skill = await create.mutateAsync({
        name,
        description,
        type,
        body,
        // The server pins `enabled` false for any non-manual source; sending it
        // here states the intent rather than relying on that alone.
        source: draft.source,
        enabled: false,
        evidence_files: draft.evidence_files,
      });
    } catch {
      return;
    }
    toast.success(t("import.savedToast", { name: skill.name }));
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  const footer = (
    <div style={s.footer}>
      <Button kind="ghost" size="sm" onClick={onClose}>
        {t("import.cancel")}
      </Button>
      {draft && (
        <>
          <Button kind="secondary" size="sm" onClick={() => setDraft(null)}>
            {t("import.startOver")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            icon="Check"
            onClick={save}
            disabled={create.isPending}
          >
            {create.isPending ? t("import.saving") : t("import.save")}
          </Button>
        </>
      )}
    </div>
  );

  return (
    <Drawer
      width={680}
      title={t("drawer.title")}
      subtitle={t("drawer.subtitle")}
      onClose={onClose}
      footer={footer}
    >
      <div style={s.body}>
        {draft === null ? (
          <>
            <Tabs
              tabs={[
                { key: "file", label: t("drawer.tabs.file"), icon: "Upload" },
                { key: "url", label: t("drawer.tabs.url"), icon: "Link" },
              ]}
              value={tab}
              onChange={setTab}
              pad="0"
            />

            {tab === "file" ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  readFile(e.dataTransfer.files[0]);
                }}
                style={s.drop}
              >
                <Icon.Upload size={22} style={s.dropIcon} />
                <p style={s.dropHint}>{t("file.dropHint")}</p>
                <Button
                  kind="secondary"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                  disabled={importFile.isPending}
                >
                  {importFile.isPending ? t("file.reading") : t("file.browse")}
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".md,.markdown,.zip"
                  aria-label={t("file.browse")}
                  style={{ display: "none" }}
                  onChange={(e) => readFile(e.target.files?.[0])}
                />
                <p style={s.hint}>{t("file.hint")}</p>
                {importFile.isError && failure(importFile.error)}
              </div>
            ) : (
              <div style={s.urlPane}>
                <FormField label={t("url.label")} hint={t("url.hint")}>
                  <TextInput
                    value={url}
                    onChange={setUrl}
                    placeholder={t("url.placeholder")}
                    mono
                  />
                </FormField>
                <div style={s.urlActions}>
                  <Button
                    kind="primary"
                    size="sm"
                    icon="Link"
                    disabled={url.trim() === "" || importUrl.isPending}
                    onClick={() => importUrl.mutate(url.trim(), { onSuccess: accept })}
                  >
                    {importUrl.isPending ? t("url.fetching") : t("url.fetch")}
                  </Button>
                </div>
                {importUrl.isError && failure(importUrl.error)}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={s.trust}>
              <strong style={s.trustTitle}>{t("import.trustTitle")}</strong>
              <p style={s.trustBody}>{t("import.trustBody")}</p>
            </div>

            <div style={s.meta}>
              <span style={s.metaLabel}>{t("import.coreFrom")}</span>
              <span className="mono" style={s.chip}>
                {draft.core_path}
              </span>
              <span style={s.evidence}>
                {t("import.evidenceCount", { count: draft.evidence_files.length })}
              </span>
            </div>

            {/* Same shape as the create modal: an import is a creation whose
                fields arrived pre-filled, so it should not look like a lesser
                form. The type in particular is always `custom` from the parser
                — the user is the one who knows what this skill actually is. */}
            <div style={s.row}>
              <FormField label={t("editor.name")} required>
                <TextInput value={name} onChange={setName} mono />
              </FormField>
              <FormField label={t("editor.type")}>
                <SelectInput
                  value={type}
                  onChange={(v) => setType(v as Skill["type"])}
                  options={TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
                />
              </FormField>
            </div>
            <FormField label={t("editor.description")} hint={t("create.descriptionHint")}>
              <TextInput value={description} onChange={setDescription} />
            </FormField>
            <FormField label={t("body.label")} required>
              <SkillBodyEditor
                name={name || draft.core_path}
                value={body}
                dirty={body !== draft.body}
                onChange={setBody}
                minRows={10}
                maxRows={16}
              />
            </FormField>

            {draft.skipped.length > 0 && (
              <div style={s.skipped}>
                <h3 style={s.skippedTitle}>{t("import.skippedTitle")}</h3>
                <ul style={s.skippedList}>
                  {draft.skipped.map((entry) => (
                    <li key={entry.path} style={s.skippedRow}>
                      <span className="mono" style={s.skippedPath}>
                        {entry.path}
                      </span>
                      <span style={s.skippedReason}>{t(`import.skipped.${entry.reason}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {draft.warnings.map((warning) => (
              <p key={warning} style={s.warning}>
                {warning}
              </p>
            ))}
          </>
        )}
      </div>
    </Drawer>
  );
}
