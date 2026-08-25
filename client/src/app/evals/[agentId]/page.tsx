"use client";

import { useParams } from "next/navigation";
import { EvalAgentView } from "./_components/EvalAgentView";

/* Route: /evals/:agentId — one agent's eval history. Thin route entry; the
   metric cards, trend, batch table, compare modal, their styles and i18n are
   colocated under _components. `useParams` rather than the async `params` prop
   because every screen in this package is a client component. */
export default function EvalAgentPage() {
  const { agentId } = useParams<{ agentId: string }>();
  return <EvalAgentView agentId={agentId} />;
}
