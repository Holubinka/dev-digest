/* OnThisPageRail — the mockup's `ON THIS PAGE`, built by mapping
   `SECTION_ORDER` and never by restating the five.

   REAL ANCHORS, not handlers. `<a href="#…">` gives keyboard focus, middle-
   click, "copy link address" and the browser's own scroll for nothing, and it
   puts the section in the URL — which is what `Share link` then copies and what
   reopening the link lands on (AC-5, AC-82). A `<button onClick={scrollTo}>`
   would have to reimplement all four and would leave the URL silent.

   EVERY SECTION KEEPS ITS ENTRY, including one that came back empty (AC-66):
   the rail is the shape of the page, and a page whose navigation changes with
   its content tells a reader a section is missing when it is merely empty.

   The labels are the section headings from `messages/en`, the same strings the
   cards carry — `OnboardingSection.title` is the model's own heading and is
   never drawn (AC-85). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SECTION_ORDER } from "../../sections";
import { s } from "./styles";

export function OnThisPageRail({ activeAnchor }: { activeAnchor: string }) {
  const t = useTranslations("onboarding");
  const label = t("onThisPage");

  return (
    <nav className="dd-tour-rail" aria-label={label}>
      <p style={s.label}>{label}</p>
      <div style={s.nav}>
        {SECTION_ORDER.map((section) => {
          const active = section.anchor === activeAnchor;
          return (
            <a
              key={section.kind}
              href={`#${section.anchor}`}
              aria-current={active ? "true" : undefined}
              style={s.link(active)}
            >
              {t(section.titleKey)}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
