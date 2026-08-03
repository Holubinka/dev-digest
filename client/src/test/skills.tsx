import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AbstractIntlMessages } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SkillListItem } from "@devdigest/shared";
import { ToastProvider } from "../lib/toast";

/**
 * Shared scaffolding for the skills screens. Five test files were building the
 * same eleven-field row by hand, so a field added to the contract meant five
 * edits and a typecheck failure in each.
 */

export function skill(over: Partial<SkillListItem> = {}): SkillListItem {
  return {
    id: "sk1",
    name: "uncovered-branch-rubric",
    description: "List every branch the diff adds and name the test covering it.",
    type: "rubric",
    source: "manual",
    enabled: true,
    version: 3,
    evidence_files: null,
    agents: 2,
    injection: [],
    ...over,
  };
}

/**
 * Wrap in the providers a skills component needs. `messages` is passed per test
 * because the namespace differs — the agent editor loads `agents` alongside
 * `skills` — and a component reading a key nobody provided should fail loudly
 * rather than render a placeholder.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  messages: AbstractIntlMessages,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <ToastProvider>{ui}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
