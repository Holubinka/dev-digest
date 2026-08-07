import { describe, it, expect } from 'vitest';
import {
  emptyTally,
  enforcedTopics,
  isMachineEnforced,
  locateSnippet,
  normaliseRule,
  verifyEvidence,
} from '../src/modules/conventions/helpers.js';

/**
 * The code half of the extractor: everything that decides whether a model's
 * claim is allowed to reach the screen. No repo, no model, no database.
 */

const FILE = [
  'import { z } from "zod";',
  '',
  'export async function handler(req: Request) {',
  '  const parsed = Schema.parse(req.body);',
  '  if (!parsed.ok) throw new ValidationError("bad input");',
  '  return parsed.value;',
  '}',
].join('\n');

describe('locateSnippet', () => {
  it('finds a single line and reports its 1-based number', () => {
    expect(locateSnippet(FILE, 'const parsed = Schema.parse(req.body);')).toEqual({
      line: 4,
      endLine: 4,
    });
  });

  it('matches through different indentation and spacing', () => {
    expect(locateSnippet(FILE, '        const   parsed = Schema.parse(req.body);')).toEqual({
      line: 4,
      endLine: 4,
    });
  });

  it('spans the lines a multi-line quote actually occupies', () => {
    const at = locateSnippet(
      FILE,
      'const parsed = Schema.parse(req.body);\nif (!parsed.ok) throw new ValidationError("bad input");',
    );
    expect(at).toEqual({ line: 4, endLine: 5 });
  });

  it('matches a quote that dropped a blank line', () => {
    const at = locateSnippet(FILE, 'import { z } from "zod";\nexport async function handler(req: Request) {');
    expect(at).toEqual({ line: 1, endLine: 3 });
  });

  it('returns null when the snippet is not in the file', () => {
    expect(locateSnippet(FILE, 'const user = await db.users.find(id);')).toBeNull();
  });

  it('refuses to match a short fragment as a substring', () => {
    // `}` appears on line 7, but a one-character "quote" proves nothing.
    expect(locateSnippet(FILE, '}')).toEqual({ line: 7, endLine: 7 });
    expect(locateSnippet(FILE, 'ok')).toBeNull();
  });
});

describe('verifyEvidence', () => {
  const files = new Map([['src/api/handler.ts', FILE]]);

  it('stores the file’s own text, not the model’s paraphrase', () => {
    const tally = emptyTally();
    const [evidence] = verifyEvidence(
      [{ path: 'src/api/handler.ts', line: 4, snippet: 'const   parsed=Schema.parse(req.body);' }],
      files,
      tally,
    );
    expect(evidence?.snippet).toBe('  const parsed = Schema.parse(req.body);');
  });

  it('re-anchors a claim that named the wrong line, and counts it', () => {
    const tally = emptyTally();
    const [evidence] = verifyEvidence(
      [{ path: 'src/api/handler.ts', line: 41, snippet: 'const parsed = Schema.parse(req.body);' }],
      files,
      tally,
    );
    expect(evidence?.line).toBe(4);
    expect(tally.reanchored).toBe(1);
  });

  it('drops a claim about a file that was never sampled', () => {
    const tally = emptyTally();
    const out = verifyEvidence(
      [{ path: 'src/never/sampled.ts', line: 1, snippet: 'export const x = 1;' }],
      files,
      tally,
    );
    expect(out).toEqual([]);
    expect(tally.unsampledFile).toBe(1);
  });

  it('drops a claim whose snippet is nowhere in the file it names', () => {
    const tally = emptyTally();
    const out = verifyEvidence(
      [{ path: 'src/api/handler.ts', line: 4, snippet: 'await db.users.find(id);' }],
      files,
      tally,
    );
    expect(out).toEqual([]);
    expect(tally.snippetNotFound).toBe(1);
  });

  it('keeps one site per location when the model quotes it twice', () => {
    const tally = emptyTally();
    const out = verifyEvidence(
      [
        { path: 'src/api/handler.ts', line: 4, snippet: 'const parsed = Schema.parse(req.body);' },
        { path: 'src/api/handler.ts', line: 9, snippet: 'const parsed = Schema.parse(req.body);' },
      ],
      files,
      tally,
    );
    expect(out).toHaveLength(1);
  });
});

describe('the machine-enforced filter', () => {
  const prettier = new Map([['.prettierrc', '{ "semi": true, "singleQuote": true, "printWidth": 100 }']]);

  it('recognises the topics a config turns on', () => {
    expect([...enforcedTopics(prettier)].sort()).toEqual(['line-length', 'quotes', 'semicolons']);
  });

  it('drops a rule the config already enforces', () => {
    const on = enforcedTopics(prettier);
    expect(isMachineEnforced('Always terminate statements with semicolons.', on)).toBe(true);
    expect(isMachineEnforced('Use single quotes for string literals.', on)).toBe(true);
  });

  it('keeps the same rule when the repo has no such config', () => {
    const on = enforcedTopics(new Map([['package.json', '{ "name": "app" }']]));
    expect(isMachineEnforced('Always terminate statements with semicolons.', on)).toBe(false);
  });

  it('keeps a rule about explicit any — noImplicitAny does not ban it', () => {
    const on = enforcedTopics(new Map([['tsconfig.json', '{ "compilerOptions": { "strict": true } }']]));
    expect(isMachineEnforced('Never annotate a parameter as any.', on)).toBe(false);
    expect(isMachineEnforced('Do not rely on implicit any in callbacks.', on)).toBe(true);
  });

  it('leaves a real convention alone', () => {
    const on = enforcedTopics(prettier);
    expect(isMachineEnforced('Route handlers throw AppError subclasses.', on)).toBe(false);
  });
});

describe('normaliseRule', () => {
  it('treats punctuation and casing as noise so a re-scan recognises a judged rule', () => {
    expect(normaliseRule('Route handlers throw AppError subclasses.')).toBe(
      normaliseRule('route handlers  throw AppError subclasses'),
    );
  });

  it('keeps genuinely different rules apart', () => {
    expect(normaliseRule('Handlers throw AppError.')).not.toBe(
      normaliseRule('Handlers return AppError.'),
    );
  });
});
