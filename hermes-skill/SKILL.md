---
name: flocking-abuse-discovery
description: Discover, verify, deduplicate, and prepare review-only reports of Flock Safety or flock-camera abuse for the Flocking Abuse Tracker.
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos]
metadata:
  created_by: agent
  hermes:
    tags: [research, web-monitoring, civil-liberties, data-quality]
---

# Flocking Abuse Discovery

Use this skill for the daily, source-grounded discovery workflow in the Flocking Abuse Tracker repository.

## Required procedure

1. Work only in the configured discovery checkout, never the running production checkout.
2. Read `docs/reporting-format.md`, `docs/source-policy.md`, `docs/dedupe-policy.md`, and `docs/automation.md`.
3. Pull `main` with fast-forward only. Stop and report if the checkout is dirty or diverged.
4. Run `npm run validate:data` and `npm run build:data`. Stop if either fails.
5. Load all `data/incidents/*.yaml` and `data/candidates/*.yaml`. Build an index of source/canonical URLs, case numbers, canonical keys, location, agency, dates, incident types, and title fingerprints.
6. Search recent web/news, court, government, audit, and civil-liberties sources with rotating query families:
   - `Flock Safety abuse police camera`
   - `Flock camera lawsuit unauthorized search`
   - `Flock Safety ALPR misuse`
   - `Flock Safety public records audit`
   - `Flock camera immigration abortion protest journalist`
   - `Flock Safety data sharing policy violation`
   - `site:aclu.org Flock Safety ALPR`
   - `site:eff.org Flock Safety`
7. Prefer primary documents and independent corroboration. Do not bypass paywalls, CAPTCHAs, robots.txt, or source terms.
8. Put inspectable source URLs in `/tmp/flock-source-urls.txt`, one per line. Run:

```bash
npm run scrape -- --seed-file /tmp/flock-source-urls.txt --output candidate-findings.json --public-data src/data/incidents.json
```

9. Inspect `candidate-findings.json`. Reject generic procurement, marketing, opinion-only stories, and follow-ups to known incidents. Treat inaccessible or ambiguous sources as uncertain, not approved.
10. For each likely unique incident, write one `status: candidate` YAML record in `data/candidates/` using the complete reporting schema. Include neutral attribution, exact source metadata, `key_claims`, uniqueness reasoning, and review notes. Never write `verified` or `disputed`.
11. Run `npm run validate:data` again. Run deterministic dedupe and resolve exact duplicates before delivery.
12. Deliver candidates with `npm run candidate:pr -- --candidate <path>`; if GitHub auth is unavailable, retain the generated review patch and report its absolute path.

## Final report

Always report:

- queries run;
- new candidate IDs and source URLs;
- duplicates skipped and reasons;
- uncertain items needing human review;
- validation result;
- PR URL or patch path;
- source, robots, network, or tool failures.

If nothing new is found, say so concisely and do not create empty commits or PRs.

## Hard rules

- Never auto-publish or promote a candidate.
- Never treat a timeout or missing reviewer response as approval.
- Never present allegations as adjudicated facts unless a primary official record supports that wording.
- Never duplicate follow-up coverage as a new incident.
- Never include private victim data beyond what reliable public sources make central to the report.
- Never commit credentials, admin passwords, scraper output, or browser/session artifacts.
