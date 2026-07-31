# Deduplication Policy

A new article does not necessarily describe a new incident. Follow-up reporting, court updates, discipline, and policy changes should be attached to the canonical incident whenever they concern the same underlying misuse.

## Exact duplicate signals

Any one of these is an exact duplicate:

- the same normalized or canonical source URL;
- the same court case or docket number;
- the same `uniqueness.canonical_key`.

URL normalization removes fragments, trailing slashes, and common tracking parameters and sorts remaining query parameters.

## Fuzzy duplicate signals

The deterministic comparison also scores:

- normalized title-token similarity;
- matching agency;
- matching state/locality;
- occurred dates within one month;
- overlapping incident types.

A score of `0.70` or higher is a probable duplicate. The tool returns the score and every contributing reason so a human can override a false match. Unknown occurrence dates receive no date-window score.

## Canonical key

Use a stable factual shape:

```text
country-state-locality:occurred-month:main-agency-or-entity:distinct-event
```

Do not use publication date alone. Two different improper searches by one agency are distinct incidents; two articles about one search are not.

## Commands

```bash
npm test -- tests/dedupe.test.ts
npm run validate:data
```

The admin endpoint rejects exact duplicates and returns probable fuzzy matches as warnings. Daily discovery compares candidate URLs with both public incidents and existing candidates before writing anything.
