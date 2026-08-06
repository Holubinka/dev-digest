import type { ConventionCandidate } from "@devdigest/shared";

/**
 * Turn accepted candidates into a skill body.
 *
 * Only `accepted` rows go in — a rejected rule is a decision, and a body that
 * quietly carried it would make the reject button a lie. Rules are grouped by
 * category so the agent reads related rules together, and every rule keeps its
 * `file:line` so a finding can point back at the code that established it.
 */
export function composeSkillBody(
  candidates: ConventionCandidate[],
  repoName: string,
): string {
  const accepted = candidates.filter((c) => c.status === "accepted");
  const lines: string[] = [
    `# ${skillName(repoName)}`,
    "",
    `House conventions observed in \`${repoName}\`. Flag any change that violates a rule` +
      " below, and cite the offending `file:line`. A rule not violated by this diff is not a" +
      " finding.",
  ];

  for (const category of categoriesOf(accepted)) {
    lines.push("", `## ${category}`);
    for (const c of accepted.filter((x) => x.category === category)) {
      lines.push("", c.rule);
      const sites = evidenceSites(c);
      if (sites.length > 0) lines.push("", `Observed at ${sites.join(", ")}.`);
    }
  }

  return lines.join("\n");
}

/** Every `file:line` the rule was verified at, first site first. */
function evidenceSites(c: ConventionCandidate): string[] {
  const first =
    c.evidence_path && c.evidence_line != null
      ? [`\`${c.evidence_path}:${c.evidence_line}\``]
      : [];
  return [...first, ...c.extra_evidence.map((e) => `\`${e.path}:${e.line}\``)];
}

/** Categories present, in the order the accepted list first mentions them. */
function categoriesOf(accepted: ConventionCandidate[]): string[] {
  return [...new Set(accepted.map((c) => c.category))];
}

/** `acme/payments-api` → `payments-api-conventions`. */
export function skillName(repoName: string): string {
  const bare = repoName.split("/").pop() ?? repoName;
  return `${bare}-conventions`;
}

/** The files the body leans on, recorded on the skill as its provenance. */
export function evidenceFiles(candidates: ConventionCandidate[]): string[] {
  const paths = candidates
    .filter((c) => c.status === "accepted")
    .flatMap((c) => [c.evidence_path, ...c.extra_evidence.map((e) => e.path)]);
  return [...new Set(paths.filter((p): p is string => !!p))];
}
