/* Turning a verified path inside model prose into a link, and nothing else
   into one.

   NOTHING HERE IS MATCHED BY PATTERN. The only strings that become links are
   exact members of the section's `verified_paths` — the list the server built
   by proving each string names a file in the clone at the index sha. A regex
   over prose would link an invented path, which is the one thing AC-39 exists
   to prevent, and deciding a string "looks like a path" IS verification: it
   happens on the server or it does not happen.

   The transformation is on the markdown SOURCE rather than on the rendered
   tree, because `react-markdown` exposes no text-node seam a caller can reach
   without owning the `p`/`li` renderers — which would mean a second copy of
   `DocumentReader`, exactly what AC-68 forbids. What it does mean is that the
   scanner has to leave alone every region where a markdown link would not be a
   markdown link: fenced blocks, indented blocks, inline code that is not
   itself a path, links and images that already exist, and autolinks.

   A COMMAND ON SCREEN IS A COMMAND SOMEBODY RUNS. Every miss in that list ends
   the same way — `](` welded into the middle of a line beside a copy control —
   so the regions are found by walking the text rather than by one alternation
   that has to be right about all of them at once. Blocks first, inline second:
   a fence is a block, and an inline scanner that meets its opener before the
   block scanner does will close a stray backtick on it. */

/** Characters that make up a path. A match flanked by one of these is a longer
 *  token that merely starts or ends with the path, and is left alone. */
const PATH_CHAR = /[A-Za-z0-9_./@+*-]/;

/** A fence opener: three or more backticks or tildes, indented at most three. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** The indent that makes a line a code block of its own. */
const INDENT = /^(?: {4}|\t)/;
const BLANK = /^[ \t]*$/;

/** A markdown link or image the model wrote, whole. */
const INLINE_LINK = /!?\[[^\]]*\]\([^)]*\)/y;
/** An autolink, or anything else in angle brackets that carries no space. */
const AUTOLINK = /<[^>\s]+>/y;

type Region = "text" | "code-span" | "opaque";

interface Segment {
  kind: Region;
  text: string;
}

/** `body` as lines that still carry their terminator, so `join("")` restores
 *  the input byte for byte however it ends. */
function toLines(body: string): string[] {
  return body.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

const withoutTerminator = (line: string): string => line.replace(/\r?\n$/, "");

/**
 * The block-level split: fenced blocks and indented blocks as opaque regions,
 * everything else as text for the inline pass.
 *
 * AN UNCLOSED FENCE PROTECTS TO THE END OF THE INPUT. That is what the renderer
 * does with one, and it is not a rare shape here: the server cuts `body` at
 * `MAX_BODY_CHARS` and computes `verified_paths` off the CUT text, so a cut
 * landing inside a fence produces exactly this and hands us the paths to link
 * in it.
 */
function blockRegions(body: string): Segment[] {
  const lines = toLines(body);
  /** The line's content without its terminator, `""` past the end. */
  const at = (k: number): string => withoutTerminator(lines[k] ?? "");
  const out: Segment[] = [];
  let plain: string[] = [];

  const flush = () => {
    if (plain.length > 0) {
      out.push({ kind: "text", text: plain.join("") });
      plain = [];
    }
  };

  let i = 0;
  // The start of the input opens a block the way a blank line does.
  let afterBlank = true;

  while (i < lines.length) {
    const line = at(i);
    const marker = FENCE.exec(line)?.[1];

    if (marker !== undefined) {
      const closer = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`);
      let end = i + 1;
      while (end < lines.length && !closer.test(at(end))) end += 1;
      if (end < lines.length) end += 1;
      flush();
      out.push({ kind: "opaque", text: lines.slice(i, end).join("") });
      i = end;
      afterBlank = false;
      continue;
    }

    if (afterBlank && !BLANK.test(line) && INDENT.test(line)) {
      // The run holds the blank lines between its indented lines but ends on
      // the last indented one — a trailing blank belongs to the prose after it.
      let end = i;
      let last = i;
      while (end < lines.length) {
        const next = at(end);
        if (BLANK.test(next)) {
          end += 1;
          continue;
        }
        if (!INDENT.test(next)) break;
        last = end;
        end += 1;
      }
      flush();
      out.push({ kind: "opaque", text: lines.slice(i, last + 1).join("") });
      i = last + 1;
      afterBlank = false;
      continue;
    }

    plain.push(lines[i] ?? "");
    afterBlank = BLANK.test(line);
    i += 1;
  }

  flush();
  return out;
}

/**
 * The offset of the next backtick run of EXACTLY `n`, or `-1`.
 *
 * Exactly, because that is the rule the renderer closes a code span by. Taking
 * the next run of ANY length lets a stray backtick swallow the opening fence of
 * the block below it, and the block's body then arrives here as prose.
 */
function closingRun(text: string, from: number, n: number): number {
  let i = from;
  while (i < text.length) {
    if (text[i] !== "`") {
      i += 1;
      continue;
    }
    let m = 1;
    while (text[i + m] === "`") m += 1;
    if (m === n) return i;
    i += m;
  }
  return -1;
}

/** The inline split of one block of prose: code spans, links, images and
 *  autolinks carved out of the text around them. */
function inlineRegions(text: string): Segment[] {
  const out: Segment[] = [];
  let plainFrom = 0;
  let i = 0;

  const take = (kind: Region, end: number) => {
    if (i > plainFrom) out.push({ kind: "text", text: text.slice(plainFrom, i) });
    out.push({ kind, text: text.slice(i, end) });
    i = end;
    plainFrom = end;
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === "`") {
      let n = 1;
      while (text[i + n] === "`") n += 1;
      const close = closingRun(text, i + n, n);
      if (close === -1) {
        // A run that never closes is a literal backtick, and it takes nothing
        // with it.
        i += n;
        continue;
      }
      take("code-span", close + n);
      continue;
    }

    if (ch === "[" || ch === "!") {
      INLINE_LINK.lastIndex = i;
      const match = INLINE_LINK.exec(text);
      if (match !== null) {
        take("opaque", i + match[0].length);
        continue;
      }
    }

    if (ch === "<") {
      AUTOLINK.lastIndex = i;
      const match = AUTOLINK.exec(text);
      if (match !== null) {
        take("opaque", i + match[0].length);
        continue;
      }
    }

    i += 1;
  }

  if (text.length > plainFrom) out.push({ kind: "text", text: text.slice(plainFrom) });
  return out;
}

