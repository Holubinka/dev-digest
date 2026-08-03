/* FindingCategoryTag — `CategoryTag` reads `CAT[category].icon`, and its own
   `if (!c) return null` guard is keyed on truthiness, so a prototype key such as
   `constructor` walks straight past it into `Icon[undefined]` and takes the
   whole route down. `findings.category` is a plain `text` column, so that value
   can arrive.

   Unlike the severity side, there is nothing to degrade to: a category is a
   secondary tag, and rendering nothing is exactly what the vendored component
   already does for a category it does not recognise. This wrapper only makes
   that path reachable for the values that currently bypass it. */
"use client";

import { CategoryTag } from "@devdigest/ui";
import { isKnownCategory } from "./helpers";

export function FindingCategoryTag({ category }: { category: string }) {
  /** `string`, not `Category`: the column is unconstrained, so a cast here
      would be the widening assertion this component exists to remove. */
  if (!isKnownCategory(category)) return null;
  return <CategoryTag category={category} />;
}
