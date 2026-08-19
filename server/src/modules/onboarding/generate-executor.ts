import {
  OnboardingInputId,
  type OnboardingDraft,
  type OnboardingInput,
  type OnboardingInputStatus,
} from '@devdigest/shared';
import { TimeoutError, withTimeout } from '../../platform/resilience.js';
import { selectWithinBudget } from '../_shared/budget.js';
import { resolveFeatureModel } from '../_shared/feature-models.js';
import {
  MAX_DOC_CHARS,
  MAX_PATH_PROBES,
  ONBOARDING_FEATURE,
  ONBOARDING_MAX_RETRIES,
  PATH_PROBE_BYTES,
} from './constants.js';
import { budgetForIndex, timeoutForBudget } from './sizing.js';
import { OnboardingGatherExecutor } from './gather-executor.js';
import type {
  OnboardingAudit,
  OnboardingGenerationContainer,
  OnboardingGenerationResult,
  OnboardingLogger,
  OnboardingRepoRef,
  OnboardingSources,
} from './generation-types.js';
import {
  collectClaimedPaths,
  groundOnboarding,
  sanitizePath,
  type OnboardingGroundingContext,
} from './helpers.js';
import {
  BLOCK_SEPARATOR,
  ONBOARDING_SCHEMA_NAME,
  OnboardingResponse,
  buildInputBlocks,
  buildUserMessage,
  systemPromptVars,
  truncateBlockToBudget,
  type OnboardingPromptBlock,
  type OnboardingPromptSources,
} from './prompt.js';

/**
 * onboarding · one generation, end to end — and the ONLY entry point this half
 * of the slice exposes.
 *
 * Gather what the model may see, fit it to the budget, make ONE structured call,
 * prove every path the answer claims against the clone, ground the rest, and
 * hand back a draft. It writes nothing anywhere: no row, no timestamp, no index
 * stamp. The slice that persists gates on the index state and adds
 * `generated_at` and `index_state` itself, which is what keeps its `.extend()`
 * collision-free by construction rather than by agreement.
 *
 * Three things it deliberately does NOT do, each owned by that slice:
 *
 *  - it is NOT concurrency-safe. Two overlapping calls make two model calls; the
 *    single-flight belongs to the caller that owns the key (`modules/brief/service.ts`
 *    holds the pattern);
 *  - it does not catch `ConfigError`. "No key for the provider this feature
 *    points at" is a first-class state with its own copy and its own link to
 *    Settings, and flattening it into a generic failure turns the one fault a
 *    user can fix into the one they cannot diagnose;
 *  - it does not decide whether generating was allowed. It cannot even ask —
 *    its container port has no `getIndexState`.
 *
 * `log` is a per-call parameter, not a constructor field: the composition root
 * builds this object and has no logger, while a request has one with its id on
 * it.
 */

/** The template rendered as the system half. A constant in code, never input. */
const ONBOARDING_SYSTEM_PROMPT = 'onboarding.system.md';

/** An empty set of sources, used to render one sampled file as its own block. */
const NO_SOURCES: OnboardingPromptSources = {
  repoMap: { text: '' },
  chains: [],
  packages: [],
  envSources: [],
  composeSources: [],
  samples: [],
  docs: [],
};

/**
 * One block offered to the budget walk. The samples are offered file by file, so
 * a repository whose twentieth sample does not fit still ships the first
 * nineteen — the input's own priority order, one step finer than the five ids.
 */
interface InputCandidate {
  block: OnboardingPromptBlock;
  /** The sampled file this block carries, `null` for every other input. */
  samplePath: string | null;
  /**
   * What this candidate is called in `inputs[].omitted` when the walk refuses
   * it: a sampled file's path, a document's path, a chain's ordinal label.
   * `null` on an input offered whole, which has nothing to name — it is either
   * `included` or `dropped` in one piece.
   */
  label: string | null;
  /**
   * `project_docs` only: whether `MAX_DOC_CHARS` cut this document before it was
   * fenced — i.e. whether what the reader is missing is the CEILING rather than
   * the budget. `false` on every candidate that ceiling does not apply to.
   *
   * It is carried rather than recomputed at the end because by then the block
   * holds the capped text, and "this was cut" is no longer decidable from it.
   */
  docShortened: boolean;
}

