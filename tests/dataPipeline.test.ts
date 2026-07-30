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

  it('publishes only verified and disputed records by default', async () => {
    const dataDir = await makeData();
    const source = await readFile('tests/fixtures/validIncident.yaml', 'utf8');
    await writeFile(join(dataDir, 'incidents', 'verified.yaml'), source);
    await writeFile(join(dataDir, 'incidents', 'draft.yaml'), source.replace('status: "verified"', 'status: "draft"').replace('2026-07-synthetic-example', 'draft-example'));
    await writeFile(join(dataDir, 'candidates', 'candidate.yaml'), source.replace('status: "verified"', 'status: "candidate"').replace('2026-07-synthetic-example', 'candidate-example'));
    expect((await buildPublicData(dataDir, false)).map((item) => item.status)).toEqual(['verified']);
    expect((await buildPublicData(dataDir, true)).map((item) => item.id)).toEqual(['2026-07-synthetic-example', 'candidate-example', 'draft-example']);
  });

  it('ships a source-verified public seed without exposing the review-only abortion-search candidate', async () => {
    const result = await validateDataDirectory('data');
    expect(result.errors).toEqual([]);
    expect(result.records.map((record) => record.id)).toContain('2026-07-milwaukee-officer-personal-flock-searches');
    expect(result.records.map((record) => record.id)).toContain('2025-05-texas-abortion-related-national-flock-search');
    expect((await buildPublicData('data')).map((record) => record.id)).toEqual(['2026-07-milwaukee-officer-personal-flock-searches']);
  });
});
