# Security policy

PHP2List is an unofficial, independent viewer of the public NCSC-NL php2shell software list.
This policy covers **this website's code** only.

## Reporting a vulnerability in PHP2List

Please report privately using GitHub's **"Report a vulnerability"** button on this
repository's **Security** tab (private vulnerability reporting). Don't open a public issue
for security problems.

Helpful details: affected page or endpoint, steps to reproduce, and the impact you see.
Reports are handled on a best-effort basis; this is a volunteer project without a support
commitment (see the site's disclaimer).

**In scope:** cross-site scripting or any script execution, Content Security Policy bypasses,
leaks of configuration or secrets (for example `GITHUB_TOKEN`), ways to make the site display
data that differs from its source, and denial of service that doesn't require large volumes
of traffic.

**Out of scope:**
- The accuracy of entries in the software list. Report corrections to the source:
  [NCSC-NL/php2shell](https://github.com/NCSC-NL/php2shell#contributions-welcome).
- The PHP2Shell vulnerabilities themselves (CVE-2026-109618, CVE-2026-109619). See
  [php2shell.com](https://www.php2shell.com/) and the PHP security advisory.
- Volumetric DDoS, Cloudflare or GitHub platform issues, and missing headers that have no
  demonstrated impact.

## How the code is kept secure

- Threat model, findings and fixes: [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md).
- `npm test`: Worker unit tests covering input validation, link filtering, token handling,
  caching under load and failure, generic error responses and the security-header policy.
- `npm run test:browser`: XSS payloads through every input path, checked in a real browser
  against the strict Content Security Policy.
- CI runs both on every change, plus `npm audit` and CodeQL. Actions are pinned to commit
  SHAs, and Dependabot proposes updates.

## For operators deploying their own copy

- Store `GITHUB_TOKEN` only as an encrypted **Secret** in the Pages project, never in code or
  in `.dev.vars` committed to git. Use a fine-grained token with public-repository read-only
  access and an expiry date.
- Keep `public/_routes.json` and `public/_headers` in the deployment. Without them every request
  runs the Worker (quota exhaustion risk) and static pages lose their security headers.
- Only point `SOURCE_PRIMARY` / `SOURCE_FALLBACKS` at copies you trust. The site displays
  whatever those sources contain (escaped and validated, but not fact-checked).
