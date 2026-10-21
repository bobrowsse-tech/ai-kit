# Pre-Ship Security Checklist

> Go through this before the first deploy and before any release that touches auth, data access, or public routes. See the `pre-ship-security` skill for how to run it. `node scripts/ai/preship-check.mjs` catches a few of these mechanically; the rest need a human or agent reading the code.

- [ ] 01 — API keys are not exposed (not in client bundles, repo, or logs)
- [ ] 02 — `.env` files are gitignored; `.env.example` is committed and secret-free
- [ ] 03 — No hardcoded secrets in source
- [ ] 04 — Authentication required on every non-public route/endpoint
- [ ] 05 — Permissions verified server-side, not trusted from the client
- [ ] 06 — Frontend-supplied user IDs are never trusted; the server derives the user from the session
- [ ] 07 — User data is isolated per-user in queries, not just filtered in the UI
- [ ] 08 — Database is locked down (no public port, least-privilege user, no default creds)
- [ ] 09 — Firebase/Supabase/storage rules are deny-by-default and reviewed
- [ ] 10 — Admin routes are protected by a role check
- [ ] 11 — Production debug mode is off
- [ ] 12 — Detailed error messages are not returned to clients
- [ ] 13 — Inputs are validated server-side
- [ ] 14 — User-supplied content is sanitized before render/use
- [ ] 15 — File uploads are restricted (type, size) and never executed from the upload path
- [ ] 16 — Queries are parameterized; no string-built SQL/NoSQL
- [ ] 17 — Login/signup endpoints are rate-limited
- [ ] 18 — Git history has been checked for committed secrets
- [ ] 19 — Security headers are set (CSP, X-Frame-Options, HSTS, ...)
- [ ] 20 — CORS is restricted to explicit origins, not `*`
- [ ] 21 — An AI agent security review was run and its findings addressed

## Notes
- Record what's out of scope for this project (e.g., "N/A: no file uploads" for #15) and why.
