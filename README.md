# PHP2List — PHP2Shell Software List

By **zer0lightning** · Source: https://github.com/zer0lightning/PHP2List · MIT licence

An unofficial, independent, searchable view of the [NCSC-NL php2shell software list](https://github.com/NCSC-NL/php2shell/tree/main/software),
live at **https://php2list.com** and **https://php2list.pages.dev** (both serve the same site on Cloudflare Pages).

The table uses the same columns as the repo:
Supplier · Product · Version (see Status) · Status CVE-2026-109618 · Status CVE-2026-109619 · Notes · Links

## Project layout

| Path | Role |
| --- | --- |
| `public/index.html`, `public/assets/app.js` | Main page: watchlist, status overview, search/filter table, exports. |
| `public/charts.html`, `public/assets/charts.js` | Patch-progress charts. |
| `public/what-is-php2shell.html`, `about.html`, `disclaimer.html`, `privacy.html`, `acknowledgements.html`, `404.html` | Content pages, **generated** by `tools/build_pages.py` from the header/footer in `index.html`. Edit the generator, then run `npm run build:pages`. It also stamps every stylesheet/script link with `?v=<content hash>` (in `index.html` too), so browsers never mix a new page with an old cached stylesheet. **Run it after editing anything in `public/assets/`**; `npm test` fails if a hash is out of date. |
| `public/assets/site.css`, `theme-init.js`, `theme.js`, `consent.js` | Shared styles, light/dark theme, privacy notice. |
| `public/_worker.js` | Runs on Cloudflare's edge for `/api/software` (the list) and `/api/timeline` (status history), with validation, caching and security headers. |
| `public/_routes.json` | Limits the Worker to `/api/*`; pages and assets are served directly (free, unlimited, no Worker quota used). |
| `public/_headers` | Security headers (CSP, HSTS, etc.) for the static pages. Must match the Worker's policy; `npm test` checks this. |
| `tools/build-data.mjs`, `.github/workflows/data.yml` | Prebuilt data: a scheduled GitHub Action builds `software.json` and `timeline.json` and writes them to Workers KV (see "Prebuilt data"). |
| `tests/` | `worker.test.mjs` (unit tests, `npm test`) and `browser/xss_test.py` (browser security tests). |
| `docs/SECURITY-REVIEW.md` | Threat model, findings and fixes. See also `SECURITY.md`. |
| `LICENSE`, `NOTICE.md`, `CONTRIBUTING.md` | MIT licence for the code, data licence and trademark notices, how to contribute. |

The pages only call `/api/software` and `/api/timeline` on their own domain. There is no separate Worker URL and no cross-origin access.
The data refreshes itself (from the prebuilt KV data, or directly from the source), so you never need to redeploy for new data.

## Features

- **Watchlist** with three kinds of entry:
  - **Supplier:** an exact supplier, e.g. *WordPress project* only (not "bbPress community / WordPress project").
  - **Product:** one exact product, e.g. *WordPress* from *WordPress project*.
  - **Keyword:** a whole word anywhere in supplier or product names, e.g. *wordpress* matches 15 products.

  Add them by typing (suggestions grouped into Keyword / Suppliers / Products), by selecting **☆ Watch** on any row, or by pasting a list (`Supplier :: Product` for a product, `supplier: Name` for a supplier, anything else is a keyword). A **Watchlist / All products** switch lets you browse everything while starring rows. Items not found in the list are called out. Saved in the visitor's browser only; older saved lists of plain names keep working as keywords.
- **Export menu:** products as CSV (with a "Matched vendor" column) or JSON, and a per-vendor summary CSV with status counts. Exports reflect all active filters and are generated in the browser.
- Search, status filters per CVE, A–Z supplier index, sortable columns, light/dark toggle.
- **Share / bookmark links:** the **Share** button in the watchlist creates a link containing the vendor list (optionally with the current search and filters), with Copy link and the device share sheet. Opening someone else's link shows their list in a "shared vendor list" banner without overwriting your own saved watchlist; you can **Save as my watchlist** or go **Back to my watchlist**. The list lives after `#` in the address, which browsers never send to the server.
- Consistent notices (info / warning / error), confirmation toasts with Undo, and a warning when GitHub is unreachable and a saved copy is shown.
- Clearly marked as **unofficial** and not affiliated with NCSC-NL on every page and in exports.
- **Patch progress charts** at `/charts`.
- **What changed:** a strip on the main page shows how many products changed status in the last 24 hours and since your last visit (click to filter the table), and recently changed rows get a "Changed 3 h ago" marker. The **Changes** page (`/changes`) lists every status change in the last 30 days, grouped by day, with filters for period, type (newly fixed, newly vulnerable, added) and "only my watchlist".
- **Feeds:** `/feed.xml` is an Atom feed of status changes; `/feed.xml?v=<entry>&v=...` narrows it to a watchlist. Copy links from the Changes page or the watchlist ⋯ menu, or use the **RSS** link in the "Recent changes" strip and the footer. Opening the feed address in a browser tab shows a **Subscribe** page (`/subscribe`) with the address to copy, instead of raw XML; feed readers still get the feed. `?view=xml` shows the raw feed.
- **Product links:** the link button on each row copies `/#p=<product-id>`, which opens that product on its own.
- **Last checked time** next to "List updated", so it's clear the site is current.
- **Public API** (`/api/v1/software`, `/changes`, `/timeline`), documented at `/api-docs`, with CORS enabled.
- **Archived mode:** when NCSC-NL archives the source repository (detected by the data Action, or set `SOURCE_ARCHIVED=true`), visitors see that the list is no longer updated.
- **Privacy notice** on first visit (no cookies set by PHP2List; Cloudflare's hosting role disclosed), with a "Don't save my settings" option and a footer "Privacy choices" link.

## Security

- **Strict Content Security Policy:** scripts and styles only from the site's own files, so no inline or injected code can run. Nothing loads from other origins, and the site can't be framed. Also HSTS, `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, COOP/CORP and a restrictive Permissions-Policy.
- **Untrusted data:** list data is size-limited, validated and cleaned on the server, then escaped again in the browser. Only `http(s)` links are kept.
- **Caching:** the API caches with stale-while-revalidate, coalesced refreshes and a cooldown after failures, so request floods can't hammer GitHub. Static pages never run the Worker.
- **Error responses:** public errors are generic. Source URLs, upstream errors and secrets stay out of responses.
- **Tests:** covered by `npm test` and `npm run test:browser`, which CI runs on every change along with `npm audit` and CodeQL.
- **More:** [SECURITY.md](SECURITY.md) explains how to report a vulnerability, and [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md) has the threat model and findings.

## Manual deployment (dashboard, no command line)

1. Log in at https://dash.cloudflare.com.
2. Go to **Workers & Pages** → **Create** → **Pages** tab → **Upload assets**.
3. Project name: **`php2list`** → **Create project**.
4. Drag the **`public` folder** onto the upload area. It must include the hidden-looking files `_worker.js`, `_routes.json` and `_headers`.
5. Click **Deploy site**, then open **https://php2list.pages.dev** to check it.

To update the site later: open the project → **Create deployment** → drag the `public` folder again → Deploy.

> Upload the folder, not the zip. Check that `_worker.js`, `_routes.json` and `_headers` are included:
> without `_worker.js` the list can't load; without the other two the site loses its security headers
> and every request counts against the Worker quota.

## Prebuilt data (recommended): no GitHub requests from visitors

A GitHub Action in this repo builds the site's data every 30 minutes and pushes two files,
`software.json` and `timeline.json`, into a **Workers KV** namespace that the site reads. Visitors never
cause requests to GitHub, and you keep deploying the site by hand as before. The data updates by itself.

If the Action stops or the data is more than 3 hours old, the site automatically goes back to reading
GitHub directly, so it keeps working. Note that GitHub turns off scheduled Actions in public repos after
60 days without any commits. Re-enable it on the Actions tab if that happens.

**One-time setup:**

1. **Create the KV namespace.** Cloudflare dashboard → **Storage & Databases** → **Workers KV** →
   **Create instance**. Name it `php2list-data`, then copy its **ID**.
2. **Bind it to the site.** Workers & Pages → **php2list** → **Settings** → **Bindings** → **Add** →
   **KV namespace**. Variable name **`DATA`**, namespace `php2list-data`. Save.
3. **Create a Cloudflare API token.** My Profile → **API Tokens** → **Create Token** → **Create Custom Token**.
   Permission: **Account → Workers KV Storage → Edit**, for your account only. Copy the token.
   Also copy your **Account ID** (shown on the Workers & Pages overview page).
4. **Add them to the GitHub repo.** Repo → **Settings** → **Secrets and variables** → **Actions**:
   - Secrets: `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID`.
   - Variables tab: `KV_NAMESPACE_ID` (the namespace ID from step 1).
5. **Run it once.** Repo → **Actions** → **Publish data** → **Run workflow**. It should finish in about a
   minute with a line like "Built 751 products from NCSC-NL/php2shell@main".
6. **Redeploy the site** (Create deployment → upload `public`), because bindings apply to new deployments.

**Check it:** `/api/software` should contain `"prebuilt":true`. If it doesn't, the Real-time logs show
why (for example "Prebuilt software.json is missing, invalid or more than 3 hours old").

The token can only edit KV in your account, and it is only used inside GitHub Actions. The worker still
checks and cleans every field of the prebuilt files, exactly as it does for data read from GitHub.

To build the files locally: `git clone --depth 1 https://github.com/NCSC-NL/php2shell upstream`, then
`npm run build:data` (writes to `data/`).

## Launch checklist

Things only you can do (they're outside the code):

- [ ] **Publish the repo** on GitHub. Then replace the placeholder repo link in `public/index.html` (the `gh-link` href) and `REPO_URL` in `tools/build_pages.py`, and run `npm run build:pages`.
- [ ] **Privacy contact:** set up an address (for example `privacy@php2list.com` with Cloudflare **Email Routing**, free), put it in `CONTACT_EMAIL` in `tools/build_pages.py`, and run `npm run build:pages`.
- [ ] **Private vulnerability reporting:** repo → Settings → Code security → enable it (SECURITY.md points there).
- [ ] **Deploy** the latest `public` folder, set **`GITHUB_TOKEN`**, and set up **prebuilt data** (KV + Action), all described below.
- [ ] **Connect php2list.com** (below). Keep `php2list.pages.dev` working for people already using it; add the redirect later if you want.
- [ ] **Cloudflare settings for php2list.com:** SSL/TLS → Edge Certificates → **Always Use HTTPS** on, **Minimum TLS 1.2**; DNS → **DNSSEC** on; Security → WAF → **Rate limiting rules** → one rule for URI path starts with `/api/` or equals `/feed.xml`, e.g. 120 requests per minute per IP → Block for 10 minutes. (Rate rules apply to your own domain, not to `pages.dev`.)
- [ ] **Monitoring:** a free uptime checker (for example UptimeRobot) on `https://php2list.com/api/v1/software`, alerting if it isn't HTTP 200 or doesn't contain `"items"`. In GitHub, make sure you get emails for failed Actions (Settings → Notifications → Actions).
- [ ] **Tell NCSC-NL** the site exists (a short, courteous note: unofficial, credits them, links back). Corrections still go to their repo.

## Custom domain (php2list.com)

1. Add **php2list.com** to Cloudflare (**Add a domain**) and change the nameservers at your registrar to the two Cloudflare gives you. An apex domain on Pages needs this.
2. Open the Pages project → **Custom domains** → **Set up a domain** → `php2list.com`. Add `www.php2list.com` too if you want it.
3. Optional, later: send the old address to the new one. Only do this once nobody depends on `php2list.pages.dev` staying as it is. **Bulk Redirects** → create a list with source `php2list.pages.dev`, target `https://php2list.com`, status **301**, and turn on *Preserve query string*, *Subpath matching*, *Preserve path suffix* and *Include subdomains*. Then create a Bulk Redirect rule that uses the list.
4. If you change the domain later, update `SITE_URL` in `tools/build_pages.py` and the canonical link in `public/index.html`, then run `npm run build:pages`.

## Recommended: GitHub token (avoids GitHub rate limits)

GitHub limits downloads made without logging in, and the site downloads from Cloudflare addresses that
many other sites share, so those limits can be hit by other people's traffic. A token gives the site its
own, much higher allowance. Strongly recommended for a public deployment:

1. **Create the token on GitHub:** Settings → Developer settings → Personal access tokens → **Fine-grained tokens** →
   Generate new token. Repository access: **Public repositories (read-only)**. No extra permissions are needed.
   Set an expiry you're comfortable with and copy the token.
2. **Add it to Cloudflare:** your `php2list` Pages project → **Settings** → **Variables and Secrets** → **Add** →
   Type **Secret**, Variable name **`GITHUB_TOKEN`**, paste the token, environment **Production** → Save.
3. **Redeploy** (Create deployment → upload the `public` folder again). Variables only apply to new deployments.

The token stays on Cloudflare and is never sent to visitors. If it expires or is wrong, the site automatically
falls back to anonymous requests, so it keeps working; renew the token when convenient.

## How the site keeps GitHub traffic low

- Each Cloudflare location keeps its own copy of the list for 30 minutes.
- After that, the site first asks GitHub for the latest commit, which is one small request. If nothing has
  changed, it keeps its copy and downloads nothing else. It downloads the 28 list files only when there is a
  new commit, and reads them all from that exact commit.
- If GitHub answers "too many requests", the site waits 15 minutes before trying again and keeps serving its
  last good copy (kept for up to 7 days) in the meantime.

To check: open `/api/software` and look at the `x-data-cache` response header (`HIT`, `REVALIDATING`,
`STALE` or `MISS`). In the Cloudflare dashboard, the Pages project's **Functions → Real-time logs** shows
warnings such as `Revision check: HTTP 403` or `HTTP 429 for software/...` when GitHub is limiting requests.

## Optional: use a fork or mirror as the data source

By default the list is read from the official `NCSC-NL/php2shell` repository. If it ever goes down, moves or is archived, point the site at a copy, with no code changes. In the Pages project → **Settings** → **Variables and Secrets**, add plain-text variables:

| Variable | Example | Meaning |
| --- | --- | --- |
| `SOURCE_PRIMARY` | `myorg/php2shell@main` | Where to read first. Accepts `owner/repo`, `owner/repo@branch`, or an `https://` base URL that serves the same files. |
| `SOURCE_FALLBACKS` | `NCSC-NL/php2shell@main, https://mirror.example.org/php2shell` | Comma-separated, tried in order if the primary fails. |

Then redeploy (variables only apply to new deployments). Notes:

- A source must serve the same files as the original repo: `README.md`, `software/software_list_0-9.md` … `software_list_z.md`, and `software/changelog_software_list.md`. A GitHub fork or a `git clone --mirror` pushed to GitHub, GitLab or your own web server works. For GitLab, use the raw base URL, e.g. `https://gitlab.com/you/php2shell/-/raw/main`.
- To keep a fork current while the original is up, use GitHub's **Sync fork** button or a scheduled sync. The site cannot be more current than the copy it reads.
- Only `https://` URLs are accepted. Invalid entries are ignored, with a warning in the logs.
- `GITHUB_TOKEN` is only sent to `raw.githubusercontent.com` and `api.github.com`, never to other hosts.
- When data comes from anything other than the official repo, the site says so on the main page and the charts page. For `https://` mirrors only the hostname is shown publicly, so a private path in the URL isn't revealed.
- Easy safety net: leave the primary unset and set `SOURCE_FALLBACKS` to your fork. The site uses NCSC-NL normally and switches automatically if it fails.

## Development

```bash
npm ci                      # installs the pinned toolchain (wrangler)
npm run dev                 # local preview at http://127.0.0.1:8788
npm test                    # Worker unit tests (no network needed)
npm run test:browser        # browser security tests; needs `npm run dev` running and
                            # `pip install playwright && python -m playwright install chromium`
npm run build:pages         # regenerate the content pages after editing tools/build_pages.py
```

## Command-line deployment (optional)

```bash
npm ci
npx wrangler login
npm run deploy                                         # wrangler pages deploy public --project-name php2list
npx wrangler pages secret put GITHUB_TOKEN --project-name php2list   # optional token
# optional mirror settings can also be set in the dashboard (see above)
```


## Settings

- **Privacy contact:** the Privacy page has a placeholder for the operator's contact details. Add them before relying on the page for GDPR purposes.
- **Refresh interval:** `CACHE_TTL` (seconds, default 1800) at the top of `public/_worker.js`.
- **Custom domain:** Pages project → Custom domains → Set up a custom domain.

## Licence

- **Code:** [MIT](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute.
- **Data:** the software list displayed by the site is © NCSC-NL and contributors under [EUPL-1.2](https://github.com/NCSC-NL/php2shell/blob/main/LICENSE) (TLP:CLEAR). It isn't included in this repository, and the MIT licence doesn't cover it. See [NOTICE.md](NOTICE.md).

Entries are investigation leads; verify against vendor advisories before acting. PHP2List is unofficial and not affiliated with NCSC-NL or php2shell.com.
