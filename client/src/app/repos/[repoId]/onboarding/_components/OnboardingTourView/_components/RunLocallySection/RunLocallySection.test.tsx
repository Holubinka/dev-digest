import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import messages from "@/../messages/en/onboarding.json";
import { renderWithProviders } from "@/test/render";
import type {
  OnboardingEnvVar,
  OnboardingPackageBlock,
  OnboardingPackageScan,
  OnboardingSetupCommand,
} from "@/lib/types";
import { RunLocallySection } from "./RunLocallySection";

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(cleanup);

const scan = (over: Partial<OnboardingPackageScan> = {}): OnboardingPackageScan => ({
  depth: 2,
  excluded_dirs: ["node_modules", "dist"],
  found: 1,
  shown: 1,
  bounded: false,
  ...over,
});

const SETUP: OnboardingSetupCommand[] = [
  {
    command: "cp .env.example .env",
    why: "Adds the OPENAI and STRIPE keys the API reads at boot",
    source_path: ".env.example",
  },
];

const API: OnboardingPackageBlock = {
  name: "payments-api",
  path: ".",
  manager: "pnpm",
  install_command: "pnpm install",
  commands: [{ script: "dev", command: "pnpm dev", why: "Starts the API on port 3000" }],
};

const WEB: OnboardingPackageBlock = {
  name: "payments-web",
  path: "web",
  manager: "pnpm",
  install_command: "pnpm install",
  commands: [{ script: "dev", command: "pnpm dev", why: "Starts the site on port 3000" }],
};

interface Over {
  packages?: OnboardingPackageBlock[];
  setupCommands?: OnboardingSetupCommand[];
  envVars?: OnboardingEnvVar[];
  envVarsTruncated?: boolean;
  packageScan?: OnboardingPackageScan;
}

const render = (over: Over = {}) =>
  renderWithProviders(
    <RunLocallySection
      packages={over.packages ?? [API]}
      setupCommands={over.setupCommands ?? SETUP}
      envVars={over.envVars ?? []}
      envVarsTruncated={over.envVarsTruncated ?? false}
      packageScan={over.packageScan ?? scan()}
    />,
    { onboarding: messages },
  );

const commands = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("code")).map((c) => c.textContent);

describe("RunLocallySection — one package", () => {
  it("is one flat numbered list with the setup steps first and no package name", () => {
    // The human's ruling, 2026-08-18: with one package its name distinguishes
    // nothing, so printing it is noise. Setup commands are preconditions for
    // the whole clone, so they come first — before the install.
    const { container } = render();

    expect(commands(container)).toEqual(["cp .env.example .env", "pnpm install", "pnpm dev"]);
    expect(screen.queryByText("payments-api")).toBeNull();
    expect(screen.queryByText(messages.setup.title)).toBeNull();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("copies the string on screen, byte for byte, comment character and pipe included", () => {
    const command = 'grep -rn "sk_live" src/*.ts | head -3 # not a comment in zsh';
    const { container } = render({
      setupCommands: [],
      packages: [{ ...API, install_command: null, commands: [{ script: "audit", command, why: "Finds the leak" }] }],
    });

    const code = container.querySelector("code") as HTMLElement;
    expect(code.textContent).toBe(command);

    fireEvent.click(screen.getByRole("button", { name: `Copy the command ${command}` }));

    expect(writeText).toHaveBeenCalledWith(command);
    // Not the command plus its reason, and not a line with a comment welded on.
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining("Finds the leak"));
  });

  it("offers no control that would run anything — every button here copies", () => {
    const { container } = render();

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b.getAttribute("aria-label")).toMatch(/^Copy the command /);
    }
    expect(container.querySelectorAll("form")).toHaveLength(0);
  });

  it("attributes the commands to the repository", () => {
    render();
    expect(screen.getByText(messages.commandsFromRepo)).toBeInTheDocument();
  });
});

describe("RunLocallySection — several packages", () => {
  it("names every block and gives the setup commands one of their own", () => {
    const { container } = render({ packages: [API, WEB], packageScan: scan({ found: 2, shown: 2 }) });

    expect(screen.getByRole("heading", { name: messages.setup.title })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "payments-api" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "payments-web" })).toBeInTheDocument();
    // Same command in two packages: without the block above it, `pnpm dev`
    // does not say which one it starts.
    expect(commands(container).filter((c) => c === "pnpm dev")).toHaveLength(2);
    expect(screen.queryByText("1", { selector: "span.mono" })).toBeNull();
  });

  it("keeps a package whose lock file names no manager, with no guessed install", () => {
    const { container } = render({
      packages: [API, { ...WEB, manager: null, install_command: null, commands: [] }],
      packageScan: scan({ found: 2, shown: 2 }),
    });

    expect(screen.getByRole("heading", { name: "payments-web" })).toBeInTheDocument();
    expect(commands(container)).toEqual(["cp .env.example .env", "pnpm install", "pnpm dev"]);
  });
});

