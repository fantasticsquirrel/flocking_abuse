import { describe, expect, it } from 'vitest';
import { candidateRelativePath, renderReviewPatch } from '../scripts/create-candidate-pr.js';

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
});
