import { lookup as dnsLookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Incident } from '../src/lib/incidentSchema.js';
import { canonicalizeUrl } from '../src/lib/dedupe.js';
import { atomicWriteRestricted } from './atomic-file.js';
import { validateDataDirectory } from './data-utils.js';

export interface RawResponse { status: number; body: Buffer; headers: Record<string, string> }
export type Requester = (url: string, pinnedAddress?: string) => Promise<RawResponse>;
export interface LookupAnswer { address: string; family: number }
export interface ScraperDependencies {
  lookup: (hostname: string) => Promise<LookupAnswer[]>;
  request: Requester;
}
export interface DiscoveryFinding {
  sourceUrl: string;
  canonicalUrl: string;
  title: string;
  publisher: string;
  publishedDate: string;
  snippet: string;
  relevanceScore: number;
  disposition: 'new-candidate' | 'duplicate' | 'uncertain';
  duplicateReason?: string;
}
export interface DiscoveryReport {
  generatedAt: string;
  findings: DiscoveryFinding[];
  newCandidates: number;
  duplicatesSkipped: number;
  uncertain: number;
  autoPublished: false;
  failures: Array<{ url: string; error: string }>;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const USER_AGENT = 'FlockingAbuseTracker/1.0 (+https://flockingabuse.multihost.ing/docs/automation.md)';
const blockedV4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const;

const v4Number = (value: string): number => value.split('.').reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);
const inV4Range = (address: string, network: string, prefix: number): boolean => {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (v4Number(address) & mask) === (v4Number(network) & mask);
};

const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) blockedV6.addSubnet(network, prefix, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.some(([network, prefix]) => inV4Range(address, network, prefix));
  if (family !== 6) return false;
  return !blockedV6.check(address, 'ipv6');
}

const defaultLookup: ScraperDependencies['lookup'] = async (hostname) => await dnsLookup(hostname, { all: true, verbatim: true });

export async function validatePublicUrl(raw: string, lookup: ScraperDependencies['lookup'] = defaultLookup): Promise<{ url: URL; addresses: LookupAnswer[] }> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Source must be a valid URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Source URL must use http or https');
  if (url.username || url.password) throw new Error('Source URL must not contain credentials');
  if (!url.hostname || url.hostname.toLocaleLowerCase('en-US') === 'localhost' || url.hostname.endsWith('.localhost')) throw new Error('Source URL hostname is not allowed');
  const literalFamily = isIP(url.hostname);
  const addresses = literalFamily ? [{ address: url.hostname, family: literalFamily }] : await lookup(url.hostname);
  if (addresses.length === 0 || addresses.some((answer) => !isPublicAddress(answer.address))) throw new Error('Source hostname resolved to a non-public address');
  return { url, addresses };
}

export const requestWithLimits = async (rawUrl: string, pinnedAddress?: string, absoluteTimeoutMs = 10_000): Promise<RawResponse> => {
  const url = new URL(rawUrl);
  const address = pinnedAddress ?? url.hostname;
  const transport = url.protocol === 'https:' ? https : http;
  return await new Promise<RawResponse>((resolveRequest, reject) => {
    let settled = false;
    const finish = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      operation();
    };
    const request = transport.request({
      protocol: url.protocol,
      hostname: address,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { Host: url.host, 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2' },
      servername: url.protocol === 'https:' ? url.hostname : undefined,
      timeout: absoluteTimeoutMs,
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) { request.destroy(new Error('Source response exceeded 2 MiB')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value;
        finish(() => resolveRequest({ status: response.statusCode ?? 0, body: Buffer.concat(chunks), headers }));
      });
    });
    const deadline = setTimeout(() => request.destroy(new Error('Source request exceeded absolute deadline')), absoluteTimeoutMs);
    request.on('timeout', () => request.destroy(new Error('Source request timed out')));
    request.on('error', (error) => finish(() => reject(error)));
    request.end();
  });
};
const defaultRequester: Requester = async (rawUrl, pinnedAddress) => await requestWithLimits(rawUrl, pinnedAddress);

interface RobotsRule { allow: boolean; pattern: string }
interface RobotsGroup { agents: string[]; rules: RobotsRule[] }

