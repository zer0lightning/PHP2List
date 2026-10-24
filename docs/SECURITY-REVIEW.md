# PHP2List security review

Release review before publishing the source code. Method: threat model → adversarial
review of every published file → fixes with regression tests → repeat review passes
until a pass finds nothing new. Publishing the code is assumed to give attackers full
knowledge of the implementation, so no finding relies on obscurity.

## 1. System overview

| Component | Runs where | Notes |
| --- | --- | --- |
| Static pages and assets (`public/*.html`, `public/assets/*`) | Visitor's browser | No third-party resources. All page logic in `assets/*.js`. |
| `public/_worker.js` | Cloudflare edge (Pages advanced mode) | Serves `/api/software` and `/api/timeline`. Reads Markdown from GitHub (or a configured mirror), parses it, caches it. |
| Upstream data | `raw.githubusercontent.com/NCSC-NL/php2shell` or operator-configured mirrors | Public, but **untrusted input** from this system's point of view. |
| Configuration | Pages environment variables | `GITHUB_TOKEN` (secret), `SOURCE_PRIMARY`, `SOURCE_FALLBACKS`. |

## 2. Assets worth protecting

1. **Visitors' browsers**: no script execution, no data theft, no UI redress via this site.
2. **Integrity of displayed security data**: visitors make patching decisions from it.
3. **Availability**: the site should stay up during an incident, when it's most needed.
4. **`GITHUB_TOKEN`**: must never reach visitors or non-GitHub hosts.
5. **Visitor privacy**: watchlists (which reveal what software an organisation runs) stay on the device.
6. **Operator cost/quota**: the free plan has a daily Worker request limit.

## 3. Threat actors

- **Anonymous internet attacker** who can send any request and craft any link (phishing a visitor into opening a crafted URL).
- **Hostile or compromised upstream**: a malicious commit to the source repo, or a compromised/misconfigured mirror.
- **Network attacker**: mitigated by HTTPS everywhere (HSTS).
- Out of scope: Cloudflare or GitHub themselves being malicious; the operator's own Cloudflare account being compromised.

## 4. Entry points / trust boundaries

| # | Input | Reaches |
| --- | --- | --- |
| E1 | URL fragment (`#q=…&v=…&status=…&l=…&sort=…`) | Client state, rendering, share dialog, exports |
| E2 | Typed / pasted watchlist text | Client state, storage, rendering, exports |
| E3 | `localStorage` values | Client state |
| E4 | `/api/software` JSON (built from upstream Markdown) | All rendering, exports, charts |
| E5 | `/api/timeline` JSON (built from upstream changelog) | Charts |
| E6 | Upstream Markdown files | Worker parser, cache |
| E7 | HTTP requests to the Worker (any method/path/volume) | Worker, quota, upstream fetches |
| E8 | Environment variables | Worker source selection, token |

## 5. Findings — pass 1

Severity uses impact × likelihood for this deployment (public, unauthenticated, static-ish site).

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| F-01 | **High** | Every request, including static pages and assets, ran through `_worker.js` and counted against the Worker's daily request quota. An attacker could exhaust the free-plan quota with a simple request flood and take the site offline (or run up cost on a paid plan). | `_routes.json` limits the Worker to `/api/*`; static files are served directly (free, unlimited). Static security headers moved to `_headers`. |
| F-02 | Medium | Cache stampede / upstream amplification: on a cache miss every concurrent request fetched 28 files from GitHub, failures were not cached, and the edge cache is per data centre. An attacker could force repeated upstream fetches, hit GitHub rate limits and degrade freshness for everyone. | Stale-while-revalidate (serve cached copy, refresh in background), single-flight refresh per isolate, failure cooldown, browser caching. |
| F-03 | Medium | Upstream content was not bounded or validated server-side: no size, row or field-length limits, no type or URL-scheme validation. A hostile or broken source could exhaust Worker memory/CPU, send `javascript:` links (blocked only on the client), or crash clients with unexpected types. | Streaming byte caps per file, row caps, string normalisation (control and bidi-override characters stripped, length caps), links restricted to `http(s)` by URL parsing, statuses length-capped. |
| F-04 | Medium | The client assumed the API shape. Non-string fields or missing arrays would throw during rendering (denial of service for every visitor). | Client-side normalisation of every item before use (defence in depth with F-03). |
| F-05 | Low | Information disclosure: `/api/software` returned the full mirror base URL (`sourceBase`), and errors returned raw upstream error text. A mirror URL with a secret path would leak. | Public responses carry only a coarse label (GitHub `owner/repo@branch` or the mirror's hostname) and generic error codes; details go to logs only. |
| F-06 | Low | Status lookups used plain objects keyed by data values, so values like `toString` or `__proto__` resolved to inherited properties (wrong counts, odd output). | Own-property checks (`Object.hasOwn`) and null-prototype maps. |
| F-07 | Low | CSV formula-injection guard missed leading whitespace and full-width `＝＋－＠` variants. | Broadened guard. |
| F-08 | Low | No HSTS header for custom domains (`*.pages.dev` is already HSTS-preloaded via `.dev`). | `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains`, so the operator's other subdomains aren't affected). |
| F-09 | Low | CSP allowed `style-src 'unsafe-inline'`. Not exploitable today (all markup is escaped) but weakens defence in depth against CSS-based data exfiltration if an escaping bug were ever introduced. | Removed the 5 inline `style` attributes; strict `style-src 'self'`. |
| F-10 | Low | Release hygiene: unpinned dev dependency, no lockfile, no `.gitignore` (the `.wrangler` build cache would be committed), page generator outside the repo, no automated tests, no CI, no security policy. | Pinned version + lockfile, `.gitignore`, generator in `tools/`, `npm test` suites, CI workflow, `SECURITY.md`. |
| F-11 | Info | Saved `localStorage` watchlist entries skipped the same cleaning as link/paste input. | Same normaliser for all three inputs. |
| F-12 | Info | Exports hard-coded `php2list.pages.dev`; a fork deployed elsewhere would mislabel its exports. | Uses the page's own origin. |
| F-13 | Info | Cache keys used a made-up hostname. Cloudflare doesn't document keys on foreign hostnames. | Keys now live under the site's own origin. |
| F-14 | Info | No custom 404: unknown paths were served the main page with HTTP 200. | Proper `404.html`. |

