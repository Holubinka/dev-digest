import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { FetchedMarkdown, SkillFetcher } from '@devdigest/shared';
import { ExternalServiceError, ValidationError } from '../../platform/errors.js';

/**
 * skill-fetch adapter — fetches a markdown document for "import a skill from a
 * URL".
 *
 * This is the one place in the product that makes an outbound request to an
 * address a user typed, from inside the network, which is the textbook shape of
 * SSRF. The guard is therefore the point of this file, not an aside:
 *
 *  - https only (a plaintext hop could be redirected by anyone on the path);
 *  - every resolved address checked against loopback, private, link-local,
 *    CGNAT and IPv6 unique-local ranges BEFORE connecting — 169.254.169.254 is
 *    a cloud metadata endpoint, not an exotic case;
 *  - redirects followed manually, at most twice, re-checking each hop, because
 *    a public host is free to redirect into private space;
 *  - the reply capped WHILE streaming rather than after, and required to be
 *    text/*;
 *  - one deadline over the whole exchange, redirects included.
 *
 * KNOWN LIMIT: the address is checked at resolution time and the connection is
 * made separately, so a name that resolves differently between the two — DNS
 * rebinding — is not covered. Closing that needs a custom agent pinning the
 * checked IP. Stated plainly rather than implied, because the check reads
 * stronger than it is.
 */

const MAX_DOCUMENT_BYTES = 2_000_000;
const MAX_REDIRECTS = 2;
const TIMEOUT_MS = 5_000;

/** False for every range that is not routable public internet. */
export function ipv4IsPublic(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false; // this-network, private, loopback
  if (a === 169 && b === 254) return false; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0) return false; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast and reserved
  return true;
}

export function ipv6IsPublic(ip: string): boolean {
  const address = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  if (address === '::1' || address === '::') return false;
  if (/^f[cd]/.test(address)) return false; // fc00::/7 unique local
  if (/^fe[89ab]/.test(address)) return false; // fe80::/10 link local
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped) return ipv4IsPublic(mapped[1]!);
  return true;
}

/** Parse, require https, and refuse a host that resolves anywhere non-public. */
export async function assertPublicHttps(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('That is not a valid URL');
  }
  if (url.protocol !== 'https:') {
    throw new ValidationError('Only https:// URLs can be imported');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(host);
  const addresses = literal
    ? [{ address: host, family: literal }]
    : await lookup(host, { all: true, verbatim: true }).catch(() => {
        throw new ValidationError(`Could not resolve ${host}`);
      });

  if (addresses.length === 0) throw new ValidationError(`Could not resolve ${host}`);
  for (const { address, family } of addresses) {
    const ok = family === 6 ? ipv6IsPublic(address) : ipv4IsPublic(address);
    if (!ok) {
      throw new ValidationError(`Refusing to fetch a non-public address (${address})`);
    }
  }
  return url;
}

export class HttpSkillFetcher implements SkillFetcher {
  async fetchMarkdown(rawUrl: string): Promise<FetchedMarkdown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let target = await assertPublicHttps(rawUrl);

      for (let hop = 0; ; hop++) {
        const res = await this.get(target, controller.signal);
        const location = res.headers.get('location');

        if (res.status >= 300 && res.status < 400 && location) {
          await res.body?.cancel();
          if (hop >= MAX_REDIRECTS) throw new ValidationError('Too many redirects');
          target = await assertPublicHttps(new URL(location, target).toString());
          continue;
        }

        if (!res.ok) {
          await res.body?.cancel();
          throw new ExternalServiceError(`Fetching the skill failed with ${res.status}`);
        }

        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.split(';')[0]?.trim().startsWith('text/')) {
          await res.body?.cancel();
          throw new ValidationError(
            `Expected a text document, got "${contentType || 'no content-type'}"`,
          );
        }
        return await readCapped(res, target);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async get(url: URL, signal: AbortSignal): Promise<Response> {
    try {
      return await fetch(url, {
        redirect: 'manual',
        signal,
        headers: { accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1' },
      });
    } catch (err) {
      throw new ExternalServiceError(`Could not reach ${url.hostname}: ${(err as Error).message}`);
    }
  }
}

/** Read the body, aborting the moment it goes over the cap — not after. */
async function readCapped(res: Response, url: URL): Promise<FetchedMarkdown> {
  const reader = res.body?.getReader();
  if (!reader) return { text: '', finalUrl: url.toString(), bytes: 0 };

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_DOCUMENT_BYTES) {
      await reader.cancel();
      throw new ValidationError(`That document is larger than ${MAX_DOCUMENT_BYTES} bytes`);
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(bytes);
  let at = 0;
  for (const chunk of chunks) {
    merged.set(chunk, at);
    at += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(merged), finalUrl: url.toString(), bytes };
}
