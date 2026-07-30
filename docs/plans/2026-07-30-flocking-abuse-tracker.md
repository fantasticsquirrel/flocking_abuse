# Flocking Abuse Tracker Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a simple, source-grounded public webpage that tracks reported instances of Flock Safety / flock camera abuse, with manual password-only article entry and daily automated discovery through a Hermes skill + cron workflow.

**Architecture:** Use a static-first website backed by structured incident files in the repository. Manual additions go through a minimal authenticated admin form that writes candidate incident records for review. Daily automation runs as a Hermes cron job loading a dedicated skill; it searches public web sources, extracts candidate reports, deduplicates against existing incident records, and prepares reviewable pull requests or draft records.

**Tech Stack:** TypeScript, Vite, React, static JSON/YAML incident data, Zod validation, Playwright for e2e checks, Vitest for unit tests, optional tiny Node/Express admin service for manual submissions, GitHub Actions for CI and static deployment, Hermes skill + cron for daily discovery.

---

## 0. Product principles and terminology

### Scope

Track reported abuses, misuses, legal challenges, and policy failures involving Flock Safety / flock camera systems, especially:

- Unauthorized or policy-violating searches.
- Political, immigration, abortion, protest, journalist, or activist targeting.
- Cross-jurisdiction data-sharing abuses.
- Improper retention, access, audit, or contract practices.
- Lawsuits, public-record findings, official investigations, or credible reporting involving Flock camera data.

### Abuse wording rule

Use the word **abuse** in the product name and navigation, but write individual incidents neutrally and source-attributed. Example: "ACLU reported...", "A lawsuit alleged...", "City audit found...". Avoid declaring liability unless a court, agency, or official record did.

### Publication states

- `candidate`: discovered but not yet reviewed.
- `draft`: manually entered but incomplete.
- `verified`: meets source requirements and is publicly rendered.
- `disputed`: credible dispute exists; keep sources and context visible.
- `retracted`: original source/report was withdrawn or disproven; preserve audit trail but hide from default public listing.

---

## 1. Repository layout

Create this structure:

```text
flocking_abuse/
├── README.md
├── package.json
├── index.html
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── data/incidents.json
│   ├── lib/incidentSchema.ts
│   ├── lib/dedupe.ts
│   ├── components/IncidentCard.tsx
│   ├── components/IncidentFilters.tsx
│   └── admin/AdminApp.tsx
├── data/
│   ├── incidents/*.yaml
│   └── candidates/*.yaml
├── scripts/
│   ├── build-incidents.ts
│   ├── validate-incidents.ts
│   ├── scrape-flock-abuse.ts
│   └── create-candidate-pr.ts
├── hermes-skill/
│   └── SKILL.md
├── docs/
│   ├── reporting-format.md
│   ├── source-policy.md
│   ├── manual-admin.md
│   ├── automation.md
│   └── plans/2026-07-30-flocking-abuse-tracker.md
├── tests/
│   ├── incidentSchema.test.ts
│   ├── dedupe.test.ts
│   └── e2e/homepage.spec.ts
└── .github/workflows/ci.yml
```

---

## 2. Incident data model

### Task 2.1: Define the incident schema

**Objective:** Make all reports use one strict format.

**Files:**
- Create: `src/lib/incidentSchema.ts`
- Create: `tests/incidentSchema.test.ts`
- Reference: `docs/reporting-format.md`

**Implementation details:**

Use Zod to define:

- `IncidentStatus`: `candidate | draft | verified | disputed | retracted`
- `IncidentType`: enumerated categories from `docs/reporting-format.md`
- `Source`: URL, title, publisher, published date, source type, archive URL, reliability, key claims.
- `Incident`: id, title, status, summary, incident_type, location, actors, dates, sources, legal/policy context, outcomes, uniqueness, review, updated_at.

**Acceptance criteria:**

- Records without sources fail validation.
- Verified records fail unless they have one primary source or two corroborating/background reliable independent sources.
- Invalid dates fail with an actionable error.
- `id` must be stable and URL-safe.

### Task 2.2: Add sample seed records as fixtures only

**Objective:** Provide fake/non-public fixture data for tests without implying real incidents.

**Files:**
- Create: `tests/fixtures/validIncident.yaml`
- Create: `tests/fixtures/invalidNoSources.yaml`

**Acceptance criteria:**

- Fixtures are clearly marked synthetic.
- Public `data/incidents/` remains empty until verified real records are added.

---

## 3. Source policy and reporting format

### Task 3.1: Write source policy

**Objective:** Make source quality auditable and consistent.

**Files:**
- Create: `docs/source-policy.md`

**Policy:**

1. Prefer primary sources: court filings, city records, audits, public-record documents, official statements.
2. News sources are acceptable, but verified publication needs either one primary source or two independent secondary sources.
3. Archive important URLs with Internet Archive or archive.today when terms allow.
4. Each source must list `key_claims` so future reviewers know exactly what it supports.
5. Paywalled sources can be cited, but do not bypass paywalls; add accessible corroboration if possible.
6. Automated scraper candidates must preserve raw snippets and search query metadata in private/draft candidate notes, not necessarily on the public page.

