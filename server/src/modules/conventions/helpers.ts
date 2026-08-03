import type { ConventionCandidate, ConventionEvidence } from '@devdigest/shared';
import type { ConventionRow, ConventionScanRow } from '../../db/rows.js';
import { MAX_EVIDENCE_CHARS, MAX_EVIDENCE_LINES, MIN_SNIPPET_MATCH_CHARS } from './constants.js';

/**
 * Grounding for extracted conventions — the code half of the feature.
 *
 * The model proposes; nothing here trusts it. A claim survives only if the
 * snippet it quotes can be found in the file it names, and what gets stored is
 * the text read out of the clone, not the text the model wrote. Everything in
 * this file is pure so the rules can be tested without a repo, a model or a DB.
 */

/** Collapse every whitespace run to one space. */
export function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Strip whitespace entirely — the currency for comparing code.
 *
 * Models re-indent and re-space what they quote (`a=1` for `a = 1`) far more
 * often than they change a token, so comparing on characters that carry meaning
 * finds the real quote and still refuses the invented one.
 */
export function compact(code: string): string {
  return code.replace(/\s+/g, '');
}

/**
 * A rule reduced to what makes it the same rule: lowercase, no punctuation,
 * single spaces. Used to recognise a rule a previous scan already surfaced.
 */
export function normaliseRule(rule: string): string {
  return normalise(rule)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .trim();
}

/**
 * True when a file line satisfies a quoted line. Equality is the common case;
 * `includes` covers the model quoting a fragment of a longer line, and is gated
 * on length so a fragment like `}` cannot match half the file.
 */
function lineMatches(fileLine: string, quoted: string): boolean {
  if (fileLine === quoted) return true;
  return quoted.length >= MIN_SNIPPET_MATCH_CHARS && fileLine.includes(quoted);
}

/**
 * Find a quoted snippet in a file and report the lines it actually occupies.
 *
 * This is the re-anchor: models cite the right code at the wrong line number
 * constantly, and discarding those would throw away good evidence over an
 * off-by-nine. Blank lines in the file are skipped so a quote that dropped one
 * still matches. Returns null when the snippet is not in the file at all —
 * that claim is fabricated and its candidate loses a piece of support.
 */
export function locateSnippet(
  content: string,
  snippet: string,
): { line: number; endLine: number } | null {
  const fileLines = content.split('\n').map(compact);
  const wanted = snippet
    .split('\n')
    .map(compact)
    .filter((l) => l.length > 0);
  if (wanted.length === 0) return null;

  for (let start = 0; start < fileLines.length; start++) {
    if (!lineMatches(fileLines[start]!, wanted[0]!)) continue;
    let cursor = start;
    let matched = 0;
    while (matched < wanted.length && cursor < fileLines.length) {
      if (fileLines[cursor] === '') {
        cursor++;
        continue;
      }
      if (!lineMatches(fileLines[cursor]!, wanted[matched]!)) break;
      cursor++;
      matched++;
    }
    if (matched === wanted.length) return { line: start + 1, endLine: cursor };
  }
  return null;
}

/** What the model claims: a file, roughly a line, and the code it read there. */
export interface EvidenceClaim {
  path: string;
  line?: number | null;
  snippet: string;
}

export type VerifiedEvidence = ConventionEvidence;

export interface VerificationTally {
  /** Claims whose file was never sampled — the model cited what it never saw. */
  unsampledFile: number;
  /** Claims whose snippet is nowhere in the file it named. */
  snippetNotFound: number;
  /** Claims found, but at a line other than the one claimed. */
  reanchored: number;
}

export function emptyTally(): VerificationTally {
  return { unsampledFile: 0, snippetNotFound: 0, reanchored: 0 };
}

/**
 * Verify one candidate's claims against the sampled files.
 *
 * The stored snippet is sliced out of the file, so what the UI shows and links
 * to on GitHub is the repository's own code — a paraphrase cannot survive this
 * step wearing the costume of a quote.
 */
export function verifyEvidence(
  claims: EvidenceClaim[],
  files: Map<string, string>,
  tally: VerificationTally,
): VerifiedEvidence[] {
  const verified: VerifiedEvidence[] = [];
  const seen = new Set<string>();

  for (const claim of claims) {
    const content = files.get(claim.path);
    if (content === undefined) {
      tally.unsampledFile++;
      continue;
    }
    const at = locateSnippet(content, claim.snippet);
    if (!at) {
      tally.snippetNotFound++;
      continue;
    }
    if (claim.line != null && claim.line !== at.line) tally.reanchored++;

    const endLine = Math.min(at.endLine, at.line + MAX_EVIDENCE_LINES - 1);
    const key = `${claim.path}:${at.line}`;
    if (seen.has(key)) continue;
    seen.add(key);

    verified.push({
      path: claim.path,
      line: at.line,
      end_line: endLine,
      snippet: content
        .split('\n')
        .slice(at.line - 1, endLine)
        .join('\n')
        .slice(0, MAX_EVIDENCE_CHARS),
    });
  }
  return verified;
}

