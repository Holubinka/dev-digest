import { describe, it, expect, afterEach } from "vitest";
// `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package (`client/INSIGHTS.md:1078`).
import { screen, cleanup, fireEvent } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import { SectionCard } from "./SectionCard";

afterEach(cleanup);

const render = (kind: Parameters<typeof SectionCard>[0]["kind"]) =>
  renderWithProviders(
    <SectionCard kind={kind}>
      <p>section body</p>
    </SectionCard>,
    { onboarding: messages },
  );

describe("SectionCard", () => {
  it("takes its heading from messages and its anchor from the descriptor", () => {
    const { container } = render("critical_paths");

    expect(
      screen.getByRole("heading", { name: messages.section.criticalPaths }),
    ).toBeInTheDocument();
    expect(container.querySelector("#critical-paths")).not.toBeNull();
  });

  it("is expanded on open and carries its body", () => {
    const { container } = render("architecture");
    const details = container.querySelector("details");

    // What the card CONTAINS, never what is visible: jsdom toggles `<details>`
    // but does not hide the closed content, so a visibility assertion here
    // could not fail (`client/INSIGHTS.md:1160`).
    expect(details?.open).toBe(true);
    expect(screen.getByText("section body")).toBeInTheDocument();
  });

  it("collapses on the summary, which is the whole of the chevron control", () => {
    const { container } = render("first_tasks");
    const details = container.querySelector("details");

    fireEvent.click(container.querySelector("summary") as HTMLElement);

    expect(details?.open).toBe(false);
  });
});
