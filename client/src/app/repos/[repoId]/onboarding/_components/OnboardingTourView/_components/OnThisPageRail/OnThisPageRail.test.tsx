/**
 * The rail: five real anchors, the section headings as their labels, and the
 * one the URL names marked.
 */
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import { SECTION_ORDER } from "../../sections";
import { OnThisPageRail } from "./OnThisPageRail";

afterEach(cleanup);

const render = (activeAnchor = "architecture") =>
  renderWithProviders(<OnThisPageRail activeAnchor={activeAnchor} />, { onboarding: messages });

describe("OnThisPageRail", () => {
  it("lists the five section headings, in SECTION_ORDER's order, under the mockup's label", () => {
    render();

    expect(screen.getByText("ON THIS PAGE")).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([
      "Architecture overview",
      "Critical paths",
      "How to run locally",
      "Guided reading path",
      "First tasks",
    ]);
  });

  it("uses real fragment anchors, so keyboard and middle-click work with no handler", () => {
    render();

    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      SECTION_ORDER.map((section) => `#${section.anchor}`),
    );
  });

  it("marks exactly the section the URL names", () => {
    render("how-to-run");

    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current"));
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("How to run locally");
  });
});
