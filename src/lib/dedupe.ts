import type { Incident } from './incidentSchema.js';

export interface DuplicateComparison {
  incidentId: string;
  isDuplicate: boolean;
  classification: 'exact' | 'probable' | 'distinct';
  score: number;
  reasons: string[];
}

const TRACKING_PARAMS = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i;
const normalize = (value: string): string => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim();

export function canonicalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  url.hostname = url.hostname.toLocaleLowerCase('en-US');
  url.protocol = url.protocol.toLocaleLowerCase('en-US');
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  const entries = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  url.search = '';
  for (const [key, value] of entries) url.searchParams.append(key, value);
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

const tokenSimilarity = (left: string, right: string): number => {
  const leftTokens = new Set(normalize(left).split(' ').filter((token) => token.length > 2));
  const rightTokens = new Set(normalize(right).split(' ').filter((token) => token.length > 2));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return (2 * intersection) / (leftTokens.size + rightTokens.size);
};

const overlaps = (left: string[], right: string[]): boolean => {
  const normalized = new Set(left.map(normalize));
  return right.some((item) => normalized.has(normalize(item)));
};

const monthIndex = (value: string): number | undefined => {
  if (!value) return undefined;
  const [year = '0', month = '1'] = value.split('-');
  return Number(year) * 12 + Number(month) - 1;
};

export function compareIncidents(candidate: Incident, existing: Incident): DuplicateComparison {
  const reasons: string[] = [];
  const candidateUrls = new Set(candidate.sources.map((source) => canonicalizeUrl(source.url)));
  if (existing.sources.some((source) => candidateUrls.has(canonicalizeUrl(source.url)))) {
    return { incidentId: existing.id, isDuplicate: true, classification: 'exact', score: 1, reasons: ['canonical source URL match'] };
  }

  const candidateCases = new Set(candidate.legal_or_policy_context.case_numbers.map(normalize));
  const caseMatch = existing.legal_or_policy_context.case_numbers.find((item) => candidateCases.has(normalize(item)));
  if (caseMatch) return { incidentId: existing.id, isDuplicate: true, classification: 'exact', score: 1, reasons: [`case number match: ${caseMatch.toLocaleLowerCase('en-US')}`] };

  if (normalize(candidate.uniqueness.canonical_key) === normalize(existing.uniqueness.canonical_key)) {
    return { incidentId: existing.id, isDuplicate: true, classification: 'exact', score: 1, reasons: ['canonical incident key match'] };
  }

  let score = 0;
  const similarity = tokenSimilarity(candidate.title, existing.title);
  if (similarity >= 0.3) {
    score += similarity * 0.25;
    reasons.push(`title similarity ${similarity.toFixed(2)}`);
  }
  if (overlaps(candidate.actors.agencies, existing.actors.agencies)) { score += 0.2; reasons.push('agency match'); }
  const candidateLocation = [candidate.location.country, candidate.location.state, candidate.location.county, candidate.location.city].map(normalize).filter(Boolean);
  const existingLocation = [existing.location.country, existing.location.state, existing.location.county, existing.location.city].map(normalize).filter(Boolean);
  if (candidateLocation.some((part) => existingLocation.includes(part)) && normalize(candidate.location.state) === normalize(existing.location.state)) {
    score += 0.15; reasons.push('location match');
  }
  const candidateMonth = monthIndex(candidate.dates.occurred);
  const existingMonth = monthIndex(existing.dates.occurred);
  if (typeof candidateMonth === 'number' && typeof existingMonth === 'number' && Math.abs(candidateMonth - existingMonth) <= 1) { score += 0.2; reasons.push('date window match'); }
  if (overlaps(candidate.incident_type, existing.incident_type)) { score += 0.2; reasons.push('incident type match'); }
  const rounded = Math.min(1, Number(score.toFixed(3)));
  const isDuplicate = rounded >= 0.7;
  return { incidentId: existing.id, isDuplicate, classification: isDuplicate ? 'probable' : 'distinct', score: rounded, reasons };
}

export function findDuplicates(candidate: Incident, existing: Incident[]): DuplicateComparison[] {
  return existing
    .map((incident) => compareIncidents(candidate, incident))
    .filter((comparison) => comparison.isDuplicate)
    .sort((left, right) => right.score - left.score || left.incidentId.localeCompare(right.incidentId));
}
