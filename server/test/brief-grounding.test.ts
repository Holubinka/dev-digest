/**
 * P2 step 4 — grounding. Everything the model returns is untrusted output, and
 * this is the filter that decides what a reviewer is allowed to see (R9, R10,
 * R12, R14).
 *
 * NEGATIVE CONTROL: deleting the membership filter in `groundBrief` must fail
 * this file. Verified by hand on 2026-08-16 — removing the `allowed.has(ref)`
 * test broke five of these cases.
 */
import { describe, it, expect } from 'vitest';
import type { Risk, RiskBrief } from '@devdigest/shared';
import { groundBrief } from '../src/modules/brief/helpers.js';
import {
  MAX_DROPPED_REFS,
  MAX_FILE_PATH_CHARS,
  MAX_LINE_CHARS,
  MAX_PROSE_CHARS,
  MAX_REVIEW_FOCUS,
  MAX_RISK_FILE_REFS,
  MAX_RISKS,
} from '../src/modules/brief/constants.js';

const ALLOWED = new Set([
  'server/src/modules/brief/service.ts',
  'server/src/modules/brief/routes.ts',
  'POST /pulls/:id/brief',
]);

function risk(over: Partial<Risk> = {}): Risk {
  return {
    kind: 'public API',
    title: 'A new paid route',
    explanation: 'The POST route spends money and is reachable by anyone in the workspace.',
    severity: 'medium',
    file_refs: ['server/src/modules/brief/routes.ts'],
    ...over,
  };
}

function brief(over: Partial<RiskBrief> = {}): RiskBrief {
  return {
    what: 'Adds a per-state risk brief.',
    why: 'Reviewers open a PR without knowing what changed.',
    risk_level: 'medium',
    risks: [risk()],
    review_focus: [
      { ref: 'server/src/modules/brief/routes.ts', kind: 'file', reason: 'the new paid route' },
    ],
    ...over,
  };
}

describe('groundBrief — only what the input can vouch for', () => {
  it('removes a file_ref outside the set and lists it in dropped_refs (R14)', () => {
    const out = groundBrief(
      brief({
        risks: [
          risk({
            file_refs: ['server/src/modules/brief/service.ts', 'server/src/does/not/exist.ts'],
          }),
        ],
      }),
      ALLOWED,
    );
    expect(out.risks[0]!.file_refs).toEqual(['server/src/modules/brief/service.ts']);
    expect(out.dropped_refs).toEqual(['server/src/does/not/exist.ts']);
    expect(out.dropped_risks).toBe(0);
  });

  it('drops a risk left with no reference, and counts it (R10)', () => {
    const out = groundBrief(
      brief({ risks: [risk({ file_refs: ['invented/a.ts', 'invented/b.ts'] })] }),
      ALLOWED,
    );
    expect(out.risks).toEqual([]);
    expect(out.dropped_risks).toBe(1);
    expect(out.dropped_refs.sort()).toEqual(['invented/a.ts', 'invented/b.ts']);
  });

  /**
   * A risk that ARRIVED with no reference is the same observable end state as one
   * grounding emptied — a claim with nothing behind it — so it gets the same
   * answer (R9). The spec does not name this case; the plan resolves it here.
   */
  it('drops a risk that arrived with no reference at all, and counts it (R9)', () => {
    const out = groundBrief(brief({ risks: [risk({ file_refs: [] })] }), ALLOWED);
    expect(out.risks).toEqual([]);
    expect(out.dropped_risks).toBe(1);
    expect(out.dropped_refs).toEqual([]);
  });

  it('filters review_focus by the same set, files and endpoint labels alike', () => {
    const out = groundBrief(
      brief({
        review_focus: [
          { ref: 'POST /pulls/:id/brief', kind: 'endpoint', reason: 'the spend' },
          { ref: 'GET /invented', kind: 'endpoint', reason: 'not in the input' },
          { ref: 'server/src/modules/brief/service.ts', kind: 'file', reason: 'the budget walk' },
          { ref: 'src/never/printed.ts', kind: 'file', reason: 'not in the input' },
        ],
      }),
      ALLOWED,
    );
    expect(out.review_focus.map((item) => item.ref)).toEqual([
      'POST /pulls/:id/brief',
      'server/src/modules/brief/service.ts',
    ]);
    expect(out.dropped_refs).toContain('GET /invented');
    expect(out.dropped_refs).toContain('src/never/printed.ts');
  });

  /**
   * Levels descend; inside a level the model's own order survives. The sort is
   * over a fixed rank map on a stable `Array.prototype.sort`, so "the model put
   * the DB risk before the API risk" is information the card keeps.
   */
  it('orders high → medium → low and preserves the model order inside a level (R12)', () => {
    const out = groundBrief(
      brief({
        risks: [
          risk({ title: 'low-1', severity: 'low' }),
          risk({ title: 'medium-1', severity: 'medium' }),
          risk({ title: 'high-1', severity: 'high' }),
          risk({ title: 'medium-2', severity: 'medium' }),
          risk({ title: 'high-2', severity: 'high' }),
          risk({ title: 'low-2', severity: 'low' }),
        ],
      }),
      ALLOWED,
    );
    expect(out.risks.map((r) => r.title)).toEqual([
      'high-1',
      'high-2',
      'medium-1',
      'medium-2',
      'low-1',
      'low-2',
    ]);
  });

  it('de-duplicates dropped_refs across risks and focus items', () => {
    const out = groundBrief(
      brief({
        risks: [risk({ file_refs: ['ghost.ts'] }), risk({ file_refs: ['ghost.ts'] })],
        review_focus: [{ ref: 'ghost.ts', kind: 'file', reason: 'also invented' }],
      }),
      ALLOWED,
    );
    expect(out.dropped_refs).toEqual(['ghost.ts']);
    expect(out.dropped_risks).toBe(2);
  });

  it('an empty allowed set drops everything and keeps nothing', () => {
    const out = groundBrief(brief(), new Set());
    expect(out.risks).toEqual([]);
    expect(out.review_focus).toEqual([]);
    expect(out.dropped_risks).toBe(1);
  });
});

