/* ShareLinkButton — puts THIS page's URL, naming a section, on the clipboard.

   Nothing else: not a markdown export, not a public link, not an invitation
   (§ N11). Those are decisions for a human to make deliberately, and a control
   labelled `Share link` is not where one gets made by accident.

   It reads `window.location.href` in the click handler rather than in render —
   an event runs only on the client, so there is no server pass to disagree with
   (next-best-practices § Hydration Errors).

   It uses `useCopyToClipboard` rather than `CopyButton`: the mockup draws a
   labelled button here, and `CopyButton` is icon-only by construction (its
   whole `aria-label` contract exists because it has no visible text). The
   clipboard behaviour — including doing nothing when `navigator.clipboard` is
   absent — is the shared hook's, so there is one of it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { shareUrl } from "../../helpers";

export function ShareLinkButton({ activeAnchor }: { activeAnchor: string }) {
  const t = useTranslations("onboarding");
  const { copied, copy } = useCopyToClipboard();

  return (
    <Button
      kind="secondary"
      icon={copied ? "Check" : "Link"}
      onClick={() => copy(shareUrl(window.location.href, activeAnchor))}
    >
      {copied ? t("shareCopied") : t("shareLink")}
    </Button>
  );
}