interface CandidateOutcome {
  candidate: InputCandidate;
  status: OnboardingInputStatus;
  tokens: number;
}

/** What the budget walk decided, in the shape the draft and the call both need. */
interface BudgetFit {
  /** The one user message, exactly as it will be sent. */
  user: string;
  inputs: OnboardingInput[];
  sampleFiles: number;
  sampleTruncated: boolean;
  /** The sampled paths that reached the model — the audit's list, not the read one. */
  samplePaths: string[];
}

export class OnboardingGenerateExecutor {
  constructor(private container: OnboardingGenerationContainer) {}

  /**
   * ONE model call, and the object that comes out of it.
   *
   * Throws on a timeout, on a repair that ran out, on a clone that cannot be
   * walked, and re-throws `ConfigError` as itself. Nothing is written on any
   * path, so "it threw" and "nothing was stored" are the same statement here
   * rather than two things that have to agree.
   */
  async run(
    input: { workspaceId: string; repo: OnboardingRepoRef; filesIndexed: number },
    log: OnboardingLogger,
  ): Promise<OnboardingGenerationResult> {
    const { repo } = input;
    const sources = await new OnboardingGatherExecutor(this.container).gather(repo);

    const count = (text: string): number => this.container.tokenizer.count(text);
    const system = await this.container.prompts.render(
      ONBOARDING_SYSTEM_PROMPT,
      systemPromptVars(),
    );
    // Both numbers come from the size of the index and from nothing else, and
    // the clock is computed FROM the budget rather than beside it: a budget
    // raised without its clock times out on exactly the repositories the budget
    // was raised for, and a timeout is a call already paid for.
    const budget = budgetForIndex(input.filesIndexed);
    const timeout = timeoutForBudget(budget);
    const systemTokens = count(system);
    const fit = this.fitToBudget(sources, repo.fullName, systemTokens, count, budget);

    // The FIRST assembled input, system and user together, counted before the
    // call — a different number, from a different counter, than the provider's
    // own `tokens_in`, which arrives afterwards. Both are on the record.
    const inputTokensCounted = systemTokens + count(fit.user);
    // AFTER counting: `TiktokenTokenizer` degrades to ceil(chars/4) silently and
    // only learns it is broken by failing one count.
    const tokenizer = this.container.tokenizer.id;
    if (tokenizer === 'heuristic') {
      log.warn(
        { repoId: repo.id, repo: repo.fullName, inputTokensCounted },
        'onboarding tour: token count came from the degradation heuristic, not the encoder',
      );
    }

    const choice = await resolveFeatureModel(this.container, input.workspaceId, ONBOARDING_FEATURE);
    const llm = await this.container.llm(choice.provider);
    // Both clocks, and neither is redundant: `timeoutMs` bounds ONE HTTP request
    // inside the provider, while `OpenRouterProvider` — this feature's default
    // path — carries its own 600 000 ms deadline and ignores this module's
    // resilience helpers. `withTimeout` is the bound this generation actually
    // holds (R21).
    const startedAt = Date.now();
    const result = await withTimeout(
      llm.completeStructured<OnboardingResponse>({
        model: choice.model,
        schema: OnboardingResponse,
        schemaName: ONBOARDING_SCHEMA_NAME,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: fit.user },
        ],
        temperature: 0,
        maxRetries: ONBOARDING_MAX_RETRIES,
        timeoutMs: timeout,
        // No reasoning: this is a description of a fact list, and reasoning
        // tokens bill at the output rate — 1078 against 113 completion tokens
        // for the same answer, measured on the intent classifier.
        reasoning: false,
      }),
      timeout,
    ).catch((err: unknown) => {
      // A generation that missed its clock leaves NO ROW — the caller keeps the
      // previously saved tour untouched — so this line is the only record it
      // leaves, and it carries the two numbers that say whether the clock was
      // the wrong size (AC-65). The error is re-thrown exactly as it came, so
      // this adds a record and changes no behaviour.
      log.warn(
        {
          repoId: repo.id,
          repo: repo.fullName,
          budget,
          timeoutMs: timeout,
          durationMs: Date.now() - startedAt,
          filesIndexed: input.filesIndexed,
        },
        err instanceof TimeoutError
          ? 'onboarding tour: the model call missed its clock'
          : 'onboarding tour: the model call failed, and nothing was stored',
      );
      throw err;
    });
    const durationMs = Date.now() - startedAt;

    const { verified, probes } = await this.verifyPaths(repo, result.data, sources);
    const ctx: OnboardingGroundingContext = {
      verified,
      // Canonicalised ONCE, here, rather than at each comparison: a root stored
      // as `docs/` once produced a successful scan with zero documents and no
      // error (`server/INSIGHTS.md`). Every membership set in this feature is
      // built from `sanitizePath` output, and every claim is put through the
      // same function before it is looked up.
      chainPaths: normalizeAll(sources.chains.flat()),
      rankedPaths: normalizeAll(sources.ranked),
      packages: sources.packages,
      envSources: sources.envSources,
      composeSources: sources.composeSources,
      chains: sources.chains,
    };
    const grounded = groundOnboarding(result.data, ctx);

    const draft: OnboardingDraft = {
      ...grounded.tour,
      package_scan: sources.package_scan,
      inputs: fit.inputs,
      dropped: grounded.dropped,
      sample_files: fit.sampleFiles,
      sample_truncated: fit.sampleTruncated,
      // What was OFFERED to the model, not what the answer walked: the reach of
      // the supply is what a thin critical-paths section has to be read against
      // (AC-20). Which of them the budget then refused is in `inputs[].omitted`.
      chains_supplied: sources.chains.length,
      longest_chain_files: sources.chains.reduce((max, chain) => Math.max(max, chain.length), 0),
      budget,
      input_tokens_counted: inputTokensCounted,
      system_tokens: systemTokens,
      duration_ms: durationMs,
      tokenizer,
      // From the provider's own answer and nowhere else. `attempts` is what says
      // whether the one repair was spent, and recomputing any of these four from
      // our side would replace a measurement with an estimate.
      attempts: result.attempts,
      tokens_in: result.tokensIn,
      provider: llm.id,
      model: result.model,
      cost_usd: result.costUsd,
    };

    const audit: OnboardingAudit = {
      ...grounded.dropped,
      ...grounded.extra,
      probes,
      samples: fit.samplePaths,
    };

    // ONE line per generation, carrying every number an operator would otherwise
    // have to read out of the record: what the answer cost, what it claimed that
    // did not survive, and how many reads proving that took.
    log.info(
      {
        repoId: repo.id,
        repo: repo.fullName,
        provider: llm.id,
        model: result.model,
        attempts: result.attempts,
        tokensIn: result.tokensIn,
        costUsd: result.costUsd,
        inputTokensCounted,
        systemTokens,
        budget,
        durationMs,
        filesIndexed: input.filesIndexed,
        tokenizer,
        inputs: fit.inputs.map((row) => `${row.id}:${row.status}`),
        packagesFound: sources.package_scan.found,
        packagesShown: sources.package_scan.shown,
        ...audit,
      },
      'onboarding tour generated',
    );

    return { draft, audit };
  }

  /**
   * Everything gathered, rendered, measured and cut to the named budget.
   *
   * The escape is applied where each block is BUILT (`buildInputBlocks`), so
   * what the walk measures is what ships. Measuring first and fencing afterwards
   * is the leak `server/INSIGHTS.md` records under "A budget measured before an
   * escape is not a budget": three files of the literal `</untrusted>` counted
   * 4521 tokens and shipped as 6021, i.e. 9202 against a budget of 8000.
   *
   * The budget the walk is given is the COMPUTED ceiling minus the system prompt
   * AND minus the user message's fixed scaffold — its header and the trusted
   * line — and every candidate is measured with the separator it will be joined
   * by (`BLOCK_SEPARATOR`, whose own docstring says a caller that measures
   * blocks must count it). What that buys is an equality rather than an
   * approximation: `input_tokens_counted` cannot exceed the budget, because every
   * token that ships was counted against it.
   *
   * The ceiling arrives as a PARAMETER rather than being read from a constant
   * here: it is a function of `files_indexed` now (`sizing.ts`), and a second
   * place that decided how big an input may be is a second place to disagree
   * with `draft.budget`.
   *
   * A block that does not fit is shortened by `truncateBlockToBudget` and NEVER
   * by the walk's own cut. `truncateToBudget` cuts a rendered string from the
   * end, which on a fenced block removes the `</untrusted>` and leaves the rest
   * of the message reading as trusted prose (AC-79) — so the walk decides WHICH
   * candidate is truncated, and the fence-aware cut decides what that means.
   */
  private fitToBudget(
    sources: OnboardingSources,
    repoFullName: string,
    systemTokens: number,
    count: (text: string) => number,
    ceiling: number,
  ): BudgetFit {
    const candidates = buildCandidates(sources);
    const scaffold = buildUserMessage({ repoFullName, blocks: [] });
    const separator = count(BLOCK_SEPARATOR);
    const budget = Math.max(ceiling - systemTokens - count(scaffold), 0);

    const selection = selectWithinBudget(
      candidates.map((candidate) => ({
        path: candidate.block.id,
        rendered: BLOCK_SEPARATOR + candidate.block.text,
      })),
      budget,
      count,
    );

    const shipped: OnboardingPromptBlock[] = [];
    const outcomes: CandidateOutcome[] = [];
    let used = 0;
    candidates.forEach((candidate, index) => {
      // The walk answers every candidate, in order.
      const result = selection.results[index];
      if (result === undefined) return;
      if (result.status === 'dropped') {
        outcomes.push({ candidate, status: 'dropped', tokens: result.tokens });
        return;
      }
      if (result.status === 'truncated') {
        const cut = truncateBlockToBudget(
          candidate.block,
          Math.max(budget - used - separator, 0),
          count,
        );
        const tokens = count(BLOCK_SEPARATOR + cut.text);
        shipped.push(cut);
        used += tokens;
        outcomes.push({ candidate, status: 'truncated', tokens });
        return;
      }
      shipped.push(candidate.block);
      used += result.tokens;
      outcomes.push({ candidate, status: 'included', tokens: result.tokens });
    });

    const samples = outcomes.filter((outcome) => outcome.candidate.samplePath !== null);
    const sentSamples = samples.filter((outcome) => outcome.status !== 'dropped');

    return {
      user: buildUserMessage({ repoFullName, blocks: shipped }),
      inputs: OnboardingInputId.options.map((id) => inputRow(id, outcomes)),
      sampleFiles: sentSamples.length,
      // Anything short of "every file we read reached the model whole" is a cut
      // the reader is told about (AC-86).
      sampleTruncated: samples.some((outcome) => outcome.status !== 'included'),
      samplePaths: sentSamples.flatMap((outcome) =>
        outcome.candidate.samplePath === null ? [] : [outcome.candidate.samplePath],
      ),
    };
  }

  /**
   * Which of the paths this answer claims really exist in the clone.
   *
   * A path already read during the gather needs no probe — it was read, so it is
   * there. Everything else is asked for at ONE BYTE through `GitClient.readFile`,
   * inside a catch-all: a directory, a symlink pointing out of the clone, a
   * refusal and a missing file are all "not a file this tour may link to", and
   * the port already answers all four. That is why this feature adds no
   * `exists()` to the port — it would be a second implementation of the symlink,
   * outside-clone and `.git` refusals, in the adapter and in the mock.
   *
   * `MAX_PATH_PROBES` is a ceiling on the reads ONE ANSWER can cause: the model
   * decides how many paths it claims, so without it the number of clone reads is
   * model-controlled. Claims past the ceiling stay unverified, which drops them
   * and counts them exactly as a failed probe does, and `probes` records what was
   * spent.
   */
  private async verifyPaths(
    repo: OnboardingRepoRef,
    response: OnboardingResponse,
    sources: OnboardingSources,
  ): Promise<{ verified: Set<string>; probes: number }> {
    const verified = normalizeAll(sources.knownPaths);
    const ref = { owner: repo.owner, name: repo.name };
    let probes = 0;

    for (const path of collectClaimedPaths(response)) {
      if (verified.has(path)) continue;
      if (probes >= MAX_PATH_PROBES) break;
      probes += 1;
      const exists = await this.container.git
        .readFile(ref, path, PATH_PROBE_BYTES)
        .then(() => true)
        .catch(() => false);
      if (exists) verified.add(path);
    }

    return { verified, probes };
  }
}

