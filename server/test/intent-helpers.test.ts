import { describe, it, expect } from 'vitest';
import type { IntentEvidenceSource } from '@devdigest/shared';
import {
  bandConfidence,
  collectEvidence,
  parsePlanRefs,
  renderClassifierInput,
  sanitizeRepoPath,
  truncateCodePoints,
} from '../src/modules/intent/helpers.js';
import {
  MAX_ISSUE_BODY_CHARS,
  MAX_ISSUE_TITLE_CHARS,
  MAX_PR_BODY_CHARS,
} from '../src/modules/intent/constants.js';
import type { IntentSources } from '../src/modules/intent/types.js';

/**
 * The pure core of intent derivation: no database, no clone, no network. The
 * path gate below is the plan's one HIGH-confidence security finding, and it
 * lives in a pure function precisely so its test needs no filesystem.
 */

const REPO = { owner: 'acme', name: 'payments-api' };

const sources = (over: Partial<IntentSources> = {}): IntentSources => ({
  title: 'Add rate limiting',
  body: null,
  linkedIssue: null,
  planFiles: [],
  commitMessages: [],
  filePaths: [],
  ...over,
});

const ISSUE = { number: 471, title: 'Public API is unmetered', body: 'Anyone can flood it.', state: 'open' };

/** Every `<untrusted source="X">` label in render order. */
const labels = (text: string): string[] =>
  [...text.matchAll(/<untrusted source="([^"]+)">/g)].map((m) => m[1]!);

/** The content of one `<untrusted source="X">` block, fence excluded. */
const block = (text: string, label: string): string =>
  new RegExp(`<untrusted source="${label}">\\n([\\s\\S]*?)\\n</untrusted>`).exec(text)?.[1] ?? '';

/** Two UTF-16 units each, so a `String.slice` cap would leave a `�` behind. */
const astral = (count: number): string => '🧪'.repeat(count);

describe('sanitizeRepoPath — the traversal gate in front of GitClient.readFile', () => {
  it.each([
    ['classic traversal', '../../../etc/passwd'],
    ['traversal after a real prefix', 'specs/../../etc/passwd'],
    ['absolute posix path', '/etc/passwd'],
    ['windows drive letter', 'C:\\Windows\\win.ini'],
    ['backslash traversal', '..\\..\\x.md'],
    ['the git directory', '.git/config'],
    ['an embedded NUL', 'specs/plan\u0000.md'],
    ['an over-long path', `${'a'.repeat(300)}.md`],
    ['a non-markdown file', 'notes.txt'],
    ['an empty string', ''],
    ['a UNC path', '\\\\server\\share\\x.md'],
  ])('rejects %s', (_label, raw) => {
    expect(sanitizeRepoPath(raw)).toBeNull();
  });

  it.each([
    ['a plain repo-relative path', 'specs/05-intent-layer.md', 'specs/05-intent-layer.md'],
    ['a leading ./', './docs/architecture.md', 'docs/architecture.md'],
    ['a doubled slash', 'docs//architecture.md', 'docs/architecture.md'],
    ['an uppercase extension', 'docs/README.MD', 'docs/README.MD'],
  ])('normalises and accepts %s', (_label, raw, expected) => {
    expect(sanitizeRepoPath(raw)).toBe(expected);
  });

  /**
   * The whole point of the function: whatever comes back, `join(cloneRoot, it)`
   * cannot leave the clone. Stated as an invariant rather than as more cases.
   */
  it('never returns a path containing a `..` segment', () => {
    const attempts = [
      '../x.md',
      'a/../../x.md',
      './../x.md',
      'a/..%2f../x.md',
      'a/b/../../../x.md',
      '..\\a.md',
    ];
    for (const raw of attempts) {
      const out = sanitizeRepoPath(raw);
      expect(out === null || !out.split('/').includes('..')).toBe(true);
    }
  });
});

