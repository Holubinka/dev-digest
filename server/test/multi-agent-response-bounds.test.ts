/**
 * The two bounds `SPEC-05 § Non-functional requirements` puts on a multi-run
 * read: the body under 2 MB, and the grouping under 250 ms, both at 10 agents ×
 * 50 findings.
 *
 * The requirement also says WHICH dimension gives way when the body is too big —
 * "різати текст обґрунтувань, а не кількість знахідок": cut the rationale text,
 * never the count, because showing part of a list in silence is what AC-177
 * forbids. So there is no `LIMIT` to test for here, and a test asserting one
 * would be asserting the opposite of the spec.
 *
 * Hermetic: `toAgentColumn` and `buildConflicts` are Core-ring functions over
 * their arguments, so the rows below ARE the input the endpoint gives them.
 */
import { describe, it, expect } from 'vitest';
import {
  MULTI_RUN_TEXT_CHARS,
  MULTI_RUN_TITLE_CHARS,
  clampModelText,
  toAgentColumn,
} from '../src/modules/reviews/helpers.js';
import { buildConflicts } from '../src/modules/reviews/conflicts.js';
import type { MultiRunItemDetail } from '../src/modules/reviews/repository/multi-run.repo.js';
import type { AgentRunRow, FindingRow } from '../src/db/rows.js';

const findingRow = (over: Partial<FindingRow> & { id: string }): FindingRow => ({
  reviewId: 'rev-1',
  file: 'src/limiter.ts',
  startLine: 10,
  endLine: 12,
  severity: 'WARNING',
  category: 'bug',
  title: 'Unbounded loop over the request body',
  rationale: 'The loop has no upper bound.',
  suggestion: null,
  confidence: 0.5,
  kind: 'finding',
  trifectaComponents: null,
  acceptedAt: null,
  dismissedAt: null,
  ...over,
});

const detail = (
  findings: FindingRow[],
  over: { summary?: string; error?: string } = {},
): MultiRunItemDetail => ({
  item: {
    runId: 'run-1',
    multiRunId: 'mr-1',
    agentId: 'agent-1',
    agentName: 'Security Reviewer',
    position: 0,
  },
  run: {
    id: 'run-1',
    agentId: 'agent-1',
    status: 'done',
    provider: 'openai',
    model: 'gpt-4.1',
    durationMs: 1000,
    costUsd: 0.01,
    score: 80,
    error: over.error ?? null,
  } as unknown as AgentRunRow,
  agentExists: true,
  review: {
    id: 'rev-1',
    verdict: 'request_changes',
    summary: over.summary ?? 'ok',
  } as MultiRunItemDetail['review'],
  findings,
});

