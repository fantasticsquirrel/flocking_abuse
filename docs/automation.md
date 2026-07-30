# Daily Automation Plan

Hermes skills are reusable procedures; they do not execute on their own. The daily workflow should be implemented as a Hermes cron job that loads a dedicated `flocking-abuse-discovery` skill.

## Target cron configuration

```text
Name: flocking-abuse-daily-discovery
Schedule: 0 7 * * *
Workdir: /path/to/flocking_abuse
Skill: flocking-abuse-discovery
Enabled toolsets: web, terminal, file, github
```

## Cron prompt

```text
Run the Flocking Abuse daily discovery workflow. Search for new source-grounded reports of Flock Safety / flock camera abuse, misuse, legal challenges, audits, or policy failures. Dedupe against existing data/incidents and data/candidates records. Create candidate YAML records only for likely unique new instances with sources. Open a PR or write a patch. Report new candidates, duplicates skipped, uncertain items, queries run, and failures. Do not publish weak or unsourced claims.
```

## Discovery workflow

1. Load all existing incident and candidate records.
2. Build a canonical index of source URLs, canonical URLs, case numbers, locations, agencies, dates, and title fingerprints.
3. Search web/news/civil-liberties/legal sources using query families in the implementation plan.
4. Extract candidate metadata and exact supported claims.
5. Reject unrelated procurement/general surveillance stories unless they include misuse, policy violation, legal challenge, audit failure, or abuse allegations.
6. Run deterministic dedupe.
7. Write reviewable `candidate` YAML records.
8. Create a PR or patch, never a silent direct publication.

## Dry-run requirement

The first cron run should be a dry-run after scraper implementation. It should prove:

- queries ran;
- sources were captured;
- duplicate checks ran;
- candidate output validates;
- no existing incident is duplicated on a second run.
