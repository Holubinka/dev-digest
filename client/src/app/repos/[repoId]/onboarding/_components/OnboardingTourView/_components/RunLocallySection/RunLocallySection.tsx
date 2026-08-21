/* RunLocallySection — how to get this repository running, in the repository's
   own words.

   TWO SHAPES, one rule, decided by the human on 2026-08-18. A repository with
   ONE package renders a flat numbered list, exactly as the mockup draws it:
   there the package's name distinguishes nothing, so printing it is noise.
   A repository with SEVERAL renders one named block each — DevDigest itself
   has five packages, and `pnpm install` with no package above it does not say
   which one it installs.

   SETUP COMMANDS COME FIRST IN BOTH. They are preconditions for the whole
   clone — an `.env` copied once, a compose stack started once — not a script
   of any one package, which is why the contract keeps them as a sibling of
   `packages` rather than inside it. In the flat list they are simply the first
   steps, which is where the mockup has `cp .env.example .env`; in the grouped
   one they get their own block, above every package.

   THE BLOCKS ARE `packages`; THE WALK'S FACTS ARE `package_scan`. Two
   different fields, and the collision plan 14 § Constraints records. Every
   claim about the WALK — that it found no manifest, how many it found — is
   read off `package_scan`, because the array is what survived grounding and
   can be empty for a five-package monorepo. And the hidden count is
   `found` minus the blocks DRAWN, never `found - shown`: `shown` is only where
   the ceiling cut, and the model and grounding cut again below it.

   Nothing in this section runs anything (AC-22). Every command comes from a
   manifest or a config file in the clone, every ordering is the server's, and
   the client reorders nothing (AC-92, AC-94).

   THIS SECTION DRAWS NO PROSE, and that is a decision rather than an omission.
   Every section carries a `body`, but measured against a live tour
   (`Holubinka/dev-digest`, 2026-08-18) the four non-architecture bodies restate
   the structured fields beside them — the same files, the same order, the same
   complexity words — so drawing both would print every list twice. Plan 14
   wires `TourProse` into `ArchitectureSection` and nowhere else, and this is
   why. Reported rather than resolved here: whether those bodies should be
   drawn at all is a question about the contract, not about this file.
   Here that also keeps an UNGROUNDED command off the screen: in the live tour
   this section's prose listed `pnpm db:seed` and four other scripts that
   grounding had already dropped as `unknown_script`, and they would have sat
   beside the grounded blocks reading exactly as authoritative. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type {
  OnboardingEnvVar,
  OnboardingPackageBlock,
  OnboardingPackageScan,
  OnboardingSetupCommand,
} from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { CommandRow } from "../CommandRow";
import { s } from "./styles";

interface Line {
  key: string;
  command: string;
  why?: string;
  sourcePath?: string;
}

function packageLines(pkg: OnboardingPackageBlock): Line[] {
  const lines: Line[] = [];
  // `install_command` is null when no lock file names a manager. A package
  // with no manager gets NO install command rather than a guessed one — the
  // root AGENTS.md says outright "do not mix" (AC-87).
  if (pkg.install_command != null && pkg.install_command !== "") {
    lines.push({ key: `${pkg.path}-install`, command: pkg.install_command });
  }
  pkg.commands.forEach((c, i) => {
    lines.push({ key: `${pkg.path}-${c.script}-${i}`, command: c.command, why: c.why });
  });
  return lines;
}

function setupLines(setup: readonly OnboardingSetupCommand[]): Line[] {
  return setup.map((c, i) => ({
    key: `setup-${i}`,
    command: c.command,
    why: c.why,
    sourcePath: c.source_path,
  }));
}

export function RunLocallySection({
  packages,
  setupCommands,
  envVars,
  envVarsTruncated,
  packageScan,
}: {
  packages: readonly OnboardingPackageBlock[];
  setupCommands: readonly OnboardingSetupCommand[];
  envVars: readonly OnboardingEnvVar[];
  /** `true` when the env list was cut at its ceiling and the tail is not here. */
  envVarsTruncated: boolean;
  packageScan: OnboardingPackageScan;
}) {
  const t = useTranslations("onboarding");

  const flat = packages.length <= 1;
  // What the reader is NOT seeing, against what the walk found. `found - shown`
  // is only what the ceiling cut, and the blocks drawn can be fewer than
  // `shown` again: the model writes a `run` entry for some packages and not
  // others, and grounding drops more as `unknown_path`. Measured against
  // `shown`, a card drawing two of five packages says nothing is hidden.
  const hiddenPackages = Math.max(0, packageScan.found - packages.length);
  const commandCount =
    setupCommands.length +
    packages.reduce((n, pkg) => n + packageLines(pkg).length, 0);
  // BOTH EMPTY STATES ARE THE WALK'S, so both are read off the walk's own
  // count. `packages` is what survived grounding, and it is empty for a
  // five-package monorepo whose every block was dropped — "No package manifests
  // were found" is false on exactly that screen, and it used to sit directly
  // above "3 more packages were found and are not shown here" (AC-24, AC-90).
  const walkFoundNothing = packageScan.found === 0;
  const nothingAtAll =
    walkFoundNothing &&
    setupCommands.length === 0 &&
    packages.length === 0 &&
    envVars.length === 0;

  const flatLines = flat
    ? [...setupLines(setupCommands), ...(packages[0] ? packageLines(packages[0]) : [])]
    : [];

  return (
    <SectionCard kind="how_to_run">

      {flat ? (
        <div style={s.rows}>
          {flatLines.map((line, i) => (
            <CommandRow
              key={line.key}
              index={i + 1}
              command={line.command}
              why={line.why}
              sourcePath={line.sourcePath}
            />
          ))}
        </div>
      ) : (
        <>
          {setupCommands.length > 0 && (
            <div style={s.block}>
              <div style={s.blockHead}>
                <h3 style={s.blockName}>{t("setup.title")}</h3>
              </div>
              <p style={s.blockNote}>{t("setup.note")}</p>
              <div style={s.rows}>
                {setupLines(setupCommands).map((line) => (
                  <CommandRow
                    key={line.key}
                    command={line.command}
                    why={line.why}
                    sourcePath={line.sourcePath}
                  />
                ))}
              </div>
            </div>
          )}
          {packages.map((pkg) => (
            <div key={pkg.path} style={s.block}>
              <div style={s.blockHead}>
                <h3 style={s.blockName}>{pkg.name}</h3>
                {/* The directory the commands are run in. Without it a block in
                    a monorepo names a package but not where to stand. */}
                {pkg.path !== "" && pkg.path !== "." && (
                  <span className="mono" style={s.blockPath}>
                    {pkg.path}
                  </span>
                )}
              </div>
              <div style={s.rows}>
                {packageLines(pkg).map((line) => (
                  <CommandRow key={line.key} command={line.command} why={line.why} />
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {(envVars.length > 0 || envVarsTruncated) && (
        <div style={s.block}>
          <div style={s.blockHead}>
            <h3 style={s.blockName}>{t("envVars.title")}</h3>
          </div>
          {envVars.length > 0 && <p style={s.blockNote}>{t("envVars.note")}</p>}
          {envVars.length > 0 && (
            <ul style={s.envList}>
              {envVars.map((v, i) => (
                <li key={`${v.name}-${i}`} style={s.envRow}>
                  <code className="mono" style={s.envName}>
                    {v.name}
                  </code>
                  <span style={s.envSource}>{t("sourceFile", { path: v.source_path })}</span>
                </li>
              ))}
            </ul>
          )}
          {envVarsTruncated && <p style={s.note}>{t("envVars.truncated")}</p>}
        </div>
      )}

      {nothingAtAll && <p style={s.note}>{t("empty.how_to_run")}</p>}

      {walkFoundNothing && (
        <p style={s.note}>
          {t("noPackages", { count: packageScan.depth })}
          {packageScan.excluded_dirs.length > 0 &&
            ` ${t("noPackagesExcluded", { excluded: packageScan.excluded_dirs.join(", ") })}`}
        </p>
      )}

      {hiddenPackages > 0 && <p style={s.note}>{t("packagesHidden", { count: hiddenPackages })}</p>}

      {commandCount > 0 && <p style={s.note}>{t("commandsFromRepo")}</p>}
    </SectionCard>
  );
}
