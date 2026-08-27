/* FindingActions — the three actions the multi-agent detail adds to a finding
   beyond Accept and Dismiss (AC-60), handed to `FindingCard` as `extraActions`.

   LEARN AND TURN INTO EVAL CASE ARE INERT ON PURPOSE (AC-62, D8):
   `modules/reviews/findings.ts` accepts exactly `accept` and `dismiss` and
   refuses anything else with a 400, and the `memory` table is empty until a
   later lesson. They are wired to no handler at all — there is nothing to send.

   THEY SAY WHY, AND THEY ARE NOT `disabled` TO BE ABLE TO. A reader asked why
   the button would not press (2026-08-26); the behaviour was right and the
   silence was not. `disabled` makes that silence structural: the browser
   dispatches no mouse events over a disabled control, so a `title` on it is
   unreliable, and it is removed from the tab order, so a keyboard never reaches
   it to be told anything. `aria-disabled` keeps the button focusable and inert,
   which is the shape that can explain itself — hover OR focus reveals the line
   below, and `aria-describedby` hands the same sentence to a screen reader.
   Pressing still does nothing because nothing is bound to it.

   The explanation names what would UNLOCK them rather than saying
   "unavailable" — `SPEC-05 § N4` puts that mechanism in a later lesson, and the
   reader's real question was whether this is broken or deliberate.

   REPLY TO AUTHOR IS THE ONE OUTBOUND UNTRUSTED FLOW OF THIS FEATURE. The body
   is text a model wrote after reading an untrusted diff, and pressing Send puts
   it on GitHub under the reader's name. So it is shown editable and published
   only on an explicit confirmation (AC-101, AC-104): the editing IS the
   sanitisation, and `SPEC-05 § Untrusted inputs` puts it deliberately on the
   person rather than on a filter. Nothing here renders the body as markup, and
   the comment is addressed to the finding's own file and START line (AC-102) —
   a line GitHub may well refuse, and that refusal is shown rather than
   swallowed by "fixing" the line (AC-107).

   THE TYPED TEXT SURVIVES A FAILURE (AC-106, AC-107). The draft is component
   state and the error path does not touch it; only the reader clears the field. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Textarea } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useCreatePrComment } from "@/lib/hooks/reviews";
import { s } from "../../styles";

export function FindingActions({
  finding,
  prId,
  prStatus,
  headMoved,
}: {
  finding: FindingRecord;
  prId: string;
  /** The PR's CURRENT status — `merged` / `closed` is a refusal to expect (AC-108). */
  prStatus: string | null;
  /** The multi-run's head is not the PR's head any more (AC-109). */
  headMoved: boolean;
}) {
  const t = useTranslations("runs");
  const tPr = useTranslations("prReview");
  /** One id per finding — the actions row is rendered once per card. */
  const hintId = React.useId();
  const [open, setOpen] = React.useState(false);
  /* A DRAFT, not a copy of server state: it is seeded from the rationale
     (AC-101) and is the reader's from the first keystroke. Deriving it during
     render would throw away every edit. */
  const [body, setBody] = React.useState(finding.rationale);
  const create = useCreatePrComment(prId);
  const posted = create.data;
  const willRefuse = prStatus === "merged" || prStatus === "closed";

  const send = () => {
    if (body.trim() === "") return;
    create.mutate({ path: finding.file, line: finding.start_line, body });
  };

  /* Hover and focus are one state on purpose: whichever way the reader arrives
     at either button, the same sentence appears. */
  const [explain, setExplain] = React.useState(false);
  const reveal = {
    style: s.inertWrap,
    onMouseEnter: () => setExplain(true),
    onMouseLeave: () => setExplain(false),
    // React's onFocus/onBlur bubble, so the wrapper hears the button inside it.
    onFocus: () => setExplain(true),
    onBlur: () => setExplain(false),
  };
  const inert = {
    kind: "ghost" as const,
    size: "sm" as const,
    type: "button" as const,
    "aria-disabled": true,
    "aria-describedby": hintId,
    style: s.inertBtn,
  };

  return (
    <>
      <span {...reveal}>
        <Button {...inert} icon="Brain">
          {tPr("finding.learn")}
        </Button>
      </span>
      <span {...reveal}>
        <Button {...inert} icon="FlaskConical">
          {t("page.finding.turnIntoEvalCase")}
        </Button>
      </span>
      <Button
        kind="ghost"
        size="sm"
        icon="MessageSquare"
        active={open}
        onClick={() => setOpen((o) => !o)}
      >
        {tPr("finding.replyToAuthor")}
      </Button>

      {/* Always in the DOM and always the `aria-describedby` target, so a screen
          reader is told on focus whether or not the line below is on screen. */}
      <span id={hintId} style={s.srOnly}>
        {t("page.finding.inertHint")}
      </span>
      {/* The seen copy of it. `aria-hidden` so the sentence is not announced
          twice when both are present. */}
      {explain && (
        <span aria-hidden="true" style={s.inertHint}>
          {t("page.finding.inertHint")}
        </span>
      )}

      {open && (
        <div style={s.reply}>
          {willRefuse && (
            <div style={s.replyWarn}>
              <Icon.AlertTriangle size={13} style={s.warnIcon} />
              <span>{t("page.finding.replyWarnPrState", { status: prStatus ?? "" })}</span>
            </div>
          )}
          {headMoved && (
            <div style={s.replyWarn}>
              <Icon.AlertTriangle size={13} style={s.warnIcon} />
              <span>{t("page.finding.replyWarnLineShift")}</span>
            </div>
          )}

          <Textarea
            value={body}
            onChange={setBody}
            rows={5}
            placeholder={tPr("finding.replyPlaceholder")}
          />
          <div className="mono" style={s.replyTarget}>
            {finding.file}:{finding.start_line}
          </div>

          <div style={s.replyActions}>
            <Button
              kind="primary"
              size="sm"
              icon="MessageSquare"
              loading={create.isPending}
              disabled={body.trim() === ""}
              onClick={send}
            >
              {tPr("finding.sendReply")}
            </Button>
            <Button kind="ghost" size="sm" onClick={() => setOpen(false)}>
              {tPr("finding.cancel")}
            </Button>
          </div>

          {create.isError && (
            <div role="alert" style={s.replyError}>
              {create.error instanceof ApiError ? create.error.message : ""}
            </div>
          )}
          {posted && (
            <div style={s.replyOk}>
              <span>{t("page.finding.replyPosted")}</span>{" "}
              <a href={posted.html_url} target="_blank" rel="noreferrer" style={s.replyLink}>
                {t("page.finding.replyViewComment")}
              </a>
            </div>
          )}
        </div>
      )}
    </>
  );
}
