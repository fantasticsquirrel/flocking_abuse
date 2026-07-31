import { execFile } from 'node:child_process';
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('immutable deployment and rollback scripts', () => {
  it('arms an ERR rollback trap and refuses to trust a pre-existing release directory', async () => {
    const script = await readFile('deploy/release.sh', 'utf8');
    expect(script).toContain("trap 'rollback_on_error $?' ERR");
    expect(script).toContain("trap 'rollback_on_error 143' TERM");
    expect(script).toContain('[[ ! -e $RELEASE_DIR && ! -L $RELEASE_DIR ]]');
    expect(script).toContain('verify_health "$PREVIOUS_SHA"');
    expect(script).toContain('restore_operational_files');
  });

  it('serializes deployments, verifies immutable data permissions without mutating them, and quiesces an existing service', async () => {
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
    expect(script).toContain('DATA_DIR="$DATA_DIR" NODE_ENV=production INCLUDE_DRAFTS=0 npm run build');
    expect(script).toContain('deploy/verify-data-permissions.sh');
    expect(script).toContain('systemctl stop flocking-abuse.service');
    expect(script).not.toMatch(/(?:chown|chmod).*\$DATA_DIR/);
    expect(script).not.toContain('snapshot_data_metadata');
    expect(script).not.toContain('restore_data_metadata');
    expect(script).toContain('mktemp -d');
    expect(script).toContain('exit 90');
    expect(script).not.toContain('cp -a "$DATA_DIR"');
  });

  it('behaviorally rejects special entries, hard links, and service-writable accepted data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'flocking-permissions-'));
    const dataDir = join(root, 'data');
    const incidents = join(dataDir, 'incidents');
    const candidates = join(dataDir, 'candidates');
    const uid = process.getuid?.() ?? 0;
    const gid = process.getgid?.() ?? 0;
    try {
      await mkdir(incidents, { recursive: true, mode: 0o750 });
      await mkdir(candidates, { recursive: true, mode: 0o750 });
      await chmod(dataDir, 0o750);
      await chmod(incidents, 0o750);
      await chmod(candidates, 0o750);
      const accepted = join(incidents, 'accepted.yaml');
      const candidate = join(candidates, 'candidate.yaml');
      await writeFile(accepted, 'id: accepted\n', { mode: 0o640 });
      await writeFile(candidate, 'id: candidate\n', { mode: 0o600 });
      const args = [dataDir, String(uid), String(gid), String(uid), String(gid)];
      await expect(execFileAsync('bash', ['deploy/verify-data-permissions.sh', ...args])).resolves.toBeDefined();

      const alias = join(candidates, 'accepted-alias.yaml');
      await link(accepted, alias);
      await expect(execFileAsync('bash', ['deploy/verify-data-permissions.sh', ...args])).rejects.toThrow(/multiply linked/i);
      await rm(alias);

      const pointer = join(candidates, 'pointer.yaml');
      await symlink('/etc/passwd', pointer);
      await expect(execFileAsync('bash', ['deploy/verify-data-permissions.sh', ...args])).rejects.toThrow(/directories and regular files/i);
      await rm(pointer);

      await chmod(accepted, 0o660);
      await expect(execFileAsync('bash', ['deploy/verify-data-permissions.sh', ...args])).rejects.toThrow(/accepted file metadata/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
