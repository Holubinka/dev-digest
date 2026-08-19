/* sections.ts — the five sections of a tour, in the order the page draws them.

   ONE array, and it is the only place that order is written down. The rail
   (P3) maps this and never restates the five; a section that moved here moves
   in both places or in neither, which is what `compareDocumentPosition` in the
   view's test is there to hold.

   `kind` is the contract enum (`@devdigest/shared`), not a local string union:
   a rename in the contract is a compile error in this file rather than a
   section that quietly stops rendering. The headings are message KEYS, never
   text — `OnboardingSection.title` is the model's own heading and is stored,
   not drawn (AC-85), and the interface stays one language while the tour body
   is another. */
import type { IconName } from "@devdigest/ui";
import type { OnboardingSectionKind } from "@/lib/types";

export interface SectionDescriptor {
  kind: OnboardingSectionKind;
  /** The element `id` its card carries. The fragment for it is `#${anchor}`. */
  anchor: string;
  /** Chosen against the mockup's glyph for that section header. */
  icon: IconName;
  /** `messages/en/onboarding.json` — the heading the reader sees. */
  titleKey: string;
  /** The sentence the card shows instead of a list when it has nothing. */
}

export const SECTION_ORDER = [
  {
    kind: "architecture",
    anchor: "architecture",
    icon: "Workflow",
    titleKey: "section.architecture",
  },
  {
    kind: "critical_paths",
    anchor: "critical-paths",
    icon: "Activity",
    titleKey: "section.criticalPaths",
  },
  {
    kind: "how_to_run",
    anchor: "how-to-run",
    icon: "Command",
    titleKey: "section.howToRun",
  },
  {
    kind: "reading_path",
    anchor: "reading-path",
    icon: "ListChecks",
    titleKey: "section.readingPath",
  },
  {
    kind: "first_tasks",
    anchor: "first-tasks",
    icon: "Target",
    titleKey: "section.firstTasks",
  },
] as const satisfies readonly SectionDescriptor[];

/**
 * The same five, by kind, for the section components that each know only their
 * own. `Object.fromEntries` widens the key back to `string`, so the assertion
 * restates what the `satisfies` above already checked — and `sections.test.ts`
 * asserts the five keys really are the five kinds, which no cast can.
 */
export const SECTION_BY_KIND = Object.fromEntries(
  SECTION_ORDER.map((d) => [d.kind, d]),
) as Record<OnboardingSectionKind, SectionDescriptor>;

/**
 * The five element ids, in the same order — what the scrollspy observes.
 *
 * Derived here rather than written out at the observer, and module-level
 * rather than built during render: it is the effect's dependency, and a new
 * array every render would tear the observer down and rebuild it on each one.
 */
export const SECTION_ANCHORS: readonly string[] = SECTION_ORDER.map((d) => d.anchor);