/** Sanitize once, at the point a path enters a set that will be compared against. */
function normalizeAll(paths: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of paths) {
    const path = sanitizePath(raw);
    if (path !== null) out.add(path);
  }
  return out;
}

/**
 * The candidates, in the priority order the budget walk drops them in reverse
 * of: the skeleton, the packages and configs, EACH CHAIN on its own, then EACH
 * PROJECT DOCUMENT on its own, then EACH SAMPLED FILE on its own.
 *
 * The chains are split by `buildInputBlocks` rather than here, because their
 * labels carry a GLOBAL ordinal — `chain-7` is the seventh chain of the supply,
 * whichever ones the walk keeps — and a per-chain call could only ever number
 * from one. Nothing in this function needs a case for it: it already maps every
 * returned block to its own candidate, so twenty chain blocks are twenty
 * candidates the same way twenty samples are.
 *
 * **The documents outrank the samples**, by a decision of 2026-08-18 that
 * reversed the pair D13 originally fixed. What it reverses is not a preference
 * but a measurement: `SAMPLE_FILE_COUNT` (20) × `MAX_FILE_CHARS` (6 000) took
 * 17 964 of the ~22 000 block tokens on a real clone, so the documents — last,
 * and offered whole — were `dropped` on every single generation, and the tour
 * described a repository whose own README it had never read. A prose file that
 * says what a package IS outranks the twentieth source file ranked by how often
 * it is imported; the samples degrade gracefully by losing their tail, which is
 * exactly what being split per item buys them.
 *
 * Both inputs are split per item rather than offered as one block because the
 * walk has a single cut point — it stops at the first candidate that does not fit
 * and drops every one after it, and it truncates only a candidate that is FIRST.
 * As one block, the input that does not fit loses everything and takes every
 * input behind it down too. Each per-item block carries its own heading and its
 * own fence, so what the walk measured is still exactly what ships.
 *
 * Within each input the order is the priority for the same reason: the documents
 * keep the order `readDocs` returned them in — root first, then by package — and
 * the samples keep their rank.
 */
