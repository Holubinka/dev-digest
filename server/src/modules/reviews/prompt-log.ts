/**
 * Safe structured logging of prompt assembly.
 *
 * `run_traces.trace.prompt_assembly` holds the FULL text of every prompt section
 * — the diff, the PR body, any spec content. That is the record, not a signal:
 * you cannot see what went into a prompt and how big each part was without
 * reading what was in it. This module builds the metadata-only view.
 *
 * THE GUARANTEE. A PromptAssemblyLog is built from lengths and hashes and
 * nothing else. It is never spread from, picked from, or mapped out of a
 * PromptAssembly, so a section added to that contract tomorrow cannot arrive
 * here as content: `describePromptSection` (reviewer-core) returns no field that
 * can hold text, and the only other thing this module derives from content is a
 * 12-hex-character sha256 prefix. `prompt-log-redaction.test.ts` pins it with
 * sentinels.
 *
 * Pure: side-effect free, `node:crypto` hashing only, no I/O.
 */
import { createHash } from 'node:crypto';
import type {
  PromptAssembly,
  PromptAssemblyLog,
  PromptSectionLog,
  UnifiedDiff,
} from '@devdigest/shared';
import { describePromptSection, sliceDiff, type ReviewMode } from '@devdigest/reviewer-core';

/**
 * First 12 hex of sha256 — enough to tell two prompts apart, not enough to
 * brute-force back to the text of a diff. It answers "did these two runs send
 * the same thing?" and nothing else.
 */
export function sectionDigest(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 12);
}

export interface PromptLogDetail {
  /** Verbose only: section name → the content the SERVER already holds for it. */
  digestSources: Record<string, string | null | undefined>;
  /** Verbose only: the per-file breakdown of this chunk's diff section. */
  files: { path: string; text: string }[];
}

export interface PromptLogInput {
  /** The runId — the value tying the SSE stream, run_traces.run_id and agent_runs.id together. */
  correlationId: string;
  provider: string | null;
  model: string;
  /** Straight from the engine: the ONLY source of section sizes. */
  sections: PromptSectionLog[];
  /** Verbose mode only. Omit it and every digest stays null. */
  detail?: PromptLogDetail;
}

/**
 * Attach a digest only to content that PROVABLY belongs to this section: a
 * code-point-length mismatch means the server is holding something else (a
 * different chunk's diff, say), and a wrong fingerprint is worse than none —
 * it would make two identical runs look different, or two different ones look
 * the same.
 */
function withDigest(section: PromptSectionLog, content: string | null | undefined): PromptSectionLog {
  if (content == null || [...content].length !== section.chars) return section;
  return { ...section, digest: sectionDigest(content) };
}

export function buildPromptAssemblyLog(input: PromptLogInput): PromptAssemblyLog {
  const sections = input.sections.map((s) => withDigest(s, input.detail?.digestSources[s.section]));

  // Totals cover the sections the prompt is ASSEMBLED from, computed before the
  // verbose breakdown is appended — so a verbose run's totals are directly
  // comparable with a quiet one's, and the diff is never counted twice.
  const totalChars = sections.reduce((n, s) => n + s.chars, 0);
  const totalTokens = sections.reduce((n, s) => n + s.tokens_approx, 0);

  // Verbose detail: paths, not contents. `pr_files.path` is already stored and
  // shown in the UI; what a file CONTAINS is the part that never leaves.
  for (const file of input.detail?.files ?? []) {
    sections.push(
      withDigest(describePromptSection(`diff:${file.path}`, 'diff', file.text), file.text),
    );
  }

  return {
    correlation_id: input.correlationId,
    provider: input.provider,
    model: input.model,
    sections,
    total_chars: totalChars,
    total_tokens_approx: totalTokens,
  };
}

/**
 * The content the server holds for one chunk, for digests and the per-file
 * breakdown. Verbose mode only — nothing here is called when it is off.
 *
 * The diff is the one section the assembly does not keep on its own (it holds
 * the concatenated `user` instead), so it is recovered the same way the engine
 * produced it: `sliceDiff` per file in map-reduce, the raw diff in single-pass.
 * `withDigest` refuses anything whose length disagrees with the engine's, so a
 * future change to how the engine chunks costs a null digest, never a wrong one.
 */
export function promptLogDetail(args: {
  mode: ReviewMode;
  chunk: string;
  diff: UnifiedDiff;
  assembly: PromptAssembly;
  task: string;
}): PromptLogDetail {
  const mapped = args.mode === 'map-reduce';
  const files = mapped ? args.diff.files.filter((f) => f.path === args.chunk) : args.diff.files;
  const a = args.assembly;
  return {
    digestSources: {
      system: a.system,
      task: args.task,
      pr_description: a.pr_description,
      intent: a.intent,
      skills: a.skills,
      memory: a.memory,
      repo_map: a.repo_map,
      specs: a.specs,
      callers: a.callers,
      diff: mapped ? sliceDiff(args.diff, args.chunk) : args.diff.raw,
    },
    files: files.map((f) => ({ path: f.path, text: sliceDiff(args.diff, f.path) })),
  };
}
