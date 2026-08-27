import { MAX_DOC_CHARS } from '@devdigest/shared';

/**
 * Project Context — caps and literals.
 *
 * Every number here bounds something a repository controls, and an imported
 * public repo is attacker-controlled: it decides how many `.md` files it
 * commits, how large each one is, and what is inside them. Two of these caps
 * also bound a paid model call, so an unbounded input here is a cost defect as
 * well as a safety one.
 */

/** The `jobs.kind` the background scan runs under. */
export const CONTEXT_SCAN_JOB_KIND = 'context_scan';

/**
 * Documents one scan will look at.
 *
 * The scan tokenises every candidate inside `JobRunner`'s 120 s timeout, so this
 * is the number that decides whether a scan finishes. MEASURED rather than
 * assumed (2026-08-13, this repo's own markdown padded to the cap): the worst
 * case — 2000 documents of 40 000 code points — costs 17.3 s of `js-tiktoken`
 * time, 14% of the timeout, leaving ~103 s for the 2000 bounded file reads
 * beside it. The 242 real documents in this repository cost 528 ms.
 *
 * If it ever stops fitting, LOWER THIS. Do not reach for a cheaper counter: the
 * editor's figure and the run's budget decision must come from the same counter
 * or they stop being the same number.
 */
export const MAX_SCAN_CANDIDATES = 2000;

/** A single document larger than this is not a document. 400 KB, as repo-intel's walk uses. */
export const MAX_DOC_FILE_BYTES = 400 * 1024;

/**
 * Code points kept from one document (NOT UTF-16 units — see `truncateCodePoints`).
 *
 * Defined in `vendor/shared/contracts/context.ts` and re-exported here: the
 * editor in the client has to disable itself on the same number a save is
 * refused on, and it cannot import this file. Re-exported rather than moved so
 * this file still reads as the one list of the feature's caps.
 */
export { MAX_DOC_CHARS };

/**
 * Bytes the clone read itself may pull for one document.
 *
 * `MAX_DOC_CHARS` bounds the string; this bounds the allocation that produces
 * it, which is the half a repository can move. Four bytes per code point is
 * UTF-8's maximum, so this can only ever cut a file the character cap was
 * already going to cut.
 *
 * This is the cap for the two paths that TRUNCATE on purpose — the scan and the
 * run's prompt assembly. The reader does not truncate at all; it uses
 * `MAX_DOC_READ_BYTES` below.
 */
export const MAX_DOC_BYTES = MAX_DOC_CHARS * 4;

/**
 * Bytes the READER may pull for one document — one more than a document may be.
 *
 * The reader hands its text to an editor, and that editor saves what it was
 * given back over the whole file. So a body the reader cut is a body a save
 * would delete the tail of, silently and with no copy kept for `.devdigest/`.
 * The reader therefore serves a document whole or serves none of it, and the
 * `+ 1` is what lets it tell the two apart: a read that comes back larger than
 * `MAX_DOC_FILE_BYTES` hit the cap, and hitting the cap is the same condition
 * `listFiles` uses to leave a file out of the scan entirely.
 *
 * A cut can only ever land at or above this many bytes, never below: the decoder
 * replaces a partial sequence at the end with U+FFFD, which is three bytes for
 * the one to three it consumed.
 */
export const MAX_DOC_READ_BYTES = MAX_DOC_FILE_BYTES + 1;

/** Documents one agent or one skill may attach for one repo. */
export const MAX_DOCS_PER_SET = 50;

/**
 * Characters in a repo-relative document path.
 *
 * Bounds the string before it reaches a filesystem call: most kernels cap a
 * single path component at 255 bytes and a whole path around 4096, and a
 * repository decides what it commits.
 */
export const MAX_PATH_LENGTH = 512;

/**
 * Repo-relative folders scanned when the workspace has set none. Restated from
 * `SettingsKnown.context_scan_roots`' default so the service never has to reach
 * into the settings contract to know what "unset" means.
 */
export const DEFAULT_SCAN_ROOTS = ['specs', 'docs', 'insights'] as const;

/**
 * The folder DevDigest writes into, and a scan root of EVERY repository
 * whatever the workspace configured.
 *
 * It is unconditional because it is the whole durability story. A document
 * created here is untracked, and untracked is precisely what `git reset --hard`
 * in `sync()` leaves alone — so the file itself survives a refresh and a resync,
 * with no row, no branch and no commit behind it. A workspace that narrowed its
 * roots to `docs` would otherwise be unable to see the documents it just wrote.
 *
 * Not in `EXCLUDED_WALK_DIRS`, so `listFiles` already descends it.
 *
 * The NAME lives in `_shared/bundle-paths.ts`: `modules/ci` writes into this same
 * root, and `no-cross-module` forbids the two slices importing each other.
 */
export { DEVDIGEST_ROOT } from '../_shared/bundle-paths.js';

/**
 * The folders under `.devdigest/` that an export to CI writes, and the only
 * part of that root the scan leaves out.
 *
 * A committed bundle is DevDigest's own output, not a fact about the
 * repository. Scanning `.devdigest/skills/<slug>.md` back in would let a review
 * read the reviewing agent's own skill as project context and ground a finding
 * in it (`AC-106`, `AC-107`). Everything else under the root stays, because the
 * documents this feature writes itself live there and that is what the root is
 * unconditional for (`AC-108`).
 *
 * The rest of a bundle needs no rule at all: `DOC_EXTENSIONS` below is `['.md']`,
 * so the `.yaml`, `.jsonl`, `.mjs` and `.gitattributes` beside these two folders
 * were never candidates.
 *
 * The DECISION to exclude them is this module's; the two names are the exporter's,
 * so they arrive from `_shared/` rather than being restated here. A rename that
 * touched only one side used to compile and pass `pnpm arch`.
 */
export { BUNDLE_SUBROOTS as EXCLUDED_DEVDIGEST_SUBROOTS } from '../_shared/bundle-paths.js';

/** Tokens the assembled `## Project context` section may occupy, per prompt. */
export const DEFAULT_CONTEXT_BUDGET_TOKENS = 16_000;

/** The one format read. One extension, one parser, one attack surface. */
export const DOC_EXTENSIONS = ['.md'] as const;

/**
 * How long a claimed scan may sit before the page stops believing it.
 *
 * `repo_doc_scans.scanning_at` is cleared by whichever outcome the job reaches,
 * and a process killed mid-scan reaches neither — leaving the row claimed, the
 * page polling and the Rescan button disabled, with no way back from the UI.
 * Ten minutes is comfortably past the worst case `JobRunner` can produce for
 * this kind (a 120 s timeout, 2 retries, backoff between them), so a claim older
 * than this is a corpse rather than a scan in flight.
 */
export const SCAN_CLAIM_STALE_MS = 10 * 60 * 1000;