function buildCandidates(sources: OnboardingSources): InputCandidate[] {
  const blocks = buildInputBlocks({ ...sources, samples: [], docs: [] });
  const fixed = (block: OnboardingPromptBlock): InputCandidate => ({
    block,
    samplePath: null,
    // A chain block carries exactly one fenced item and its label is the chain's
    // own — read off the block rather than recomputed, so what the record names
    // as omitted is the string the model would have been shown.
    label: block.id === 'critical_paths' ? (block.items[0]?.label ?? null) : null,
    docShortened: false,
  });
  return [
    ...blocks.map(fixed),
    ...sources.docs.flatMap((doc) =>
      buildInputBlocks({ ...NO_SOURCES, docs: [doc] }).map((block) => ({
        block,
        samplePath: null,
        label: doc.path,
        // By CODE POINT, which is the unit `truncateCodePoints` cuts in. `.length`
        // is UTF-16 units and would call a document of 3 000 astral characters
        // shortened when the cap never touched it.
        docShortened: [...doc.text].length > MAX_DOC_CHARS,
      })),
    ),
    ...sources.samples.flatMap((file) =>
      buildInputBlocks({ ...NO_SOURCES, samples: [file] }).map((block) => ({
        block,
        samplePath: file.path,
        label: file.path,
        docShortened: false,
      })),
    ),
  ];
}

