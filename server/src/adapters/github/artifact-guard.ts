/**
 * What makes a workflow-run artifact unusable, asked once.
 *
 * The Octokit adapter and `MockGitHubClient` both have to refuse an expired or
 * oversized artifact — the mock because a fake that handed the bytes over
 * regardless would let a caller that forgot the cap pass its tests. While each
 * carried its own copy, the messages were duplicated character for character
 * and only the adapter's were asserted (`test/ci-actions-port.test.ts`), so the
 * mock's could drift without a single test noticing.
 */

import { ValidationError } from '../../platform/errors.js';

/** The metadata check: refuse before a byte is downloaded. */
export function refuseUnusableArtifact(
  artifactId: number,
  meta: { expired: boolean; size_in_bytes: number },
  maxBytes: number,
): void {
  if (meta.expired) {
    throw new ValidationError(`Artifact ${artifactId} has expired`);
  }
  if (meta.size_in_bytes > maxBytes) {
    throw new ValidationError(
      `Artifact ${artifactId} declares ${meta.size_in_bytes} bytes, ` +
        `over the ${maxBytes}-byte limit`,
    );
  }
}

/**
 * The second check, against what actually arrived.
 *
 * A declared size is the server's claim; this one is the fact. They differ when
 * the artifact grew between the two calls, and that is the case the cap exists
 * for.
 */
export function refuseOversizedDownload(
  artifactId: number,
  bytes: Uint8Array,
  maxBytes: number,
): void {
  if (bytes.byteLength > maxBytes) {
    throw new ValidationError(
      `Artifact ${artifactId} downloaded ${bytes.byteLength} bytes, ` +
        `over the ${maxBytes}-byte limit`,
    );
  }
}
