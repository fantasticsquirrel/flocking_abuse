# Incident Reporting Format

Each public incident record should be stored as structured data and rendered by the website. Sources are first-class evidence, not footnotes.

## Required fields

```yaml
schema_version: 1
id: "lowercase-url-safe-stable-id" # manual intake emits YYYY-MM-DD-title-slug-12-character-source-hash
title: "Short factual title"
status: "verified" # draft | candidate | verified | disputed | retracted
summary: "2-4 sentence neutral summary of what was reported."
incident_type:
  - "unauthorized-search"
  - "political-targeting"
  - "law-enforcement-overreach"
  - "data-sharing"
  - "retention-or-access-policy"
  - "vendor-or-contracting"
  - "other"
location:
  city: ""
  county: ""
  state: ""
  country: "US"
actors:
  agencies: []
  officials_or_entities: []
  vendor_entities: ["Flock Safety"]
dates:
  occurred: "YYYY-MM-DD or YYYY-MM if known; empty string when unknown"
  discovered: "YYYY-MM-DD or YYYY-MM if known"
  reported: "YYYY-MM-DD; empty string when the source publication/report date is unknown"
sources:
  - url: "https://..."
    title: "Source title"
    publisher: "Publisher / court / agency"
    published_date: "YYYY-MM-DD; empty string when unknown"
    source_type: "news" # news | court-record | government-record | advocacy-report | public-record | official-statement | other
    archive_url: "https://web.archive.org/... optional"
    reliability: "primary" # primary only for direct official/public record types; otherwise corroborating | background
    key_claims:
      - "Specific claim supported by this source."
legal_or_policy_context:
  case_numbers: []
  statutes_or_policies: []
outcomes:
  - "Investigation opened / lawsuit filed / policy changed / unknown"
uniqueness:
  canonical_key: "country-state-locality:occurred-month-or-unknown:main-agency-or-entity:distinct-event-key"
  duplicate_of: null
review:
  added_by: "manual | daily-scraper"
  approval: "pending | human-approved"
  reviewed_by: ""
  reviewed_at: ""
  approval_reference: "unique docs/approvals/YYYY-MM-DD-decision-slug.md#approval-stable-decision-id; empty while pending"
  notes: ""
updated_at: "YYYY-MM-DD"
```

The approval document must include a machine-readable `approval-metadata` block containing schema version, approval/incident IDs, `public-incident-content-v1` scope, approval date, accountable human role, stable authorization evidence, reviewed base revision, and the SHA-256 digest of the approved incident after neutralizing only `review.approval_reference`. Validation rejects a missing/mismatched anchor, incident ID, content digest, or reused reference.

## Verification rules

1. **At least one source is mandatory** for every candidate.
2. **Verified incidents need either:**
   - one primary source, such as a court filing, official record, public-record document, official statement, or direct admission; or
   - two independent reliable secondary sources.
   Publisher labels and canonical source hosts must both be independent; two brand labels on one host do not satisfy this gate.
3. **Use neutral wording.** Attribute claims to sources unless legally/adjudicatively established.
4. **No private personal data** unless it is central to the public report and already published by a reliable source.
5. **Do not merge distinct incidents** just because they involve the same jurisdiction; track each separate misuse/reportable event independently.
6. **Do not duplicate the same incident** across follow-up articles; add follow-up sources and outcomes to the canonical incident.
7. **Do not invent occurrence dates.** Use an empty `occurred` value and an `unknown` canonical-key segment until a cited source establishes the date or month.
