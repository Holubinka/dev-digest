/* The severity order is defined beside the findings card, which both this bar
   and the PR list rank against. Re-exported here so this folder keeps its own
   public surface.

   Imported from `findings-preview/helpers` rather than that folder's barrel on
   purpose: the barrel also names `FindingsPreview`, and this is a three-string
   array. `helpers` carries only a type import from `@devdigest/shared`, so this
   path pulls in nothing at runtime. */
export {
  SEVERITY_LEVELS,
  type SeverityLevel,
} from "@/components/findings-preview/helpers";
