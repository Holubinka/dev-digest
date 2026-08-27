/**
 * A YAML sanity scan for a hand-edited workflow (AC-55).
 *
 * It sits beside `workflow.ts`, whose output it validates, rather than beside
 * the row-to-DTO mapping in `helpers.ts` where it was written. Deliberately not
 * a YAML parser: the question is only "would GitHub refuse this file", and the
 * answer has to name the offending LINE to whoever edited it.
 */

export interface YamlProblem {
  /** 1-based, so it can be named to the person who edited the file. */
  line: number;
  message: string;
}

interface LineScan {
  /** Index of the `: ` (or trailing `:`) that separates a key from its value. */
  sepIndex: number | null;
  /** The line ended inside a quoted scalar. */
  unterminatedQuote: boolean;
  /** Content with any trailing comment removed. */
  content: string;
}

/**
 * Scan one line for its mapping separator and its quote balance in one pass.
 *
 * A plain YAML scalar may not contain `": "`, which is exactly why the first one
 * outside quotes is the separator.
 */
function scanLine(body: string): LineScan {
  let quote: "'" | '"' | null = null;
  let sepIndex: number | null = null;
  let end = body.length;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quote === "'") {
      if (c === "'") {
        if (body[i + 1] === "'") i += 1;
        else quote = null;
      }
      continue;
    }
    if (quote === '"') {
      if (c === '\\') i += 1;
      else if (c === '"') quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === '#' && (i === 0 || body[i - 1] === ' ')) {
      end = i;
      break;
    }
    if (c === ':' && sepIndex === null && (i + 1 === body.length || body[i + 1] === ' ')) {
      sepIndex = i;
    }
  }
  return { sepIndex, unterminatedQuote: quote !== null, content: body.slice(0, end).trimEnd() };
}

/** A `|`, `>`, `|-`, `|2-`… header: everything below it is opaque text. */
const BLOCK_SCALAR = /^[|>][+-]?[0-9]?[+-]?$/;

/**
 * Refuse a workflow that is not YAML, naming the line (AC-55).
 *
 * Deliberately a scanner and not a parser, the way `modules/skills/helpers.ts`
 * reads frontmatter: the repository carries no YAML dependency, and the four
 * things below are what a hand edit actually breaks — a tab in the indentation,
 * an indent that lines up with no open block, an unterminated quote, and a line
 * that is neither a comment, a sequence item nor a `key: value` pair. It is
 * biased towards accepting: everything it flags is invalid YAML, and a
 * construct it does not model is passed rather than refused, because refusing a
 * VALID workflow blocks an install that should have gone through.
 *
 * Returns the first problem, or null when nothing is wrong with it.
 */
export function findYamlProblem(text: string): YamlProblem | null {
  // EMPTY IS THE FIRST CHECK, not a case the scan below happens to cover: the
  // scan skips blank lines, so `''` and `'   \n'` walked out of here as null and
  // a zero-byte workflow was committed. An empty document is legal YAML and is
  // not a legal workflow — GitHub refuses to run one — and this function is the
  // WORKFLOW gate, not a general parser. Line 1 is where a reader looks for it.
  if (text.trim() === '') return { line: 1, message: 'the file is empty' };

  const lines = text.split(/\r?\n/);
  const indents: number[] = [0];
  let blockScalarMinIndent: number | null = null;
  let sawMapping = false;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    if (raw.trim() === '') continue;
    const lead = /^[ \t]*/.exec(raw)?.[0] ?? '';
    const indent = lead.length;

    if (blockScalarMinIndent !== null) {
      if (indent >= blockScalarMinIndent) continue;
      blockScalarMinIndent = null;
    }

    if (lead.includes('\t')) {
      return { line: i + 1, message: 'a tab is used for indentation, which YAML forbids' };
    }

    let body = raw.slice(indent);
    if (body.startsWith('#')) continue;
    if (body === '---' || body === '...') {
      indents.length = 1;
      continue;
    }

    if (indent > (indents[indents.length - 1] ?? 0)) {
      indents.push(indent);
    } else {
      while (indents.length > 1 && (indents[indents.length - 1] ?? 0) > indent) indents.pop();
      if ((indents[indents.length - 1] ?? 0) !== indent) {
        return { line: i + 1, message: 'the indentation lines up with no open block' };
      }
    }

    // A sequence item opens a node of its own; what follows it is scanned as
    // content at a deeper level, which the indent stack does not need to model.
    let offset = 0;
    while (body === '-' || body.startsWith('- ')) {
      const skipped = body === '-' ? 1 : 2;
      offset += skipped;
      body = body.slice(skipped);
      const trimmed = body.trimStart();
      offset += body.length - trimmed.length;
      body = trimmed;
    }
    if (body === '') continue;

    const scan = scanLine(body);
    if (scan.unterminatedQuote) {
      return { line: i + 1, message: 'a quoted string is never closed' };
    }
    if (scan.sepIndex === null) {
      // `offset > 0` means a `- ` was stripped above, so this is a SEQUENCE
      // ITEM, and a plain scalar is what a sequence item usually is —
      // `types:\n  - opened` is the block form of the workflow's own trigger
      // list. Only a bare scalar sitting among mappings is the broken shape
      // this looks for; flagging a sequence entry refuses valid YAML, which
      // this scanner exists not to do.
      if (sawMapping && offset === 0) {
        return { line: i + 1, message: 'expected a "key: value" pair' };
      }
      continue;
    }
    sawMapping = true;
    if (scan.sepIndex === 0) {
      return { line: i + 1, message: 'the mapping key is empty' };
    }
    const value = scan.content.slice(scan.sepIndex + 1).trim();
    if (BLOCK_SCALAR.test(value)) blockScalarMinIndent = indent + offset + 1;
  }
  return null;
}
