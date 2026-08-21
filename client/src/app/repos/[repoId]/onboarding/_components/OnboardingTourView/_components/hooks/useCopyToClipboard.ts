/* useCopyToClipboard — the copy half of every control on this page that puts
   something on the clipboard: a command in How to run locally, and the page
   link in the header.

   `navigator.clipboard` is undefined outside a secure context and absent in
   jsdom altogether, and optional chaining short-circuits the WHOLE chain after
   `?.` — so a copy that cannot happen leaves the flag alone rather than
   claiming success with a tick (`ConventionCard.tsx:41-52`). */
"use client";

import React from "react";

/** How long a control shows its confirmation before returning to its icon. */
export const COPIED_FEEDBACK_MS = 1500;

export function useCopyToClipboard() {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
      },
      () => {},
    );
  };

  return { copied, copy };
}
