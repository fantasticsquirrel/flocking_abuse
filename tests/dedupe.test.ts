import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import type { Incident } from '../src/lib/incidentSchema.js';
import { canonicalizeUrl, compareIncidents, findDuplicates } from '../src/lib/dedupe.js';

const fixture = (): Incident => yaml.load(readFileSync(resolve('tests/fixtures/validIncident.yaml'), 'utf8')) as Incident;

describe('canonicalizeUrl', () => {
  it('normalizes host, fragment, trailing slash, and tracking parameters deterministically', () => {
    expect(canonicalizeUrl('HTTPS://Example.COM/story/?utm_source=x&b=2&a=1#part')).toBe('https://example.com/story?a=1&b=2');
  });
});

describe('compareIncidents', () => {
  it('marks exact and canonical source URLs as exact duplicates with explained scores', () => {
    const existing = fixture();
    const candidate = structuredClone(existing);
    candidate.id = 'candidate-two';
    candidate.sources[0]!.url = 'https://EXAMPLE.gov/audits/synthetic-report/?utm_campaign=test#top';
    const comparison = compareIncidents(candidate, existing);
    expect(comparison.isDuplicate).toBe(true);
    expect(comparison.classification).toBe('exact');
    expect(comparison.score).toBe(1);
    expect(comparison.reasons).toContain('canonical source URL match');
  });

  it('marks matching case numbers or canonical keys as exact duplicates', () => {
    const existing = fixture();
    existing.legal_or_policy_context.case_numbers = ['Case 24-CV-100'];
    const candidate = structuredClone(existing);
    candidate.id = 'another';
    candidate.sources[0]!.url = 'https://different.example/article';
    candidate.uniqueness.canonical_key = 'different';
    expect(compareIncidents(candidate, existing).classification).toBe('exact');
    expect(compareIncidents(candidate, existing).reasons).toContain('case number match: case 24-cv-100');
    candidate.legal_or_policy_context.case_numbers = [];
    candidate.uniqueness.canonical_key = existing.uniqueness.canonical_key;
    expect(compareIncidents(candidate, existing).classification).toBe('exact');
    expect(compareIncidents(candidate, existing).reasons).toContain('canonical incident key match');
  });

  it('scores fuzzy title plus agency, location, date, and type and explains each signal', () => {
    const existing = fixture();
    const candidate = structuredClone(existing);
    candidate.id = 'fuzzy-candidate';
    candidate.title = 'Official audit report finds synthetic access policy failures';
    candidate.sources[0]!.url = 'https://elsewhere.example/follow-up';
    candidate.uniqueness.canonical_key = 'different-key';
    const comparison = compareIncidents(candidate, existing);
    expect(comparison.isDuplicate).toBe(true);
    expect(comparison.classification).toBe('probable');
    expect(comparison.score).toBeGreaterThanOrEqual(0.7);
    expect(comparison.reasons).toEqual(expect.arrayContaining([
      expect.stringMatching(/title similarity/), 'agency match', 'location match', 'date window match', 'incident type match',
    ]));
  });

  it('does not misclassify a maximum-scoring fuzzy match as exact', () => {
    const existing = fixture();
    const candidate = structuredClone(existing);
    candidate.id = 'maximum-fuzzy-candidate';
    candidate.sources[0]!.url = 'https://different.example/follow-up';
    candidate.uniqueness.canonical_key = 'different-key';
    candidate.legal_or_policy_context.case_numbers = [];
    const comparison = compareIncidents(candidate, existing);
    expect(comparison.score).toBe(1);
    expect(comparison.classification).toBe('probable');
  });

  it('does not award a date-window match when either occurrence date is unknown', () => {
    const existing = fixture();
    const candidate = structuredClone(existing);
    candidate.id = 'unknown-date-candidate';
    candidate.dates.occurred = '';
    candidate.sources[0]!.url = 'https://different.example/follow-up';
    candidate.uniqueness.canonical_key = 'different-key';
    const comparison = compareIncidents(candidate, existing);
    expect(comparison.reasons).not.toContain('date window match');
  });

  it('does not award a locality score for country-only records', () => {
    const existing = fixture();
    const candidate = structuredClone(existing);
    candidate.id = 'country-only-candidate';
    candidate.sources[0]!.url = 'https://different.example/country-only';
    candidate.uniqueness.canonical_key = 'different-country-only-key';
    for (const record of [existing, candidate]) {
      record.location.city = '';
      record.location.county = '';
      record.location.state = '';
      record.dates.occurred = '';
    }
    expect(compareIncidents(candidate, existing).reasons).not.toContain('location match');
  });

  it('keeps a different event distinct and returns the best comparisons in stable score order', () => {
    const existing = fixture();
    const candidate = structuredClone(existing);
    candidate.id = 'distinct-event';
    candidate.title = 'Unrelated lawsuit in another jurisdiction';
    candidate.location = { city: 'Elsewhere', county: 'Other', state: 'ZZ', country: 'US' };
    candidate.actors.agencies = ['Different Agency'];
    candidate.dates.occurred = '2020-01';
    candidate.incident_type = ['vendor-or-contracting'];
    candidate.sources[0]!.url = 'https://different.example/lawsuit';
    candidate.uniqueness.canonical_key = 'zz/other:2020:different:vendor';
    expect(compareIncidents(candidate, existing).isDuplicate).toBe(false);
    const duplicate = structuredClone(existing);
    duplicate.id = 'same-event-candidate';
    duplicate.sources[0]!.url = 'https://different.example/follow-up';
    const matches = findDuplicates(duplicate, [existing, { ...existing, id: 'z-copy' }]);
    expect(matches.map((match) => match.incidentId)).toEqual(['2026-07-synthetic-example', 'z-copy']);
  });
});
