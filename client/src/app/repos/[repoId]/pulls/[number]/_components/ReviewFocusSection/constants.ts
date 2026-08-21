import type { RiskBriefInputStatus } from "@devdigest/shared";

/**
 * Input status → its message key, or `null` for a value the contract does not
 * carry. next-intl THROWS on a missing key, which would take the whole section
 * down over one unexpected string from an unvalidated response; the caller
 * renders the raw value instead (the same guard `SmartDiffViewer`'s `chipFor`
 * exists for).
 */
const STATUS_KEY: Record<RiskBriefInputStatus, string> = {
  included: "riskBrief.status.included",
  truncated: "riskBrief.status.truncated",
  dropped: "riskBrief.status.dropped",
  missing: "riskBrief.status.missing",
};

export function statusKey(status: string): string | null {
  return Object.hasOwn(STATUS_KEY, status) ? STATUS_KEY[status as RiskBriefInputStatus] : null;
}

/**
 * How many focus rows stand open before the rest go behind a disclosure.
 *
 * The server caps `review_focus` at 10 today
 * (`server/src/modules/brief/constants.ts`), so the overflow branch is not
 * reachable through the API right now. It is built and tested anyway: the cap is
 * a server constant one commit away from changing, and the alternative is a
 * full-width block whose length is bounded by something no reader of this
 * component can see.
 */
export const FOCUS_SHOWN = 10;
