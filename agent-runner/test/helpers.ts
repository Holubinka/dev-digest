import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  Finding,
  LLMProvider,
  Review,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';

export const VALID_MANIFEST = [
  'name: Security Reviewer',
  'provider: openrouter',
  'model: deepseek/deepseek-v4-flash',
  'system_prompt: Review the diff for security defects.',
  'skills:',
  '  - secret-leakage',
  'strategy: single-pass',
  'ci_fail_on: critical',
  '',
].join('\n');

/** A one-file diff whose hunk covers new-side lines 9..12, two of them added. */
export const PATCH = [
  '@@ -9,2 +9,4 @@ export function handler() {',
  ' const a = 1;',
  '+const token = req.query.token;',
  '+eval(token);',
  ' return a;',
].join('\n');

export function bundleDir(files: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-runner-'));
  mkdirSync(path.join(root, '.devdigest', 'agents'), { recursive: true });
  mkdirSync(path.join(root, '.devdigest', 'skills'), { recursive: true });
  for (const [rel, contents] of Object.entries(files)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents, 'utf8');
  }
  return root;
}

export function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'CRITICAL',
    category: 'security',
    title: 'Command injection',
    file: 'src/handler.ts',
    start_line: 10,
    end_line: 11,
    rationale: 'User input reaches eval.',
    confidence: 0.9,
    ...over,
  } as Finding;
}

export function review(over: Partial<Review> = {}): Review {
  return {
    verdict: 'request_changes',
    summary: 'One critical defect.',
    score: 20,
    findings: [finding()],
    ...over,
  };
}

/**
 * An LLMProvider that answers with a fixed Review and records every prompt it
 * was given, so a test can assert on the assembled message without a network.
 */
export class StubProvider implements LLMProvider {
  readonly id = 'openrouter' as const;
  readonly prompts: string[] = [];
  calls = 0;

  constructor(private readonly answer: Review = review()) {}

  async listModels() {
    return [];
  }

  async complete() {
    return { text: '', model: 'stub', tokensIn: 0, tokensOut: 0, costUsd: null };
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls += 1;
    this.prompts.push(req.messages.map((m) => m.content).join('\n\n'));
    return {
      data: this.answer as unknown as T,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: null,
      raw: JSON.stringify(this.answer),
      attempts: 1,
    };
  }

  async embed() {
    return [];
  }
}
