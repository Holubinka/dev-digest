import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ ...dns, default: dns }));

const https = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('node:https', () => ({ request: https.request, default: { request: https.request } }));

import {
  HttpSkillFetcher,
  assertPublicHttps,
  ipv4IsPublic,
  ipv6IsPublic,
} from '../src/adapters/skill-fetch/index.js';
import { ValidationError } from '../src/platform/errors.js';

/**
 * The SSRF guard on "import a skill from a URL". Everything here is hermetic:
 * DNS is mocked, `fetch` is stubbed, and the literal-IP cases never resolve at
 * all — so the rules are pinned without touching a network.
 */

const PUBLIC_V4 = [{ address: '93.184.216.34', family: 4 }];

/** An `IncomingMessage`-shaped stream, which is what the adapter now reads. */
function response(
  body: string | Readable | null,
  status = 200,
  headers: Record<string, string> = {},
) {
  const stream =
    body === null || typeof body === 'string'
      ? Readable.from(body ? [Buffer.from(body)] : [])
      : body;
  return Object.assign(stream, {
    statusCode: status,
    headers: { 'content-type': 'text/markdown', ...headers },
  }) as unknown as IncomingMessage;
}

/** Answer each successive request with the next response, recording the options. */
function respondWith(...responses: IncomingMessage[]) {
  const calls: Array<{ url: URL; options: Record<string, unknown> }> = [];
  let n = 0;
  https.request.mockImplementation(
    (url: URL, options: Record<string, unknown>, callback: (r: IncomingMessage) => void) => {
      calls.push({ url, options });
      const res = responses[Math.min(n++, responses.length - 1)]!;
      process.nextTick(() => callback(res));
      return { on: vi.fn(), end: vi.fn() };
    },
  );
  return calls;
}

beforeEach(() => {
  dns.lookup.mockReset();
  dns.lookup.mockResolvedValue(PUBLIC_V4);
  https.request.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('address classification', () => {
  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1'])('treats %s as public', (ip) => {
    expect(ipv4IsPublic(ip)).toBe(true);
  });

  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'private class A'],
    ['172.16.0.1', 'private class B'],
    ['172.31.255.255', 'private class B, top of range'],
    ['192.168.1.1', 'private class C'],
    ['169.254.169.254', 'link-local cloud metadata'],
    ['100.64.0.1', 'CGNAT'],
    ['0.0.0.0', 'this network'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
  ])('refuses %s (%s)', (ip) => {
    expect(ipv4IsPublic(ip)).toBe(false);
  });

  it('does not treat 172.32.x as private — the range stops at 172.31', () => {
    expect(ipv4IsPublic('172.32.0.1')).toBe(true);
  });

  it.each([
    '::1',
    '::',
    'fd00::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::127.0.0.1',
  ])('refuses the IPv6 address %s', (ip) => {
    expect(ipv6IsPublic(ip)).toBe(false);
  });

  /**
   * `new URL()` re-spells a mapped literal into hex, so these — not the dotted
   * forms above — are what the guard is actually handed at runtime. Testing
   * only the dotted spelling is how the bypass survived its own test.
   */
  it.each([
    ['::ffff:7f00:1', '127.0.0.1'],
    ['::ffff:a9fe:a9fe', '169.254.169.254'],
    ['::ffff:a00:5', '10.0.0.5'],
    ['::ffff:c0a8:101', '192.168.1.1'],
    ['::7f00:1', '127.0.0.1, IPv4-compatible'],
    ['64:ff9b::7f00:1', '127.0.0.1 behind the NAT64 prefix'],
  ])('refuses %s, the hex spelling of %s', (ip) => {
    expect(ipv6IsPublic(ip)).toBe(false);
  });

  it.each(['2606:2800:220:1:248:1893:25c8:1946', '::ffff:5db8:d822', '2001:4860:4860::8888'])(
    'allows the public IPv6 address %s',
    (ip) => {
      expect(ipv6IsPublic(ip)).toBe(true);
    },
  );

  it.each(['', 'nonsense', '1:2:3::4::5', '12345::1', '::ffff:1.2.3', '1:2:3:4:5:6:7'])(
    'refuses %s rather than reading an unparseable address as public',
    (ip) => {
      expect(ipv6IsPublic(ip)).toBe(false);
    },
  );
});