/**
 * P2 step 3 — the model writes `src/x.ts:12` because that is how a file:line
 * reads everywhere else, and the whole reference used to be dropped as ungrounded
 * over a tail nothing was looking for (R13, R17).
 *
 * Three separate decisions, one per case below: the suffix is cut BEFORE the
 * membership test, the cut form is what is STORED, and the original is what
 * `dropped_refs` reports. The number itself is discarded at the cut — the numbers
 * that reach a reader come off the blast answer through `buildRefLines`, which
 * never sees this function's input (AC-57).
 *
 * NEGATIVE CONTROLS, run on 2026-08-16. Make `stripLineSuffix` the identity and
 * the first four cases fail here, plus the one in `brief-allowed-refs.test.ts`.
 * Drop the `$` from its regex and exactly one case fails: the colon-and-digits
 * INSIDE a path. Not the endpoint label — `:id` carries no digits, so a label
 * survives an unanchored cut too, and a suite that pinned only the label would
 * have called the anchor tested while it was not.
 */
describe('groundBrief — a line suffix is cut before membership, and discarded', () => {
  const ROUTES = 'server/src/modules/brief/routes.ts';

  it('admits src/x.ts:12 because src/x.ts is a member, and stores the path alone', () => {
    const out = groundBrief(brief({ risks: [risk({ file_refs: [`${ROUTES}:12`] })] }), ALLOWED);
    expect(out.risks[0]!.file_refs).toEqual([ROUTES]);
    expect(out.dropped_refs).toEqual([]);
  });

  it('cuts a RANGE suffix the same way', () => {
    const out = groundBrief(brief({ risks: [risk({ file_refs: [`${ROUTES}:12-18`] })] }), ALLOWED);
    expect(out.risks[0]!.file_refs).toEqual([ROUTES]);
  });

  it('cuts it on a review-focus ref too', () => {
    const out = groundBrief(
      brief({ review_focus: [{ ref: `${ROUTES}:52`, kind: 'file', reason: 'the 429 branch' }] }),
      ALLOWED,
    );
    expect(out.review_focus[0]!.ref).toBe(ROUTES);
  });

  /**
   * `a.ts` and `a.ts:3` are one file and get one row and one control. The
   * de-duplication has to happen AFTER the cut or the card draws the same place
   * twice under two spellings.
   */
  it('de-duplicates after the cut: a.ts and a.ts:3 are one reference and one focus row', () => {
    const out = groundBrief(
      brief({
        risks: [risk({ file_refs: [ROUTES, `${ROUTES}:3`, `${ROUTES}:10-20`] })],
        review_focus: [
          { ref: `${ROUTES}:3`, kind: 'file', reason: 'the first reason' },
          { ref: ROUTES, kind: 'file', reason: 'a repeat' },
        ],
      }),
      ALLOWED,
    );
    expect(out.risks[0]!.file_refs).toEqual([ROUTES]);
    expect(out.review_focus).toHaveLength(1);
    expect(out.review_focus[0]!.reason).toBe('the first reason');
  });

  /**
   * The security half. The cut may only ever REMOVE a claim: the result is tested
   * against the same set, so a suffix cannot turn a name the prompt never printed
   * into a member.
   */
  it('the cut cannot manufacture a member — evil.ts:1 is still dropped', () => {
    const out = groundBrief(brief({ risks: [risk({ file_refs: ['evil.ts:1'] })] }), ALLOWED);
    expect(out.risks).toEqual([]);
    expect(out.dropped_risks).toBe(1);
  });

  /**
   * The other half of "anchored at the end", and the one with teeth. An
   * unanchored cut would rewrite `…/brief:1/routes.ts` into `…/brief/routes.ts`
   * — a member — and grounding would then stamp a path the prompt never printed
   * as vouched for. The cut may only ever remove a claim.
   */
  it('a colon-and-digits INSIDE a path is not a suffix, and cannot be cut into a member', () => {
    const out = groundBrief(
      brief({ risks: [risk({ file_refs: ['server/src/modules/brief:1/routes.ts'] })] }),
      ALLOWED,
    );
    expect(out.risks).toEqual([]);
    expect(out.dropped_refs).toEqual(['server/src/modules/brief:1/routes.ts']);
  });

  /** Applied once, at the end: `x.ts:12:34` is tested as `x.ts:12`, which is nobody's member. */
  it('is applied once and anchored at the end, so x.ts:12:34 does not become x.ts', () => {
    const out = groundBrief(brief({ risks: [risk({ file_refs: [`${ROUTES}:12:34`] })] }), ALLOWED);
    expect(out.risks).toEqual([]);
    expect(out.dropped_refs).toEqual([`${ROUTES}:12:34`]);
  });

  /** A colon that is not a line suffix is not a line suffix. Endpoint labels are full of them. */
  it('leaves an endpoint label alone', () => {
    const out = groundBrief(
      brief({
        review_focus: [{ ref: 'POST /pulls/:id/brief', kind: 'endpoint', reason: 'the spend' }],
      }),
      ALLOWED,
    );
    expect(out.review_focus[0]!.ref).toBe('POST /pulls/:id/brief');
  });

  /**
   * `dropped_refs` is evidence of what the MODEL said, not of what we made of it.
   * Recording the stripped form would quietly rewrite the disclosure.
   */
  it('a dropped ref keeps the string the model wrote, suffix and all', () => {
    const out = groundBrief(
      brief({
        risks: [risk({ file_refs: ['src/invented.ts:41-52'] })],
        review_focus: [{ ref: 'src/also/invented.ts:7', kind: 'file', reason: 'nope' }],
      }),
      ALLOWED,
    );
    expect(out.dropped_refs.sort()).toEqual(['src/also/invented.ts:7', 'src/invented.ts:41-52']);
  });
});

