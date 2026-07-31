# Flocking Abuse Tracker

A source-grounded public ledger for reported abuses, misuse, legal challenges, audit findings, and policy failures involving Flock Safety / automatic license-plate-reader systems.

**Live:** https://flockingabuse.multihost.ing

## What this repository contains

- A responsive React public incident ledger with a deliberate surveillance-state visual language.
- Strict YAML incident records and source-verification rules.
- Password-only admin intake at `/admin`; candidates never appear publicly before review.
- Deterministic deduplication and a robots-aware, SSRF-hardened discovery helper.
- A dedicated Hermes skill and daily cron workflow that discover candidates but never auto-publish allegations.
- CI, systemd, nginx, and TLS deployment assets.

## Reporting standard

- [`docs/reporting-format.md`](docs/reporting-format.md)
- [`docs/source-policy.md`](docs/source-policy.md)
- [`docs/dedupe-policy.md`](docs/dedupe-policy.md)
- [`docs/plans/2026-07-30-flocking-abuse-tracker.md`](docs/plans/2026-07-30-flocking-abuse-tracker.md)

A verified incident requires one primary source or two independent reliable secondary publishers. Claims remain source-attributed unless an official record establishes them.

## Local development

Requires Node.js 20 or newer.

```bash
npm ci
npm run bootstrap:admin
cp .local/admin-env.txt .env
set -a; . ./.env; set +a
npm run dev
```

The random local password is written to `.local/admin-password.txt` with mode `0600`. No username or signup exists.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run validate:data
npm run build
npx playwright install chromium
npm run test:e2e
npm audit
```

## Data commands

```bash
npm run validate:data
npm run build:data
npm run scrape -- --seed-file /tmp/flock-source-urls.txt --output candidate-findings.json --data-dir data
npm run candidate:pr -- --candidate data/candidates/example.yaml
```

`candidate-findings.json` and candidate YAML records are review inputs. The scraper never publishes an incident. Directory/status validation prevents review-only files from entering the public build, and candidate delivery blocks exact duplicates while surfacing probable matches.

## Production architecture

The admin API prevents a GitHub-Pages-only deployment. Production uses one loopback Node/Express service behind nginx and a dedicated Let's Encrypt certificate:

- Immutable releases: `/opt/flocking-abuse/releases/<40-character Git SHA>`
- Atomic active link: `/opt/flocking-abuse/current`
- Service: `flocking-abuse.service`
- Loopback: `127.0.0.1:8110`
- Public host: `https://flockingabuse.multihost.ing`
- Mutable data: `/var/lib/flocking-abuse/data`
- Secret env: `/etc/flocking-abuse/flocking-abuse.env` (`0600`)
- Copyable owner password: `/root/.credentials/flocking-abuse-admin-password.txt` (`0600`)

Deployment templates live in `deploy/`. See [`docs/deployment.md`](docs/deployment.md), [`docs/manual-admin.md`](docs/manual-admin.md), and [`docs/automation.md`](docs/automation.md).
