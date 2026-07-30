import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { archiveDeliveredCandidates, candidateRelativePath, cleanupDeliveredCandidates, renderReviewPatch } from '../scripts/create-candidate-pr.js';

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

  it('removes only unchanged candidate files after confirmed delivery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flocking-delivery-'));
    try {
      const candidate = join(root, 'data', 'candidates', 'report.yaml');
      await mkdir(join(root, 'data', 'candidates'), { recursive: true });
      await writeFile(candidate, 'status: candidate\n');
      const result = await cleanupDeliveredCandidates(root, [{
        path: 'data/candidates/report.yaml', content: 'status: candidate\n',
      }]);
      expect(result).toEqual({ removed: ['data/candidates/report.yaml'], preserved: [] });
      await expect(access(candidate)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves a candidate that changed after the delivery snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flocking-delivery-'));
    try {
      const candidate = join(root, 'data', 'candidates', 'report.yaml');
      await mkdir(join(root, 'data', 'candidates'), { recursive: true });
      await writeFile(candidate, 'status: candidate\nnotes: revised\n');
      const result = await cleanupDeliveredCandidates(root, [{
        path: 'data/candidates/report.yaml', content: 'status: candidate\n',
      }]);
      expect(result).toEqual({ removed: [], preserved: ['data/candidates/report.yaml'] });
      expect(await readFile(candidate, 'utf8')).toContain('notes: revised');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never removes a candidate already tracked by git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flocking-delivery-'));
    try {
      const candidate = join(root, 'data', 'candidates', 'tracked.yaml');
      await mkdir(join(root, 'data', 'candidates'), { recursive: true });
      await writeFile(candidate, 'status: candidate\n');
      expect(spawnSync('git', ['init', '-q'], { cwd: root }).status).toBe(0);
      expect(spawnSync('git', ['add', '--', 'data/candidates/tracked.yaml'], { cwd: root }).status).toBe(0);
      const result = await cleanupDeliveredCandidates(root, [{
        path: 'data/candidates/tracked.yaml', content: 'status: candidate\n',
      }]);
      expect(result).toEqual({ removed: [], preserved: ['data/candidates/tracked.yaml'] });
      expect(await readFile(candidate, 'utf8')).toBe('status: candidate\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('archives unchanged patch-delivered candidates outside the git data tree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flocking-delivery-'));
    try {
      const candidate = join(root, 'data', 'candidates', 'report.yaml');
      await mkdir(join(root, 'data', 'candidates'), { recursive: true });
      await writeFile(candidate, 'status: candidate\n');
      const result = await archiveDeliveredCandidates(root, [{
        path: 'data/candidates/report.yaml', content: 'status: candidate\n',
      }]);
      expect(result.preserved).toEqual([]);
      expect(result.archived).toHaveLength(1);
      await expect(access(candidate)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(result.archived[0]!, 'utf8')).toBe('status: candidate\n');
      expect(result.archived[0]).toContain(join('.local', 'delivered-candidates'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
