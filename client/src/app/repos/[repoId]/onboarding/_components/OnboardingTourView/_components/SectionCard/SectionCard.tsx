/* SectionCard — the frame all five tour sections share: the icon and heading
   the mockup draws, the anchor the rail links to, and the collapse control.

   A native `<details>`, not a hand-rolled disclosure: it is keyboard-reachable
   for free and `.dd-brief-disclosure` in `app/globals.css` already hides the
   default marker (the chevron the design draws sits on the RIGHT, and no
   `styles.ts` can reach `::-webkit-details-marker`). The one piece of state
   here is the chevron's direction — the element owns its own open/closed, and
   `onToggle` is how React learns what the browser already did.

   The heading comes from `messages/en/onboarding.json` through the descriptor.
   `OnboardingSection.title` — the model's own heading — is never rendered
   (AC-85): the page would otherwise carry two headings for one section, in two
   languages. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { OnboardingSectionKind } from "@/lib/types";
import { SECTION_BY_KIND } from "../../sections";
import { s } from "./styles";

export function SectionCard({
  kind,
  children,
}: {
  kind: OnboardingSectionKind;
  children?: React.ReactNode;
}) {
  const t = useTranslations("onboarding");
  const [open, setOpen] = React.useState(true);
  const descriptor = SECTION_BY_KIND[kind];
  const SectionIcon = Icon[descriptor.icon];

  return (
    <details
      id={descriptor.anchor}
      className="dd-brief-disclosure"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      style={s.card}
    >
      <summary style={s.header}>
        <span style={s.iconBox} aria-hidden="true">
          <SectionIcon size={15} />
        </span>
        <h2 style={s.heading}>{t(descriptor.titleKey)}</h2>
        <Icon.ChevronDown size={16} style={s.chevron(open)} aria-hidden="true" />
      </summary>
      <div style={s.body}>{children}</div>
    </details>
  );
}