describe('parsePlanRefs — which links become clone reads', () => {
  it('accepts a bare repo-relative path', () => {
    expect(parsePlanRefs('Implements specs/05-intent-layer.md today.', REPO)).toEqual([
      'specs/05-intent-layer.md',
    ]);
  });

  it('accepts a backticked path', () => {
    expect(parsePlanRefs('See `docs/architecture.md` first.', REPO)).toEqual([
      'docs/architecture.md',
    ]);
  });

  it('accepts a markdown link target', () => {
    expect(parsePlanRefs('[the plan](specs/05-intent-layer.md)', REPO)).toEqual([
      'specs/05-intent-layer.md',
    ]);
  });

  it('accepts a blob URL for THIS repo, discarding the ref', () => {
    const body = 'https://github.com/acme/payments-api/blob/main/specs/05-intent-layer.md';
    expect(parsePlanRefs(body, REPO)).toEqual(['specs/05-intent-layer.md']);
  });

  it('strips a #L12-L40 anchor and a ?plain=1 query from a blob URL', () => {
    const body =
      'https://github.com/ACME/Payments-API/blob/feat-x/docs/architecture.md?plain=1#L12-L40';
    expect(parsePlanRefs(body, REPO)).toEqual(['docs/architecture.md']);
  });

  it.each([
    ["another repo's blob URL", 'https://github.com/other/repo/blob/main/plan.md'],
    ['a gist', 'https://gist.github.com/someone/abc123/raw/plan.md'],
    ['a non-markdown file', 'See notes.txt and config.yaml.'],
    ['an external doc URL', 'https://example.com/specs/plan.md'],
    ['a Notion page', 'https://www.notion.so/team/Plan-2f8c19ab4d'],
    ['a traversal attempt', 'Read ../../../etc/passwd and ../../secrets.md'],
  ])('excludes %s', (_label, body) => {
    expect(parsePlanRefs(body, REPO)).toEqual([]);
  });

  it('returns [] for a body with no links at all', () => {
    expect(parsePlanRefs('Just a plain description with no references.', REPO)).toEqual([]);
  });

  it('caps the candidate list at three files', () => {
    const body = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'].map((p) => `docs/${p}`).join(' and ');
    expect(parsePlanRefs(body, REPO)).toEqual(['docs/a.md', 'docs/b.md', 'docs/c.md']);
  });

  it('de-duplicates a path referenced twice in different forms', () => {
    const body = 'See `specs/plan.md` — also [here](./specs/plan.md) and specs//plan.md.';
    expect(parsePlanRefs(body, REPO)).toEqual(['specs/plan.md']);
  });
});

describe('bandConfidence — total over all eight combinations', () => {
  const combos: [IntentEvidenceSource[], string][] = [
    [[], 'low'],
    [['body'], 'medium'],
    [['linked_issue'], 'medium'],
    [['plan_spec'], 'medium'],
    [['body', 'linked_issue'], 'medium'],
    [['body', 'plan_spec'], 'medium'],
    [['linked_issue', 'plan_spec'], 'medium'],
    [['body', 'linked_issue', 'plan_spec'], 'high'],
  ];

  it.each(combos)('%j → %s', (evidence, expected) => {
    expect(bandConfidence(evidence)).toBe(expected);
  });

  /**
   * `title` is always present and `commits_files` almost always is, so if
   * either could raise the band, every PR would score above `low` and the
   * signal would be worthless.
   */
  it.each(combos)('neither title nor commits_files changes %j', (evidence, expected) => {
    expect(bandConfidence([...evidence, 'title', 'commits_files'])).toBe(expected);
  });
});

describe('collectEvidence — which of the five sources were non-empty', () => {
  it('reports every present source', () => {
    expect(
      collectEvidence(
        sources({
          body: 'Rate-limit the public API.',
          linkedIssue: ISSUE,
          planFiles: [{ path: 'specs/plan.md', text: 'plan' }],
          commitMessages: ['Add limiter'],
          filePaths: ['src/config.ts'],
        }),
      ),
    ).toEqual(['title', 'body', 'linked_issue', 'plan_spec', 'commits_files']);
  });

  it('treats a whitespace-only body as absent', () => {
    expect(collectEvidence(sources({ body: '   \n  ' }))).toEqual(['title']);
    expect(bandConfidence(collectEvidence(sources({ body: '   \n  ' })))).toBe('low');
  });

  it('counts commits_files when only changed files exist', () => {
    expect(collectEvidence(sources({ filePaths: ['src/a.ts'] }))).toEqual([
      'title',
      'commits_files',
    ]);
  });
});

