import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SkillImportPreview } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../lib/toast";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }));

import { ImportSkillDrawer } from "./ImportSkillDrawer";

const PREVIEW: SkillImportPreview = {
  name: "Flakiness patterns",
  description: "Flag real clocks and shared state in tests.",
  type: "custom",
  source: "imported_file",
  body: "# Flakiness\nNever sleep in a test.",
  enabled: false,
  evidence_files: ["SKILL.md", "reference.md"],
  core_path: "SKILL.md",
  skipped: [
    { path: "scripts/check.sh", reason: "executable" },
    { path: "logo.png", reason: "not_markdown" },
  ],
  bytes: 812,
  warnings: [],
};

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  nav.push.mockReset();
  fetchMock = vi.fn(async (url: string) =>
    String(url).includes("/skills/import/")
      ? jsonResponse(PREVIEW)
      : jsonResponse({ ...PREVIEW, id: "sk-new", version: 1 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDrawer() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <ToastProvider>
          <ImportSkillDrawer onClose={() => {}} />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

async function uploadSkillZip() {
  renderDrawer();
  const input = screen.getByLabelText("Choose a file");
  fireEvent.change(input, {
    target: { files: [new File(["zip bytes"], "pack.zip", { type: "application/zip" })] },
  });
  await screen.findByText("SKILL.md");
}

describe("ImportSkillDrawer", () => {
  it("shows what became the body, and every entry it refused to read", async () => {
    await uploadSkillZip();

    expect(screen.getByText("Body taken from")).toBeInTheDocument();
    expect(screen.getByText("SKILL.md")).toBeInTheDocument();
    expect(screen.getByText("2 Markdown files found")).toBeInTheDocument();

    expect(screen.getByText("scripts/check.sh")).toBeInTheDocument();
    expect(screen.getByText("executable — never opened")).toBeInTheDocument();
    expect(screen.getByText("logo.png")).toBeInTheDocument();
    expect(screen.getByText("not Markdown")).toBeInTheDocument();
  });

  it("says plainly that the body will become instructions", async () => {
    await uploadSkillZip();
    expect(screen.getByText("This body becomes instructions.")).toBeInTheDocument();
    expect(screen.getByText(/it is not quoted as data/)).toBeInTheDocument();
  });

  it("saves NOTHING until the user confirms", async () => {
    await uploadSkillZip();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/skills/import/preview");
  });

  it("persists on confirmation, disabled, keeping the provenance", async () => {
    await uploadSkillZip();
    fireEvent.click(screen.getByText("Save as disabled"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toContain("/skills");
    expect(String(url)).not.toContain("/import/");

    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent).toMatchObject({
      name: "Flakiness patterns",
      source: "imported_file",
      enabled: false,
    });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/skills/sk-new?tab=config"));
  });

  it("carries an edit made in the preview into what is saved", async () => {
    await uploadSkillZip();
    fireEvent.change(screen.getByDisplayValue("Flakiness patterns"), {
      target: { value: "Renamed before saving" },
    });
    fireEvent.click(screen.getByText("Save as disabled"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const sent = JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body));
    expect(sent.name).toBe("Renamed before saving");
  });

  it("fetches a URL server-side rather than from the browser", async () => {
    renderDrawer();
    fireEvent.click(screen.getByText("From URL"));
    fireEvent.change(screen.getByPlaceholderText("https://example.com/skills/flakiness.md"), {
      target: { value: "https://example.com/s.md" },
    });
    fireEvent.click(screen.getByText("Fetch"));

    await screen.findByText("SKILL.md");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/skills/import/url");
    const sent = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(sent).toEqual({ url: "https://example.com/s.md" });
  });
});
