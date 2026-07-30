# Manual Admin Plan

The manual entry flow should mirror the Hermes WebUI-style password-only pattern without copying or exposing the actual password from any Hermes instance.

## Authentication

- One password field.
- No username.
- No account creation.
- No public registration.
- Store only a slow password hash, e.g. `ADMIN_PASSWORD_HASH` using Argon2id or bcrypt.
- Store session signing secret in `ADMIN_SESSION_SECRET`.
- Use signed, HTTP-only, SameSite cookies with short expiration.

## Local bootstrap

For local development only:

1. Generate a random password.
2. Write it to `.local/admin-password.txt` with mode `0600`.
3. Print a local-only command such as `cat .local/admin-password.txt` so the operator can copy it.
4. Never commit `.local/` or any password material.

This preserves the same ergonomics as a copy-password WebUI while keeping production secrets outside git.

## Submission flow

Manual article submission should ask for:

- Source URL
- Optional archive URL
- Title
- Publisher
- Published date
- Source type
- Location
- Agency/entity involved
- Incident type tags
- Neutral summary
- Key claims supported by source
- Reviewer notes

## Save behavior

- Validate fields against the incident schema.
- Run dedupe against existing incidents and candidates.
- Save as `data/candidates/YYYY-MM-DD-source-slug.yaml`.
- Prefer opening a GitHub PR for review.
- If GitHub write access is unavailable, provide the YAML as a downloadable file or patch.
