import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPublicData, publicationContentDigest, validateDataDirectory } from '../scripts/data-utils.js';
import { IncidentSchema } from '../src/lib/incidentSchema.js';

const dirs: string[] = [];
const fixtureApprovalRoot = 'tests/fixtures/approvals';
const makeData = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'flocking-data-'));
  dirs.push(root);
  await mkdir(join(root, 'incidents'), { recursive: true });
  await mkdir(join(root, 'candidates'), { recursive: true });
  return root;
};

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('data pipeline', () => {
  it('validates YAML in both incident and candidate directories with file-specific errors', async () => {
    const dataDir = await makeData();
    await writeFile(join(dataDir, 'candidates', 'bad.yaml'), 'id: bad\nsources: []\n');
    const result = await validateDataDirectory(dataDir, fixtureApprovalRoot);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/candidates\/bad\.yaml/);
  });

  it('publishes only accepted records from the public incident directory', async () => {
    const dataDir = await makeData();
    const source = await readFile('tests/fixtures/validIncident.yaml', 'utf8');
    await writeFile(join(dataDir, 'incidents', 'verified.yaml'), source);
    await writeFile(join(dataDir, 'candidates', 'candidate.yaml'), source
      .replace('status: "verified"', 'status: "candidate"')
      .replace('approval: "human-approved"', 'approval: "pending"')
      .replace('2026-07-synthetic-example', 'candidate-example')
      .replace('https://example.gov/audits/synthetic-report', 'https://example.org/candidate-source')
      .replace('Example Police Department', 'Candidate Agency')
      .replace('approval_reference: "docs/approvals/2026-07-03-test-fixture-approval.md#approval-test-fixture"', 'approval_reference: ""')
      .replace('us-ex-example-county:2026-06:example-police-department:retention-or-access-policy', 'us-ex-example-county:2026-06:candidate-agency:retention-or-access-policy'));
    expect((await buildPublicData(dataDir, false, fixtureApprovalRoot)).map((item) => item.status)).toEqual(['verified']);
    expect((await buildPublicData(dataDir, true, fixtureApprovalRoot)).map((item) => item.status).sort()).toEqual(['candidate', 'verified']);
  });

  it('preserves retracted public records in the generated audit bundle', async () => {
    const dataDir = await makeData();
    const source = await readFile('tests/fixtures/validIncident.yaml', 'utf8');
    const retracted = source.replace('status: "verified"', 'status: "retracted"');
    await writeFile(join(dataDir, 'incidents', 'retracted.yaml'), retracted);
    const approvalRoot = join(dataDir, '..', 'approvals');
    await mkdir(approvalRoot, { recursive: true });
    const digest = publicationContentDigest(IncidentSchema.parse(yaml.load(retracted)));
    const approval = (await readFile('tests/fixtures/approvals/2026-07-03-test-fixture-approval.md', 'utf8'))
      .replace('9331c34bdf4b3a3bdc58a605db236ea65733f7c884c1bec9fa54cbc199675618', digest);
    await writeFile(join(approvalRoot, '2026-07-03-test-fixture-approval.md'), approval);
    expect((await buildPublicData(dataDir, false, approvalRoot)).map((item) => item.status)).toEqual(['retracted']);
  });

  it('fails closed when a public status is placed in the review-only candidate directory', async () => {
    const dataDir = await makeData();
    const source = await readFile('tests/fixtures/validIncident.yaml', 'utf8');
    await writeFile(join(dataDir, 'candidates', 'misplaced.yaml'), source);
    const result = await validateDataDirectory(dataDir, fixtureApprovalRoot);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('candidates/misplaced.yaml: candidate storage accepts only candidate or draft status');
    await expect(buildPublicData(dataDir, false, fixtureApprovalRoot)).rejects.toThrow(/candidate storage/i);
  });

  it('fails closed when a review-only status is placed in the public incident directory', async () => {
    const dataDir = await makeData();
    const source = (await readFile('tests/fixtures/validIncident.yaml', 'utf8'))
      .replace('status: "verified"', 'status: "candidate"')
      .replace('approval: "human-approved"', 'approval: "pending"')
      .replace('reviewed_by: "Fixture Reviewer"', 'reviewed_by: ""')
      .replace('reviewed_at: "2026-07-03"', 'reviewed_at: ""')
      .replace('approval_reference: "docs/approvals/2026-07-03-test-fixture-approval.md#approval-test-fixture"', 'approval_reference: ""');
    await writeFile(join(dataDir, 'incidents', 'misplaced.yaml'), source);
    const result = await validateDataDirectory(dataDir, fixtureApprovalRoot);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('incidents/misplaced.yaml: public storage accepts only verified, disputed, or retracted status');
  });

  it('fails validation for exact duplicate identities across files', async () => {
    const dataDir = await makeData();
    const source = await readFile('tests/fixtures/validIncident.yaml', 'utf8');
    await writeFile(join(dataDir, 'incidents', 'first.yaml'), source);
    await writeFile(join(dataDir, 'candidates', 'second.yaml'), source
      .replace('2026-07-synthetic-example', 'duplicate-candidate')
      .replace('status: "verified"', 'status: "candidate"')
      .replace('approval: "human-approved"', 'approval: "pending"')
      .replace('reviewed_by: "Fixture Reviewer"', 'reviewed_by: ""')
      .replace('reviewed_at: "2026-07-03"', 'reviewed_at: ""')
      .replace('approval_reference: "docs/approvals/2026-07-03-test-fixture-approval.md#approval-test-fixture"', 'approval_reference: ""'));
    const result = await validateDataDirectory(dataDir, fixtureApprovalRoot);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/exact duplicate.*canonical source URL match/i);
  });

  it('fails closed when an accepted record approval document root is unavailable', async () => {
    const dataDir = await makeData();
    const result = await validateDataDirectory(dataDir, join(dataDir, '..', 'missing-approvals'));
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/approval document root/i);
  });

  it('rejects an approval document that is not bound to the accepted incident and its content', async () => {
    const dataDir = await makeData();
    const changedId = (await readFile('data/incidents/2026-07-milwaukee-officer-personal-flock-searches.yaml', 'utf8'))
      .replace('id: 2026-07-milwaukee-officer-personal-flock-searches', 'id: 2026-07-milwaukee-officer-personal-flock-searches-copy');
    await writeFile(join(dataDir, 'incidents', 'changed-id.yaml'), changedId);
    const identityResult = await validateDataDirectory(dataDir, 'docs/approvals');
    expect(identityResult.valid).toBe(false);
    expect(identityResult.errors.join('\n')).toMatch(/approval.*incident id/i);

    const changedContent = (await readFile('data/incidents/2026-07-milwaukee-officer-personal-flock-searches.yaml', 'utf8'))
      .replace('The report said a court commissioner granted two restraining orders against Ayala.', 'The report contained a materially different claim for mismatch testing only.');
    await writeFile(join(dataDir, 'incidents', 'changed-id.yaml'), changedContent);
    const contentResult = await validateDataDirectory(dataDir, 'docs/approvals');
    expect(contentResult.valid).toBe(false);
    expect(contentResult.errors.join('\n')).toMatch(/approval.*content digest/i);
  });

  it('rejects reuse of one approval decision across multiple accepted records', async () => {
    const dataDir = await makeData();
    const source = await readFile('data/incidents/2026-07-milwaukee-officer-personal-flock-searches.yaml', 'utf8');
    await writeFile(join(dataDir, 'incidents', 'first.yaml'), source);
    await writeFile(join(dataDir, 'incidents', 'second.yaml'), source
      .replace('id: 2026-07-milwaukee-officer-personal-flock-searches', 'id: 2026-07-milwaukee-officer-personal-flock-searches-copy')
      .replace('title: Former Milwaukee officer used Flock searches for personal surveillance', 'title: Distinct synthetic record attempting approval reuse'));
    const result = await validateDataDirectory(dataDir, 'docs/approvals');
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/approval reference is already used/i);
  });

  it('ships a source-verified public seed without exposing the review-only abortion-search candidate', async () => {
    const result = await validateDataDirectory('data');
    expect(result.errors).toEqual([]);
    expect(result.records.map((record) => record.id)).toContain('2026-07-milwaukee-officer-personal-flock-searches');
    expect(result.records.map((record) => record.id)).toContain('2025-05-texas-abortion-related-national-flock-search');
    const publicRecord = result.records.find((record) => record.id === '2026-07-milwaukee-officer-personal-flock-searches')!;
    expect(publicRecord.sources.some((source) => source.key_claims.some((claim) => /restraining orders/i.test(claim)))).toBe(true);
    expect(publicRecord.review.approval_reference).toMatch(/^docs\/approvals\/.+\.md#approval-/);
    const [approvalPath, approvalAnchor] = publicRecord.review.approval_reference.split('#');
    const approvalDocument = await readFile(approvalPath!, 'utf8');
    expect(approvalDocument).toContain(`<a id="${approvalAnchor}"></a>`);
    expect((await buildPublicData('data')).map((record) => record.id)).toEqual([
      '2012-01-trendnet-camera-feed-exposure',
      '2022-10-kechi-lieutenant-flock-stalking',
      '2023-06-costa-mesa-officer-personal-flock-tracking',
      '2023-06-sedgwick-chief-flock-tracking',
      '2024-01-milwaukee-detective-flock-gps-tracking',
      '2024-02-prairie-grove-officer-personal-flock-searches',
      '2024-02-wyze-cross-account-camera-exposure',
      '2024-06-orange-city-officer-flock-stalking',
      '2024-06-riverside-deputy-flock-stalking',
      '2024-10-norfolk-flock-constitutional-challenge',
      '2024-12-matteson-officer-personal-flock-searches',
      '2025-03-louisville-officer-alpr-stalking',
      '2025-07-jerome-county-sheriff-wife-flock-searches',
      '2025-09-kenosha-county-deputy-flock-tracking',
      '2025-10-menasha-officer-flock-tracking',
      '2025-10-niceville-officer-flock-stalking',
      '2025-11-bonner-springs-detective-flock-stalking',
      '2025-11-braselton-chief-alpr-stalking',
      '2025-12-echols-employee-personal-flock-searches',
      '2025-12-greer-officers-false-flock-search-justifications',
      '2025-12-joplin-officer-flock-misuse',
      '2026-04-conyers-dispatcher-non-law-enforcement-searches',
      '2026-04-san-jose-flock-constitutional-challenge',
      '2026-05-coffee-county-deputy-license-plate-data-stalking',
      '2026-05-pasadena-sergeant-flock-tracking',
      '2026-05-racine-county-officers-flock-misuse',
      '2026-06-albany-officers-non-law-enforcement-searches',
      '2026-06-charlotte-officer-non-law-enforcement-flock-query',
      '2026-06-cherokee-county-deputy-coworker-plate-searches',
      '2026-06-cherokee-county-supervisors-non-law-enforcement-searches',
      '2026-06-ogeechee-investigator-retained-flock-access',
      '2026-06-richmond-county-deputy-personal-flock-searches',
      '2026-07-baytown-officer-alleged-flock-misuse',
      '2026-07-dekalb-deputy-flock-misuse',
      '2026-07-fayetteville-three-officers-personal-flock-searches',
      '2026-07-greene-county-deputy-personal-searches',
      '2026-07-greenville-county-employees-romantic-partner-tracking',
      '2026-07-henry-county-officer-non-law-enforcement-flock-use',
      '2026-07-milwaukee-officer-personal-flock-searches',
      '2026-07-richmond-county-three-employees-personal-flock-searches',
      '2026-07-sumter-county-detective-personal-flock-searches',
      '2026-08-02-quebec-regulator-ordered-crane-supply-to-limit-continuous-in-cab-camer-8a555de0ffbe',
    ]);
  });
});
