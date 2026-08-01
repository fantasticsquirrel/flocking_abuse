# Manual Admin Intake

The owner intake at `https://flockingabuse.multihost.ing/admin` uses the same simple authentication shape as Hermes WebUI: **one password, no username, no signup**. It does not reuse or expose the Hermes password.

## Production password

- Copyable owner password: `/root/.credentials/flocking-abuse-admin-password.txt`
- Service secrets: `/etc/flocking-abuse/flocking-abuse.env`
- Both files must be owned by root and mode `0600`.
- The service env stores only a bcrypt hash and a random session-signing secret, never the plaintext password.

To copy the password from a trusted shell:

```bash
cat /root/.credentials/flocking-abuse-admin-password.txt
```

Do not paste it into issues, commits, chat logs, or screenshots.

## Local bootstrap

```bash
npm ci
npm run bootstrap:admin
```

This creates:

- `.local/admin-password.txt` (`0600`)
- `.local/admin-env.txt` (`0600`)

No secret value is printed. `.local/` is ignored by git.

## Session security

- Bcrypt password verification.
- Signed, HTTP-only, Secure, SameSite=Strict cookie in production.
- 30-minute session expiration.
- Login rate limiting using the nginx-forwarded client IP; Express trusts only loopback proxies.
- Exact Origin checks and per-session CSRF tokens on candidate creation and logout.
- No-store headers on every admin API response.
- 32 KiB JSON limit in the app and 64 KiB request limit at nginx.

## Submission fields

Enter the source URL, optional archive URL, publisher, source title, optional publication date, source type/reliability, location, agency or entity, occurrence date when known, a stable factual event key, incident classifications, neutral summary, exact source-supported claims, and reviewer notes. The event key identifies the underlying event rather than the article, so independent follow-up URLs can match the same canonical incident. Leave unknown dates empty; the service never substitutes the intake date for an unsupported source date.

The service validates the record, compares it with incidents and candidates, rejects explicitly classified exact duplicates, and returns probable fuzzy matches as warnings before writing a mode-0600 YAML candidate under `/var/lib/flocking-abuse/data/candidates`. Validation enforces that only `candidate` or `draft` records can exist there; the public builder reads accepted records only from `data/incidents`.

The MVP intentionally does **not** fetch arbitrary metadata from submitted URLs. Manual metadata avoids turning the admin API into an SSRF surface. Automated discovery uses a separate robots-aware, DNS-pinned, bounded fetcher.

## Review and publish from the site

Authenticated owners can review queued candidates on `/admin`, choose the public category, record outcomes and reviewer notes, and publish by typing the candidate-specific confirmation shown by the form. Publication is rejected unless the candidate already satisfies the public evidence policy and exact schema checks.

The web process cannot write accepted reports. It sends a tightly scoped request over a group-only Unix socket to the root-owned publisher service. That service can only promote an existing, validated candidate; it writes a digest-bound approval record and accepted incident atomically, then archives the candidate. The public API reloads accepted data on request, so a successful publication appears on report lists, details, and the timeline without an application build or code change.
