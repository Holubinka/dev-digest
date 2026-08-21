/* CommandRow — one command a reader is meant to paste into a shell.

   THE COMMAND CARRIES NO COMMENT. We tried allowing a `#` explanation inside
   the string and reverted it: `#` is not a comment character in an interactive
   zsh, so a pasted line carrying one runs as arguments. The explanation is the
   contract's own `why` field, and it is drawn OUTSIDE the `<code>`, in the
   interface font — because the copy control sits right there, and anything
   that reads as part of the command will be pasted as part of it.

   The copy control hands over `command`, byte for byte (AC-20): not the
   command plus its reason, not a re-joined or truncated version, and not a
   line with a comment welded on.

   Nothing here executes anything. There is no run control on this page at all
   (AC-22) — DevDigest shows what the repository's own manifests say and stops
   there. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CopyButton } from "../CopyButton";
import { s } from "./styles";

export function CommandRow({
  command,
  why,
  sourcePath,
  index,
}: {
  command: string;
  /** The contract's `why`. Absent on a package's install command, which has none. */
  why?: string;
  /** `OnboardingSetupCommand.source_path` — the file that authorised the command. */
  sourcePath?: string;
  /** Step number, in the flat single-package list the mockup draws. */
  index?: number;
}) {
  const t = useTranslations("onboarding");
  const hasMeta = (why != null && why !== "") || (sourcePath != null && sourcePath !== "");

  return (
    <div style={s.row}>
      <div style={s.top}>
        {index != null && (
          <span className="mono" style={s.index}>
            {index}
          </span>
        )}
        <code className="mono" style={s.command}>
          {command}
        </code>
        <CopyButton text={command} label={t("copyCommand", { command })} />
      </div>
      {hasMeta && (
        <div style={s.meta}>
          {why != null && why !== "" && <span style={s.why}>{why}</span>}
          {sourcePath != null && sourcePath !== "" && (
            <span style={s.source}>{t("sourceFile", { path: sourcePath })}</span>
          )}
        </div>
      )}
    </div>
  );
}
