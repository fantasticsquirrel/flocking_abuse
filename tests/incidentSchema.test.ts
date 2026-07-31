import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { IncidentSchema } from '../src/lib/incidentSchema.js';

const loadFixture = (name: string): unknown => yaml.load(readFileSync(resolve('tests/fixtures', name), 'utf8'));

describe('IncidentSchema', () => {
  it('accepts the complete synthetic reporting-format fixture', () => {
    expect(IncidentSchema.parse(loadFixture('validIncident.yaml')).id).toBe('2026-07-synthetic-example');
  });

  it('rejects records without sources with an actionable message', () => {
    const result = IncidentSchema.safeParse(loadFixture('invalidNoSources.yaml'));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toMatch(/at least one source/i);
  });

  it('requires independent corroborating publishers for verified records without a primary source', () => {
    const fixture = loadFixture('validIncident.yaml') as Record<string, unknown>;
    const baseSource = {
      url: 'https://news.example/story-one', title: 'Story one', publisher: 'Same Newsroom',
      published_date: '2026-07-02', source_type: 'news', reliability: 'corroborating', key_claims: ['Reported claim'],
    };
    fixture.sources = [baseSource, { ...baseSource, url: 'https://news.example/story-two' }];
    const samePublisher = IncidentSchema.safeParse(fixture);
    expect(samePublisher.success).toBe(false);
    if (!samePublisher.success) expect(samePublisher.error.issues.at(-1)?.message).toMatch(/independent secondary publishers/i);
    fixture.sources = [baseSource, { ...baseSource, url: 'https://other.example/report', publisher: 'Other Newsroom' }];
    expect(IncidentSchema.safeParse(fixture).success).toBe(true);
  });

  it('rejects news or advocacy sources mislabeled as primary', () => {
    const fixture = loadFixture('validIncident.yaml') as { sources: Array<Record<string, unknown>> };
    fixture.sources[0]!.source_type = 'news';
    fixture.sources[0]!.reliability = 'primary';
    const result = IncidentSchema.safeParse(fixture);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message).join(' ')).toMatch(/direct official or public record/i);
  });

  it('does not count publisher aliases on one source host as independent corroboration', () => {
    const fixture = loadFixture('validIncident.yaml') as Record<string, unknown>;
    const baseSource = {
      url: 'https://news.example/story-one', title: 'Story one', publisher: 'News Brand One',
      published_date: '2026-07-02', source_type: 'news', reliability: 'corroborating', key_claims: ['Reported claim'],
    };
    fixture.sources = [baseSource, { ...baseSource, url: 'https://news.example/story-two', publisher: 'News Brand Two' }];
    expect(IncidentSchema.safeParse(fixture).success).toBe(false);
  });

  it('allows an unknown occurrence date without presenting an estimated month as fact', () => {
    const fixture = loadFixture('validIncident.yaml') as { dates: { occurred: string }; uniqueness: { canonical_key: string } };
    fixture.dates.occurred = '';
    fixture.uniqueness.canonical_key = 'us-ex-example-county:unknown:example-police-department:other';
    expect(IncidentSchema.safeParse(fixture).success).toBe(true);
  });

  it('couples unknown occurrence dates to an unknown canonical-key segment', () => {
    const fixture = loadFixture('validIncident.yaml') as { dates: { occurred: string }; uniqueness: { canonical_key: string } };
    fixture.dates.occurred = '';
    expect(IncidentSchema.safeParse(fixture).success).toBe(false);
    fixture.uniqueness.canonical_key = 'us-ex-example-county:unknown:example-police-department:other';
    expect(IncidentSchema.safeParse(fixture).success).toBe(true);
    fixture.dates.occurred = '2026-07';
    expect(IncidentSchema.safeParse(fixture).success).toBe(false);
  });

  it('requires structured human approval and an immutable reference for public statuses', () => {
    const fixture = loadFixture('validIncident.yaml') as { review: { approval: string; reviewed_by: string; reviewed_at: string; approval_reference: string } };
    fixture.review.approval = 'pending';
    fixture.review.reviewed_by = '';
    fixture.review.reviewed_at = '';
    fixture.review.approval_reference = '';
    expect(IncidentSchema.safeParse(fixture).success).toBe(false);
    fixture.review.approval = 'human-approved';
    fixture.review.reviewed_by = 'Site owner';
    fixture.review.reviewed_at = '2026-07-31';
    fixture.review.approval_reference = 'arbitrary text';
    expect(IncidentSchema.safeParse(fixture).success).toBe(false);
    fixture.review.approval_reference = 'docs/approvals/2026-07-03-test-fixture-approval.md#approval-test-fixture';
    expect(IncidentSchema.safeParse(fixture).success).toBe(true);
  });

  it('binds canonical identity to location, occurrence month, agency, and a factual event segment', () => {
    const fixture = loadFixture('validIncident.yaml') as { uniqueness: { canonical_key: string } };
    for (const invalid of [
      'arbitrary',
      'us-wrong-place:2026-06:example-police:retention-or-access-policy',
      'ex-example-exampleville:2025-01:example-police-department:retention-or-access-policy',
      'ex-example-exampleville:2026-06:wrong-agency:retention-or-access-policy',
    ]) {
      fixture.uniqueness.canonical_key = invalid;
      expect(IncidentSchema.safeParse(fixture).success, invalid).toBe(false);
    }
  });

  it('represents sources with an unknown publication date explicitly', () => {
    const fixture = loadFixture('validIncident.yaml') as { sources: Array<{ published_date: string }> };
    fixture.sources[0]!.published_date = '';
    expect(IncidentSchema.safeParse(fixture).success).toBe(true);
  });

  it('rejects invalid calendar dates and identifies the failing path', () => {
    const fixture = loadFixture('validIncident.yaml') as { dates: { occurred: string } };
    fixture.dates.occurred = '2026-13-40';
    const result = IncidentSchema.safeParse(fixture);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'dates.occurred')).toBe(true);
      expect(result.error.issues.map((issue) => issue.message).join(' ')).toMatch(/YYYY-MM/i);
    }
  });

  it('rejects non URL-safe IDs and unrecognized fields', () => {
    const fixture = loadFixture('validIncident.yaml') as Record<string, unknown>;
    fixture.id = '../unsafe id';
    fixture.unexpected = true;
    const result = IncidentSchema.safeParse(fixture);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'id')).toBe(true);
      expect(result.error.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
    }
  });
});
