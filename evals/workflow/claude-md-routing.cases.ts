import type { WorkflowCase } from "../src/index.js";

/**
 * Coverage for the remaining rows of root CLAUDE.md's "Read when" table that
 * review-workflow.cases.ts doesn't already exercise, plus the module-AGENTS.md-first rule for
 * client/ and e2e/ (server/ and reviewer-core/ are covered there). Each case folds together every
 * rule that the SAME real task naturally triggers, instead of one session per rule.
 *
 * Budget: 5 Claude sessions total — 5 × trace, 1 session each.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): client/AGENTS.md-first + its own "consume a new endpoint" rule --------
  {
    kind: "trace",
    // client/AGENTS.md's own "Read when" points at ../server/README.md for exactly this scenario
    // ("before consuming a new endpoint the client does not validate"). One cross-module task,
    // one session, two distinct real files — not a forced pairing.
    name: "client task consuming a new endpoint reads client/AGENTS.md and server/README.md",
    prompt:
      "Я хочу додати в client/ кнопку 'Export as markdown', яка викликає НОВИЙ ендпоінт " +
      "GET /reviews/:id/export на сервері (він ще не реалізований). Перш ніж писати хук чи " +
      "компонент — звірся з конвенціями цього репо для роботи в client/ і з тим, де описаний " +
      "контракт серверних роутів.",
    expectFilesRead: ["client/AGENTS.md", "server/README.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): e2e/AGENTS.md-first + its own "where this suite sits" rule -------------
  {
    kind: "trace",
    // e2e/AGENTS.md's own "Read when" points at ../TESTING.md for exactly this scenario. Folds the
    // module-entry rule and the root TESTING.md rule ("before adding a test") into one task.
    name: "new e2e flow task reads e2e/AGENTS.md and TESTING.md",
    prompt:
      "Я хочу написати новий e2e-флоу в e2e/, який перевіряє, що ревʼю відкривається зі списку " +
      "PR. Перш ніж писати сам flow.json — звірся з конвенціями цього репо для роботи в e2e/ і " +
      "з тим, як цей suite співвідноситься з unit- та integration-тестами.",
    expectFilesRead: ["e2e/AGENTS.md", "TESTING.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): docs/architecture.md + "a feature starts with a spec" ------------------
  {
    kind: "trace",
    // Ties two CLAUDE.md rules together on one genuinely cross-package change: "Read
    // docs/architecture.md before changing how a review is produced end to end" AND "A feature
    // starts with a spec" (spec-creator dispatch, before any plan or code).
    // First cut left "спочатку спека" implicit — the model read architecture.md, then dug into
    // grounding.ts/run.ts/run-executor.ts on its own and burned its turn budget instead of
    // dispatching. Needs the same explicit "ОБОВ'ЯЗКОВО запусти сабагента ... не роби сам" command
    // that makes the architecture-reviewer dispatch case reliable.
    name: "end-to-end pipeline change reads architecture.md and dispatches spec-creator",
    prompt:
      "Я хочу додати новий етап у процес ревʼю: після grounding-гейту прогонити знахідки через " +
      "додаткову LLM-перевірку 'чи це дублікат вже відомої знахідки', перш ніж вони потраплять у " +
      "клієнт. Це змінює, як влаштований review end-to-end. Спершу звірся з тим, як уже " +
      "влаштована система (docs/architecture.md). Потім ОБОВ'ЯЗКОВО запусти сабагента " +
      "spec-creator, щоб він написав спеку на цю фічу — не досліджуй код сам і не пиши спеку сам.",
    expectFilesRead: ["docs/architecture.md"],
    expectSubagents: ["spec-creator"],
    maxTurns: 10,
  },

  // --- trace (1 session): docs/agent-prompts/README.md -------------------------------------------
  {
    kind: "trace",
    name: "editing a built-in reviewer's prompt reads docs/agent-prompts/README.md",
    prompt:
      "Я хочу трохи змінити формулювання в системному промпті сабагента architecture-reviewer, " +
      "який зберігається в БД. За правилами цього репо, який документ я маю прочитати перед тим, " +
      "як редагувати вбудований промпт агента? Прочитай його.",
    expectFilesRead: ["docs/agent-prompts/README.md"],
    maxTurns: 5,
  },

  // --- trace (1 session): docs/skills/README.md ---------------------------------------------------
  {
    kind: "trace",
    name: "adding a new skill body reads docs/skills/README.md",
    prompt:
      "Я хочу додати новий skill body для API Contract Reviewer — рубрику про заборонені зміни " +
      "заголовків відповіді. За правилами цього репо, який документ каже, яке питання вже " +
      "закриває кожен існуючий skill і чи він засіяний у БД? Прочитай його перед тим, як писати " +
      "новий файл.",
    expectFilesRead: ["docs/skills/README.md"],
    maxTurns: 5,
  },
];
