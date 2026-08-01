import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { createPublisherClient } from '../server/publisher-client.js';
import { validateDataDirectory } from '../scripts/data-utils.js';

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGTERM');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function waitFor(path: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { await access(path); return; } catch { await new Promise((resolve) => setTimeout(resolve, 25)); }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

describe('protected publisher', () => {
  it('atomically promotes an approved candidate and writes a digest-bound runtime approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flocking-publisher-'));
    roots.push(root);
    const dataDir = join(root, 'data');
    for (const directory of ['incidents', 'candidates', 'unverified', 'analytics', 'approvals', 'published-candidates']) await mkdir(join(dataDir, directory), { recursive: true });
    const source = yaml.load(await readFile('tests/fixtures/validIncident.yaml', 'utf8')) as Record<string, unknown>;
    const candidate = {
      ...source,
      id: 'candidate-publisher-test', status: 'candidate', category: 'system-abuse',
      uniqueness: { canonical_key: 'us-ex-example-county:2026-06:example-police-department:publisher-test-event', duplicate_of: null },
      review: { approval: 'pending', added_by: 'manual', reviewed_by: '', reviewed_at: '', approval_reference: '', notes: 'Ready for owner review.' },
    };
    await writeFile(join(dataDir, 'candidates', 'candidate.yaml'), yaml.dump(candidate));
    const socketPath = join(root, 'publisher.sock');
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/publisher.ts'], {
      cwd: process.cwd(), stdio: 'ignore',
      env: { ...process.env, DATA_DIR: dataDir, DOCS_DIR: join(process.cwd(), 'docs'), PUBLISHER_SOCKET: socketPath, RELEASE_SHA: '0123456789abcdef0123456789abcdef01234567' },
    });
    children.push(child);
    await waitFor(socketPath);
    const result = await createPublisherClient(socketPath)({
      candidateId: 'candidate-publisher-test', category: 'system-abuse', outcomes: ['Access was revoked.'], reviewerNotes: 'Owner reviewed.', confirmation: 'PUBLISH candidate-publisher-test',
    });
    expect(result.status).toBe('published');
    expect(await readdir(join(dataDir, 'candidates'))).toEqual([]);
    expect(await readdir(join(dataDir, 'incidents'))).toEqual(['candidate-publisher-test.yaml']);
    expect(await readdir(join(dataDir, 'approvals'))).toEqual([`${new Date().toISOString().slice(0, 10)}-candidate-publisher-test.md`]);
    const validation = await validateDataDirectory(dataDir, join(process.cwd(), 'docs', 'approvals'));
    expect(validation.errors).toEqual([]);
    expect(validation.publicRecords[0]).toMatchObject({ status: 'verified', category: 'system-abuse', outcomes: ['Access was revoked.'] });
  });
});