/**
 * Membership is not a bound. Everything below is a grounded answer — every name
 * is one the model was shown — that is still too big to write, because a filter
 * on names says nothing about counts, repetition or prose length. The upstream
 * is attacker-controlled and all of it lands in jsonb and on every GET.
 *
 * NEGATIVE CONTROL: remove any one `slice`, the `file_refs` Set or any one
 * `truncateCodePoints` in `groundBrief` and the matching case here fails.
 * Verified by hand on 2026-08-16, and again the same day for the five strings a
 * cap on a COUNT never bounded — `kind`, `title`, `explanation`, `reason` and each
 * element of `dropped_refs`.
 */
describe('groundBrief — and only as much of it as a record may carry', () => {
  const manyPaths = (n: number) => Array.from({ length: n }, (_, i) => `src/f${i}.ts`);

  it(`keeps at most MAX_RISKS (${MAX_RISKS}) and counts the rest as dropped`, () => {
    const allowed = new Set(['src/a.ts']);
    const out = groundBrief(
      brief({
        risks: Array.from({ length: MAX_RISKS + 5 }, (_, i) =>
          risk({ title: `r${i}`, severity: 'low', file_refs: ['src/a.ts'] }),
        ),
      }),
      allowed,
    );
    expect(out.risks).toHaveLength(MAX_RISKS);
    expect(out.dropped_risks).toBe(5);
  });

  /** The cut follows the sort, so what a full list loses is its least severe end. */
  it('cuts the least severe, never a high one', () => {
    const allowed = new Set(['src/a.ts']);
    const out = groundBrief(
      brief({
        risks: [
          ...Array.from({ length: MAX_RISKS }, (_, i) =>
            risk({ title: `low-${i}`, severity: 'low', file_refs: ['src/a.ts'] }),
          ),
          risk({ title: 'the-high-one', severity: 'high', file_refs: ['src/a.ts'] }),
        ],
      }),
      allowed,
    );
    expect(out.risks[0]!.title).toBe('the-high-one');
    expect(out.risks.map((r) => r.title)).not.toContain(`low-${MAX_RISKS - 1}`);
  });

  it('de-duplicates file_refs on one risk — the same allowed path repeated is one reference', () => {
    const out = groundBrief(
      brief({
        risks: [
          risk({
            file_refs: Array.from(
              { length: 50 },
              () => 'server/src/modules/brief/routes.ts',
            ),
          }),
        ],
      }),
      ALLOWED,
    );
    expect(out.risks[0]!.file_refs).toEqual(['server/src/modules/brief/routes.ts']);
  });

  it(`caps file_refs on one risk at MAX_RISK_FILE_REFS (${MAX_RISK_FILE_REFS})`, () => {
    const paths = manyPaths(MAX_RISK_FILE_REFS + 6);
    const out = groundBrief(
      brief({ risks: [risk({ file_refs: paths })] }),
      new Set(paths),
    );
    expect(out.risks[0]!.file_refs).toHaveLength(MAX_RISK_FILE_REFS);
  });

  it('de-duplicates review_focus by ref, keeping the first reason', () => {
    const out = groundBrief(
      brief({
        review_focus: [
          { ref: 'server/src/modules/brief/routes.ts', kind: 'file', reason: 'the first reason' },
          { ref: 'server/src/modules/brief/routes.ts', kind: 'file', reason: 'a repeat' },
        ],
      }),
      ALLOWED,
    );
    expect(out.review_focus).toHaveLength(1);
    expect(out.review_focus[0]!.reason).toBe('the first reason');
  });

  it(`caps review_focus at MAX_REVIEW_FOCUS (${MAX_REVIEW_FOCUS}), keeping the head of the list`, () => {
    const paths = manyPaths(MAX_REVIEW_FOCUS + 4);
    const out = groundBrief(
      brief({
        review_focus: paths.map((ref) => ({ ref, kind: 'file' as const, reason: 'look' })),
      }),
      new Set(paths),
    );
    expect(out.review_focus).toHaveLength(MAX_REVIEW_FOCUS);
    expect(out.review_focus[0]!.ref).toBe('src/f0.ts');
  });

  /** `dropped_refs` is the one field on the record that was never vouched for. */
  it(`caps dropped_refs at MAX_DROPPED_REFS (${MAX_DROPPED_REFS})`, () => {
    const invented = manyPaths(MAX_DROPPED_REFS + 20).map((p) => `invented/${p}`);
    const out = groundBrief(
      brief({
        risks: [risk({ file_refs: ['server/src/modules/brief/routes.ts', ...invented] })],
      }),
      ALLOWED,
    );
    expect(out.dropped_refs).toHaveLength(MAX_DROPPED_REFS);
  });

  it(`truncates what and why to MAX_PROSE_CHARS (${MAX_PROSE_CHARS})`, () => {
    const out = groundBrief(
      brief({ what: 'W'.repeat(MAX_PROSE_CHARS + 400), why: 'Y'.repeat(MAX_PROSE_CHARS + 400) }),
      ALLOWED,
    );
    expect([...out.what]).toHaveLength(MAX_PROSE_CHARS);
    expect([...out.why]).toHaveLength(MAX_PROSE_CHARS);
  });

  /** Code points, not UTF-16 units: a `slice` here would halve an astral pair. */
  it('truncates by code point, so no surrogate pair is split', () => {
    const out = groundBrief(brief({ what: '🙂'.repeat(MAX_PROSE_CHARS + 50) }), ALLOWED);
    expect([...out.what]).toHaveLength(MAX_PROSE_CHARS);
    expect(out.what.endsWith('🙂')).toBe(true);
  });

  it('leaves prose shorter than the cap exactly as the model wrote it', () => {
    const out = groundBrief(brief({ what: 'Short enough.', why: 'Also short.' }), ALLOWED);
    expect(out.what).toBe('Short enough.');
    expect(out.why).toBe('Also short.');
  });

  /**
   * A cap on a list bounds the list, not the strings in it. `MAX_RISKS` says
   * twelve risks; it says nothing about a `title` the model wrote a novel into,
   * and a risk that survives grounding is a risk whose every field is served.
   */
  it(`truncates a kept risk's kind and title to MAX_LINE_CHARS (${MAX_LINE_CHARS})`, () => {
    const out = groundBrief(
      brief({
        risks: [
          risk({ kind: 'k'.repeat(MAX_LINE_CHARS + 500), title: 't'.repeat(MAX_LINE_CHARS + 500) }),
        ],
      }),
      ALLOWED,
    );
    expect([...out.risks[0]!.kind]).toHaveLength(MAX_LINE_CHARS);
    expect([...out.risks[0]!.title]).toHaveLength(MAX_LINE_CHARS);
  });

  it(`truncates a kept risk's explanation to MAX_PROSE_CHARS (${MAX_PROSE_CHARS})`, () => {
    const out = groundBrief(
      brief({ risks: [risk({ explanation: '🙂'.repeat(MAX_PROSE_CHARS + 200) })] }),
      ALLOWED,
    );
    expect([...out.risks[0]!.explanation]).toHaveLength(MAX_PROSE_CHARS);
    expect(out.risks[0]!.explanation.endsWith('🙂')).toBe(true);
  });

  it(`truncates a kept review_focus reason to MAX_LINE_CHARS (${MAX_LINE_CHARS})`, () => {
    const out = groundBrief(
      brief({
        review_focus: [
          {
            ref: 'server/src/modules/brief/routes.ts',
            kind: 'file',
            reason: 'r'.repeat(MAX_LINE_CHARS + 500),
          },
        ],
      }),
      ALLOWED,
    );
    expect([...out.review_focus[0]!.reason]).toHaveLength(MAX_LINE_CHARS);
  });

  /** The ungrounded field: nothing about a dropped ref was ever vouched for, its length included. */
  it(`truncates each dropped ref to MAX_FILE_PATH_CHARS (${MAX_FILE_PATH_CHARS})`, () => {
    const out = groundBrief(
      brief({ risks: [risk({ file_refs: [`invented/${'p'.repeat(MAX_FILE_PATH_CHARS)}.ts`] })] }),
      ALLOWED,
    );
    expect([...out.dropped_refs[0]!]).toHaveLength(MAX_FILE_PATH_CHARS);
  });

  it('leaves every field shorter than its cap exactly as the model wrote it', () => {
    const out = groundBrief(brief(), ALLOWED);
    expect(out.risks[0]!.title).toBe('A new paid route');
    expect(out.risks[0]!.kind).toBe('public API');
    expect(out.review_focus[0]!.reason).toBe('the new paid route');
  });
});
