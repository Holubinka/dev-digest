import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentListItem } from "@devdigest/shared";
import messages from "../../../../../messages/en/agents.json";
import { AgentCard } from "./AgentCard";

afterEach(cleanup);

const AGENT: AgentListItem = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
  skill_count: 3,
};

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("AgentCard (smoke)", () => {
  it("renders the agent name, model chip and skill count", () => {
    renderWithIntl(<AgentCard ag={AGENT} />);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    expect(screen.getByText("3 skills")).toBeInTheDocument();
  });

  it("takes the count from the row, so no caller can render the card without it", () => {
    // The badge used to depend on an optional `skillCount` prop that neither
    // list passed, which is why it never appeared in the app.
    renderWithIntl(<AgentCard ag={{ ...AGENT, skill_count: 7 }} />);
    expect(screen.getByText("7 skills")).toBeInTheDocument();
  });

  it("says an agent binds nothing instead of hiding the badge", () => {
    renderWithIntl(<AgentCard ag={{ ...AGENT, skill_count: 0 }} />);
    expect(screen.getByText("No skills")).toBeInTheDocument();
  });

  it("uses the singular for one skill", () => {
    renderWithIntl(<AgentCard ag={{ ...AGENT, skill_count: 1 }} />);
    expect(screen.getByText("1 skill")).toBeInTheDocument();
  });

  it("falls back to a translated placeholder when description is empty", () => {
    renderWithIntl(<AgentCard ag={{ ...AGENT, description: "" }} />);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });
});