### Task 3.2: Define dedupe policy

**Objective:** Prevent duplicate entries for the same incident while allowing follow-ups.

**Files:**
- Create: `docs/dedupe-policy.md`
- Create: `src/lib/dedupe.ts`
- Create: `tests/dedupe.test.ts`

**Canonical key:**

```text
normalized-location + main-agency/entity + approximate-occurred-date + incident-type + normalized-title-keywords
```

**Duplicate indicators:**

- Same source URL or canonical URL.
- Same court case number / docket.
- Same agency, date window, and facts.
- Follow-up article references the same original event.

**Distinct incident indicators:**

- Different search/action event by same agency.
- Different affected person/group and different date.
- Separate lawsuit/audit finding with independent factual basis.

---

## 4. Public webpage

### Task 4.1: Build static incident listing

**Objective:** Render verified incidents as a simple readable webpage.

**Files:**
- Create: `src/App.tsx`
- Create: `src/components/IncidentCard.tsx`
- Create: `src/components/IncidentFilters.tsx`
- Create: `src/data/incidents.json`

**UI requirements:**

- Page title: "Flocking Abuse Tracker".
- Intro paragraph explaining source-grounded tracking.
- Incident cards show title, status, date, location, summary, incident types, outcomes, and source links.
- Filters: state, incident type, status, year, source type.
- Search: title/summary/location/source publisher.
- Empty state: explain no verified incidents yet and link to reporting format.

**Accessibility:**

- Semantic headings.
- Keyboard-accessible filters.
- Source links have descriptive text.
- Color is not the only status signal.

### Task 4.2: Generate static JSON from YAML records

**Objective:** Keep records easy to edit while letting the frontend consume normalized JSON.

**Files:**
- Create: `scripts/build-incidents.ts`
- Create: `scripts/validate-incidents.ts`
- Modify: `package.json`

**Acceptance criteria:**

- `npm run validate:data` validates all YAML records.
- `npm run build:data` outputs `src/data/incidents.json` with only public statuses by default: `verified`, `disputed`.
- Candidate/draft records are excluded from the public JSON unless `INCLUDE_DRAFTS=1` is set locally.

---

## 5. Manual article entry: Hermes WebUI-style password-only auth

### Design note

Hermes skills do not run by themselves; scheduled behavior must be a Hermes cron job. Similarly, the manual admin UI should copy the **pattern** of this Hermes WebUI session’s auth — password-only access — without copying or committing the actual Hermes WebUI password.

### Task 5.1: Document manual admin flow

**Objective:** Give the site owner a low-friction way to add articles manually.

**Files:**
- Create: `docs/manual-admin.md`

**Authentication model:**

- Password-only login form: one password field, no username, no signup.
- Password value is stored outside git, preferably as `ADMIN_PASSWORD_HASH` generated with Argon2id or bcrypt.
- Development bootstrap can create a random local password and write it to `.local/admin-password.txt` with `0600` permissions.
- Admin page includes a "copy password" helper only for the local/dev bootstrap password, mirroring the Hermes WebUI copy-password ergonomics.
- Production password is injected by deployment secrets; it is never logged and never committed.
- Sessions use signed HTTP-only cookies with short expiration.

**Manual submission fields:**

- Article/source URL.
- Optional archive URL.
- Publisher, title, publication date.
- Claimed location and agency/entity.
- Short neutral summary.
- Incident type tags.
- Notes for reviewer.

**Manual submission behavior:**

- Fetch URL metadata when possible.
- Run schema validation.
- Run dedupe check against existing incidents and candidates.
- Save as `data/candidates/YYYY-MM-DD-source-slug.yaml`.
- If deployed with GitHub token, open a branch/PR; otherwise download YAML for manual commit.

### Task 5.2: Implement minimal admin service

**Objective:** Support password-only candidate creation without a full user system.

**Files:**
- Create: `server/adminServer.ts`
- Create: `src/admin/AdminApp.tsx`
- Create: `tests/e2e/admin.spec.ts`

**Acceptance criteria:**

- Wrong password cannot create a candidate.
- Correct password can create a candidate YAML file.
- The public site never exposes the password or draft candidates.
- CI verifies candidate validation and auth rejection.

---

## 6. Daily automated discovery: Hermes skill + cron

### Task 6.1: Create repository skill file

**Objective:** Define the reusable procedure Hermes will load each day.

**Files:**
- Create: `hermes-skill/SKILL.md`

**Skill trigger:**

Use when discovering and triaging new public reports of Flock Safety / flock camera abuse for this repository.

**Daily skill workflow:**

1. Load existing `data/incidents/*.yaml` and `data/candidates/*.yaml`.
2. Build a canonical index of existing incident keys, source URLs, case numbers, locations, agencies, dates, and title fingerprints.
3. Search web/news sources with rotating queries such as:
   - `Flock Safety abuse police camera`
   - `Flock camera lawsuit unauthorized search`
   - `Flock Safety ALPR misuse`
   - `Flock Safety public records audit`
   - `Flock camera immigration abortion protest journalist`
   - `site:aclunc.org Flock Safety`
   - `site:eff.org Flock Safety`
   - `site:aclu.org Flock Safety ALPR`
