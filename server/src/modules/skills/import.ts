import { unzipSync, type UnzipFileInfo } from 'fflate';
import type { SkillImportPreview, SkillSkippedEntry, SkillSource } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { MAX_ENTRIES, MAX_TOTAL_BYTES, READ_EXTENSIONS } from './constants.js';
import { classifyEntry, draftFromMarkdown, pickSkillCore } from './helpers.js';

/**
 * Archive reading for skill import. Pure: bytes in, text out. Inflating a
 * `Uint8Array` is CPU, not I/O, so this needs no port — a mock `ArchiveReader`
 * could only ever return a canned object, which is what a fixture already is.
 * (`js-tiktoken` sits behind a port because it is stateful; this is not.)
 *
 * The safety property lives in `unzipSync`'s filter, which fflate calls BEFORE
 * an entry is decompressed and which receives the entry's declared uncompressed
 * size. So an executable entry is never read rather than read-then-discarded,
 * and a 10 KB archive claiming a 4 GB member never allocates.
 */

export interface ArchiveScan {
  /** Readable markdown, path → decoded text. */
  files: Map<string, string>;
  /** Everything that was not read, with the reason shown in the preview. */
  skipped: SkillSkippedEntry[];
}

/** Scan a `.zip`, reading only the markdown inside it. */
export function parseSkillArchive(bytes: Uint8Array): ArchiveScan {
  const skipped: SkillSkippedEntry[] = [];
  let considered = 0;
  let inflated = 0;

  const unzipped = unzipSync(bytes, {
    filter: (entry: UnzipFileInfo) => {
      // A directory entry describes no content; reporting it as "skipped" would
      // just be noise in the preview.
      if (entry.name.endsWith('/')) return false;

      if (++considered > MAX_ENTRIES) {
        throw new ValidationError(`Archive has more than ${MAX_ENTRIES} entries`);
      }

      const verdict = classifyEntry(entry.name, entry.originalSize);
      if (verdict !== 'read') {
        skipped.push({ path: entry.name, reason: verdict });
        return false;
      }

      inflated += entry.originalSize;
      if (inflated > MAX_TOTAL_BYTES) {
        throw new ValidationError(`Archive markdown exceeds ${MAX_TOTAL_BYTES} bytes`);
      }
      return true;
    },
  });

  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  for (const [path, data] of Object.entries(unzipped)) files.set(path, decoder.decode(data));
  return { files, skipped };
}

/** True when the upload should be read as an archive rather than a document. */
export function looksLikeArchive(filename: string, bytes: Uint8Array): boolean {
  const isPk = bytes[0] === 0x50 && bytes[1] === 0x4b;
  return isPk || filename.toLowerCase().endsWith('.zip');
}

/** True when the filename is one we are willing to read as a plain document. */
export function isMarkdownFilename(filename: string): boolean {
  const base = filename.slice(filename.lastIndexOf('/') + 1).toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot > 0 && READ_EXTENSIONS.includes(base.slice(dot));
}

/** A display name for a fetched document: its last path segment, else the host. */
export function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split('/').filter(Boolean).pop() ?? parsed.hostname;
  } catch {
    return url;
  }
}

/** Build the preview for one markdown document — an upload or a fetched URL. */
export function previewFromDocument(args: {
  filename: string;
  text: string;
  bytes: number;
  source: SkillSource;
}): SkillImportPreview {
  return {
    ...draftFromMarkdown(args.text, args.filename),
    source: args.source,
    enabled: false,
    evidence_files: [args.filename],
    core_path: args.filename,
    skipped: [],
    bytes: args.bytes,
  };
}

/**
 * Build the preview for an archive. Only markdown was ever read; everything else
 * is reported in `skipped` so the user can see what was left alone rather than
 * take our word for it.
 */
export function previewFromArchive(bytes: Uint8Array): SkillImportPreview {
  const { files, skipped } = parseSkillArchive(bytes);
  const paths = [...files.keys()].sort();
  const core = pickSkillCore(paths);
  if (core === undefined) {
    throw new ValidationError('That archive has no SKILL.md or README.md to import', { skipped });
  }
  return {
    ...draftFromMarkdown(files.get(core)!, core),
    source: 'imported_file',
    enabled: false,
    evidence_files: paths,
    core_path: core,
    skipped,
    bytes: bytes.byteLength,
  };
}
