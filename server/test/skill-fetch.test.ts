import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ ...dns, default: dns }));

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

function response(body: BodyInit | null, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/markdown', ...headers },
  });
}

beforeEach(() => {
  dns.lookup.mockReset();
  dns.lookup.mockResolvedValue(PUBLIC_V4);
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

  it('accepts a public host', async () => {
    const url = await assertPublicHttps('https://example.com/skill.md');
    expect(url.hostname).toBe('example.com');
  });
});

describe('HttpSkillFetcher', () => {
  const fetcher = new HttpSkillFetcher();

  it('returns the document, its final URL and its size', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('# Skill\nBody.')));
    const out = await fetcher.fetchMarkdown('https://example.com/skill.md');
    expect(out).toMatchObject({ text: '# Skill\nBody.', finalUrl: 'https://example.com/skill.md' });
    expect(out.bytes).toBe(13);
  });

  it('follows a redirect that stays public', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(null, 302, { location: 'https://cdn.example.com/s.md' }))
      .mockResolvedValueOnce(response('# Moved'));
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetcher.fetchMarkdown('https://example.com/skill.md');
    expect(out.text).toBe('# Moved');
    expect(out.finalUrl).toBe('https://cdn.example.com/s.md');
  });

  it('refuses a redirect INTO private space, at the hop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response(null, 302, { location: 'https://127.0.0.1/s.md' })),
    );
    await expect(fetcher.fetchMarkdown('https://example.com/skill.md')).rejects.toThrow(
      /non-public address/,
    );
  });

  it('gives up rather than following a redirect chain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response(null, 302, { location: 'https://example.com/next.md' })),
    );
    await expect(fetcher.fetchMarkdown('https://example.com/skill.md')).rejects.toThrow(
      /Too many redirects/,
    );
  });

  it('refuses a reply that is not text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response('{}', 200, { 'content-type': 'application/json' })),
    );
    await expect(fetcher.fetchMarkdown('https://example.com/skill.md')).rejects.toThrow(
      /Expected a text document/,
    );
  });

  it('surfaces an error status rather than importing the error page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('nope', 404)));
    await expect(fetcher.fetchMarkdown('https://example.com/skill.md')).rejects.toThrow(/404/);
  });

  it('aborts an oversized body mid-stream instead of buffering it', async () => {
    const chunk = new Uint8Array(256 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Would be 32 MB if it were ever allowed to finish.
        if (sent >= 32 * 1024 * 1024) return controller.close();
        controller.enqueue(chunk);
        sent += chunk.byteLength;
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(stream)));

    await expect(fetcher.fetchMarkdown('https://example.com/huge.md')).rejects.toThrow(
      /larger than/,
    );
    // Stopped at the cap rather than reading the whole thing.
    expect(sent).toBeLessThan(4 * 1024 * 1024);
  });
});