/**
 * The inputs offered to the walk one item at a time, and the noun their `detail`
 * counts in. Every other id has exactly one candidate, so it has nothing to
 * count — and it is also why membership in this map is what decides whether a
 * row can name what it left behind.
 */
const SPLIT_INPUT_NOUNS: Partial<Record<OnboardingInput['id'], string>> = {
  critical_paths: 'chains',
  file_samples: 'files',
  project_docs: 'documents',
};

/**
 * One row per input id, always five, whatever the walk did.
 *
 * `missing` and `dropped` are different answers and the contract keeps them
 * apart: an input with no candidate at all had nothing to say about this
 * repository, while a dropped one had something and did not fit. `tokens` is
 * what shipped for the first, and what was refused for the second — in both
 * cases the size of what the row is about.
 *
 * A split input collapses into ONE row, since the five ids are what a reader
 * sees and "14 of 20 files" is the sentence they need out of twenty candidates.
 *
 * For the documents that sentence carries a second number, and it is the only
 * place `MAX_DOC_CHARS` becomes observable: "3 of 7 documents, 2 shortened" says
 * that four did not fit the budget AND that two of the three that did arrived
 * cut by the ceiling. `status` is deliberately left alone by it — the contract
 * defines these four words in terms of the budget walk, and a document the
 * ceiling shortened did reach the model in the state this run intended.
 *
 * `omitted` and `shortened` say WHICH, by label, where `detail` says how many
 * (AC-54, AC-55). They are two lists rather than one because they are two
 * different absences: an omitted item never reached the model, while a shortened
 * one did with its tail gone — so a claim the tour makes about it may rest on
 * text nobody sent. `detail` is left exactly as it reads today: it is the string
 * the screen draws, and putting six paths inside it is a design decision this
 * change is not making.
 */
