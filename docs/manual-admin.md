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

Enter the source URL, optional archive URL, publisher, source title/date/type/reliability, location, agency or entity, incident classifications, neutral summary, exact source-supported claims, and reviewer notes.

The service validates the record, compares it with incidents and candidates, rejects exact duplicates, and writes a mode-0600 YAML candidate under `/var/lib/flocking-abuse/data/candidates`. Candidates are excluded from the public build.

The MVP intentionally does **not** fetch arbitrary metadata from submitted URLs. Manual metadata avoids turning the admin API into an SSRF surface. Automated discovery uses a separate robots-aware, DNS-pinned, bounded fetcher.