4. Extract candidate source metadata and snippets.
5. Reject obvious non-abuse/general procurement stories unless they include misuse, legal challenge, audit failure, policy violation, or civil-liberties abuse allegations.
6. Run dedupe checks against existing incidents/candidates.
7. For likely unique candidates, write YAML candidate records with `status: candidate`.
8. Include source URLs, archive URLs where allowed, exact key claims, and scraper notes.
9. Open a PR or produce a patch file for review.
10. Report: new candidates, duplicates skipped, uncertain items needing manual review, queries run, and failures.

### Task 6.2: Create daily cron job configuration instructions

**Objective:** Make the skill run every day in Hermes.

**Files:**
- Create: `docs/automation.md`

**Hermes cron job shape:**

```text
Schedule: 0 7 * * *
Name: flocking-abuse-daily-discovery
Workdir: /path/to/flocking_abuse
Skills: hermes-skill/SKILL.md installed as flocking-abuse-discovery
Toolsets: web, terminal, file, github
Prompt: Run the Flocking Abuse daily discovery workflow. Search for new source-grounded reports, dedupe against existing incidents and candidates, create candidate YAML records for unique new instances, and open a PR or write a patch. Do not publish weak or unsourced claims.
```

**Important:** The actual cron job should be created after implementation and after the repository skill is installed into Hermes. Do not schedule a non-existent scraper.

### Task 6.3: Build scraper script

**Objective:** Give the daily skill deterministic tooling to call.

**Files:**
- Create: `scripts/scrape-flock-abuse.ts`
- Create: `scripts/create-candidate-pr.ts`

**Scraper behavior:**

- Query configurable search providers/APIs if credentials exist.
- Accept manual seed URLs from a text file for testing.
- Respect robots.txt and source terms.
- Extract canonical URL, title, publisher, published date, text snippets, and likely location/agency/date.
- Score relevance and confidence.
- Output `candidate-findings.json` for Hermes review.

**Uniqueness verification:**

- Exact source URL match.
- Canonical URL match.
- Case number match.
- Fuzzy title similarity.
- Location + agency + incident type + date-window match.
- Optional embedding similarity later, but MVP should not require embeddings.

---

## 7. CI, review, and deployment

### Task 7.1: Add CI

**Objective:** Prevent broken data/site commits.

**Files:**
- Create: `.github/workflows/ci.yml`

**Checks:**

- `npm ci`
- `npm run lint`
- `npm run test`
- `npm run validate:data`
- `npm run build`
- Playwright smoke test for homepage.

### Task 7.2: Add GitHub Pages deployment

**Objective:** Host the simple webpage from GitHub.

**Files:**
- Modify: `.github/workflows/ci.yml` or create `.github/workflows/pages.yml`

**Acceptance criteria:**

- `main` deploys static build to GitHub Pages.
- Pull requests run checks without deployment.
- README links to the live site once enabled.

---

## 8. Initial bite-sized implementation sequence

1. Create package skeleton with Vite React TypeScript.
2. Add Zod incident schema test for valid synthetic fixture.
3. Run test and confirm it fails because schema does not exist.
4. Implement minimal schema.
5. Run test and confirm it passes.
6. Add invalid/no-source fixture test.
7. Implement source validation rules.
8. Add YAML data validator script.
9. Add static build script from YAML to JSON.
10. Build simple homepage with empty state.
11. Add incident card rendering using synthetic test data only.
12. Add filters and search.
13. Add source policy docs.
14. Add dedupe tests.
15. Implement deterministic dedupe.
16. Add manual admin docs.
17. Implement password-only admin service behind env secrets.
18. Add admin e2e tests for reject/accept flows.
19. Add Hermes skill file.
20. Add scraper script with seed-URL mode first.
21. Add web-search mode second.
22. Add candidate PR/patch creation.
23. Add CI.
24. Add Pages deployment.
25. Only after the scraper works locally, create the Hermes daily cron job.

---

## 9. Verification gates before real use

- `npm run validate:data` passes.
- `npm run test` passes.
- `npm run build` passes.
- Playwright homepage smoke passes.
- Admin auth rejection/acceptance e2e passes.
- Scraper seed-URL test produces one candidate and skips it on second run as duplicate.
- Daily Hermes job dry-run reports queries, candidates, duplicates, and errors.
- First live candidate PR is manually reviewed before any public incident is published.

---

## 10. Open decisions

- Repository visibility: public is recommended for transparency, but private is possible until first verified dataset is ready.
- Hosting: GitHub Pages is simplest; Cloudflare Pages is acceptable if admin service is deployed separately.
- Manual admin write target: local file download, GitHub PR, or direct commit. PR is safest.
- Search provider: generic web search through Hermes is easiest initially; a paid search API can improve reliability later.
- Archiving service: Internet Archive Save Page Now when permitted, otherwise store source URL only.