describe("RunLocallySection — what the walk did not bring back", () => {
  it("names the walk's own parameters when it found no manifest, never a literal", () => {
    render({
      packages: [],
      packageScan: scan({ depth: 7, excluded_dirs: ["vendor", "tmp"], found: 0, shown: 0 }),
    });

    // Rendered FROM the response: a hard-coded `2` and a hand-typed directory
    // list would be a second copy of a server constant, drifting on its first
    // change (AC-24).
    expect(screen.getByText(/7 directories deep/)).toBeInTheDocument();
    expect(screen.getByText(/vendor, tmp/)).toBeInTheDocument();
    expect(screen.queryByText(/node_modules/)).toBeNull();
  });

  it("counts the packages the ceiling dropped, in both plural branches", () => {
    render({ packageScan: scan({ found: 2, shown: 1 }) });
    expect(screen.getByText("1 more package was found and is not shown here")).toBeInTheDocument();

    cleanup();
    render({ packageScan: scan({ found: 4, shown: 1 }) });
    expect(
      screen.getByText("3 more packages were found and are not shown here"),
    ).toBeInTheDocument();
  });

  it("counts them off the SCAN and not off the array of blocks", () => {
    // The collision plan 14 § Constraints records: `packages` is the blocks and
    // `package_scan` is the walk's facts. Nine were walked and one is drawn, so
    // eight are not on the screen — a component reading `found` off the array
    // would say nothing was hidden at all.
    render({ packages: [API], packageScan: scan({ found: 9, shown: 5 }) });

    expect(
      screen.getByText("8 more packages were found and are not shown here"),
    ).toBeInTheDocument();
  });

  it("measures the hidden count against the blocks drawn, not against the ceiling", () => {
    // `found === shown` says the ceiling cut nothing, and it is still not the
    // reader's number: the model writes a `run` entry for some packages and not
    // others, and grounding drops more. Two blocks are drawn out of five walked,
    // so three are missing from the screen and the card says so (AC-90).
    render({ packages: [API, WEB], packageScan: scan({ found: 5, shown: 5 }) });

    expect(
      screen.getByText("3 more packages were found and are not shown here"),
    ).toBeInTheDocument();
  });

  it("never says the walk found nothing on a card that says packages are hidden", () => {
    // The payload that put two contradicting sentences on one card: eight
    // manifests walked, five under the ceiling, and every block dropped by
    // grounding. "No package manifests were found" is the array's answer and it
    // is false — `package_scan.found` is sitting right there saying eight.
    render({
      packages: [],
      setupCommands: [],
      envVars: [],
      packageScan: scan({ depth: 3, found: 8, shown: 5 }),
    });

    expect(screen.queryByText(/No package manifests were found/)).toBeNull();
    expect(screen.queryByText(messages.empty.how_to_run)).toBeNull();
    expect(
      screen.getByText("8 more packages were found and are not shown here"),
    ).toBeInTheDocument();
  });

  it("shows no dropped-package line when nothing was dropped", () => {
    render({ packageScan: scan({ found: 1, shown: 1 }) });
    expect(screen.queryByText(/more package/)).toBeNull();
  });

  it("says the environment list was cut when it was, and stays quiet when it was not", () => {
    const envVars: OnboardingEnvVar[] = [{ name: "STRIPE_KEY", source_path: ".env.example" }];

    render({ envVars, envVarsTruncated: true });
    expect(screen.getByText("STRIPE_KEY")).toBeInTheDocument();
    expect(screen.getByText(messages.envVars.truncated)).toBeInTheDocument();

    cleanup();
    render({ envVars, envVarsTruncated: false });
    expect(screen.queryByText(messages.envVars.truncated)).toBeNull();
  });

  it("keeps its card and says so when nothing about running came back", () => {
    render({
      packages: [],
      setupCommands: [],
      packageScan: scan({ found: 0, shown: 0 }),
    });

    expect(screen.getByText(messages.empty.how_to_run)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: messages.section.howToRun })).toBeInTheDocument();
    expect(screen.queryByText(messages.commandsFromRepo)).toBeNull();
  });
});
