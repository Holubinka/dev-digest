/* CreateSkillModal — write the whole skill here: name, description, type and
   body. Asking only for a name and a type made "create manually" a stub that
   dropped you into the editor to do the actual work; the body IS the skill. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, TextInput } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useCreateSkill } from "../../../../lib/hooks/skills";
import { useToast } from "../../../../lib/toast";
import { SkillBodyEditor } from "../SkillBodyEditor";
import { TYPE_VALUES } from "../constants";
import { s } from "./styles";

export function CreateSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const create = useCreateSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<Skill["type"]>("rubric");
  const [body, setBody] = React.useState(t("create.starterBody"));

  const ready = name.trim() !== "" && body.trim() !== "";

  const submit = async () => {
    if (!ready) return;
    const skill = await create.mutateAsync({
      name: name.trim(),
      description: description.trim(),
      type,
      body,
    });
    toast.success(t("create.createdToast", { name: skill.name }));
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  return (
    <Modal
      width={720}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <span style={s.footerNote}>{t("create.footerNote")}</span>
          <Button kind="ghost" size="sm" onClick={onClose}>
            {t("import.cancel")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            icon="Check"
            onClick={submit}
            disabled={!ready || create.isPending}
          >
            {create.isPending ? t("create.creating") : t("create.submit")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.row}>
          <FormField label={t("create.name")} required>
            <TextInput
              value={name}
              onChange={setName}
              placeholder={t("create.namePlaceholder")}
              mono
            />
          </FormField>
          <FormField label={t("create.type")}>
            <SelectInput
              value={type}
              onChange={(v) => setType(v as Skill["type"])}
              options={TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
            />
          </FormField>
        </div>

        <FormField label={t("editor.description")} hint={t("create.descriptionHint")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("editor.descriptionPlaceholder")}
          />
        </FormField>

        <FormField label={t("body.label")} hint={t("create.bodyHint")} required>
          <SkillBodyEditor
            name={name || t("create.namePlaceholder")}
            value={body}
            dirty={false}
            onChange={setBody}
            minRows={8}
            maxRows={12}
          />
        </FormField>
      </div>
    </Modal>
  );
}
