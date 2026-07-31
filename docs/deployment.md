# Production deployment and rollback

Production is an exact-commit release, not a mutable working tree. The public edge terminates TLS in nginx; the application listens only on `127.0.0.1:8110` as the unprivileged `flocking-abuse` account.

## Layout

- immutable releases: `/opt/flocking-abuse/releases/<40-character Git SHA>`
- atomic active link: `/opt/flocking-abuse/current`
- mutable accepted/candidate data: `/var/lib/flocking-abuse/data`
- secrets: `/etc/flocking-abuse/flocking-abuse.env` (`0600`, root-owned)
- non-secret release identity: `/etc/flocking-abuse/release.env`
- systemd unit: `/etc/systemd/system/flocking-abuse.service`
- nginx site: `/etc/nginx/sites-available/flockingabuse.multihost.ing`
- deployment backups: `/var/backups/flocking-abuse/release-*`

## Prerequisites

1. DNS resolves `flockingabuse.multihost.ing` to the host.
2. A dedicated certificate exists under `/etc/letsencrypt/live/flockingabuse.multihost.ing/` and `certbot renew --dry-run` passes.
3. The service account, secret file, data directories, and root-only backup directory exist.
4. The candidate/public data tree validates under the release schema. Every YAML record declares `schema_version: 1`; public records also carry `review.approval: human-approved`, non-automation reviewer provenance, and an anchored repository approval reference.
5. The requested Git SHA has green CI and a clean exact-SHA local release gate.

Do not copy a candidate into the public incident directory. A schema migration must be reviewed and run against a backup before release; startup readiness deliberately fails closed on old or invalid data.

## Deploy an exact SHA

From a clean checkout at the exact reviewed commit:

```bash
sudo ./deploy/release.sh /opt/flocking_abuse "$(git rev-parse HEAD)"
```

The script:

1. verifies the exact clean commit;
2. records and backs up operational configuration and enablement state;
3. exports the commit to a new immutable release directory;
4. verifies the pre-provisioned data boundary, installs dependencies, quiesces an existing service, and verifies again that accepted incidents are root-owned/non-writable while only the candidate inbox is service-writable;
5. runs `npm ci`, validates live data, builds, and prunes development dependencies;
6. atomically switches `/opt/flocking-abuse/current`;
7. installs/verifies systemd, writes the exact release identity, and restarts the service;
8. requires `/health` to report `ready` and the exact SHA;
9. installs/tests nginx and reloads the edge only after application readiness.

The deploy requires pre-provisioned mutable-data directories that pass `deploy/verify-data-permissions.sh`: no symlinks, special entries, or multiply linked files; accepted data is root-owned and service-readable but not service-writable; candidate data alone is service-owned. Code deployment never changes or restores mutable-data ownership, modes, or contents. Any one-time metadata migration requires a separate root-only backup and explicit maintenance operation. The release takes an exclusive host deployment lock and automatically restores the prior release, service enablement/activity, nginx configuration, and enabled-site link if readiness or edge activation fails. Schema migrations require their own application-consistent backup and maintenance window.

## Verification

```bash
systemctl is-active flocking-abuse.service
systemctl show flocking-abuse.service -p User -p Group -p FragmentPath
ss -ltnp | grep '127.0.0.1:8110'
curl --fail --silent http://127.0.0.1:8110/live
curl --fail --silent http://127.0.0.1:8110/health
curl --fail --silent --show-error https://flockingabuse.multihost.ing/health
curl -I https://flockingabuse.multihost.ing/
```

Verify security headers, public filtering/details/source links, password-only login, CSRF/origin rejection, candidate persistence, logout, restart persistence, semantic documentation pages, and absence of candidates from the public bundle. Remove only the uniquely identified smoke candidate after proving persistence.

## Rollback

Choose a previously deployed 40-character release SHA and run the dedicated fail-fast rollback tool:

```bash
sudo ./deploy/rollback.sh <reviewed-40-character-sha>
```

The rollback tool uses the same exclusive host lock as deployment, preflights the target artifacts and current healthy release before mutation, switches the application and operational files, verifies exact target readiness, and automatically recovers the previous release if any systemd or nginx step fails. Recovery failure exits distinctly with status `90` and requires manual intervention.

If a separate schema migration must be rolled back, stop intake first and reconcile every candidate accepted after the backup before restoring anything. Never blindly restore a mutable-data snapshot over newer candidate writes. Never restore secrets into Git or a world-readable path.

## Secret rotation

Generate a new password hash and session secret offline, replace `/etc/flocking-abuse/flocking-abuse.env` atomically with mode `0600`, restart the service, and confirm all old sessions fail. Never print secret values into deployment logs.

## Candidate review delivery

Manual admin intake writes to `/var/lib/flocking-abuse/data/candidates`. Deliver that inbox into a review-only PR or patch from the discovery checkout:

```bash
cd /opt/flocking-abuse-discovery
npm run candidate:pr -- --candidate-inbox /var/lib/flocking-abuse/data/candidates --patch /var/lib/flocking-abuse/data/candidate-review.patch
```

A successful delivery atomically archives only the delivered snapshot. Concurrent replacements remain queued. The command never publishes records.
