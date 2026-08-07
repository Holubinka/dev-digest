import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Providers } from "./providers";
import { ApiError } from "./api";

/**
 * The provider stack's error surfacing, pinned because components depend on it
 * by NOT doing it themselves.
 *
 * `Providers` gives the `QueryClient` a `MutationCache.onError` that toasts every
 * failed mutation. That is why no modal or drawer in this app carries its own
 * `toast.error` on a failed save: a local one is a second copy of the same
 * sentence, and two identical toasts for one click is what this file exists to
 * stop coming back. Queries are the opposite — they only toast on 0/5xx, so an
 * expected 404 can drive an inline empty state.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

function Failing({ status, message }: { status: number; message: string }) {
  const m = useMutation({
    mutationFn: async () => {
      throw new ApiError(message, status);
    },
  });
  return (
    <button onClick={() => m.mutate()} disabled={m.isPending}>
      Save
    </button>
  );
}

function FailingQuery({ status, message }: { status: number; message: string }) {
  const q = useQuery({
    queryKey: ["probe", status, message],
    queryFn: async () => {
      throw new ApiError(message, status);
    },
    retry: false,
  });
  return <div>{q.isError ? "query failed" : "loading"}</div>;
}

/** Every toast currently on screen carrying `message`. */
function toasts(message: string) {
  return within(screen.getByRole("status")).queryAllByText(message);
}

describe("Providers — global error surfacing", () => {
  it("toasts a failed mutation exactly once, with the server's own message", async () => {
    render(
      <Providers>
        <Failing status={409} message="a skill with that name exists" />
      </Providers>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toasts("a skill with that name exists").length).toBe(1));

    // Once, and it stays once — a component adding its own toast.error on top is
    // the regression this asserts against.
    await new Promise((r) => setTimeout(r, 20));
    expect(toasts("a skill with that name exists")).toHaveLength(1);
  });

  it("toasts a 4xx mutation too — a rejected save is never silent", async () => {
    render(
      <Providers>
        <Failing status={400} message="model is not available for this provider" />
      </Providers>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toasts("model is not available for this provider")).toHaveLength(1),
    );
  });

  it("stays quiet on an expected 4xx query, so an empty state can speak instead", async () => {
    render(
      <Providers>
        <FailingQuery status={404} message="no tour yet" />
      </Providers>,
    );
    await screen.findByText("query failed");
    expect(toasts("no tour yet")).toHaveLength(0);
  });

  it("toasts a query that failed for a reason the user cannot read past", async () => {
    render(
      <Providers>
        <FailingQuery status={500} message="the engine is down" />
      </Providers>,
    );
    await waitFor(() => expect(toasts("the engine is down")).toHaveLength(1));
  });
});
