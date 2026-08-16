/* TrackedSaveModal — the one warning this page gives before it writes.

   A document outside `.devdigest/` came from the repository, and the next
   resync of it runs `git reset --hard origin/<default>`: the edit is returned to
   the state of the branch with no trace, no conflict and no question, and
   DevDigest keeps no copy of it. That is worth a sentence BEFORE the write, not
   a surprise after it.

   The confirmation is UI-only, and deliberately so: the save request carries no
   `confirm_tracked` field because the server cannot render a warning and would
   only be recording that one was shown. So this dialog is the whole mechanism —
   do not route the write around it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { s } from "../../styles";

export function TrackedSaveModal({
  branch,
  pending,
  onConfirm,
  onCancel,
}: {
  branch: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("context");
  return (
    <Modal
      width={560}
      title={t("tracked.title")}
      onClose={onCancel}
      footer={
        <div style={s.modalFooter}>
          <Button kind="ghost" size="sm" onClick={onCancel}>
            {t("tracked.cancel")}
          </Button>
          <Button kind="primary" size="sm" onClick={onConfirm} disabled={pending}>
            {t("tracked.confirm")}
          </Button>
        </div>
      }
    >
      <div style={s.modalBody}>
        <p style={s.modalText}>{t("tracked.body", { branch })}</p>
      </div>
    </Modal>
  );
}