### Verified as not vulnerable (pass 1)

- **XSS through every input** (E1–E5): all dynamic text goes through `esc()` or `textContent`; link `href`s are scheme-checked; search highlighting escapes each fragment. Covered by `tests/browser/xss_test.py` (14 payload families × link, typing, paste, starring, suggestions, share dialog, malicious API data, charts).
- **CSP**: scripts only from `'self'`, no inline or injected scripts can run (verified by injecting a `<script>` at runtime).
- **Token handling**: sent only to `raw.githubusercontent.com`; redirects are not followed while the token is attached; invalid tokens fall back to anonymous requests.
- **Clickjacking**: `frame-ancestors 'none'` + `X-Frame-Options: DENY`.
- **CSRF / state-changing endpoints**: none exist; the API is read-only (`GET`/`HEAD`).
- **SSRF**: upstream hosts come only from operator environment variables; only `https://` URLs without credentials, query or fragment are accepted.
- **Open redirect**: none.
- **Tabnabbing**: external links use `rel="noopener noreferrer"`; `Referrer-Policy: no-referrer` site-wide.

## 6. Accepted risks

- **Trusted Types not enforced.** All HTML sinks are fed by escaped templates and covered by tests; enforcing Trusted Types would require routing every `innerHTML` through a policy. Revisit if the code grows.
- **Upstream accuracy.** A malicious commit to the official repository could publish false statuses. PHP2List displays the source faithfully and says so; it cannot verify vendor advisories.
- **Shared links reveal watchlists to recipients.** By design, and stated in the Privacy notice.

## 7. Review log

Each pass re-reads the changed code adversarially and re-runs every test suite.

### Pass 2 (review of the fixes)

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| F-15 | **High** (deploy-breaking) | The rewritten Worker exported non-function constants. The Workers runtime rejects these ("Incorrect type for map entry"), so the API would have failed to start in production. Caught by running the build in `workerd` locally. | Only functions are exported; constants are exposed to tests through `_internals()`. |
| F-16 | Low | After an upstream failure the 2-minute cooldown marker wasn't cleared when a background refresh later succeeded, so fresh data could be reported as "stale" and refreshes skipped until the marker expired. | Marker deleted on successful refresh; regression test added. |
| F-17 | Info | Highlighted search terms inside product names were split into separate layout items (cosmetic, found during visual regression). | Product name wrapped in one element. |

Test-suite validation: five of the pass-1 bugs were re-introduced one at a time (allowing
`javascript:` links, sending the token to every host, `unsafe-inline` in `_headers`, leaking
upstream errors, removing single-flight). The suite failed for each and passed again once
restored.

### Pass 3 (fresh read of everything)

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| F-18 | Info | A few external links used `rel="noopener"` without `noreferrer`. Already covered by the site-wide `Referrer-Policy: no-referrer`. | All external links now `noopener noreferrer`. |
| F-19 | Info | CI hygiene: actions pinned to tags rather than commits; one release tag was an annotated tag object, not a commit. | All actions pinned to resolved commit SHAs; Dependabot added; `permissions: contents: read`; `persist-credentials: false`; `npm ci --ignore-scripts`. |

Pass 3 also re-checked, and found clean:
- the privacy notice (static markup only);
- the theme scripts (only `light`/`dark` accepted from storage);
- the charts (DOM text APIs only; supplier links are `encodeURIComponent`-ed and same-origin);
- the share dialog and "Read more" controls (static markup);
- the page generator (static, authored text only);
- the CI workflow (no secrets used, no untrusted input in `run:` steps).

### Pass 4 (GitHub load reduction and prebuilt data)