// ---------------------------------------------------------------------------
// "A linter already does this"
// ---------------------------------------------------------------------------

/**
 * Topics a formatter, linter or the compiler already enforces, paired with what
 * a config looks like when it enforces them and how a rule talks about them.
 *
 * A rule the build already fails over is not worth a skill: the agent would
 * spend prompt budget re-deriving what CI says in a second. The pairing matters
 * — the topic is only filtered when the repo's own config actually turns it on,
 * so a project without Prettier keeps its quote-style convention.
 */
const ENFORCEABLE_TOPICS: { topic: string; inConfig: RegExp; inRule: RegExp }[] = [
  {
    topic: 'semicolons',
    inConfig: /"semi"\s*:|\bsemi\s*:|'semi'\s*:/,
    inRule: /\bsemi-?colons?\b/i,
  },
  {
    topic: 'quotes',
    inConfig: /"singleQuote"\s*:|\bsingleQuote\s*:|"quotes"\s*:/,
    inRule: /\b(single|double)\s+quotes?\b|\bquote style\b/i,
  },
  {
    topic: 'indentation',
    inConfig: /"tabWidth"\s*:|\btabWidth\s*:|"useTabs"\s*:|"indent"\s*:/,
    inRule: /\bindent(ation)?\b|\btabs? (vs\.?|or) spaces\b/i,
  },
  {
    topic: 'line-length',
    inConfig: /"printWidth"\s*:|\bprintWidth\s*:|"max-len"\s*:/,
    inRule: /\bline (length|width)\b|\bcharacters per line\b/i,
  },
  {
    topic: 'trailing-comma',
    inConfig: /"trailingComma"\s*:|\btrailingComma\s*:|"comma-dangle"\s*:/,
    inRule: /\btrailing comma/i,
  },
  {
    topic: 'unused-vars',
    inConfig: /"no-unused-vars"|"@typescript-eslint\/no-unused-vars"|"noUnusedLocals"\s*:\s*true/,
    inRule: /\bunused (variable|import|binding|parameter)/i,
  },
  {
    topic: 'implicit-any',
    inConfig: /"noImplicitAny"\s*:\s*true|"strict"\s*:\s*true/,
    // Explicit `any` is NOT what noImplicitAny bans, so "avoid any" stays a
    // convention. Only the implicit form is machine-enforced.
    inRule: /\bimplicit(ly)? any\b/i,
  },
  {
    topic: 'console',
    inConfig: /"no-console"/,
    inRule: /\bconsole\.(log|debug)\b/i,
  },
];

/** The topics this repo's own configs turn on. */
export function enforcedTopics(configs: Map<string, string>): Set<string> {
  const blob = [...configs.values()].join('\n');
  const on = new Set<string>();
  for (const { topic, inConfig } of ENFORCEABLE_TOPICS) {
    if (inConfig.test(blob)) on.add(topic);
  }
  return on;
}

/** True when the rule restates something `enforced` already guarantees. */
export function isMachineEnforced(rule: string, enforced: Set<string>): boolean {
  return ENFORCEABLE_TOPICS.some((t) => enforced.has(t.topic) && t.inRule.test(rule));
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export function toCandidateDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    repo_id: row.repoId,
    scan_id: row.scanId,
    category: row.category as ConventionCandidate['category'],
    rule: row.rule,
    evidence_path: row.evidencePath,
    evidence_snippet: row.evidenceSnippet,
    evidence_line: row.evidenceLine,
    evidence_end_line: row.evidenceEndLine,
    extra_evidence: row.extraEvidence ?? [],
    head_sha: row.headSha,
    confidence: row.confidence,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

export function toScanDto(row: ConventionScanRow) {
  return {
    id: row.id,
    repo_id: row.repoId,
    head_sha: row.headSha,
    model: row.model,
    sample_files: row.sampleFiles,
    candidates_returned: row.candidatesReturned,
    candidates_kept: row.candidatesKept,
    created_at: row.createdAt.toISOString(),
  };
}
