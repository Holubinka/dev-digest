/* PathPromptModal — "where should it go?", for the two dialogs that ask it.

   A new document and a new folder differ in their copy and in the request they
   send, and in nothing else: both take one repo-relative path under
   `.devdigest/`, both are refused by the server on the same path rules, and both
   have to keep the dialog open when they are, because the typed path is the only
   copy of what the user meant. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, TextInput } from "@devdigest/ui";
import { s } from "../../styles";

export function PathPromptModal({
  title,
  label,
  hint,
  submitLabel,
  initial = "",
  error,
  pending,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  hint?: string;
  submitLabel: string;
  /** The prefix the server requires, so the field starts on a valid path. */
  initial?: string;
  /** Already-translated copy for a refusal, or null. */
  error: string | null;
  pending: boolean;
  onSubmit: (path: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("context");
  const [path, setPath] = React.useState(initial);

  const trimmed = path.trim();
  const ready = trimmed !== "" && trimmed !== initial;

  return (
    <Modal
      width={560}
      title={title}
      onClose={onClose}
      footer={
        <div style={s.modalFooter}>
          {/* `create.cancel`, not `reader.cancel`: this dialog is not the reader,
              and a label borrowed across surfaces is one that changes on both when
              only one of them was meant. */}
          <Button kind="ghost" size="sm" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button
            kind="primary"
            size="sm"
            onClick={() => onSubmit(trimmed)}
            disabled={!ready || pending}
          >
            {submitLabel}
          </Button>
        </div>
      }
    >
      <div style={s.modalBody}>
        {error && (
          <div role="alert" style={s.modalError}>
            {error}
          </div>
        )}
        <FormField label={label} hint={hint} required>
          <TextInput value={path} onChange={setPath} mono aria-label={label} />
        </FormField>
      </div>
    </Modal>
  );
}