Changes: a revision check before downloading, files pinned to one commit, longer backoff on 403/429, and an optional prebuilt-data path (GitHub Action → Workers KV → worker).

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| F-20 | **High** (deploy-breaking) | The new code exported two string constants. This is the same runtime failure as F-15, caught again by running the site in `workerd` locally. | Exposed through `_internals()`. A unit test now fails if any named export isn't a function. |
| F-21 | Medium (design) | Data in KV is written by an Action using an API token. If the token or the repo were compromised, an attacker could write arbitrary JSON that the site serves. | KV data gets the same treatment as upstream Markdown. Every field is re-cleaned (control/bidi characters, length caps, http(s)-only links), unknown properties are dropped, and timeline points must be in-range numbers. Data more than 3 hours old or in the future is ignored. Prototype-pollution keys are inert. The browser still escapes everything. Tested with hostile input and mutation-tested. |
| F-22 | Low | The API token's scope. | The documented token has only Account → Workers KV Storage → Edit. It is stored as a GitHub Actions secret, used only in the publish step, and never reaches the site or visitors. The workflow has `permissions: contents: read` and pinned actions. |
| F-23 | Info | The GitHub token is now also sent to `api.github.com` (revision check). | It goes only to GitHub hosts, with redirects not followed, as before. A non-SHA answer is ignored and the site falls back to a normal download. |

### Final verification (all passing)

- `npm test`: 24 Worker unit tests.
- `npm run test:browser`: XSS payloads through every input path including malicious API data;
  no execution, no injected elements, runtime inline script blocked by CSP, 0 CSP violations.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- Routing: static pages don't invoke the Worker (verified with a probe header);
  `/api/__cache/*` and unknown API paths 404; non-GET/HEAD → 405; unknown pages → 404.
- Visual regression: every page at 1440 px and 390 px, light and dark, with the strict CSP;
  no console errors, no horizontal scrolling, all chart and status bars painted.

**Result: no open findings.** Accepted risks are listed in section 6.

### Pass 5 (changes, feeds, product links, public API)

New attack surface: `/api/changes`, `/api/v1/*` (CORS), `/feed.xml?v=…` (visitor-controlled input on the server), product IDs in links (`#p=`), the Changes page, and last-visit storage.

| ID | Severity | Finding | Fix |
| --- | --- | --- | --- |
| F-24 | Medium | `/feed.xml` turns query text into regular expressions and does work per request. Random parameters bypass the cache, and the worst case measured ~10 ms CPU, at the free plan's limit. | Entries are cleaned and capped (25 entries, 80/240 chars) and regex-escaped (no ReDoS: literals with fixed boundaries). All keywords are combined into one pattern, each event is lowercased once, and matching stops at 50 results, giving ~3.6 ms worst case. Feeds are cached for 5 minutes under a SHA-256 of the normalised list, so cache keys stay short. |
| F-25 | Medium | XML injection in the feed via data or query text. | Every value is XML-escaped and characters that are invalid in XML 1.0 are removed. Content uses `type="text"` (never HTML), and the feed is served with `nosniff` and the API CSP (`sandbox`). Tested with hostile supplier/product names, `]]>` and control characters, and the output parses as XML. |
| F-26 | Low | Product IDs reach URLs and HTML attributes. | IDs are generated by the worker from cleaned names (`[a-z0-9-]` only). They are never taken from KV or the URL without checking against `^[a-z0-9][a-z0-9-]{0,150}$`, in the worker (KV data), `app.js` and `changes.js`. |
| F-27 | Low | CORS on `/api/v1` lets any website read the data and spend the site's request quota through visitors' browsers. | The data is public and the site uses no cookies or credentials, so there's nothing to steal. CORS is limited to `/api/v1` and the feed; the internal `/api/*` stays same-origin. The quota risk is covered by the recommended rate-limiting rule (README launch checklist). |
| F-28 | Low (privacy) | A watchlist feed URL sends watchlist entries to the server; last-visit time is new client storage. | Documented in the UI next to the button and on the Privacy page. Last-visit time is stored only after the visitor selected OK, and is cleared by "Don't save my settings". |
| F-29 | **High** (would have broken the page) | Writing `changes.js` turned a `\u2028` escape into a raw U+2028 character inside a regex literal, so the script didn't parse. Caught in the browser check. | Fixed. A unit test now compiles every page script and rejects raw U+2028/2029. |

Re-checked and clean: route lookup uses `Object.hasOwn` (`/api/v1/__proto__` and `/api/v1/constructor` return 404); new client code inserts data only through `esc()`; status CSS classes come from a fixed list; the Changes page validates every API field like the main page does.
| F-30 | Info | Feed opened in a browser tab showed raw XML. | Browser tab navigations (`Sec-Fetch-Dest: document` + `Sec-Fetch-Mode: navigate`) get a 303 to `/subscribe`. Only cleaned `v` entries are carried over, re-encoded, with a fixed relative `Location`, so there's no open redirect. Responses send `Vary: Sec-Fetch-Dest, Sec-Fetch-Mode`. The Subscribe page shows entries with `textContent` only and is covered by the browser XSS suite. XSLT styling was rejected because Chrome is removing XSLT support. |
