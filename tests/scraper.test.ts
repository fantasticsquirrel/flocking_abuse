import { describe, expect, it, vi } from 'vitest';
import {
  fetchDiscoverablePage,
  isPublicAddress,
  runSeedDiscovery,
  validatePublicUrl,
  type Requester,
  type ScraperDependencies,
} from '../scripts/scrape-flock-abuse.js';

const publicLookup: ScraperDependencies['lookup'] = async () => [{ address: '93.184.216.34', family: 4 }];
const response = (status: number, body: string, headers: Record<string, string> = {}) => ({ status, body: Buffer.from(body), headers });

describe('scraper network safety', () => {
  it('rejects loopback, private, link-local, carrier-grade NAT, documentation, multicast, and reserved addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '169.254.2.3', '172.16.2.3', '192.168.1.2', '100.64.0.1', '192.0.2.1', '198.51.100.2', '203.0.113.2', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '2001:db8::1']) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    expect(isPublicAddress('93.184.216.34')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('rejects unsafe schemes, credentials, localhost names, and DNS answers containing any non-public address', async () => {
    await expect(validatePublicUrl('file:///etc/passwd', publicLookup)).rejects.toThrow(/http or https/i);
    await expect(validatePublicUrl('https://user:pass@example.org/report', publicLookup)).rejects.toThrow(/credentials/i);
    await expect(validatePublicUrl('http://localhost/report', publicLookup)).rejects.toThrow(/hostname/i);
    await expect(validatePublicUrl('https://example.org/report', async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }])).rejects.toThrow(/non-public/i);
  });

  it('checks every redirect target and blocks a redirect into a private network', async () => {
    const requester = vi.fn<Requester>()
      .mockResolvedValueOnce(response(404, ''))
      .mockResolvedValueOnce(response(302, '', { location: 'http://internal.example/secret' }));
    const deps: ScraperDependencies = {
      lookup: async (hostname) => [{ address: hostname === 'internal.example' ? '10.0.0.8' : '93.184.216.34', family: 4 }],
      request: requester,
    };
    await expect(fetchDiscoverablePage('https://news.example/report', deps)).rejects.toThrow(/non-public/i);
    expect(requester).toHaveBeenCalledTimes(2); // robots.txt, then source page; private target is never requested
  });

  it('honors robots.txt before fetching a source page', async () => {
    const requester = vi.fn<Requester>().mockResolvedValueOnce(response(200, 'User-agent: *\nDisallow: /blocked'));
    await expect(fetchDiscoverablePage('https://news.example/blocked/report', { lookup: publicLookup, request: requester })).rejects.toThrow(/robots\.txt/i);
    expect(requester).toHaveBeenCalledTimes(1);
  });
});

describe('deterministic seed discovery', () => {
  it('extracts a review-only finding and marks the same source duplicate on an identical second run', async () => {
    const html = `<!doctype html><html><head><title>Audit finds Flock camera access violations</title><meta name="author" content="Example Newsroom"><meta property="article:published_time" content="2026-07-29T10:00:00Z"><meta name="description" content="A city audit reported unauthorized Flock camera searches and access policy failures."><link rel="canonical" href="https://news.example/flock-audit"></head><body><article>The city audit found unauthorized searches involving Flock Safety cameras.</article></body></html>`;
    const makeDeps = (): ScraperDependencies => ({
      lookup: publicLookup,
      request: vi.fn<Requester>()
        .mockResolvedValueOnce(response(404, ''))
        .mockResolvedValueOnce(response(200, html, { 'content-type': 'text/html; charset=utf-8' })),
    });
    const first = await runSeedDiscovery(['https://news.example/flock-audit?utm_source=test'], [], [], makeDeps());
    expect(first.findings).toHaveLength(1);
    expect(first.findings[0]).toMatchObject({
      canonicalUrl: 'https://news.example/flock-audit',
      title: 'Audit finds Flock camera access violations',
      publisher: 'Example Newsroom',
      publishedDate: '2026-07-29',
      disposition: 'new-candidate',
    });
    expect(first.findings[0]?.snippet).toMatch(/unauthorized Flock camera searches/i);
    expect(first.autoPublished).toBe(false);

    const second = await runSeedDiscovery(['https://news.example/flock-audit?utm_source=test'], [], first.findings, makeDeps());
    expect(second.findings[0]?.disposition).toBe('duplicate');
    expect(second.duplicatesSkipped).toBe(1);
    expect(second.newCandidates).toBe(0);
  });
});
