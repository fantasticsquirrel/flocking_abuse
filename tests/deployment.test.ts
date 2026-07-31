import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('immutable deployment and rollback scripts', () => {
  it('arms an ERR rollback trap and refuses to trust a pre-existing release directory', async () => {
    const script = await readFile('deploy/release.sh', 'utf8');
    expect(script).toContain("trap 'rollback_on_error $?' ERR");
    expect(script).toContain("trap 'rollback_on_error 143' TERM");
    expect(script).toContain('[[ ! -e $RELEASE_DIR && ! -L $RELEASE_DIR ]]');
    expect(script).toContain('verify_health "$PREVIOUS_SHA"');
    expect(script).toContain('restore_operational_files');
  });

  it('serializes deployments and accepts only an absent service or a healthy persistent deployment', async () => {
    const script = await readFile('deploy/release.sh', 'utf8');
    expect(script).toContain('flock -n 9');
    expect(script).toContain('nginx-enabled.target');
    expect(script).toContain('require_regular_artifact');
    expect(script).toContain('SERVICE_TOUCHED=1');
    expect(script).toContain('prior.mode');
    expect(script).toContain('must be persistently enabled before deployment');
    expect(script).toContain('must be active before deployment');
    expect(script).toContain('restore_service_state');
    expect(script).toContain('recovery_failed=0');
    expect(script).toContain('mktemp -d');
    expect(script).toContain('exit 90');
    expect(script).not.toContain('cp -a "$DATA_DIR"');
  });

  it('uses a locked fail-fast rollback tool with preflight and automatic recovery', async () => {
    const script = await readFile('deploy/rollback.sh', 'utf8');
    expect(script).toContain('flocking-abuse-deploy.lock');
    expect(script).toContain('Target release is missing an unconfined regular');
    expect(script).toContain('require_regular_artifact');
    expect(script).toContain('Target nginx configuration failed preflight');
    expect(script).toContain("trap 'rollback_failed $?' ERR");
    expect(script).toContain("trap 'rollback_failed 143' TERM");
    expect(script).toContain('restore_previous');
    expect(script).toContain('mktemp -d');
    expect(script).toContain('exit 90');
    expect(script).toContain('nginx-enabled.target');
    expect(script).not.toContain('cp -a "$DATA_DIR"');
    expect((await stat('deploy/rollback.sh')).mode & 0o111).toBe(0o111);
  });

  it('documents the dedicated rollback tool instead of an unsafe inline sequence', async () => {
    const documentation = await readFile('docs/deployment.md', 'utf8');
    expect(documentation).toContain('sudo ./deploy/rollback.sh');
    expect(documentation).toContain('same exclusive host lock');
    expect(documentation).not.toContain('/tmp/flocking-release.env');
  });
});
