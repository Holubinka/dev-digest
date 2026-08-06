import {
  FEATURE_MODELS,
  FeatureModelChoice,
  type FeatureModelId,
} from '@devdigest/shared';

/**
 * Per-feature model configuration.
 *
 * System LLM features (onboarding, intent, risk brief, conformance, conventions)
 * read their provider/model from the workspace's Settings instead of a hardcoded
 * module constant. When the workspace hasn't chosen one, we fall back to the
 * registry default in `FEATURE_MODELS` — which mirrors each module's old
 * constant, so behaviour is unchanged until a model is explicitly picked.
 *
 * It lives in `_shared/` rather than in `modules/settings/` because it is
 * cross-slice by definition — every feature in the registry needs it, and
 * `modules/intent/service.ts` importing `modules/settings/` would be a
 * `no-cross-module` violation. This is the ONLY path: the re-export shim that
 * briefly stood at `modules/settings/feature-models.ts` was deleted, because it
 * advertised an import specifier no module outside `settings/` could legally
 * use.
 */

/**
 * What resolution needs from the composition root, stated structurally.
 *
 * `Container` is deliberately NOT imported: `platform/container.ts` constructs
 * `IntentService`, which reaches this file, so naming `Container` here closes an
 * import cycle that `no-circular` rejects. A `Container` satisfies this shape by
 * construction, so every existing call site is unchanged.
 */
export interface SettingsReader {
  readonly settingsRepo: { value(workspaceId: string, key: string): Promise<unknown> };
}

const FEATURE_MODELS_KEY = 'feature_models';

const DEFAULTS = Object.fromEntries(
  FEATURE_MODELS.map((f) => [f.id, { provider: f.defaultProvider, model: f.defaultModel }]),
) as Record<FeatureModelId, FeatureModelChoice>;

/** The registry default (provider+model) for a feature — no DB read. */
export function defaultFeatureModel(id: FeatureModelId): FeatureModelChoice {
  return DEFAULTS[id];
}

/**
 * The workspace's override for `id`, or `undefined` when unset/invalid. Callers
 * that keep their own dynamic default (e.g. conventions) use this directly so
 * that default is preserved; callers with a static default use
 * `resolveFeatureModel` instead.
 */
export async function getFeatureModelOverride(
  container: SettingsReader,
  workspaceId: string,
  id: FeatureModelId,
): Promise<FeatureModelChoice | undefined> {
  const stored = await container.settingsRepo.value(workspaceId, FEATURE_MODELS_KEY);
  const byFeature = stored as Record<string, unknown> | null | undefined;
  const parsed = FeatureModelChoice.safeParse(byFeature?.[id]);
  return parsed.success ? parsed.data : undefined;
}

/** Resolve `id` to a concrete provider+model: workspace override, else registry default. */
export async function resolveFeatureModel(
  container: SettingsReader,
  workspaceId: string,
  id: FeatureModelId,
): Promise<FeatureModelChoice> {
  return (await getFeatureModelOverride(container, workspaceId, id)) ?? DEFAULTS[id];
}