describe('renderClassifierInput — one wrapped block per present source', () => {
  it('labels every present source exactly once', () => {
    const text = renderClassifierInput(
      sources({
        body: 'Rate-limit the public API.',
        linkedIssue: ISSUE,
        planFiles: [
          { path: 'specs/a.md', text: 'first' },
          { path: 'specs/b.md', text: 'second' },
        ],
        commitMessages: ['Add limiter'],
        filePaths: ['src/config.ts'],
      }),
    );
    expect(labels(text)).toEqual([
      'pr-title',
      'pr-body',
      'linked-issue',
      'plan-spec',
      'commits-files',
    ]);
    // Two plan files, still ONE block — the block count tracks the evidence
    // list, not the file count.
    expect(text).toContain('### specs/a.md');
    expect(text).toContain('### specs/b.md');
  });

  it('contributes no block for an absent source', () => {
    const text = renderClassifierInput(sources());
    expect(labels(text)).toEqual(['pr-title']);
    expect(text).not.toContain('pr-body');
    expect(text).not.toContain('linked-issue');
    expect(text).not.toContain('plan-spec');
    expect(text).not.toContain('commits-files');
  });

  it('renders one block per source in the same set collectEvidence reports', () => {
    const s = sources({ body: 'why', filePaths: ['src/a.ts'] });
    expect(labels(renderClassifierInput(s))).toHaveLength(collectEvidence(s).length);
  });
});

/**
 * The PR body and the linked issue are attacker-controlled on a public repo and
 * they feed a paid call, so their length is ours to bound — not the model's
 * context window's. Every assertion counts CODE POINTS: `String.slice` would
 * split a surrogate pair and leave `�` (`server/INSIGHTS.md:103-114`).
 */
describe('renderClassifierInput — caps on attacker-controlled text', () => {
  it('caps the PR body at MAX_PR_BODY_CHARS code points, matching the reviewer', () => {
    const text = renderClassifierInput(sources({ body: astral(MAX_PR_BODY_CHARS + 500) }));
    const body = block(text, 'pr-body');
    expect([...body]).toHaveLength(MAX_PR_BODY_CHARS);
    expect(body).not.toContain('�');
  });

  it('caps the linked issue title at MAX_ISSUE_TITLE_CHARS code points', () => {
    const text = renderClassifierInput(
      sources({
        linkedIssue: { ...ISSUE, title: astral(MAX_ISSUE_TITLE_CHARS + 200), body: 'short' },
      }),
    );
    const [first = ''] = block(text, 'linked-issue').split('\n');
    const title = first.replace(`#${ISSUE.number} (${ISSUE.state}) `, '');
    expect([...title]).toHaveLength(MAX_ISSUE_TITLE_CHARS);
    expect(title).not.toContain('�');
  });

  it('caps the linked issue body at MAX_ISSUE_BODY_CHARS code points', () => {
    const text = renderClassifierInput(
      sources({
        linkedIssue: { ...ISSUE, title: 'short', body: astral(MAX_ISSUE_BODY_CHARS + 500) },
      }),
    );
    const issueBody = block(text, 'linked-issue').split('\n').slice(1).join('\n');
    expect([...issueBody]).toHaveLength(MAX_ISSUE_BODY_CHARS);
    expect(issueBody).not.toContain('�');
  });

  /**
   * The cap runs BEFORE `wrapUntrusted`. Truncating the wrapped string instead
   * would eventually cut the closing fence off, which hands the whole tail of
   * the prompt to attacker-controlled text.
   */
  it('leaves the fence intact on a body long enough to be truncated', () => {
    const text = renderClassifierInput(sources({ body: astral(MAX_PR_BODY_CHARS + 500) }));
    expect(text).toContain('<untrusted source="pr-body">');
    expect(text.split('</untrusted>')).toHaveLength(labels(text).length + 1);
  });

  it('leaves text under the cap untouched', () => {
    const text = renderClassifierInput(sources({ body: 'Rate-limit the public API.' }));
    expect(block(text, 'pr-body')).toBe('Rate-limit the public API.');
  });
});

describe('truncateCodePoints', () => {
  it('cuts on code points, not UTF-16 units', () => {
    // Each astral emoji is TWO UTF-16 units; String.slice(0, 3) would return
    // one and a half of them plus a replacement character.
    const text = '🧪'.repeat(10);
    expect([...truncateCodePoints(text, 3)]).toHaveLength(3);
    expect(truncateCodePoints(text, 3)).toBe('🧪🧪🧪');
  });

  it('leaves shorter text untouched', () => {
    expect(truncateCodePoints('short', 100)).toBe('short');
  });
});