const robotsPattern = (pattern: string): RegExp => {
  const anchored = pattern.endsWith('$');
  const source = (anchored ? pattern.slice(0, -1) : pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`);
};

export const robotsAllows = (body: string, pathname: string): boolean => {
  const groups: RobotsGroup[] = [];
  let group: RobotsGroup | undefined;
  let sawRule = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLocaleLowerCase('en-US');
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      if (!group || sawRule) {
        group = { agents: [], rules: [] };
        groups.push(group);
        sawRule = false;
      }
      group.agents.push(value.toLocaleLowerCase('en-US'));
    } else if ((field === 'allow' || field === 'disallow') && group) {
      sawRule = true;
      if (value) group.rules.push({ allow: field === 'allow', pattern: value });
    }
  }
  const crawler = 'flockingabusetracker';
  const ranked = groups.map((candidate) => ({
    candidate,
    specificity: Math.max(-1, ...candidate.agents.map((agent) => agent === '*' ? 0 : crawler.includes(agent) ? agent.length : -1)),
  })).filter(({ specificity }) => specificity >= 0);
  const bestSpecificity = Math.max(-1, ...ranked.map(({ specificity }) => specificity));
  const matchingRules = ranked.filter(({ specificity }) => specificity === bestSpecificity).flatMap(({ candidate }) => candidate.rules);
  const matches = matchingRules
    .filter((rule) => robotsPattern(rule.pattern).test(pathname))
    .sort((left, right) => right.pattern.replace(/[*$]/g, '').length - left.pattern.replace(/[*$]/g, '').length || Number(right.allow) - Number(left.allow));
  return matches[0]?.allow ?? true;
};

const requestValidated = async (url: URL, deps: ScraperDependencies): Promise<RawResponse> => {
  const validated = await validatePublicUrl(url.toString(), deps.lookup);
  return await deps.request(validated.url.toString(), validated.addresses[0]?.address);
};

const fetchRobots = async (origin: string, deps: ScraperDependencies): Promise<string> => {
  let current = new URL('/robots.txt', origin);
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    const response = await requestValidated(current, deps);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (!location) throw new Error('robots.txt redirect omitted Location');
      current = new URL(location, current);
      await validatePublicUrl(current.toString(), deps.lookup);
      continue;
    }
    if (response.status >= 200 && response.status < 300) return response.body.toString('utf8');
    if (response.status === 401 || response.status === 403) return 'User-agent: *\nDisallow: /';
    if (response.status >= 500) throw new Error(`robots.txt returned HTTP ${response.status}`);
    return '';
  }
  throw new Error('robots.txt exceeded redirect limit');
};

export async function fetchDiscoverablePage(rawUrl: string, dependencies?: Partial<ScraperDependencies>): Promise<{ finalUrl: string; html: string }> {
  const deps: ScraperDependencies = { lookup: dependencies?.lookup ?? defaultLookup, request: dependencies?.request ?? defaultRequester };
  let validated = await validatePublicUrl(rawUrl, deps.lookup);
  let current = validated.url;
  const robotsByOrigin = new Map<string, string>();
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    if (!robotsByOrigin.has(current.origin)) robotsByOrigin.set(current.origin, await fetchRobots(current.origin, deps));
    const robotsBody = robotsByOrigin.get(current.origin) ?? '';
    if (!robotsAllows(robotsBody, `${current.pathname}${current.search}`)) throw new Error('robots.txt disallows this source path');
    validated = await validatePublicUrl(current.toString(), deps.lookup);
    const response = await deps.request(validated.url.toString(), validated.addresses[0]?.address);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (!location) throw new Error('Redirect response omitted Location');
      const target = new URL(location, current);
      await validatePublicUrl(target.toString(), deps.lookup);
      current = target;
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`Source returned HTTP ${response.status}`);
    const contentType = response.headers['content-type'] ?? 'text/html';
    if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(contentType)) throw new Error(`Unsupported source content type: ${contentType}`);
    return { finalUrl: current.toString(), html: response.body.toString('utf8') };
  }
  throw new Error('Source exceeded redirect limit');
}

const decode = (value: string): string => value.replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
const stripMarkup = (html: string): string => decode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
const attribute = (tag: string, name: string): string | undefined => new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1];
const meta = (html: string, names: string[]): string | undefined => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = attribute(tag, 'name') ?? attribute(tag, 'property') ?? attribute(tag, 'itemprop');
    if (key && names.some((name) => key.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))) {
      const content = attribute(tag, 'content');
      if (content) return decode(content.trim());
    }
  }
  return undefined;
};
const canonicalFrom = (html: string): string | undefined => {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) if ((attribute(tag, 'rel') ?? '').toLocaleLowerCase('en-US').split(/\s+/).includes('canonical')) return attribute(tag, 'href');
  return undefined;
};
const titleFrom = (html: string): string => meta(html, ['og:title', 'twitter:title']) ?? decode(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? 'Untitled source');
const dateFrom = (html: string): string => {
  const raw = meta(html, ['article:published_time', 'datepublished', 'date', 'pubdate']);
  const match = raw?.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? '';
};
const snippetFrom = (html: string): string => {
  const description = meta(html, ['description', 'og:description']);
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1];
  return stripMarkup([description, article ?? html].filter(Boolean).join(' ')).slice(0, 1200);
};
const relevance = (text: string): number => {
  const value = text.toLocaleLowerCase('en-US');
  const flock = /flock safety|flock camera|license plate reader|\balpr\b/.test(value) ? 0.45 : 0;
  const abuseTerms = ['abuse', 'misuse', 'unauthorized', 'lawsuit', 'audit', 'policy violation', 'immigration', 'abortion', 'protest', 'stalk', 'privacy'];
  return Number(Math.min(1, flock + abuseTerms.filter((term) => value.includes(term)).length * 0.11).toFixed(2));
};

export async function runSeedDiscovery(seedUrls: string[], incidents: Incident[], priorFindings: DiscoveryFinding[], dependencies?: Partial<ScraperDependencies>): Promise<DiscoveryReport> {
  const sourceIndex = new Set(incidents.flatMap((incident) => incident.sources.map((source) => canonicalizeUrl(source.url))));
  const priorIndex = new Set(priorFindings.map((finding) => canonicalizeUrl(finding.canonicalUrl)));
  const findings: DiscoveryFinding[] = [];
  const failures: Array<{ url: string; error: string }> = [];
  for (const sourceUrl of seedUrls) {
    try {
      const page = await fetchDiscoverablePage(sourceUrl, dependencies);
      const canonicalRaw = canonicalFrom(page.html);
      const canonicalUrl = canonicalizeUrl(new URL(canonicalRaw ?? page.finalUrl, page.finalUrl).toString());
      const title = titleFrom(page.html);
      const snippet = snippetFrom(page.html);
      const score = relevance(`${title} ${snippet}`);
      const duplicate = sourceIndex.has(canonicalUrl) || priorIndex.has(canonicalUrl);
      findings.push({
        sourceUrl,
        canonicalUrl,
        title,
        publisher: meta(page.html, ['author', 'og:site_name', 'application-name']) ?? new URL(canonicalUrl).hostname.replace(/^www\./, ''),
        publishedDate: dateFrom(page.html),
        snippet,
        relevanceScore: score,
        disposition: duplicate ? 'duplicate' : score >= 0.56 ? 'new-candidate' : 'uncertain',
        ...(duplicate ? { duplicateReason: 'canonical source URL already exists' } : {}),
      });
    } catch (error) {
      failures.push({ url: sourceUrl, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    generatedAt: new Date().toISOString(), findings,
    newCandidates: findings.filter((finding) => finding.disposition === 'new-candidate').length,
    duplicatesSkipped: findings.filter((finding) => finding.disposition === 'duplicate').length,
    uncertain: findings.filter((finding) => finding.disposition === 'uncertain').length,
    autoPublished: false, failures,
  };
}

async function braveSeedUrls(apiKey: string): Promise<string[]> {
  const queries = ['"Flock Safety" abuse police camera', '"Flock camera" misuse lawsuit audit', '"Flock Safety" immigration abortion protest'];
  const urls = new Set<string>();
  for (const query of queries) {
    const endpoint = new URL('https://api.search.brave.com/res/v1/web/search');
    endpoint.searchParams.set('q', query); endpoint.searchParams.set('count', '10'); endpoint.searchParams.set('freshness', 'pm');
    const response = await fetch(endpoint, { headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Brave Search returned HTTP ${response.status}`);
    const payload = await response.json() as { web?: { results?: Array<{ url?: string }> } };
    for (const result of payload.web?.results ?? []) if (result.url) urls.add(result.url);
  }
  return [...urls];
}

