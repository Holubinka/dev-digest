/* CreateSkillModal — name + type, then straight into the editor. The body is
   where the work is, so this asks for as little as possible before opening it. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, TextInput } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useCreateSkill } from "../../../../lib/hooks/skills";
import { TYPE_VALUES } from "./constants";
import { s } from "./styles";

export function CreateSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<Skill["type"]>("rubric");

  const submit = async () => {
    const skill = await create.mutateAsync({
      name: name.trim() || t("create.defaultName"),
      type,
      body: t("create.starterBody"),
    });
    onClose();
    router.push(`/skills/${skill.id}?tab=config`);
  };

  return (
    <Modal
      width={480}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" size="sm" onClick={onClose}>
            {t("import.cancel")}
          </Button>
          <Button kind="primary" size="sm" icon="Check" onClick={submit} disabled={create.isPending}>
            {create.isPending ? t("create.creating") : t("create.submit")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("create.name")} required>
          <TextInput value={name} onChange={setName} placeholder={t("create.namePlaceholder")} mono />
        </FormField>
        <FormField label={t("create.type")}>
          <SelectInput
            value={type}
            onChange={(v) => setType(v as Skill["type"])}
            options={TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
          />
        </FormField>
      </div>
    </Modal>
  );
}
