# Source Policy

The tracker should be useful because every incident is grounded in inspectable sources.

## Reported but unverified lane

Reports that lack a primary record or independent corroboration may be shown only in the separate **Reported but unverified** lane. Each public lead must identify the companies involved, state why verification is incomplete, list the evidence still needed, and link its sources. These entries are excluded from the documented incident count and may never be silently promoted.

Company attribution identifies the camera or data-system provider reported in the evidence. It does not, by itself, allege that the provider directed or endorsed a user's conduct.

## Source hierarchy

1. **Primary sources:** court filings, docket records, official audits, public-record releases, city/county/state records, official statements, contracts, policies, meeting minutes.
2. **Strong secondary sources:** established newsrooms, specialist civil-liberties organizations, investigative reports with named documents.
3. **Background sources:** blog posts, social posts, commentary, vendor pages, and general explainers.

## Publication gates

A `verified` public incident requires either:

- at least one primary source; or
- at least two independent reliable secondary sources.

Candidates with only one secondary source may be tracked privately as `candidate` until corroborated.

Every public record also requires `review.approval: human-approved`, a non-automation reviewer identity or accountable role, a full `reviewed_at` date, and a unique `review.approval_reference` in the form `docs/approvals/YYYY-MM-DD-decision-slug.md#approval-stable-id`. The named repository document must contain that anchor and machine-readable metadata binding the decision to the exact incident ID and a SHA-256 digest of the approved incident content (with only the reference field neutralized to avoid circularity). One approval reference cannot authorize multiple public records. Candidate and draft records must remain `pending` with an empty approval reference; scraper, agent, or automation labels never satisfy this gate. Exact release-code approval is a separate exact-SHA specification/security/UX gate; deployment authorization must explicitly include the public record boundary before the accountable site-owner role is recorded.

`reliability: primary` is accepted only with `court-record`, `government-record`, `public-record`, or `official-statement`. News and advocacy reporting cannot become primary merely by changing a label. Secondary-source independence requires distinct publisher identities and distinct canonical source hosts.

## Citation requirements

Every source must include:

- URL
- title
- publisher
- publication date when available
- source type
- reliability classification
- key claims supported by that exact source

## Neutrality and safety

- Attribute allegations to sources.
- Do not publish private personal data unless already central in reliable public reporting.
- Mark disputes, corrections, and retractions explicitly.
- Preserve follow-up sources on the canonical incident rather than duplicating the incident.
