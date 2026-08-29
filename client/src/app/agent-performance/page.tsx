import { Suspense } from "react";
import { AgentPerformanceView } from "./_components/AgentPerformanceView";

/* Route: /agent-performance — every agent's runs, cost, duration and accept rate
   over one period (SPEC-07). Thin route entry; the screen is colocated below.

   `useSearchParams` opts a client component into CSR bailout, which Next
   requires a Suspense boundary above — the period lives in the query string. */
export default function AgentPerformanceRoute() {
  return (
    <Suspense>
      <AgentPerformanceView />
    </Suspense>
  );
}
