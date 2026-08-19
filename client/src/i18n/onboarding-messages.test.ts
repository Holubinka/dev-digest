/**
 * Every countable string in the Onboarding Tour namespace, formatted on BOTH
 * branches.
 *
 * The guard everyone writes is an assertion on the plural branch, and a
 * hard-coded `"{count} packages"` satisfies `2` forever — that is how
 * `"1 skills"` shipped twice (`client/INSIGHTS.md:400-433`). So each case here
 * asserts the singular reads correctly AND that the plural spelling is absent
 * from it.
 *
 * It lives beside the message loader rather than in a component test because
 * the strings are P1's contract: the five components that render them are
 * written in later packages, and a plural that is wrong here would be wrong in
 * every one of them at once.
 */
import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import onboarding from "../../messages/en/onboarding.json";

const t = createTranslator({
  locale: "en",
  messages: { onboarding } as never,
  namespace: "onboarding" as never,
}) as unknown as (key: string, values?: Record<string, unknown>) => string;

describe("messages/en/onboarding.json — plurals", () => {
  it("counts indexed files, and groups the number the way the design shows it", () => {
    expect(t("provenance", { count: 1, ago: "2h" })).toBe(
      "Generated from index of 1 file · last refreshed 2h ago",
    );
    // The mockup's own figure: the grouping separator comes from ICU's `#`,
    // never from a client-side formatter (AC-78).
    expect(t("provenance", { count: 12450, ago: "2h" })).toContain("12,450 files");
  });

  it("counts the scan's depth", () => {
    expect(t("noPackages", { count: 1 })).toContain("1 directory");
    expect(t("noPackages", { count: 1 })).not.toContain("1 directories");
    expect(t("noPackages", { count: 2 })).toContain("2 directories");
  });

  it("counts the packages the ceiling cut", () => {
    expect(t("packagesHidden", { count: 1 })).toBe(
      "1 more package was found and is not shown here",
    );
    expect(t("packagesHidden", { count: 2 })).toBe(
      "2 more packages were found and are not shown here",
    );
  });

  it("counts the files a partial index skipped", () => {
    expect(t("partial", { count: 1 })).toContain("1 file was skipped");
    expect(t("partial", { count: 4 })).toContain("4 files were skipped");
  });
});

describe("messages/en/onboarding.json — the texts a copy change must not soften", () => {
  it("names the five sections this feature actually builds, and no others", () => {
    const body = t("generate.body");
    for (const section of [
      "architecture overview",
      "critical paths",
      "how to run it locally",
      "guided reading path",
      "first tasks",
    ]) {
      expect(body).toContain(section);
    }
    // The three the scaffolding used to promise and this feature does not build.
    for (const ghost of ["key modules", "conventions & gotchas", "getting started"]) {
      expect(body).not.toContain(ghost);
    }
  });

  it("promises nothing about waiting when there is no index", () => {
    // `IndexStatus` has no "building" member, so "it is nearly ready" is a
    // claim the system has no way to check (AC-84). Asserted on the string
    // itself so a copy edit cannot quietly reintroduce one.
    const text = `${t("refusal.noIndex.title")} ${t("refusal.noIndex.body")}`.toLowerCase();
    for (const promise of ["shortly", "soon", "in progress", "try again in", "wait", "nearly"]) {
      expect(text).not.toContain(promise);
    }
  });

  it("keeps the three refusals distinguishable from one another", () => {
    const texts = [
      t("refusal.noIndex.body"),
      t("refusal.indexFailed.body"),
      t("refusal.unsupportedLanguage.body"),
    ];
    expect(new Set(texts).size).toBe(3);
  });

  it("carries a label for every input id the contract can send", () => {
    // A key named for a losing spelling — `repo_skeleton` for `repo_map` —
    // renders a blank label and fails nothing.
    for (const id of [
      "repo_map",
      "package_configs",
      "critical_paths",
      "file_samples",
      "project_docs",
    ]) {
      expect(t(`inputs.id.${id}`)).not.toBe("");
      expect(t(`inputs.id.${id}`)).not.toContain("inputs.id");
    }
  });

  // Written as literals by the five cards — ArchitectureSection.tsx,
  // CriticalPathsSection.tsx, RunLocallySection.tsx, ReadingPathSection.tsx and
  // FirstTasksSection.tsx — and spelled `empty.critical_paths` where the title
  // family is `section.criticalPaths`. A key that does not resolve renders an
  // empty paragraph and fails nothing, so the spelling is checked here.
  it("resolves the sentence each card shows when it has nothing", () => {
    for (const key of [
      "empty.architecture",
      "empty.critical_paths",
      "empty.how_to_run",
      "empty.reading_path",
      "empty.first_tasks",
    ]) {
      expect(typeof t(key), key).toBe("string");
      expect(t(key), key).not.toBe("");
    }
  });
});
