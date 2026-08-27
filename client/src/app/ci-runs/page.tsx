import { CiRunsPage } from "./_components/CiRunsPage";

/* Route: /ci-runs — the agent reviews that ran inside somebody else's CI
   (SPEC-05 § CI Runs page). Thin route entry: the table, its poll banner and its
   empty state are colocated under _components. */
export default function CiRunsRoute() {
  return <CiRunsPage />;
}
