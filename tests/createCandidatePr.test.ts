import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { archiveDeliveredCandidates, candidateRelativePath, evaluateCandidateDelivery, loadCandidateFiles, renderReviewPatch } from '../scripts/create-candidate-pr.js';
import type { Incident } from '../src/lib/incidentSchema.js';

const fixture = async (): Promise<Incident> => yaml.load(await readFile('tests/fixtures/validIncident.yaml', 'utf8')) as Incident;

describe('candidate review delivery', () => {
  it('accepts only YAML files inside data/candidates', () => {
    expect(candidateRelativePath('/repo', '/repo/data/candidates/report.yaml')).toBe('data/candidates/report.yaml');
    expect(() => candidateRelativePath('/repo', '/repo/data/incidents/public.yaml')).toThrow(/data\/candidates/i);
    expect(() => candidateRelativePath('/repo', '/tmp/escape.yaml')).toThrow(/data\/candidates/i);
    expect(() => candidateRelativePath('/repo', '/repo/data/candidates/not.txt')).toThrow(/yaml/i);
  });

  it('renders a reviewable patch without interpreting source contents as shell code', () => {
    const patch = renderReviewPatch([{ path: 'data/candidates/report.yaml', content: 'title: "$(touch /tmp/nope)"\nstatus: candidate\n' }]);
    expect(patch).toContain('diff --git a/data/candidates/report.yaml b/data/candidates/report.yaml');
    expect(patch).toContain('+title: "$(touch /tmp/nope)"');
    expect(patch).toContain('+status: candidate');
  });

  it('atomically archives delivered candidate files after confirmed delivery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flocking-delivery-'));
    try {
      const candidate = join(root, 'data', 'candidates', 'report.yaml');
      await mkdir(join(root, 'data', 'candidates'), { recursive: true });
      await writeFile(candidate, 'status: candidate\n');
      const result = await archiveDeliveredCandidates(root, [{ path: 'data/candidates/report.yaml', content: 'status: candidate\n' }]);
      expect(result.preserved).toEqual([]);
      expect(result.archived).toHaveLength(1);
      await expect(access(candidate)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(result.archived[0]!, 'utf8')).toBe('status: candidate\n');
      expect((await stat(result.archived[0]!)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves a concurrent candidate change in the active review queue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flocking-delivery-'));
    try {
      const candidate = join(root, 'data', 'candidates', 'report.yaml');
      await mkdir(join(root, 'data', 'candidates'), { recursive: true });
      await writeFile(candidate, 'status: candidate\nnotes: revised\n');
      const result = await archiveDeliveredCandidates(root, [{ path: 'data/candidates/report.yaml', content: 'status: candidate\n' }]);
      expect(result.archived).toEqual([]);
      expect(result.preserved).toContain('data/candidates/report.yaml');
      expect(await readFile(candidate, 'utf8')).toContain('notes: revised');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('loads a production candidate inbox into safe repository patch paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flocking-delivery-'));
    const inbox = await mkdtemp(join(tmpdir(), 'flocking-inbox-'));
    try {
      await mkdir(join(root, 'data', 'candidates'), { recursive: true });
      await writeFile(join(inbox, 'manual.yaml'), 'status: candidate\n');
      const files = await loadCandidateFiles(root, [], inbox);
      expect(files).toEqual([{
        path: 'data/candidates/manual.yaml',
        sourcePath: join(inbox, 'manual.yaml'),
        content: 'status: candidate\n',
      }]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(inbox, { recursive: true, force: true });
    }
  });

  it('never archives a candidate already tracked by git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flocking-delivery-'));
    try {
      const candidate = join(root, 'data', 'candidates', 'tracked.yaml');
      await mkdir(join(root, 'data', 'candidates'), { recursive: true });
      await writeFile(candidate, 'status: candidate\n');
      expect(spawnSync('git', ['init', '-q'], { cwd: root }).status).toBe(0);
      expect(spawnSync('git', ['add', '--', 'data/candidates/tracked.yaml'], { cwd: root }).status).toBe(0);
      const result = await archiveDeliveredCandidates(root, [{ path: 'data/candidates/tracked.yaml', content: 'status: candidate\n' }]);
      expect(result).toEqual({ archived: [], preserved: ['data/candidates/tracked.yaml'] });
      expect(await readFile(candidate, 'utf8')).toBe('status: candidate\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks exact duplicates and surfaces probable matches before delivery', async () => {
    const existing = await fixture();
    const exact = structuredClone(existing);
    exact.id = 'exact-candidate';
    exact.status = 'candidate';
    const exactResult = evaluateCandidateDelivery([exact], [existing]);
    expect(exactResult.exact).toHaveLength(1);

    const probable = structuredClone(existing);
    probable.id = 'probable-candidate';
    probable.status = 'candidate';
    probable.sources[0]!.url = 'https://different.example/follow-up';
    probable.uniqueness.canonical_key = 'different-key';
    const probableResult = evaluateCandidateDelivery([probable], [existing]);
    expect(probableResult.exact).toEqual([]);
    expect(probableResult.probable[0]?.classification).toBe('probable');
  });

  it('blocks duplicates within the same candidate delivery batch', async () => {
    const first = await fixture();
    first.status = 'candidate';
    const second = structuredClone(first);
    second.id = 'second-batch-candidate';
    expect(evaluateCandidateDelivery([first, second], []).exact).toHaveLength(1);
  });
});
