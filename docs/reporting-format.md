# Incident Reporting Format

Each public incident record should be stored as structured data and rendered by the website. Sources are first-class evidence, not footnotes.

## Required fields

```yaml
id: "YYYY-MM-jurisdiction-short-slug"
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
  reported: "YYYY-MM-DD"
sources:
  - url: "https://..."
    title: "Source title"
    publisher: "Publisher / court / agency"
    published_date: "YYYY-MM-DD"
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
  canonical_key: "state/county/city:occurred-date:main-actor:incident-type"
  duplicate_of: null
review:
  added_by: "manual | daily-scraper"
  reviewed_by: ""
  reviewed_at: ""
  notes: ""
updated_at: "YYYY-MM-DD"
```

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
