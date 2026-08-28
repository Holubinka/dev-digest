import { hasInjection } from '../../platform/skill-injection.js';

/**
 * Turning an agent's linked skills into the prompt's `## Skills / rules` slot.
 *
 * Moved out of `modules/reviews/helpers.ts` when the eval batch runner needed
 * the SAME two filters: an eval run assembles the same prompt from the same
 * bindings, and a second implementation of "which skills reach the model" would
 * make an eval measure a prompt the live review never sends.
 */

/**
 * The shape of a linked skill this module needs, declared structurally rather
 * than imported from `modules/agents`. `no-cross-module` follows type-only
 * imports too (dependency-cruiser runs with `tsPreCompilationDeps`), so naming
 * the agents module's row type here would be a real violation, not a loophole.
 */
export interface LinkedSkillLike {
  order: number;
  skill: { id: string; name: string; body: string; enabled: boolean };
}

/**
 * The ordered skill bodies for the prompt's `## Skills / rules` slot.
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

export function skillBodiesFor(links: LinkedSkillLike[]): string[] {
  return attachedSkills(links).map((l) => skillBlock(l.skill.name, l.skill.body));
}

/**
 * Prefix a body with its skill's name, unless it already opens with a markdown
 * heading (an imported SKILL.md usually does). Without this the assembled block
 * is an unlabelled wall of markdown, and neither the model nor whoever reads the
 * run trace can tell which rule came from which skill.
 */
export function skillBlock(name: string, body: string): string {
  return /^\s*#{1,6}\s/.test(body) ? body : `### ${name}\n${body}`;
}
