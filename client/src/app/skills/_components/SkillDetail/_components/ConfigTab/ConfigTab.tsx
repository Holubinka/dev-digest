/* ConfigTab — name, description, type and body, saved together. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, SelectInput, TextInput } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useUpdateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { TYPE_VALUES } from "@/components/skill-type";
import { SkillBodyEditor } from "@/components/skill-body-editor";
import { s } from "./styles";

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<Skill["type"]>(skill.type);
  const [body, setBody] = React.useState(skill.body);

  // Reset the form when the selection changes under it.
  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () =>
    update.mutate(
      { id: skill.id, patch: { name, description, type, body } },
      {
        onSuccess: (data) =>
          toast.success(t("editor.savedToast", { name: data.name, version: data.version })),
      },
    );

  return (
    <div style={s.wrap}>
      <FormField label={t("editor.name")} required>
        <TextInput value={name} onChange={setName} mono />
      </FormField>

      <FormField label={t("editor.description")} hint={t("editor.descriptionHint")}>
        <TextInput
          value={description}
          onChange={setDescription}
          placeholder={t("editor.descriptionPlaceholder")}
        />
      </FormField>

      <FormField label={t("editor.type")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as Skill["type"])}
          options={TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
        />
      </FormField>

      <FormField label={t("body.label")} hint={t("body.hint")} required>
        <SkillBodyEditor
          name={name}
          value={body}
          dirty={body !== skill.body}
          onChange={setBody}
        />
      </FormField>

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
          {update.isPending ? t("editor.saving") : t("editor.save")}
        </Button>
      </div>
    </div>
  );
}
