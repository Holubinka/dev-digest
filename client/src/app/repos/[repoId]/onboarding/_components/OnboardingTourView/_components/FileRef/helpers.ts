/* The one rule that turns a path written into a tour into a control.

   Four callers — Critical paths' `Open`, the reading path, a first task, and a
   verified path inside prose — and ONE definition, because each of them is
   answering the same question and a second copy would drift on the first
   change (`client/INSIGHTS.md:697-709`).

   All three tests must hold:

    1. `indexSha` is a NON-EMPTY string. Slice B publishes `''` for "there is no
       index at all", so a `!= null` check passes on a value that names no
       commit and would build `…/blob//src/server.ts`.
    2. `repoFullName` is known. It arrives with the active repository and is
       null until that query resolves.
    3. `isLinkablePath(path)` — imported, never restated. Membership in the
       tour is NOT this question: the server proved the string names a file
       that exists (AC-37); this asks whether it is safe inside a URL. Both
       have to hold.

   THE SHA IS THE TOUR'S OWN `index_state.last_indexed_sha`, never the
   repository head. The path was verified against the clone at that state, and
   a link built at another commit can open a file whose contents make the row a
   lie — `BlastRadiusCard.tsx:97-102` makes the same decision for the same
   reason, and the root `INSIGHTS.md:418-432` is what getting it wrong looked
   like: the link opened, the file existed, the line existed, and it was a
   comment. */
import { githubBlobUrl, isLinkablePath } from "@/lib/github-urls";

export function fileHref(
  path: string,
  repoFullName: string | null | undefined,
  indexSha: string | null | undefined,
): string | undefined {
  if (!indexSha) return undefined;
  if (!repoFullName) return undefined;
  if (!isLinkablePath(path)) return undefined;
  return githubBlobUrl(repoFullName, indexSha, path);
}
