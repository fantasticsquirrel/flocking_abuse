# Daily Discovery Automation

Hermes skills define procedures; a Hermes cron job supplies the daily schedule. The workflow discovers and deduplicates review candidates but never publishes allegations.

## Installed shape

```text
Name: flocking-abuse-daily-discovery
Schedule: 0 7 * * *
Workdir: /opt/flocking-abuse-discovery
Skill: flocking-abuse-discovery
Toolsets: web, browser, terminal, file, skills
```

The production service checkout remains clean at `/opt/flocking_abuse`. Automation uses the separate `/opt/flocking-abuse-discovery` checkout so candidate branches cannot dirty the running release.

## Deterministic tools

Validate and build public data:

```bash
npm run validate:data
npm run build:data
```

Run discovery against human/Hermes-curated seed URLs:

```bash
npm run scrape -- \
  --seed-file /tmp/flock-source-urls.txt \
  --output candidate-findings.json \
  --data-dir data
```

Without `--seed-file`, the script uses Brave Search only when `BRAVE_SEARCH_API_KEY` exists; otherwise it fails clearly. The network path accepts only HTTP(S), rejects credentials and private/reserved DNS answers, pins requests to validated public IPs, revalidates redirects, respects robots.txt, and limits time, redirects, content type, and response size.

Run the same seed file twice to prove the second result is classified as a duplicate. Discovery output is mode `0600` and ignored by git.

After Hermes converts strong findings to schema-valid candidate YAML:

```bash
npm run validate:data
npm run candidate:pr -- --candidate data/candidates/YYYY-MM-DD-source-slug.yaml
```

With GitHub auth, candidate delivery uses an isolated worktree, opens a pull request, and removes only unchanged **untracked** delivered files from the discovery checkout so they are not submitted again. Tracked files and files changed during delivery are preserved. Without auth it writes `candidate-review.patch`, archives unchanged untracked source candidates under ignored mode-restricted `.local/delivered-candidates/`, and preserves tracked or concurrently changed files; no shell interpolation is used.

## Daily prompt

```text
Run the Flocking Abuse daily discovery workflow. Search for new source-grounded reports of Flock Safety or flock-camera abuse, misuse, legal challenges, audits, or policy failures. Dedupe against data/incidents and data/candidates. Create candidate YAML only for likely unique incidents with exact source-supported claims. Validate the data and open a review PR or produce a patch. Never change a candidate to verified or publish it. Report queries, new candidates, duplicates, uncertain items, validation, and source-access failures.
```

## Publication gate

A human must review source independence, neutral wording, uniqueness, dates, privacy, and outcomes before changing status to `verified` or `disputed`. A timeout, inaccessible source, or tool failure never counts as approval.
