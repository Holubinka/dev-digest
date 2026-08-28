/**
 * Static quality checks for SKILL.md files — no model, no network. The fast gate to run
 * before the (slower) LLM evals.
 *
 *   pnpm eval:quality                 # all skills under .claude/skills
 *   pnpm eval:quality onion-architecture
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import matter from "gray-matter";
import { REPO_ROOT, SKILLS_DIR, EVALS_DIR, WORKFLOW_DIR } from "./artifacts/paths.js";
import type { WorkflowCase } from "./dsl/case.js";

const REQUIRED = ["name", "description"];
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

interface Report {
  skill: string;
  errors: string[];
  warnings: string[];
  verdict: "PASS" | "WARN" | "FAIL";
}

function* internalLinks(body: string): Generator<[string, string]> {
  for (const m of body.matchAll(LINK_RE)) {
    const target = m[2];
    if (/^(https?:|#|mailto:)/.test(target)) continue;
    const path = target.split("#")[0];
    if (path) yield [target, path];
  }
}

function evaluate(skillDir: string): Report {
  const name = basename(skillDir);
  const skillMd = join(skillDir, "SKILL.md");
  if (!existsSync(skillMd)) {
    return { skill: name, errors: [`SKILL.md not found in ${skillDir}`], warnings: [], verdict: "FAIL" };
  }
  const { data: fm, content: body } = matter(readFileSync(skillMd, "utf8"));
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const f of REQUIRED) {
    if (!(f in fm)) errors.push(`missing frontmatter field: ${f}`);
    else if (!fm[f]) errors.push(`empty frontmatter field: ${f}`);
  }
  if (fm.name && fm.name !== name) errors.push(`frontmatter name '${fm.name}' != directory '${name}'`);
  if (body.length < 100) errors.push("SKILL.md body suspiciously short (< 100 chars)");
  if (body.split("\n").filter((l) => l.startsWith("#")).length < 2) errors.push("fewer than 2 headings — likely incomplete");
  for (const [target, path] of internalLinks(body)) {
    if (!existsSync(join(skillDir, path))) errors.push(`broken reference (${target}) — not found: ${path}`);
  }

  const evalFile = join(EVALS_DIR, "skills", name, `${name}.eval.ts`);
  if (!existsSync(evalFile)) warnings.push(`no eval file (expected: ${evalFile.replace(REPO_ROOT + "/", "")})`);
  if (body.split("\n").length > 500) warnings.push(`SKILL.md very long (${body.split("\n").length} lines) — consider splitting`);

  return { skill: name, errors, warnings, verdict: errors.length ? "FAIL" : warnings.length ? "WARN" : "PASS" };
}

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

const verdictColor = (v: Report["verdict"]) => (v === "FAIL" ? RED : v === "WARN" ? YELLOW : GREEN);

/**
 * Anti-pattern gate: a skill with ONLY positive `activation` coverage (never a `shouldActivate:
 * false` near-miss) is one test-suite-editing accident away from "always activates on anything
 * that mentions the topic" going unnoticed — see evals/README.md § Anti-patterns, "testing only
 * positive cases". Scans every real `WorkflowCase[]` (dynamic import, not regex — the source of
 * truth is the actual exported array, not its text) across evals/workflow/*.cases.ts.
 */
async function activationCoverage(): Promise<{ skill: string; positive: boolean; negative: boolean }[]> {
  const bySkill = new Map<string, { positive: boolean; negative: boolean }>();
  if (!existsSync(WORKFLOW_DIR)) return [];
  const files = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith(".cases.ts"));
  for (const f of files) {
    const mod = (await import(pathToFileURL(join(WORKFLOW_DIR, f)).href)) as { cases?: WorkflowCase[] };
    for (const c of mod.cases ?? []) {
      if (c.kind !== "activation") continue;
      const entry = bySkill.get(c.skill) ?? { positive: false, negative: false };
      if (c.shouldActivate) entry.positive = true;
      else entry.negative = true;
      bySkill.set(c.skill, entry);
    }
  }
  return [...bySkill.entries()].map(([skill, v]) => ({ skill, ...v }));
}

async function main() {
  const args = process.argv.slice(2);
  const dirs = args.length
    ? args.map((a) => (a.includes("/") ? a : join(SKILLS_DIR, a)))
    : readdirSync(SKILLS_DIR)
        .map((d) => join(SKILLS_DIR, d))
        .filter((d) => statSync(d).isDirectory() && existsSync(join(d, "SKILL.md")));

  let failures = 0;
  for (const d of dirs.sort()) {
    const r = evaluate(d);
    console.log(`\n${"=".repeat(56)}\n${r.skill}  [${verdictColor(r.verdict)}${r.verdict}${RESET}]\n${"=".repeat(56)}`);
    r.errors.forEach((e) => console.log(`  ${RED}ERROR: ${e}${RESET}`));
    r.warnings.forEach((w) => console.log(`  ${YELLOW}WARN:  ${w}${RESET}`));
    if (!r.errors.length && !r.warnings.length) console.log(`  ${GREEN}all checks passed.${RESET}`);
    if (r.verdict === "FAIL") failures++;
  }

  const coverage = await activationCoverage();
  const unbalanced = coverage.filter((c) => c.positive !== c.negative);
  if (coverage.length) {
    console.log(`\n${"=".repeat(56)}\nworkflow activation coverage\n${"=".repeat(56)}`);
    for (const c of coverage) {
      if (c.positive && c.negative) {
        console.log(`  ${GREEN}OK${RESET}    ${c.skill} — positive + negative`);
      } else if (c.positive) {
        console.log(`  ${RED}ERROR${RESET} ${c.skill} — positive activation only, no near-miss negative`);
        failures++;
      } else {
        console.log(`  ${YELLOW}WARN${RESET}  ${c.skill} — negative only, never confirmed it activates at all`);
      }
    }
  }
  if (unbalanced.some((c) => c.positive && !c.negative)) {
    console.log(`  ${DIM_HINT}`);
  }

  console.log(`\n${"=".repeat(56)}\nTotal: ${dirs.length} skills, ${failures} failures`);
  process.exit(failures ? 1 : 0);
}

const DIM_HINT =
  "\x1b[2madd a `{ kind: \"activation\", shouldActivate: false, ... }` near-miss case for each ERROR above\x1b[0m";

main();
