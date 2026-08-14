/* DocumentReader — one project-context document, rendered as markdown.

   THE renderer, singular: the Project Context page's reading pane, its `Preview`
   mode, and the preview inside both editors' Context tabs all go through this
   component. A second copy is what `AC-56` forbids, because the two halves below
   would then hold on one surface and not on another.

   The text comes from an imported repository, so it is untrusted, and this
   component is where that is dealt with. Two halves, and BOTH are load-bearing:

   1. Raw HTML stays escaped. `react-markdown` v9 escapes embedded HTML unless
      `rehype-raw` is added, and `rehype-raw` is deliberately NOT a dependency of
      this project. So `<img src=x onerror=alert(1)>` renders as text. Do not add
      that plugin, and do not open a `dangerouslySetInnerHTML` path to make a
      table or an alignment work: either one turns a document from a public repo
      into stored XSS.

   2. Link and image protocols are checked HERE, because the vendored `Markdown`
      primitive does not check them and `[click](javascript:alert(1))` would
      otherwise render as a working anchor. Doing it at the call site rather than
      inside `vendor/ui/primitives/Markdown.tsx` keeps the vendored file
      untouched, so a UI-kit update cannot silently overwrite this. */
"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isSafeUrl } from "./helpers";
import { s } from "./styles";

export function DocumentReader({ markdown }: { markdown: string }) {
  return (
    <div className="dd-md" style={s.wrap}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // A refused link renders as plain text rather than disappearing: the
          // reader still sees what the document said, it just cannot be clicked.
          a: ({ children, href }) =>
            isSafeUrl(href) ? (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow" style={s.link}>
                {children}
              </a>
            ) : (
              <span style={s.blockedLink}>{children}</span>
            ),
          img: ({ src, alt }) =>
            isSafeUrl(typeof src === "string" ? src : undefined) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src as string} alt={alt ?? ""} style={s.image} />
            ) : (
              <span style={s.blockedLink}>{alt ?? ""}</span>
            ),
          pre: ({ children }) => (
            <pre className="mono" style={s.pre}>
              {children}
            </pre>
          ),
          code: ({ children }) => (
            <code className="mono" style={s.code}>
              {children}
            </code>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
