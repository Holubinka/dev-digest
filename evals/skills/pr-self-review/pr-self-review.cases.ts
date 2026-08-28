import type { SkillCase } from "../../src/index.js";

// pr-self-review's own SKILL.md is a *procedure* for an orchestrator that dispatches
// subagents and runs real Bash gates — skillTask has no tools, so these cases don't try to
// exercise the procedure itself (that's what evals/workflow/ activation cases would be for).
// What they test is whether a model that has only READ this skill's content (SKILL.md plus
// its flat-sibling references — gates.md, modes.md, routing.md, severity.md, README.md, all
// auto-inlined by skillContent()) correctly internalizes three of its sharpest, most
// specifically-documented rules — the kind of rule a vaguer restatement would blur.

export const cases: SkillCase[] = [
  {
    name: "grades an OWASP-shaped finding critical even when a teammate calls it bounded",
    kind: "quality",
    prompt: `You are executing /pr-self-review Step 3 — grading a finding for the security agent's
part of the report, using this skill's own severity rules.

Diff under review — new file server/src/modules/settings/webhook.ts:

\`\`\`ts
export async function sendWebhook(url: string, payload: unknown) {
  if (url.toLowerCase().includes('localhost') || url.startsWith('127.0.0.1')) {
    throw new Error('Webhook URL cannot target localhost');
  }
  return fetch(url, { method: 'POST', body: JSON.stringify(payload) });
}
\`\`\`

\`url\` comes from a user-editable workspace setting (\`WebhookConfig.url\`) with no other
validation. A teammate commented on the PR: "This looks fine to me — it explicitly blocks
localhost, so the blast radius is bounded to external hosts only."

Grade this finding the way the security agent would, and say explicitly whether you agree
with the teammate's "bounded" reasoning.`,
    practices: [
      "grades the finding as critical (an SSRF / server-side request forgery shape), not major, minor, or note",
      "explicitly states or applies the rule that an OWASP-shaped finding is critical even when its blast radius looks bounded, rather than accepting a lower grade because a mitigation exists",
      "explains concretely why the localhost/127.0.0.1 substring check does not actually bound the input — e.g. it does not block other loopback or internal-network representations (0.0.0.0, [::1], decimal/octal/hex IP encodings, a DNS name that resolves to an internal address), so an attacker can still reach internal hosts",
      "does not use a severity word outside this skill's four legal values (critical, major, minor, note) — e.g. never writes 'high' or 'medium'",
    ],
    threshold: 0.65,
    maxTurns: 6,
  },
  {
    name: "refuses to run when the current branch is main",
    kind: "quality",
    prompt: `The user says: "Run /pr-self-review on this branch, I want to push."

You run step 1 of the procedure (scope.sh) and its output includes:

\`\`\`json
{ "branch": "main", "base": "e59ab57...", "head": "e59ab57..." }
\`\`\`

What do you do next?`,
    practices: [
      "explicitly stops / refuses to proceed with the review because the current branch is main",
      "tells the user to create or switch to a branch before this skill can run, rather than proceeding anyway",
      "does not run Track A gates or dispatch any Track B subagent against main",
      "gives a reason tied to there being no base to diff against and no PR to gate on main, not a vague 'main is special' statement",
    ],
    threshold: 0.65,
    maxTurns: 6,
  },
  {
    name: "a repo skill overrules a pinned upstream one, and the upstream rule is not reported at all",
    kind: "quality",
    prompt: `You are the conventions agent executing /pr-self-review Step 3 over this diff for a
new file, server/src/modules/onboarding/schema.ts:

\`\`\`ts
export const onboardingSteps = pgTable('onboarding_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
});

const db = drizzle(pool);

export async function listSteps() {
  return db.select().from(onboardingSteps);
}
\`\`\`

The query lives at module scope, right beside the schema it queries — the exact pattern
\`drizzle-orm-patterns\`' own Example 1 shows as the recommended way to build the client and
query.

Follow this skill's own output contract for Track B findings exactly: return a JSON array
and no prose, each element {severity, source, file, line, message, fix}, severity one of
critical/major/minor/note, source starting "agent conventions · ".`,
    practices: [
      "the reply is a JSON array of finding objects (severity, source, file, line, message, fix) with no surrounding prose, per this skill's output contract",
      "flags this as a violation of this repo's own onion-architecture rule that Drizzle queries belong in a repository.ts (source names onion-architecture), not approving it or treating it as acceptable",
      "no finding's message or fix mentions, cites, or credits drizzle-orm-patterns — the upstream rule is not reported at all, not even as a note",
      "reports one finding for this line, not two contradictory ones (one citing onion-architecture, another citing drizzle-orm-patterns)",
    ],
    threshold: 0.65,
    maxTurns: 6,
  },
];
