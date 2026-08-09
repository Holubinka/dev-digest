/**
 * `list_agents` (spec 06 step 6).
 *
 * Where the model gets a valid agent name. Every agent is returned, disabled
 * ones included: "disabled" is usually the explanation for a review that will
 * not start, and a filtered-out agent explains nothing.
 */

import type { ApiClient } from '../api/client.js';
import { AgentSummary } from '../api/schemas.js';
import { okResult, type ToolTextResult } from '../errors.js';
import { projectAgents } from '../project.js';
import { z } from 'zod';

const AgentList = z.array(AgentSummary);

export async function listAgents(client: ApiClient): Promise<ToolTextResult> {
  const agents = await client.get('/agents', AgentList);
  const projected = projectAgents(agents);

  if (projected.length === 0) {
    return okResult({
      agents: [],
      note:
        'No reviewer agents are configured in DevDigest. Ask the user to create one on the ' +
        'Agents page in the DevDigest UI — this server cannot create agents.',
    });
  }
  return okResult({ agents: projected });
}
