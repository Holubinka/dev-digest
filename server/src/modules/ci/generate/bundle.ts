import type { CiFailOn, CiFile, Provider, ReviewStrategy, RunnerBundleInfo } from '@devdigest/shared';
import {
  BUNDLE_AGENTS_DIR,
  DEVDIGEST_ROOT,
  BUNDLE_SKILLS_DIR,
  LEGACY_WORKFLOW_PATH,
  RUNNER_FILE,
  RUNNER_PATH,
  workflowPathFor,
} from '../constants.js';
import { skillBlock } from '../../_shared/skill-prompt.js';
import type { GeneratedBundle } from '../types.js';
import { buildManifest, manifestToYaml } from './manifest.js';
import { agentSlug as slugFor, disambiguate, slugify } from './slug.js';
import { renderWorkflow, type PostAs } from './workflow.js';

/**
 * The ordered `CiFile[]` of AC-16, and nothing else.
 *
 * Pure by construction: everything it needs — the agent's row, its skills and
 * the built runner — arrives as a parameter. That is what makes AC-25 provable
 * rather than asserted: the generator has no `SecretsProvider`, so no generated
 * file can carry a secret's value.
 */

export interface BundleAgent {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  ciFailOn: CiFailOn;
}

export interface BundleSkill {
  id: string;
  name: string;
  body: string;
}

export interface BundleInput {
  agent: BundleAgent;
  /** Bound skills, in binding order. */
  skills: BundleSkill[];
  runner: RunnerBundleInfo;
  triggers: string[];
  postAs: PostAs;
  /**
   * A workflow the person edited in the wizard, committed instead of the
   * generated one (AC-31, AC-32). Validated by the caller before it gets here.
   */
  workflowOverride?: string | undefined;
}

export function buildBundle(input: BundleInput): GeneratedBundle {
  const agentSlug = slugFor(input.agent);
  const skillSlugs = disambiguate(input.skills.map((s) => slugify(s.name, s.id)));

  const manifest = buildManifest({
    name: input.agent.name,
    model: input.agent.model,
    systemPrompt: input.agent.systemPrompt,
    strategy: input.agent.strategy,
    ciFailOn: input.agent.ciFailOn,
    skillSlugs,
  });

  const files: CiFile[] = [
    {
      path: `${DEVDIGEST_ROOT}/${BUNDLE_AGENTS_DIR}/${agentSlug}.yaml`,
      contents: manifestToYaml(manifest),
      editable: true,
      role: 'manifest',
    },
    ...input.skills.map((skill, i) => ({
      path: `${DEVDIGEST_ROOT}/${BUNDLE_SKILLS_DIR}/${skillSlugs[i]}.md`,
      contents: skillBlock(skill.name, skill.body),
      editable: true,
      role: 'skill' as const,
    })),
    {
      // EMPTY, and that is a requirement rather than a placeholder (AC-95,
      // AC-96): nothing from the workspace database — conventions, `memory`
      // rows or anything else — is written into a file that lives in someone
      // else's repository. Valid JSONL with zero lines is an empty file.
      path: `${DEVDIGEST_ROOT}/memory.jsonl`,
      contents: '',
      editable: true,
      role: 'memory',
    },
    {
      path: RUNNER_PATH,
      contents: input.runner.contents,
      editable: false,
      role: 'runner',
    },
    {
      path: `${DEVDIGEST_ROOT}/.gitattributes`,
      contents: `${RUNNER_FILE} linguist-generated=true\n`,
      editable: false,
      role: 'gitattributes',
    },
    {
      // ONE FILE PER AGENT (AC-135). While this path was a constant, publishing
      // a second agent into a repository overwrote the first agent's workflow
      // and left both installation rows looking healthy.
      path: workflowPathFor(agentSlug),
      contents:
        // `??`, and never `||`: an override that is empty or blank is REFUSED —
        // by `CiExportInput.workflow` at the edge and by
        // `service.refuseBrokenWorkflow` here — while `||` would quietly swap it
        // for the generated file and publish something the reader never wrote.
        input.workflowOverride ??
        renderWorkflow({
          triggers: input.triggers,
          postAs: input.postAs,
          agentSlug,
          agentName: input.agent.name,
        }),
      editable: true,
      role: 'workflow',
    },
  ];

  // The legacy file goes with the same commit, unconditionally (AC-146). The
  // generator cannot know whether the target repository holds it — it reads
  // nothing — so it asks for the END STATE and `commitFiles` skips a path the
  // parent commit does not carry. `WORKFLOW_PREFIX` guarantees this is never
  // one of the paths above: a slug is never empty (AC-105).
  return { files, agentSlug, removals: [LEGACY_WORKFLOW_PATH] };
}
