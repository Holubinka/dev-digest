import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import type { IncomingMessage } from 'node:http';
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
 *  - one deadline over the whole exchange, redirects included;
 *  - **the connection pinned to the address that was checked.** `assertPublicHttps`
 *    hands back the literal it verified and `get` feeds it to `node:https` as the
 *    `lookup` result, so DNS is consulted once per hop and the socket cannot go
 *    anywhere the check did not allow.
 *
 * That last point is why this uses `node:https` and not `fetch`: `fetch`
 * re-resolves the hostname when it connects, which left a window where a name
 * could answer with a public address during the check and a private one a
 * moment later — DNS rebinding. It was carried here as a KNOWN LIMIT until
 * 2026-08-03, when /pr-self-review raised it against the shipped feature.
 *
 * What is still NOT covered: a host that is public, reachable, and hostile.
 * Pinning proves the socket goes where the check allowed; it says nothing about
 * whether that destination deserved to be trusted.
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

/**
 * Expand any IPv6 text form to its eight 16-bit groups, or null if it is not
 * one. Matching on the text instead is what let `https://[::ffff:127.0.0.1]/`
 * through: `new URL()` re-spells that hostname as `[::ffff:7f00:1]`, so a
 * pattern written against the dotted-quad form sees a public address.
 */
function ipv6Groups(address: string): number[] | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;

  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    const pieces = part.split(':');
    for (const [index, piece] of pieces.entries()) {
      if (piece.includes('.')) {
        if (index !== pieces.length - 1) return null;
        const quad = piece.split('.').map(Number);
        if (quad.length !== 4 || quad.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
          return null;
        }
        out.push((quad[0]! << 8) | quad[1]!, (quad[2]! << 8) | quad[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };

  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;

  const fill = 8 - head.length - tail.length;
  return fill < 1 ? null : [...head, ...(Array(fill).fill(0) as number[]), ...tail];
}

export function ipv6IsPublic(ip: string): boolean {
  const address = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  const groups = ipv6Groups(address);
  if (groups === null) return false;

  const [a, b, c, d, e, f, g, h] = groups as [
    number, number, number, number, number, number, number, number,
  ];
  const embedded = () => ipv4IsPublic([g >> 8, g & 0xff, h >> 8, h & 0xff].join('.'));

  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0) {
    if (f === 0xffff) return embedded(); // ::ffff:0:0/96 IPv4-mapped
    if (f === 0) return false; // ::/96 — unspecified, loopback, IPv4-compatible
  }
  if (a === 0x64 && b === 0xff9b && !c && !d && !e && !f) return embedded(); // NAT64
  if ((a & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
  if ((a & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  return true;
}

/** A checked target: where to connect, and the name to present while doing it. */
export interface VerifiedTarget {
  url: URL;
  /** The literal this host resolved to, and the only one we will connect to. */
  address: string;
  family: 4 | 6;
}

/** Parse, require https, and refuse a host that resolves anywhere non-public. */
export async function assertPublicHttps(raw: string): Promise<VerifiedTarget> {
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

  // Every address checked out; the first is the one the connection is pinned
  // to. Returning it is what closes the gap between checking and connecting.
  const chosen = addresses[0]!;
  return { url, address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

export class HttpSkillFetcher implements SkillFetcher {
  async fetchMarkdown(rawUrl: string): Promise<FetchedMarkdown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let target = await assertPublicHttps(rawUrl);

      for (let hop = 0; ; hop++) {
        const res = await this.get(target, controller.signal);
        const status = res.statusCode ?? 0;
        const location = header(res, 'location');

        if (status >= 300 && status < 400 && location) {
          res.destroy();
          if (hop >= MAX_REDIRECTS) throw new ValidationError('Too many redirects');
          target = await assertPublicHttps(new URL(location, target.url).toString());
          continue;
        }

        if (status < 200 || status >= 300) {
          res.destroy();
          throw new ExternalServiceError(`Fetching the skill failed with ${status}`);
        }

        const contentType = header(res, 'content-type') ?? '';
        if (!contentType.split(';')[0]?.trim().startsWith('text/')) {
          res.destroy();
          throw new ValidationError(
            `Expected a text document, got "${contentType || 'no content-type'}"`,
          );
        }
        return await readCapped(res, target.url);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Issue the request against the address `assertPublicHttps` checked.
   *
   * `node:https` is used rather than `fetch` for one reason: its `lookup` hook.
   * `fetch` re-resolves the hostname when it connects, so a name that answered
   * with a public address during the check and a private one a moment later —
   * DNS rebinding — reached the private address anyway. That was the KNOWN
   * LIMIT this file used to carry. Handing back the already-verified literal,
   * and never consulting DNS a second time, closes it: the socket can only go
   * where the check allowed.
   *
   * TLS is unaffected. `servername` still carries the hostname, so the
   * certificate is validated against the name the user typed, not the IP.
   */
  private get(target: VerifiedTarget, signal: AbortSignal): Promise<IncomingMessage> {
    const { url, address, family } = target;
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          signal,
          servername: url.hostname.replace(/^\[|\]$/g, ''),
          lookup: (_hostname, options, callback) => {
            // `all: true` asks for every address; answer both shapes of the
            // callback with the single pinned one.
            if ((options as { all?: boolean }).all) {
              (callback as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(
                null,
                [{ address, family }],
              );
              return;
            }
            callback(null, address, family);
          },
          headers: { accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1' },
        },
        resolve,
      );
      req.on('error', (err: Error) => {
        reject(new ExternalServiceError(`Could not reach ${url.hostname}: ${err.message}`));
      });
      req.end();
    });
  }
}

/** First value of a response header, whatever shape Node hands back. */
function header(res: IncomingMessage, name: string): string | undefined {
  const value = res.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Read the body, aborting the moment it goes over the cap — not after. */
async function readCapped(res: IncomingMessage, url: URL): Promise<FetchedMarkdown> {
  const chunks: Buffer[] = [];
  let bytes = 0;

  try {
    for await (const chunk of res) {
      const buf = chunk as Buffer;
      bytes += buf.byteLength;
      if (bytes > MAX_DOCUMENT_BYTES) {
        res.destroy();
        throw new ValidationError(`That document is larger than ${MAX_DOCUMENT_BYTES} bytes`);
      }
      chunks.push(buf);
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ExternalServiceError(`Reading the skill failed: ${(err as Error).message}`);
  }

  return {
    text: Buffer.concat(chunks).toString('utf8'),
    finalUrl: url.toString(),
    bytes,
  };
}