describe('clampModelText', () => {
  it('leaves text at or under the cap exactly as the model wrote it', () => {
    const text = 'a'.repeat(MULTI_RUN_TEXT_CHARS);
    expect(clampModelText(text, MULTI_RUN_TEXT_CHARS)).toBe(text);
  });

  it('says how much it cut, so a cut is not mistaken for the model stopping', () => {
    const cut = clampModelText('a'.repeat(MULTI_RUN_TEXT_CHARS + 25), MULTI_RUN_TEXT_CHARS);
    expect(cut).toContain('[truncated, 25 more characters]');
    expect(cut.startsWith('a'.repeat(MULTI_RUN_TEXT_CHARS))).toBe(true);
  });

  /**
   * `String.slice` counts UTF-16 units, so a cut inside an astral character
   * leaves an orphaned surrogate on the wire. The assertion is on the CODE
   * POINTS, not on `.length`, which is what makes it fail for a `slice`.
   */
  it('never cuts an astral character in half', () => {
    const cut = clampModelText('🙂'.repeat(10), 5);
    expect([...cut].slice(0, 5).join('')).toBe('🙂'.repeat(5));
    expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('a multi-run column bounds every model-written field', () => {
  it('clamps rationale, suggestion and title, and leaves a null suggestion null', () => {
    const [column] = [
      toAgentColumn(
        detail([
          findingRow({
            id: 'f-1',
            title: 'T'.repeat(MULTI_RUN_TITLE_CHARS + 100),
            rationale: 'R'.repeat(MULTI_RUN_TEXT_CHARS + 100),
            suggestion: 'S'.repeat(MULTI_RUN_TEXT_CHARS + 100),
          }),
          findingRow({ id: 'f-2' }),
        ]),
      ),
    ];

    const [long, short] = column!.findings;
    expect([...long!.title]).toHaveLength(MULTI_RUN_TITLE_CHARS + '… [truncated, 100 more characters]'.length);
    expect(long!.rationale).toContain('[truncated, 100 more characters]');
    expect(long!.suggestion).toContain('[truncated, 100 more characters]');
    // Untouched text is untouched: the cap is a ceiling, not a formatter.
    expect(short!.rationale).toBe('The loop has no upper bound.');
    expect(short!.suggestion).toBeNull();
  });

  /**
   * The take quotes the flagging finding's rationale (AC-71), and the service
   * builds the takes FROM the columns rather than from a second read — which is
   * the only reason one clamp covers both copies. A second reader that went back
   * to the rows would put the unclamped text back on the wire.
   */
  it('carries the clamp into the conflict take that quotes the rationale', () => {
    const column = toAgentColumn(
      detail([findingRow({ id: 'f-1', rationale: 'R'.repeat(MULTI_RUN_TEXT_CHARS + 7) })]),
    );

    const [position] = buildConflicts(
      [{ runId: column.run_id, agentId: column.agent_id, agentName: column.agent_name, status: column.status }],
      column.findings.map((finding) => ({ runId: column.run_id, finding })),
    );

    expect(position!.takes[0]!.note).toContain('[truncated, 7 more characters]');
  });

  /**
   * `summary` and `error` sit on the same object literal as the clamped
   * findings and are just as model-written. `summary` is the join of one
   * partial PER CHANGED FILE (`reviewer-core/src/review/reduce.ts:53`), so it
   * grows with a file count the PR author picks; `error` is a raw provider
   * message. Ten of each ride one response.
   */
  it('clamps the column summary and the run error too, not only the findings', () => {
    const column = toAgentColumn(
      detail([findingRow({ id: 'f-1' })], {
        summary: 'S'.repeat(MULTI_RUN_TEXT_CHARS + 40),
        error: 'E'.repeat(MULTI_RUN_TEXT_CHARS + 11),
      }),
    );

    expect(column.summary).toContain('[truncated, 40 more characters]');
    expect(column.error).toContain('[truncated, 11 more characters]');
  });

  it('leaves a short summary and a null error exactly as they were', () => {
    const column = toAgentColumn(detail([findingRow({ id: 'f-1' })]));
    expect(column.summary).toBe('ok');
    expect(column.error).toBeNull();
  });
});

/**
 * The grouping is a pair scan within each file, so its cost is quadratic in
 * findings per file — the worst input at the stated load is all 500 in ONE file,
 * which is what this builds. The budget is the spec's own 250 ms, and the
 * assertion is deliberately the budget rather than a tighter number measured
 * today: this is a ceiling, not a benchmark, and a machine-dependent margin
 * turns a real regression into a flaky failure and back.
 */
describe('the grouping stays inside its budget at the stated load', () => {
  it('groups 10 agents × 50 findings in one file under 250 ms, with no I/O', () => {
    const agents = Array.from({ length: 10 }, (_, a) => ({
      runId: `run-${a}`,
      agentId: `agent-${a}`,
      agentName: `Agent ${a}`,
      status: 'done' as const,
    }));
    const findings = agents.flatMap((agent, a) =>
      Array.from({ length: 50 }, (_, f) => ({
        runId: agent.runId,
        finding: {
          ...findingRow({ id: `f-${a}-${f}` }),
          id: `f-${a}-${f}`,
          start_line: f * 3,
          end_line: f * 3 + 2,
          title: `Finding ${f} about the ${f % 7} limiter and its ${f % 5} bound`,
          rationale: 'R'.repeat(2_000),
          suggestion: null,
          confidence: 0.5,
          review_id: 'rev-1',
          accepted_at: null,
          dismissed_at: null,
        },
      })),
    ) as Parameters<typeof buildConflicts>[1];

    const started = performance.now();
    const positions = buildConflicts(agents, findings);
    const elapsed = performance.now() - started;

    expect(positions.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(250);
  });
});
