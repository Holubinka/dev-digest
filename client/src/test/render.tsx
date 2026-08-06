import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AbstractIntlMessages } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "../lib/toast";

/**
 * Wrap a component in the providers every screen here needs: a fresh
 * QueryClient, next-intl, and the toast host. `messages` is passed per test
 * because the namespace differs — the agent editor loads `agents` alongside
 * `skills`, the merge modal loads `conventions` alongside it — and a component
 * reading a key nobody provided should fail loudly rather than render a
 * placeholder.
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
