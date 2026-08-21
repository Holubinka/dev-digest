/* TourStates — every state of this page that is not "here is the tour", each
   with its own text and none of them masking another.

   READING IS NEVER BLOCKED. A refusal, a failure and a generation in flight are
   all rendered BESIDE a saved tour, never instead of it — the caller keeps
   drawing the sections and puts this above them. Only generating is blocked
   (AC-60).

   THE REFUSAL SHOWS BEFORE ANYONE PRESSES ANYTHING. `generate_blocked` arrives
   on the READ, so the three texts are reachable without spending a request; the
   same three arrive as 409 `error.code`s after a press, and both go through one
   mapping in `helpers.ts`. There is no generic apology, no fourth text
   assembled out of two, and no default branch that quietly renders the first of
   three — they lead a reader to three different actions and the third is final.

   NOTHING HERE FIRES ON MOUNT. The tour is generated when a human presses the
   control and at no other time (AC-62): no automatic first generation, no
   regeneration when the index moves, no retry after a failure. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import type { OnboardingRefusal } from "@/lib/types";
import { generateFailureKey, refusalCopyKey, refusalFromErrorCode } from "../../helpers";
import { s } from "./styles";

export function TourStates({
  blocked,
  hasTour,
  isPending,
  error,
  onGenerate,
}: {
  /** `generate_blocked` from the read envelope. Exactly three values or null. */
  blocked: OnboardingRefusal | null;
  /** Derived from `data` alone — NEVER from the mutation's error, which is
   *  sticky and would empty the page for the rest of the mount
   *  (`client/INSIGHTS.md:626-645`). */
  hasTour: boolean;
  isPending: boolean;
  error: unknown;
  onGenerate: () => void;
}) {
  const t = useTranslations("onboarding");
  const apiError = error instanceof ApiError ? error : null;
  const refusalKey = refusalCopyKey(blocked ?? refusalFromErrorCode(apiError?.code));

  if (refusalKey !== null) {
    return (
      <div role="status" style={s.block}>
        <h2 style={s.title}>{t(`${refusalKey}.title`)}</h2>
        <p style={s.body}>{t(`${refusalKey}.body`)}</p>
      </div>
    );
  }

  return (
    <>
      {isPending && hasTour && (
        <p role="status" style={s.running}>
          {t("generate.generating")}
        </p>
      )}
      {!isPending && error != null && <FailureNote error={error} hasTour={hasTour} />}
      {!hasTour && (
        <EmptyState
          icon="Workflow"
          title={t("generate.title")}
          body={t("generate.body")}
          cta={isPending ? t("generate.generating") : t("generate.cta")}
          onCta={onGenerate}
          ctaLoading={isPending}
        />
      )}
    </>
  );
}

/**
 * Why a generation failed, in the reader's terms — and the saved tour is
 * untouched in every one of these cases.
 *
 * A missing provider key is not a failure anyone can retry into success, so it
 * gets its own copy and a way to fix it rather than a raw server error
 * (`PrBriefBanner.tsx:264-275`). Everything else shows the server's own
 * sentence under a stable heading, which is what makes "shows the reason" more
 * than a generic apology.
 */
function FailureNote({ error, hasTour }: { error: unknown; hasTour: boolean }) {
  const t = useTranslations("onboarding");
  const apiError = error instanceof ApiError ? error : null;

  if (apiError?.code === "config_error") {
    return (
      <div role="status" style={s.block}>
        <p style={s.running}>{t("notConfigured")}</p>
        <p style={s.hint}>
          <Link href="/settings/models" style={s.link}>
            {t("notConfiguredLink")}
          </Link>
        </p>
      </div>
    );
  }

  const key = generateFailureKey(apiError?.code);
  const indexChanged = key === "generateIndexChanged";

  return (
    <div role="status" style={s.block}>
      {/* `generateFailed` promises the tour below is unchanged, which is only a
          statement when there is one. `generateIndexChanged` says nothing was
          saved, which is true either way. */}
      {(indexChanged || hasTour) && <p style={s.running}>{t(key)}</p>}
      {!indexChanged && <p style={s.hint}>{apiError?.message ?? t("unknownError")}</p>}
    </div>
  );
}
