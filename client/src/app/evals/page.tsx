import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /evals (Skills Lab · Eval Dashboard). Thin route entry — the agent
   cards, the all-agents batch table, their styles and i18n are colocated under
   _components. */
export default function EvalDashboardPage() {
  return <EvalDashboardView />;
}
