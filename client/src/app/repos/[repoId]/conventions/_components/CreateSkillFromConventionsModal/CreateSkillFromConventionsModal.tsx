/* CreateSkillFromConventionsModal — the accepted rules, merged into one skill
   body and shown in full before anything is saved. Everything is editable: the
   merge is a starting point, not a commitment.

   It saves through POST /skills like every other skill, so versioning, the
   injection check and the agent binding screen all work on it unchanged. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, Icon, Modal, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { ConventionCandidate, Skill } from "@devdigest/shared";
import { SkillBodyEditor } from "@/components/skill-body-editor";
import { ApiError } from "@/lib/api";
import { useCreateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { TYPE_VALUES } from "@/components/skill-type";
import { composeSkillBody, evidenceFiles, skillName } from "./helpers";
import { s } from "./styles";

export function CreateSkillFromConventionsModal({
  candidates,
  repoName,
  onClose,
}: {
  candidates: ConventionCandidate[];
  repoName: string;
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const toast = useToast();
  const create = useCreateSkill();

  const accepted = candidates.filter((c) => c.status === "accepted");
  const [name, setName] = React.useState(() => skillName(repoName));
  const [description, setDescription] = React.useState(() =>
    t("skill.defaultDescription", { count: accepted.length, repo: repoName }),
  );
  const [type, setType] = React.useState<Skill["type"]>("convention");
  const [enabled, setEnabled] = React.useState(true);
  const [body, setBody] = React.useState(() => composeSkillBody(candidates, repoName));

  const ready = name.trim() !== "" && body.trim() !== "";

  /**
   * The catch is narrow on purpose — it covers the request and nothing after it.
   * `onClick` cannot await this, so a rejection with no handler would surface as
   * an unhandled rejection and tell the user nothing at all; and a failure here
   * must leave the modal open, because the body in it is the only copy of an
   * edit nobody has saved yet.
   */
  const submit = async () => {
    if (!ready) return;
    let skill: Skill;
    try {
      skill = await create.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        type,
        body,
        source: "extracted",
        enabled,
        evidence_files: evidenceFiles(candidates),
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("skill.createFailed"));
      return;
    }
    toast.success(t("skill.createdToast", { name: skill.name }));
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  return (
    <Modal
      width={1100}
      title={t("skill.title")}
      subtitle={name}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <span style={s.footerNote}>{t("skill.footerNote")}</span>
          <Button kind="ghost" size="sm" onClick={onClose}>
            {t("skill.cancel")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            icon="Sparkles"
            onClick={submit}
            disabled={!ready || create.isPending}
          >
            {create.isPending ? t("skill.creating") : t("skill.submit")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.banner}>
          <Icon.Wrench size={15} style={s.bannerIcon} />
          <span>
            {t.rich("skill.mergedFrom", {
              count: accepted.length,
              repo: repoName,
              b: (chunks) => <strong style={s.bannerStrong}>{chunks}</strong>,
              name: (chunks) => (
                <span className="mono" style={s.bannerRepo}>
                  {chunks}
                </span>
              ),
            })}
          </span>
        </div>

        <FormField label={t("skill.name")} required>
          <TextInput value={name} onChange={setName} mono />
        </FormField>

        <FormField label={t("skill.description")}>
          <TextInput value={description} onChange={setDescription} />
        </FormField>

        <div style={s.row}>
          <FormField label={t("skill.type")}>
            <SelectInput
              value={type}
              onChange={(v) => setType(v as Skill["type"])}
              options={TYPE_VALUES.map((v) => ({ value: v, label: v }))}
            />
          </FormField>
          <FormField label={t("skill.enabled")} hint={t("skill.enabledHint")}>
            <Toggle on={enabled} onChange={setEnabled} />
          </FormField>
        </div>

        <FormField label={t("skill.body")} required>
          <SkillBodyEditor name={name} value={body} dirty onChange={setBody} minRows={10} />
        </FormField>
      </div>
    </Modal>
  );
}
