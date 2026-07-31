import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPublicData, validateDataDirectory } from '../scripts/data-utils.js';

const dirs: string[] = [];
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
    const result = await validateDataDirectory(dataDir);
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
      .replace('ex/example/exampleville:2026-06:example-police:retention-or-access-policy', 'ex/example/exampleville:2026-06:candidate-agency:retention-or-access-policy'));
    expect((await buildPublicData(dataDir, false)).map((item) => item.status)).toEqual(['verified']);
    expect((await buildPublicData(dataDir, true)).map((item) => item.id)).toEqual(['2026-07-synthetic-example']);
  });

  it('fails closed when a public status is placed in the review-only candidate directory', async () => {
    const dataDir = await makeData();
    const source = await readFile('tests/fixtures/validIncident.yaml', 'utf8');
    await writeFile(join(dataDir, 'candidates', 'misplaced.yaml'), source);
    const result = await validateDataDirectory(dataDir);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('candidates/misplaced.yaml: candidate storage accepts only candidate or draft status');
    await expect(buildPublicData(dataDir)).rejects.toThrow(/candidate storage/i);
  });

  it('fails closed when a review-only status is placed in the public incident directory', async () => {
    const dataDir = await makeData();
    const source = (await readFile('tests/fixtures/validIncident.yaml', 'utf8'))
      .replace('status: "verified"', 'status: "candidate"')
      .replace('approval: "human-approved"', 'approval: "pending"');
    await writeFile(join(dataDir, 'incidents', 'misplaced.yaml'), source);
    const result = await validateDataDirectory(dataDir);
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
      .replace('reviewed_at: "2026-07-03"', 'reviewed_at: ""'));
    const result = await validateDataDirectory(dataDir);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/exact duplicate.*canonical source URL match/i);
  });

  it('ships a source-verified public seed without exposing the review-only abortion-search candidate', async () => {
    const result = await validateDataDirectory('data');
    expect(result.errors).toEqual([]);
    expect(result.records.map((record) => record.id)).toContain('2026-07-milwaukee-officer-personal-flock-searches');
    expect(result.records.map((record) => record.id)).toContain('2025-05-texas-abortion-related-national-flock-search');
    expect((await buildPublicData('data')).map((record) => record.id)).toEqual(['2026-07-milwaukee-officer-personal-flock-searches']);
  });
});
