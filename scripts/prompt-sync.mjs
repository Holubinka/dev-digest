#!/usr/bin/env node
/**
 * prompt-sync — the two file copies of every reviewer prompt must stay equal.
 *
 * A reviewer prompt lives in three places (docs/agent-prompts/README.md):
 *
 *   1. docs/agent-prompts/<name>.md   the copy a person reads and reviews
 *   2. server/src/db/seed-prompts.ts  a template literal `pnpm db:seed` upserts
 *   3. agents.system_prompt in the DB the one the model actually receives
 *
 * Nothing in the type system connects them. A prompt improved in the doc and in
 * the DB but not in the seed constant is silently reverted the next time anyone
 * seeds a database — the change survives until a fresh clone, then vanishes.
 *
 * This compares 1 against 2. It cannot check 3: CI has no database and no
 * agents, so the DB copy stays a manual `PUT /agents/:id` and the README says so.
 *
 * No dependencies and no build on purpose — it reads two files and compares
 * strings, the same way the shared-sync gate is a directory diff.
 *
 * Run locally:  node scripts/prompt-sync.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = "server/src/db/seed-prompts.ts";
const DOCS = "docs/agent-prompts";

/** Constant in the seed file ⇄ canonical markdown beside the README. */
const PROMPTS = [
  ["GENERAL_REVIEWER_PROMPT", "general-reviewer.md"],
  ["SECURITY_REVIEWER_PROMPT", "security-reviewer.md"],
  ["PERFORMANCE_REVIEWER_PROMPT", "performance-reviewer.md"],
  ["TEST_QUALITY_REVIEWER_PROMPT", "test-quality-reviewer.md"],
  ["API_CONTRACT_REVIEWER_PROMPT", "api-contract-reviewer.md"],
];

/**
 * The body of `export const NAME = \`…\`;`, un-escaped back to what the model
 * receives.
 *
 * Scanned rather than matched with a regex because the literal legitimately
 * contains escaped backticks — `\`file:line\`` — and a lazy `/`([^`]*)`/` would
 * stop at the first one and silently compare a fragment. Returns null when the
 * constant is missing, which is itself a failure worth naming.
 */
function seedLiteral(source, name) {
  const opener = `export const ${name} = \``;
  const from = source.indexOf(opener);
  if (from === -1) return null;

  let i = from + opener.length;
  let out = "";
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      const next = source[i + 1];
      // `\\` must be checked BEFORE `` \` `` / `\$`: a doc quoting a template
      // literal that itself contains a backtick needs an escaped backslash
      // *followed by* an escaped backtick (source `\\\``, four characters, for
      // one literal `\` + one literal backtick) — checking `` \` `` first would
      // consume the first two of those four chars as "an escaped backtick" and
      // desync the rest of the scan by one character.
      if (next === "\\") {
        out += "\\";
        i += 2;
        continue;
      }
      // The two sequences a template literal otherwise forces us to escape.
      // Anything else keeps its backslash, so a prompt that one day contains a
      // real `\n` two-character sequence is not corrupted.
      if (next === "`" || next === "$") {
        out += next;
        i += 2;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "`") return out;
    out += ch;
    i += 1;
  }
  return null; // unterminated literal
}

const source = readFileSync(join(root, SEED), "utf8");
const problems = [];

for (const [constant, file] of PROMPTS) {
  const seed = seedLiteral(source, constant);
  if (seed === null) {
    problems.push({ file, constant, why: `${constant} is missing from ${SEED}, or its literal is unterminated` });
    continue;
  }

  let doc;
  try {
    doc = readFileSync(join(root, DOCS, file), "utf8");
  } catch {
    problems.push({ file, constant, why: `${DOCS}/${file} does not exist` });
    continue;
  }

  // Both sides are compared trimmed: the seed literal starts right after the
  // opening backtick and the markdown file ends with a newline, and neither
  // difference reaches the model.
  if (seed.trim() === doc.trim()) continue;

  const a = seed.trim().split("\n");
  const b = doc.trim().split("\n");
  const at = Array.from({ length: Math.max(a.length, b.length) }).findIndex((_, i) => a[i] !== b[i]);
  problems.push({
    file,
    constant,
    why: `differs from ${DOCS}/${file} at line ${at + 1}`,
    seed: a[at],
    doc: b[at],
  });
}

if (problems.length === 0) {
  console.log(`prompt-sync: all ${PROMPTS.length} reviewer prompts match ${SEED}.`);
  process.exit(0);
}

for (const p of problems) {
  console.error(`\n${p.constant} — ${p.why}`);
  if (p.seed !== undefined) {
    console.error(`   seed: ${JSON.stringify(p.seed ?? null)}`);
    console.error(`   doc : ${JSON.stringify(p.doc ?? null)}`);
  }
}
console.error(`
------------------------------------------------------------------
${problems.length} reviewer prompt(s) drifted.

docs/agent-prompts/*.md is the copy to read and review; the constant
in ${SEED} is what \`pnpm db:seed\` writes. When they
disagree, seeding a database reverts the prompt.

Decide which side is right — the doc is usually the intended one, but
not always; a prompt fixed directly in the seed file to unbreak a seed
is the exception. Then make them equal, re-run this, and remember the
third copy this gate cannot see:

  node scripts/prompt-sync.mjs
  # then push the prompt to the running agent, which versions it:
  #   PUT /agents/:id  { "system_prompt": "<the file's contents>" }
------------------------------------------------------------------`);
process.exit(1);