function inputRow(id: OnboardingInput['id'], outcomes: CandidateOutcome[]): OnboardingInput {
  const mine = outcomes.filter((outcome) => outcome.candidate.block.id === id);
  const first = mine[0];
  if (first === undefined) {
    return { id, status: 'missing', tokens: 0, detail: null, omitted: [], shortened: [] };
  }

  const noun = SPLIT_INPUT_NOUNS[id];
  if (noun === undefined) {
    // Offered whole: it is `included` or `dropped` in one piece, so there is no
    // item to name on either list.
    return {
      id,
      status: first.status,
      tokens: first.tokens,
      detail: null,
      omitted: [],
      shortened: [],
    };
  }

  const sent = mine.filter((outcome) => outcome.status !== 'dropped');
  const status: OnboardingInputStatus =
    sent.length === 0
      ? 'dropped'
      : sent.length === mine.length && sent.every((outcome) => outcome.status === 'included')
        ? 'included'
        : 'truncated';
  const counted = sent.length === 0 ? mine : sent;
  const shortened = sent.filter((outcome) => outcome.candidate.docShortened);
  const labelsOf = (rows: CandidateOutcome[]): string[] =>
    rows.flatMap((outcome) => (outcome.candidate.label === null ? [] : [outcome.candidate.label]));
  return {
    id,
    status,
    tokens: counted.reduce((sum, outcome) => sum + outcome.tokens, 0),
    detail:
      `${sent.length} of ${mine.length} ${noun}` +
      (shortened.length > 0 ? `, ${shortened.length} shortened` : ''),
    omitted: labelsOf(mine.filter((outcome) => outcome.status === 'dropped')),
    shortened: labelsOf(shortened),
  };
}