export async function loadExistingRecords(dataDir: string): Promise<Incident[]> {
  const result = await validateDataDirectory(resolve(dataDir));
  if (!result.valid) throw new Error(`Existing incident data failed validation:\n${result.errors.join('\n')}`);
  return result.records;
}

interface CliOptions { seedFile?: string; output: string; dataFile?: string; dataDir: string }
const parseCli = (arguments_: string[]): CliOptions => {
  const result: CliOptions = { output: 'candidate-findings.json', dataDir: 'data' };
  for (let index = 0; index < arguments_.length; index += 1) {
    const value = arguments_[index]; const next = arguments_[index + 1];
    if (value === '--seed-file' && next) { result.seedFile = next; index += 1; }
    else if (value === '--output' && next) { result.output = next; index += 1; }
    else if (value === '--public-data' && next) { result.dataFile = next; index += 1; }
    else if (value === '--data-dir' && next) { result.dataDir = next; index += 1; }
    else throw new Error(`Unknown or incomplete option: ${value}`);
  }
  return result;
};

async function runCli(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const seeds = options.seedFile
    ? (await readFile(resolve(options.seedFile), 'utf8')).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
    : await braveSeedUrls(process.env.BRAVE_SEARCH_API_KEY?.trim() || (() => { throw new Error('Use --seed-file or configure BRAVE_SEARCH_API_KEY'); })());
  const incidents = await loadExistingRecords(options.dataDir);
  if (options.dataFile) incidents.push(...JSON.parse(await readFile(resolve(options.dataFile), 'utf8')) as Incident[]);
  let prior: DiscoveryFinding[] = [];
  const outputPath = resolve(options.output);
  try {
    prior = (JSON.parse(await readFile(outputPath, 'utf8')) as DiscoveryReport).findings ?? [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Existing discovery state is malformed or unreadable: ${outputPath}`, { cause: error });
  }
  const report = await runSeedDiscovery(seeds, incidents, prior);
  await atomicWriteRestricted(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Discovery complete: ${report.newCandidates} new, ${report.duplicatesSkipped} duplicates, ${report.uncertain} uncertain, ${report.failures.length} failures. No records were auto-published.`);
  if (report.failures.length > 0 && report.findings.length === 0) process.exitCode = 1;
}

const isEntrypoint = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) await runCli().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
