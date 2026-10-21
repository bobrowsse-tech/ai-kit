---
name: pre-ship-security
description: Pre-launch security review — the 21-point checklist (secrets, auth, permissions, data isolation, injection, uploads, headers, CORS, rate limiting). Use before a first deploy, before making a project public, or whenever the user asks for a security review.
---

# Pre-ship security review

Run this before shipping, not after. Go through `docs/security-checklist.md` item by item — do not just eyeball the code. Most of these are judgment calls that no script can make for you.

## How to use this skill
1. Run `node scripts/ai/preship-check.mjs`. It is a cheap grep-based net for a handful of items (env tracking, obvious debug flags, stack traces in responses, wildcard CORS, missing rate-limit/headers packages, string-built SQL, open Firebase/Supabase rules). Findings are leads to verify, not proof of a problem — and a clean run does not mean the project is safe, since most items below need reading the code, not grepping it.
2. Open `docs/security-checklist.md` and go through every unchecked item for what actually applies to this project. Check the box and note how it's satisfied (file/line or "N/A: no file uploads").
3. Report what you checked, what you fixed, and what still needs the user's decision (e.g., which origins CORS should allow, what the rate limit should be).

## The 21 points, in short
| # | Check | Where to look |
|---|---|---|
| 1 | API keys not exposed | never in client-side bundles, repo, or logs; server-side only |
| 2 | `.env` files hidden | `.gitignore` covers `.env`/`.env.*`; `.env.example` stays committed and secret-free |
| 3 | No hardcoded secrets | grep for API keys/passwords in source (the [[reuse-first]]/guard hook already blocks new ones) |
| 4 | Authentication present | every non-public route/endpoint requires it |
| 5 | Permissions verified server-side | never trust a client-sent role/flag; re-check on the server |
| 6 | Frontend user IDs not trusted | derive the user from the session/token server-side, never from a request body/param |
| 7 | User data isolated | queries scoped to `WHERE user_id = <session user>`, not just filtered in the UI |
| 8 | Database locked down | no public DB port, least-privilege DB user, no default credentials |
| 9 | Firebase/Supabase/storage rules | deny-by-default; RLS or security rules reviewed, not left at "allow all" |
| 10 | Admin routes protected | role check, not just route obscurity |
| 11 | Production debug mode off | `DEBUG=False`, `NODE_ENV=production`, no dev-only middleware in prod |
| 12 | Detailed errors hidden from clients | log the stack trace, return a generic message |
| 13 | Inputs validated server-side | client-side validation is UX only; validate again on the server |
| 14 | User content sanitized | escape/sanitize anything rendered as HTML or used in shell/DB/file paths |
| 15 | File uploads secured | type/size limits, re-encode or scan, never execute from the upload dir |
| 16 | SQL/NoSQL injection prevented | parameterized queries or an ORM, never string-built queries |
| 17 | Login/signup rate-limited | brute-force and credential-stuffing protection |
| 18 | Git history checked for secrets | `git log -p` / gitleaks over history, not just the working tree (the kit's CI gitleaks step scans history too — confirm it found nothing) |
| 19 | Security headers set | CSP, X-Frame-Options, HSTS, etc. |
| 20 | CORS restricted | explicit allowed origins, not `*` |
| 21 | AI agent security review | this skill run, with findings reported to the user |

## Do not
- Do not check a box in the checklist without verifying it — a false "done" is worse than an honest "TODO".
- Do not silently "fix" auth, permissions, or CORS choices — these need the user's decision (which origins, which roles); propose and ask.
- Do not treat a clean `preship-check.mjs` run as a pass. Most of the 21 points (auth, permissions, isolation, DB lockdown) require reading the code.
