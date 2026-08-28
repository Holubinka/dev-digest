import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 5 Claude sessions total.
 *   - 3 × trace     → 1 session each                      = 3
 *   - 1 × activation pair (positive + near-miss negative) = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): module AGENTS.md-first + "Read When" routing + subagent dispatch -------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    // server/AGENTS.md and server/README.md are two distinct real files, both triggered by the
    // same HTTP-route scenario (root CLAUDE.md's "AGENTS.md first" rule + its own route-doc rule) —
    // folds that module-entry check into this session for free instead of a separate one.
    name: "API-route task reads server/AGENTS.md + README AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу звірся з конвенціями цього репо для роботи в server/ і з тим, де в server " +
      "описана мапа API. Потім ОБОВʼЯЗКОВО запусти сабагента architecture-reviewer, щоб він оцінив " +
      "мій план на відповідність onion-шарам — не рецензуй сам.",
    expectFilesRead: ["server/AGENTS.md", "server/README.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- trace (1 session): module AGENTS.md-first + its own README rule, same file in this repo ---
  {
    kind: "trace",
    // Tests the CLAUDE.md "Read When" routing, so the prompt must push toward CONSULTING the docs,
    // not exploring source. Earlier phrasing ("розберись, як усе влаштовано") sent the model straight
    // into schema.ts / pipeline.run.ts and it never opened the routed doc. reviewer-core/AGENTS.md
    // (read first) and reviewer-core/README.md (root CLAUDE.md's own rule for touching prompt
    // assembly / the grounding gate) are two distinct real files — one deterministic check, not two.
    name: "reviewer-core task reads AGENTS.md and README before touching prompt assembly",
    prompt:
      "Я збираюся змінити, як prompt.ts збирає промпт для LLM у reviewer-core, і торкнутися " +
      "grounding-гейту. Перш ніж торкатися коду — звірся з конвенціями цього репо щодо роботи в " +
      "reviewer-core/ і прочитай документ із діаграмою пайплайна.",
    expectFilesRead: ["reviewer-core/AGENTS.md", "reviewer-core/README.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): CLAUDE.md "Hit unexpected behavior" routing -> module INSIGHTS.md ------
  // Was a contrast case, but the control run (empty tmpdir) could still reach the real repo by
  // absolute path and read INSIGHTS.md, making the negative flaky. As a single-session trace it
  // reliably checks the same routing rule: in the real repo, the discovery prompt reads INSIGHTS.md.
  {
    kind: "trace",
    name: "CLAUDE.md routes a reviewer-core debugging question to its INSIGHTS.md",
    prompt:
      "У reviewer-core я стикнувся з несподіваною поведінкою — щось працює не так, як я очікував. " +
      "За настановами цього репо, де це вже могло бути задокументовано? Прочитай той файл.",
    expectFilesRead: ["reviewer-core/INSIGHTS.md"],
    maxTurns: 5,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  // Two independent issues surfaced via eval:repeat, both now fixed:
  //  1. HARNESS BUG (fixed in src/dsl/case.ts + src/records/record.ts): record()'s old
  //     `!result.isError` fallback is not a proxy for "did the check pass" — a session that ends
  //     cleanly without activating the skill is "clean" yet fails, and one that overruns maxTurns
  //     AFTER already activating is "unclean" yet passes. `record()` now takes an explicit
  //     `outcome` derived from the same boolean `expect()` checks, for every workflow kind.
  //  2. REAL FLAKINESS (this case, the positive half only): reconstructing the true pass/fail from
  //     the trace (not the old broken outcome) across 3 observed runs, the skill activated only
  //     once — the other two times the model either read INSIGHTS.md by hand instead of calling
  //     the Skill tool, or stopped to ask clarifying questions first. Unlike the dispatch cases
  //     above, this prompt never told the model to use the skill explicitly — added that command.
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати. Використай для " +
      "цього відповідний skill цього репо — не редагуй INSIGHTS.md вручну і не став уточнювальних " +
      "питань, спершу зафіксуй знахідку.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 6,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 6,
  },
];
