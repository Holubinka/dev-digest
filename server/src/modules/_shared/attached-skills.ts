/**
 * Which of an agent's linked skills actually become instructions, and how one
 * is labelled — one rule, every consumer.
 *
 * `modules/reviews` assembles them into a prompt; `modules/ci` writes them into
 * a target repository's `.devdigest/skills/`. `no-cross-module` forbids either
 * reaching into the other, and while the filter lived in `reviews/helpers.ts`
 * the CI export simply did not apply it: a globally-disabled skill, and a body
 * the injection detector had flagged, were both published into someone else's
 * repository and executed there, while the same agent in the studio ignored
 * them. That is the escape `_shared/` exists for, and `_shared/bundle-paths.ts`
 * is the same move for the same pair of slices.
 */

import { hasInjection } from '../../platform/skill-injection.js';

/**
 * The shape of a linked skill this rule needs, declared structurally rather
 * than imported from `modules/agents`. `no-cross-module` follows type-only
 * imports too (dependency-cruiser runs with `tsPreCompilationDeps`), so naming
 * the agents module's row type here would be a real violation, not a loophole.
 */
export interface LinkedSkillLike {
  order: number;
  skill: { id: string; name: string; body: string; enabled: boolean };
}

/**
 * The ordered skills that may become instructions.
 *
 * Two filters, for different reasons.
 *
 * A globally-disabled skill is dropped because the toggle on the Skills screen
 * gates a skill for EVERY agent, while the `agent_skills` row is only the
 * binding — disabling one leaves its binding and its order intact and simply
 * stops it reaching the model.
 *
 * A body that trips the injection detector is dropped no matter what its
 * `enabled` flag says. The service already refuses to enable one, so this is
 * the second lock: a row edited straight in the database, or flagged by a rule
 * added after it was enabled, still cannot reach the prompt.
 *
 * `attachedSkills` exists so nothing has to restate those two filters. The Live
 * Log used to build its name list from `enabled` alone, so a skill dropped for
 * injection was still announced as attached and the count disagreed with the
 * names beside it — a log that lies exactly where someone is debugging why a
 * rule did not apply.
 */
export function attachedSkills(links: LinkedSkillLike[]): LinkedSkillLike[] {
  return [...links]
    .sort((a, b) => a.order - b.order)
    .filter((l) => l.skill.enabled && !hasInjection(l.skill.body));
}

/**
 * Prefix a body with its skill's name, unless it already opens with a markdown
 * heading (an imported SKILL.md usually does). Without this the assembled block
 * is an unlabelled wall of markdown, and neither the model nor whoever reads the
 * run trace can tell which rule came from which skill.
 *
 * Shared rather than restated: a CI review that labelled its skills differently
 * from a studio review would produce a different prompt from the same agent.
 */
export function skillBlock(name: string, body: string): string {
  return /^\s*#{1,6}\s/.test(body) ? body : `### ${name}\n${body}`;
}