/**
 * A path safe to spell inside `[text](href)`. A `]`, `)`, backtick, angle
 * bracket or whitespace would end the construct early and turn the rest of the
 * line into something the model did not write. Refusing leaves the path as
 * plain text, which is the safe direction.
 */
function isInlinable(path: string): boolean {
  return path.length > 0 && !/[[\]()`<>\s\\]/.test(path);
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function linkifyText(text: string, paths: readonly string[]): string {
  let out = text;
  for (const path of paths) {
    const re = new RegExp(escapeForRegExp(path), "g");
    out = out.replace(re, (match, offset: number, whole: string) => {
      const before = offset > 0 ? whole[offset - 1] : "";
      const after = whole[offset + match.length] ?? "";
      if (before && PATH_CHAR.test(before)) return match;
      if (after && PATH_CHAR.test(after)) return match;
      return `[${match}](${match})`;
    });
  }
  return out;
}

/**
 * `body`, with every exact occurrence of a linkable verified path turned into
 * a markdown link whose href is the path itself. `DocumentReader`'s
 * `resolvePath` is what turns that repo-relative href into a URL — or refuses
 * it, leaving the text plain.
 *
 * `paths` has already been filtered by the caller to those that resolve; a
 * path the URL rules refuse never reaches here, so this never produces a link
 * that then renders as plain text with link punctuation left in it.
 */
export function linkifyVerifiedPaths(body: string, paths: readonly string[]): string {
  const usable = paths.filter(isInlinable).sort((a, b) => b.length - a.length);
  if (usable.length === 0) return body;

  return blockRegions(body)
    .flatMap((block) => (block.kind === "text" ? inlineRegions(block.text) : [block]))
    .map((segment) => {
      if (segment.kind === "text") return linkifyText(segment.text, usable);
      if (segment.kind === "code-span") {
        const inner = segment.text.replace(/^`+/, "").replace(/`+$/, "").trim();
        // A code span holding exactly one verified path is the form the mockup
        // draws: mono text, coloured as a link. The span is kept whole and
        // wrapped, so what the reader sees is unchanged.
        if (usable.includes(inner)) return `[${segment.text}](${inner})`;
      }
      return segment.text;
    })
    .join("");
}
