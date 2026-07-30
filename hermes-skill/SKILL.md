---
name: flocking-abuse-discovery
description: Daily discovery and triage workflow for source-grounded Flock Safety / flock camera abuse reports.
version: 0.1.0
author: Hermes Agent
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [research, web-monitoring, civil-liberties, data-quality]
---

# Flocking Abuse Discovery

Use this skill when discovering, deduplicating, and preparing candidate records for the Flocking Abuse Tracker repository.

## Daily workflow

1. Work from the repository root.
2. Read `docs/reporting-format.md`, `docs/source-policy.md`, and `docs/automation.md`.
3. Load existing records from `data/incidents/*.yaml` and `data/candidates/*.yaml` if present.
4. Build a duplicate index from:
   - source URLs and canonical URLs;
   - court case numbers or docket IDs;
   - normalized location;
   - agency/entity names;
   - occurred/reported date windows;
   - incident type;
   - normalized title keywords.
5. Search for new public reports using query families:
   - `Flock Safety abuse police camera`
   - `Flock camera lawsuit unauthorized search`
   - `Flock Safety ALPR misuse`
   - `Flock Safety public records audit`
   - `Flock camera immigration abortion protest journalist`
   - `Flock Safety data sharing controversy`
   - `Flock Safety audit access policy violation`
6. Prefer primary and strong secondary sources. Do not bypass paywalls or violate robots.txt.
7. Reject generic procurement, deployment, marketing, or opinion-only results unless there is a concrete alleged misuse, abuse, lawsuit, audit finding, official investigation, or policy failure.
8. For each likely unique candidate, create a `status: candidate` YAML record following `docs/reporting-format.md`.
9. Include exact source URLs, publisher, dates, source type, reliability, and `key_claims` supported by each source.
10. Run validation/dedupe scripts if implemented.
11. Open a PR if GitHub access is configured; otherwise produce a patch file.
12. Final report must list:
    - new candidates created;
    - duplicates skipped;
    - uncertain items needing manual review;
    - queries run;
    - validation results;
    - any source access failures.

## Hard rules

- Do not publish unsourced claims.
- Do not present allegations as adjudicated facts unless a primary source supports that wording.
- Do not duplicate follow-up articles as new incidents.
- Do not commit credentials or private admin passwords.
