import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  Risks,
  PrHistory,
  SmartDiff,
  Conformance,
  Onboarding,
  EvalRun,
  MemoryItem,
  RunTrace,
  Settings,
  Repo,
  PrDetail,
  RiskBrief,
  RiskBriefRecord,
  RiskBriefTimeline,
  ReviewRecord,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'], risk_areas: ['auth'] }),
    ).not.toThrow();
    // risk_areas is REQUIRED, not optional: it is a field of the strict schema
    // handed to the model, and putting a field in that schema is how you get
    // the model to fill it in.
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'] }),
    ).toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_lines: [28, 52] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      Onboarding.parse({
        sections: [{ kind: 'architecture', title: 'T', body: 'b', links: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, cost_usd: 0.06, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
  });

  /**
   * `run_traces` is parsed on read, so every key the contract requires must
   * exist in every document ever persisted. Two do not: `project_context` post-
   * dates most rows, and `cost_usd` was removed by `d45ab0d` (2026-06-14) and
   * restored by `5e92756` (2026-07-28). Both are defaulted; drop either default
   * and `GET /runs/:id/trace` 500s on a historical document.
   */
  it('RunTrace parses a document from an older contract generation', () => {
    const legacy = RunTrace.parse({
      config: { agent: 'a', model: 'm' },
      stats: { duration_ms: 1, tokens_in: 1, tokens_out: 1, findings: 0, grounding: '0/0 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: [],
    });
    expect(legacy.stats.cost_usd).toBeNull();
    expect(legacy.project_context).toEqual([]);
  });
});

/**
 * Risk Brief (10) — the contract P2 persists and P3 renders. `RiskBriefRecord` is
 * parsed on read out of `pr_brief.json`, so every field it requires must be present
 * in every row ever written; the enums are what stop a model's free string from
 * reaching the card as a level or a freshness the UI has no branch for.
 */
describe('Risk Brief contracts', () => {
  const record = {
    what: 'Adds a per-workspace rate limit to the brief route.',
    why: 'The paid path was keyed by IP, which throttled unrelated workspaces.',
    risk_level: 'medium',
    risks: [
      {
        kind: 'security',
        title: 'Limit evaded by a distributed caller',
        explanation: 'Keying on IP lets a caller spread the spend across addresses.',
        severity: 'high',
        file_refs: ['server/src/modules/brief/routes.ts'],
      },
    ],
    review_focus: [
      {
        ref: 'server/src/modules/brief/routes.ts',
        kind: 'file',
        reason: 'The keyGenerator resolves tenancy twice per POST.',
      },
      { ref: 'POST /pulls/:id/brief', kind: 'endpoint', reason: 'The only paid route here.' },
    ],
    head_sha: 'a'.repeat(40),
    intent_computed_at: '2026-08-16T09:00:00.000Z',
    intent_freshness: 'stale',
    blast_status: 'partial',
    link_sha: 'b'.repeat(40),
    index_matches_head: false,
    inputs: [
      { id: 'diff_stats', status: 'included', tokens: 320, detail: '12 files, +840/-96' },
      { id: 'intent', status: 'included', tokens: 210, detail: null },
      { id: 'specs', status: 'truncated', tokens: 1200, detail: 'specs/SPEC-02-pr-why-risk-brief.md' },
      { id: 'linked_issue', status: 'missing', tokens: 0, detail: 'no linked issue' },
    ],
    ref_lines: [
      { ref: 'server/src/modules/brief/routes.ts', line: 42, source: 'blast_symbol' },
    ],
    dropped_refs: ['../../etc/passwd'],
    dropped_risks: 2,
    budget: 8000,
    input_tokens_counted: 4310,
    tokenizer: 'cl100k_base',
    attempts: 2,
    tokens_in: 4402,
    provider: 'openai',
    model: 'gpt-4.1',
    cost_usd: 0.031,
    computed_at: '2026-08-16T09:05:00.000Z',
  };

  it('RiskBrief — the flat schema handed to the model', () => {
    const brief = RiskBrief.parse({
      what: record.what,
      why: record.why,
      risk_level: record.risk_level,
      risks: record.risks,
      review_focus: record.review_focus,
    });
    expect(brief.risks).toHaveLength(1);
    expect(brief.review_focus[1]!.kind).toBe('endpoint');
  });

  it('RiskBriefRecord round-trips a full row', () => {
    const parsed = RiskBriefRecord.parse(record);
    expect(parsed.head_sha).toBe('a'.repeat(40));
    expect(parsed.attempts).toBe(2);
    expect(parsed.tokens_in).toBe(4402);
    expect(parsed.inputs).toHaveLength(4);
    expect(parsed.index_matches_head).toBe(false);
    expect(parsed.ref_lines).toEqual([
      { ref: 'server/src/modules/brief/routes.ts', line: 42, source: 'blast_symbol' },
    ]);
  });

  /**
   * `ref_lines` carries the line beside the refs, never inside them: `RiskBrief`
   * — the schema the model fills — has no line field, so a number can only come
   * from the blast answer the server measured.
   */
  it('ref_lines round-trips one entry of each source, and never reaches RiskBrief', () => {
    const parsed = RiskBriefRecord.parse({
      ...record,
      ref_lines: [
        { ref: 'src/middleware/ratelimit.ts', line: 12, source: 'blast_symbol' },
        { ref: 'src/api/public/index.ts', line: 23, source: 'blast_caller' },
        { ref: 'GET /api/public/items', line: 88, source: 'blast_endpoint' },
      ],
    });
    expect(parsed.ref_lines.map((r) => r.source)).toEqual([
      'blast_symbol',
      'blast_caller',
      'blast_endpoint',
    ]);
    expect(parsed.ref_lines[1]!.line).toBe(23);
    // The refs themselves keep their shapes — plain strings, no `:<n>` suffix in
    // the stored value and no line field on Risk / ReviewFocusItem.
    expect(parsed.risks[0]!.file_refs).toEqual(['server/src/modules/brief/routes.ts']);
    expect(RiskBrief.parse(record)).not.toHaveProperty('ref_lines');
  });

  it('a ref_lines source outside the enum, or a non-integer line, is rejected', () => {
    expect(() =>
      RiskBriefRecord.parse({
        ...record,
        ref_lines: [{ ref: 'src/a.ts', line: 12, source: 'pr_files_patch' }],
      }),
    ).toThrow();
    // A model-written number is the one thing this field must not be able to hold,
    // and a fractional or string line is what a guessed one looks like.
    expect(() =>
      RiskBriefRecord.parse({
        ...record,
        ref_lines: [{ ref: 'src/a.ts', line: 12.5, source: 'blast_symbol' }],
      }),
    ).toThrow();
    expect(() =>
      RiskBriefRecord.parse({
        ...record,
        ref_lines: [{ ref: 'src/a.ts', line: '12', source: 'blast_symbol' }],
      }),
    ).toThrow();
  });

  it('cost_usd and link_sha are nullable — an unpriced model and a missing index are rows, not errors', () => {
    const parsed = RiskBriefRecord.parse({
      ...record,
      cost_usd: null,
      link_sha: null,
      intent_computed_at: null,
      intent_freshness: 'unknown',
    });
    expect(parsed.cost_usd).toBeNull();
    expect(parsed.link_sha).toBeNull();
  });

  it('a fourth risk_level is rejected', () => {
    expect(() => RiskBriefRecord.parse({ ...record, risk_level: 'critical' })).toThrow();
    expect(() =>
      RiskBriefRecord.parse({
        ...record,
        risks: [{ ...record.risks[0]!, severity: 'critical' }],
      }),
    ).toThrow();
  });

  it('a fourth intent_freshness is rejected', () => {
    expect(() => RiskBriefRecord.parse({ ...record, intent_freshness: 'maybe' })).toThrow();
    // A boolean would spell "unknown" as false, i.e. "not stale" — the one thing
    // this field exists to avoid claiming.
    expect(() => RiskBriefRecord.parse({ ...record, intent_freshness: false })).toThrow();
  });

  it('an input id or status outside its enum is rejected', () => {
    expect(() =>
      RiskBriefRecord.parse({
        ...record,
        inputs: [{ id: 'patch', status: 'included', tokens: 1, detail: null }],
      }),
    ).toThrow();
    expect(() =>
      RiskBriefRecord.parse({
        ...record,
        inputs: [{ id: 'specs', status: 'partial', tokens: 1, detail: null }],
      }),
    ).toThrow();
    expect(() => RiskBriefRecord.parse({ ...record, tokenizer: 'o200k_base' })).toThrow();
  });

  it('RiskBriefTimeline with two entries parses', () => {
    const timeline = RiskBriefTimeline.parse({
      entries: [
        {
          head_sha: 'c'.repeat(40),
          what: 'First state.',
          risk_level: 'low',
          computed_at: '2026-08-15T10:00:00.000Z',
          on_branch: false,
          level_changed: false,
        },
        {
          head_sha: 'd'.repeat(40),
          what: 'Second state.',
          risk_level: 'high',
          computed_at: '2026-08-16T10:00:00.000Z',
          on_branch: true,
          level_changed: true,
        },
      ],
      commits_without_brief: 3,
      evicted: 0,
      max_states: 20,
    });
    expect(timeline.entries).toHaveLength(2);
    expect(timeline.entries[1]!.level_changed).toBe(true);
    // `evicted` is the count carried on the rows, never inferred from entries.length:
    // a PR at exactly max_states has evicted nothing.
    expect(timeline.evicted).toBe(0);
  });
});

/**
 * `ReviewRecord.head_sha` — which STATE of the PR a review describes. The banner
 * asks "is there a completed review for the head I am looking at", and nothing
 * else in the schema answers it: `pull_requests.last_reviewed_sha` speaks only for
 * the newest completed run. `null` is "written before this column existed", which
 * is why it is nullable rather than defaulted to the current head.
 */
describe('ReviewRecord head_sha', () => {
  const review = {
    id: 'r1',
    pr_id: 'pr1',
    agent_id: null,
    run_id: 'run-1',
    agent_name: 'Security Reviewer',
    head_sha: 'a'.repeat(40),
    kind: 'review',
    verdict: 'request_changes',
    summary: 'Two blockers before merge.',
    score: 61,
    model: 'gpt-4.1',
    grounding: '3/3 passed',
    created_at: '2026-08-16T09:05:00.000Z',
    findings: [],
  };

  it('carries the head it describes', () => {
    const parsed = ReviewRecord.parse(review);
    expect(parsed.head_sha).toBe('a'.repeat(40));
  });

  it('null is a row from before the column, not a claim about the current head', () => {
    const parsed = ReviewRecord.parse({ ...review, head_sha: null });
    expect(parsed.head_sha).toBeNull();
  });

  it('the key is required — an absent head_sha is not the same as an unknown one', () => {
    const { head_sha: _omitted, ...withoutHead } = review;
    expect(() => ReviewRecord.parse(withoutHead)).toThrow();
    expect(() => ReviewRecord.parse({ ...review, head_sha: 42 })).toThrow();
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });
});
