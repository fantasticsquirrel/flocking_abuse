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

Run the same seed file twice to prove the second result is classified as a duplicate. Each report preserves its originating search-query metadata (manual seed files use the explicit `manual-seed-file` provenance label). Discovery output is mode `0600` and ignored by git.

After Hermes converts strong findings to schema-valid candidate YAML:

```bash
npm run validate:data
npm run candidate:pr -- --candidate data/candidates/YYYY-MM-DD-source-slug.yaml
```

Before any patch, commit, push, or PR, candidate delivery compares the selected records against published incidents, stored candidates, and the current delivery batch. Exact URL/key/case matches block delivery; probable fuzzy matches are printed with scores for human review.

With GitHub auth, delivery uses an isolated worktree and opens a pull request. After confirmed PR or patch delivery, each untracked source candidate is atomically claimed. Only the exact delivered snapshot is moved into a mode-restricted archive; content changed before or during cleanup is restored to the active inbox under a collision-safe name. Tracked files are never moved. `--candidate-inbox /var/lib/flocking-abuse/data/candidates` maps manual runtime intake into review-only repository paths. Without auth the command atomically writes a mode-`0600` review patch; no shell interpolation is used.

## Daily prompt

```text
Run the TASS surveillance-abuse discovery workflow. Search for new source-grounded reports of ALPR, facial-recognition, camera-network, and related surveillance abuse, misuse, legal challenges, audits, or policy failures. Dedupe against data/incidents and data/candidates. Create candidate YAML only for likely unique incidents with exact source-supported claims. Validate the data and open a review PR or produce a patch. Never change a candidate to verified or publish it. Report queries, new candidates, duplicates, uncertain items, validation, and source-access failures.
```

## Publication gate

A human must review source independence, neutral wording, uniqueness, dates, privacy, and outcomes before changing status to `verified` or `disputed`. A timeout, inaccessible source, or tool failure never counts as approval.