describe('assertPublicHttps', () => {
  it('refuses anything that is not https', async () => {
    await expect(assertPublicHttps('http://example.com/s.md')).rejects.toThrow(ValidationError);
    await expect(assertPublicHttps('file:///etc/passwd')).rejects.toThrow(ValidationError);
    await expect(assertPublicHttps('gopher://example.com')).rejects.toThrow(ValidationError);
  });

  it('refuses a URL it cannot parse', async () => {
    await expect(assertPublicHttps('not a url')).rejects.toThrow(ValidationError);
  });

  it('refuses a literal private address without resolving anything', async () => {
    await expect(assertPublicHttps('https://169.254.169.254/latest/meta-data')).rejects.toThrow(
      ValidationError,
    );
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it.each([
    'https://[::ffff:127.0.0.1]/x',
    'https://[::ffff:169.254.169.254]/latest/meta-data',
    'https://[::ffff:10.0.0.5]/x',
    'https://[::1]/x',
  ])('refuses %s — the bracketed form the guard is really given', async (url) => {
    await expect(assertPublicHttps(url)).rejects.toThrow(/non-public address/);
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('refuses a redirect to a mapped literal, which reaches the guard normalised', async () => {
    await expect(
      assertPublicHttps(new URL('//[::ffff:127.0.0.1]/s.md', 'https://example.com').toString()),
    ).rejects.toThrow(/non-public address/);
  });

  it('refuses a public hostname that resolves into private space', async () => {
    dns.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(assertPublicHttps('https://sneaky.example.com/s.md')).rejects.toThrow(
      /non-public address/,
    );
  });

  it('refuses when ANY resolved address is private, not just the first', async () => {
    dns.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(assertPublicHttps('https://mixed.example.com/s.md')).rejects.toThrow(
      ValidationError,
    );
  });

  it('accepts a public host, and hands back the address it checked', async () => {
    const target = await assertPublicHttps('https://example.com/skill.md');
    expect(target.url.hostname).toBe('example.com');
    // The pin: what the connection is allowed to use, decided here.
    expect(target).toMatchObject({ address: '93.184.216.34', family: 4 });
  });
});

describe('HttpSkillFetcher', () => {
  const fetcher = new HttpSkillFetcher();

  it('returns the document, its final URL and its size', async () => {
    respondWith(response('# Skill\nBody.'));
    const out = await fetcher.fetchMarkdown('https://example.com/skill.md');
    expect(out).toMatchObject({ text: '# Skill\nBody.', finalUrl: 'https://example.com/skill.md' });
    expect(out.bytes).toBe(13);
  });

  /**
   * The rebinding fix. The guard resolves the name once and the socket is then
   * pinned to that literal, so a name that answers publicly during the check
   * and privately a moment later has nothing left to rebind: `node:https` never
   * asks again, it asks our `lookup`, and our `lookup` only knows one address.
   */
  describe('pins the connection to the address the guard checked', () => {
    it('answers the transport with the verified literal, not the hostname', async () => {
      const calls = respondWith(response('# Skill'));
      await fetcher.fetchMarkdown('https://example.com/skill.md');

      const lookup = calls[0]!.options.lookup as (
        host: string,
        opts: { all?: boolean },
        cb: (e: null, a: string, f: number) => void,
      ) => void;
      const seen = vi.fn();
      lookup('example.com', {}, seen);
      expect(seen).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    });

    it('answers the `all: true` form with the same single address', async () => {
      const calls = respondWith(response('# Skill'));
      await fetcher.fetchMarkdown('https://example.com/skill.md');

      const lookup = calls[0]!.options.lookup as (
        host: string,
        opts: { all?: boolean },
        cb: (e: null, a: Array<{ address: string; family: number }>) => void,
      ) => void;
      const seen = vi.fn();
      lookup('example.com', { all: true }, seen);
      expect(seen).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
    });

    it('resolves the name exactly once per hop', async () => {
      respondWith(response('# Skill'));
      await fetcher.fetchMarkdown('https://example.com/skill.md');
      expect(dns.lookup).toHaveBeenCalledTimes(1);
    });

    it('still presents the hostname for TLS, so the certificate is checked against it', async () => {
      const calls = respondWith(response('# Skill'));
      await fetcher.fetchMarkdown('https://example.com/skill.md');
      expect(calls[0]!.options.servername).toBe('example.com');
    });

    it('re-pins on each redirect hop rather than reusing the first address', async () => {
      dns.lookup
        .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
        .mockResolvedValueOnce([{ address: '151.101.1.140', family: 4 }]);
      const calls = respondWith(
        response(null, 302, { location: 'https://cdn.example.com/s.md' }),
        response('# Moved'),
      );

      await fetcher.fetchMarkdown('https://example.com/skill.md');

      const second = calls[1]!.options.lookup as (
        host: string,
        opts: object,
        cb: (e: null, a: string, f: number) => void,
      ) => void;
      const seen = vi.fn();
      second('cdn.example.com', {}, seen);
      expect(seen).toHaveBeenCalledWith(null, '151.101.1.140', 4);
    });
  });

  it('follows a redirect that stays public', async () => {
    respondWith(
      response(null, 302, { location: 'https://cdn.example.com/s.md' }),
      response('# Moved'),
    );
    const out = await fetcher.fetchMarkdown('https://example.com/skill.md');
    expect(out.text).toBe('# Moved');
    expect(out.finalUrl).toBe('https://cdn.example.com/s.md');
  });

  it('refuses a redirect INTO private space, at the hop', async () => {
    respondWith(response(null, 302, { location: 'https://127.0.0.1/s.md' }));
    await expect(fetcher.fetchMarkdown('https://example.com/skill.md')).rejects.toThrow(
      /non-public address/,
    );
  });

  it('gives up rather than following a redirect chain', async () => {
    respondWith(response(null, 302, { location: 'https://example.com/next.md' }));
    await expect(fetcher.fetchMarkdown('https://example.com/skill.md')).rejects.toThrow(
      /Too many redirects/,
    );
  });

  it('refuses a reply that is not text', async () => {
    respondWith(response('{}', 200, { 'content-type': 'application/json' }));
    await expect(fetcher.fetchMarkdown('https://example.com/skill.md')).rejects.toThrow(
      /Expected a text document/,
    );
  });

  it('surfaces an error status rather than importing the error page', async () => {
    respondWith(response('nope', 404));
    await expect(fetcher.fetchMarkdown('https://example.com/skill.md')).rejects.toThrow(/404/);
  });

  /**
   * The cap used to be enforced by destroying the stream and throwing from
   * inside the `try`, whose `catch` rewrites anything that is not a
   * ValidationError. A review flagged that as CRITICAL on the grounds that a
   * throwing `destroy()` would mask the refusal. Node's `destroy()` does not
   * throw — measured — so it was not reachable, but the shape invited it, and
   * this pins the property rather than the argument: whatever the stream does
   * on the way out, the caller is told the document was too large.
   */
  it('reports the cap even when tearing the stream down goes wrong', async () => {
    const chunk = Buffer.alloc(256 * 1024);
    const stream = new Readable({
      read() {
        this.push(chunk);
      },
    });
    stream.destroy = () => {
      throw new Error('destroy exploded');
    };
    respondWith(response(stream));

    await expect(fetcher.fetchMarkdown('https://example.com/huge.md')).rejects.toThrow(
      /larger than/,
    );
  });

  it('aborts an oversized body mid-stream instead of buffering it', async () => {
    const chunk = Buffer.alloc(256 * 1024);
    let sent = 0;
    const stream = new Readable({
      read() {
        // Would be 32 MB if it were ever allowed to finish.
        if (sent >= 32 * 1024 * 1024) return this.push(null);
        this.push(chunk);
        sent += chunk.byteLength;
      },
    });
    respondWith(response(stream));

    await expect(fetcher.fetchMarkdown('https://example.com/huge.md')).rejects.toThrow(
      /larger than/,
    );
    // Stopped at the cap rather than reading the whole thing.
    expect(sent).toBeLessThan(4 * 1024 * 1024);
  });
});
