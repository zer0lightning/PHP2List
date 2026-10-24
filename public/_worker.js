// SPDX-License-Identifier: MIT
// PHP2List — Cloudflare Pages advanced-mode worker (_worker.js).
//
// Serves two read-only JSON endpoints on the same origin as the pages:
//   GET /api/software   the software list, parsed from the source repository's Markdown
//   GET /api/timeline   status history rebuilt from the source repository's changelog
//   GET /api/changes    recent status changes (from → to), newest first
//   GET /api/recent     the newest change per product only (compact; used by the main page)
//   GET /api/v1/...     the same three datasets as a documented public API (CORS enabled)
//   GET /feed.xml       Atom feed of status changes; ?v=<watchlist entry> narrows it
// Static pages are served directly by Pages (see _routes.json) and never run this code.
//
// Security model (see docs/SECURITY-REVIEW.md):
//   * Upstream Markdown is untrusted input: size-capped, row-capped, normalised and
//     validated here, and escaped again in the browser.
//   * Public responses never include secrets, full mirror URLs or raw upstream errors.
//   * GITHUB_TOKEN is only sent to raw.githubusercontent.com and api.github.com, and
//     requests carrying it never follow redirects.
//   * GitHub-friendly: each refresh first asks GitHub for the latest commit (one small
//     request). The list files are downloaded only when that commit has changed, and
//     rate-limit responses (403/429) pause refreshes for longer.
//   * Upstream fetches are coalesced and cached (stale-while-revalidate + failure
//     cooldown) so request floods cannot amplify into upstream traffic.
//
// Prebuilt data (recommended): a scheduled GitHub Action (.github/workflows/data.yml) builds
// software.json and timeline.json and writes them to a Workers KV namespace bound as DATA.
// The worker reads those first, re-validates them as untrusted input, and falls back to
// reading GitHub directly if they are missing, invalid or more than 3 hours old.
//
// Configuration (Pages → Settings → Variables and Secrets / Bindings):
//   DATA              optional KV namespace binding with the prebuilt JSON.
//   GITHUB_TOKEN      optional secret; higher GitHub rate limits.
//   SOURCE_PRIMARY    optional; "owner/repo", "owner/repo@branch" or an https:// base URL.
//   SOURCE_FALLBACKS  optional; comma-separated, same format, tried in order.
//   SOURCE_ARCHIVED   optional; "true" shows visitors that the source list is no longer updated.

// ---------------------------------------------------------------------------
// Limits (generous compared with today's data: ~55 KB per page, ~460 KB changelog, ~730 rows)
const LIMITS = Object.freeze({
  README_BYTES: 1_000_000,
  PAGE_BYTES: 2_000_000,
  CHANGELOG_BYTES: 10_000_000,
  ROWS: 20_000,
  EVENTS: 200_000,
  FIELD: 500,          // supplier, product, version
  STATUS: 40,
  NOTE: 4_000,
  NOTES: 20,
  LINKS: 20,
  LINK_LABEL: 100,
  URL: 2_000,
  LIST_UPDATED: 100,
  FETCH_TIMEOUT_MS: 10_000,
  KV_BYTES: 20_000_000,
  POINTS: 2_001,
  CHANGES: 1_000,      // change events kept (newest first)
  CHANGE_NOTE: 600,
  CHANGE_LINKS: 3,
  FEED_ENTRIES: 50,
  FEED_WATCH: 25,      // watchlist entries accepted by /feed.xml (bounds the matching work per request)
});

const CACHE_TTL = 1800;              // data considered fresh for 30 minutes
const STALE_TTL = 60 * 60 * 24 * 7;  // last good copy kept for 7 days
const KV_CACHE_TTL = 300;            // with prebuilt data: re-read KV every 5 minutes
const KV_MAX_AGE_S = 3 * 60 * 60;    // prebuilt data older than 3 hours is not trusted to be current
const COOLDOWN_S = 120;              // after an upstream failure, don't retry for 2 minutes
const RATE_LIMIT_COOLDOWN_S = 900;   // after GitHub says "too many requests", wait 15 minutes
const CACHE_VERSION = "v7";
const CHANGES_DAYS = 30;             // window for /api/changes   // bump to discard cached data after parser changes
const USER_AGENT = "PHP2List (+unofficial viewer of the NCSC-NL php2shell list)";

// ---------------------------------------------------------------------------
// Data sources
const DEFAULT_SOURCE = "NCSC-NL/php2shell@main";
const MAX_SOURCES = 5;

export function parseSource(spec) {
  spec = String(spec || "").trim();
  if (!spec || spec.length > 500) return null;
  const gh = spec.match(/^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})(?:@([A-Za-z0-9_./-]{1,200}))?$/);
  if (gh) {
    if (spec.includes("..") || /(^|\/)\.(\/|$)/.test(spec)) return null;
    const [, owner, repo, branch = "main"] = gh;
    return {
      label: `${owner}/${repo}@${branch}`,
      base: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`,
      web: `https://github.com/${owner}/${repo}/tree/${branch}/software`,
      github: true,
      repo: { owner, repo, branch },
    };
  }
  let u;
  try { u = new URL(spec); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.port) return null;
  const base = u.href.replace(/\/+$/, "");
  // Public label is the hostname only, so a mirror path (which may be unguessable) never leaks.
  return { label: u.hostname, base, web: `https://${u.hostname}/`, github: u.hostname === "raw.githubusercontent.com" };
}

export function sourcesFrom(env) {
  const specs = [env.SOURCE_PRIMARY || DEFAULT_SOURCE, ...String(env.SOURCE_FALLBACKS || "").split(/[\s,]+/)];
  const out = [], seen = new Set();
  for (const s of specs) {
    const src = parseSource(s);
    if (!src) { if (String(s || "").trim()) console.warn("Ignoring an invalid source setting"); continue; }
    if (seen.has(src.base)) continue;
    seen.add(src.base); out.push(src);
    if (out.length >= MAX_SOURCES) break;
  }
  if (!out.length) out.push(parseSource(DEFAULT_SOURCE));
  for (const s of out) { s.official = s.label === DEFAULT_SOURCE; s.id = hash(s.base); }
  return out;
}

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
const hasKv = (env) => !!(env && env.DATA && typeof env.DATA.get === "function");
const configId = (env) => hash(sourcesFrom(env).map((s) => s.base).join("|") + (hasKv(env) ? "|kv" : ""));

// Try each source in order; all files for one dataset come from the same source.
async function fromSources(env, fn, preferId) {
  let list = sourcesFrom(env);
  if (preferId) list = [...list.filter((s) => s.id === preferId), ...list.filter((s) => s.id !== preferId)];
  const errors = [];
  for (const src of list) {
    try { return await fn(src); }
    catch (err) { errors.push(err); console.warn(`Source ${src.label} failed: ${err.message}`); }
  }
  const e = new Error(errors.map((x) => x.message).join(" · "));
  e.rateLimited = errors.some((x) => x.rateLimited);
  throw e;
}

// ---------------------------------------------------------------------------
// Untrusted-text helpers
// C0/C1 controls, zero-width and bidirectional override characters are removed:
// they have no place in this data and can be used to disguise text.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
// The source Markdown sometimes contains simple HTML formatting tags (e.g. a trailing <br>).
// Only these known tags are removed, so text such as "<8.2.35" in version ranges is kept.
const HTML_TAG_RE = /<\/?(?:br|b|i|em|strong|code|sup|sub|span|p|div|small|u|s)\b[^<>]{0,200}>/gi;
export function cleanText(v, max) {
  const s = String(v ?? "").replace(HTML_TAG_RE, " ").replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
export function cleanUrl(raw) {
  if (typeof raw !== "string" || raw.length > LIMITS.URL) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return null;
  return u.href.length > LIMITS.URL ? null : u.href;
}

// ---------------------------------------------------------------------------
// Markdown parsing
const COLUMNS = ["Supplier", "Product", "Version (see Status)", "Status CVE-2026-109618", "Status CVE-2026-109619", "Notes", "Links"];

// Split a Markdown table row on unescaped pipes, then unescape "\|".
function splitRow(line) {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return t.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}

function parseLinks(cell) {
  const out = [];
  const re = /\[([^\]]{0,300})\]\(<?([^)>\s]{1,2100})>?\)/g;
  let m;
  while ((m = re.exec(cell)) && out.length < LIMITS.LINKS) {
    const url = cleanUrl(m[2]);
    if (url) out.push({ label: cleanText(m[1], LIMITS.LINK_LABEL) || "source", url });
  }
  return out;
}

export function parseTable(md, max = LIMITS.ROWS) {
  const rows = [];
  for (const line of String(md).split("\n")) {
    if (rows.length >= max) break;
    if (!line.startsWith("|")) continue;
    if (/^\|\s*:?-{2,}/.test(line)) continue;      // separator row
    if (/^\|\s*Supplier\s*\|/.test(line)) continue; // header row
    const c = splitRow(line);
    if (c.length < 7) continue;
    const supplier = cleanText(c[0], LIMITS.FIELD), product = cleanText(c[1], LIMITS.FIELD);
    if (!supplier && !product) continue;
    rows.push({
      supplier,
      product,
      version: cleanText(c[2], LIMITS.FIELD),
      s1: cleanText(c[3], LIMITS.STATUS),
      s2: cleanText(c[4], LIMITS.STATUS),
      notes: c[5].split(/<br\s*\/?>/i).map((s) => cleanText(s, LIMITS.NOTE)).filter(Boolean).slice(0, LIMITS.NOTES),
      links: parseLinks(c.slice(6).join("|")),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Upstream fetching with a byte cap and timeout
async function readCapped(res, maxBytes) {
  const declared = Number(res.headers.get("content-length"));
  if (declared && declared > maxBytes) { res.body?.cancel(); throw new Error(`file too large (${declared} bytes)`); }
  if (!res.body) return "";
  const reader = res.body.getReader(), chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new Error("file too large"); }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

function upstreamError(status, what) {
  const e = new Error(`HTTP ${status} for ${what}`);
  e.rateLimited = status === 429 || status === 403;
  return e;
}

// GET with the token attached only for GitHub hosts; redirects are not followed while the
// token is attached, so it can't be carried elsewhere. Falls back to an anonymous request
// if the token is rejected.
async function githubAwareGet(url, src, env, accept) {
  const token = src.github && env.GITHUB_TOKEN ? String(env.GITHUB_TOKEN) : null; // never sent to other hosts
  const base = { "user-agent": USER_AGENT, accept };
  const get = (headers, redirect) => fetch(url, { headers, redirect, signal: AbortSignal.timeout(LIMITS.FETCH_TIMEOUT_MS) });
  // With the token attached, redirects are not followed, so the token can't be carried elsewhere.
  let r = await get(token ? { ...base, authorization: `Bearer ${token}` } : base, token ? "manual" : "follow");
  if (token && (r.status === 401 || r.status === 403 || r.status === 404 || (r.status >= 300 && r.status < 400) || r.type === "opaqueredirect")) {
    console.warn(`Authenticated request not accepted (HTTP ${r.status}); retrying without the token`);
    r.body?.cancel();
    r = await get(base, "follow");
  }
  return r;
}

async function fetchText(src, path, env, maxBytes) {
  const r = await githubAwareGet(`${src.base}/${path}`, src, env, "text/plain, text/markdown, */*;q=0.1");
  if (!r.ok) { r.body?.cancel(); throw upstreamError(r.status, path); }
  return readCapped(r, maxBytes);
}

// The latest commit on the source branch (one small API request), or null if unknown.
// Used to skip downloading the list when nothing has changed.
export async function latestRevision(src, env) {
  if (!src.repo) return null;
  const { owner, repo, branch } = src.repo;
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`;
  try {
    const r = await githubAwareGet(url, { github: true }, env, "application/vnd.github.sha");
    if (!r.ok) { r.body?.cancel(); console.warn(`Revision check: HTTP ${r.status}`); return null; }
    const sha = (await readCapped(r, 200)).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch (err) { console.warn(`Revision check failed: ${err.message}`); return null; }
}

const LETTERS = ["0-9", ..."abcdefghijklmnopqrstuvwxyz"];

const archivedByConfig = (env) => String(env.SOURCE_ARCHIVED || "").trim().toLowerCase() === "true";
async function buildData(env, prev) {
  const out = await buildDataFrom(env, prev);
  if (archivedByConfig(env)) out.sourceArchived = true;
  return out;
}
async function buildDataFrom(env, prev) {
  if (hasKv(env)) {
    const kv = normaliseList(await readKv(env, "software.json"));
    if (kv) return kv;
    console.warn("Prebuilt software.json is missing, invalid or more than 3 hours old; reading GitHub instead");
    if (prev && prev.prebuilt) prev = null;     // don't reuse a prebuilt copy as a GitHub snapshot
  }
  return fromSources(env, async (src) => {
    const rev = await latestRevision(src, env);
    if (rev && prev && prev.sourceId === src.id && prev.sourceRevision === rev) {
      return { ...prev, fetchedAt: new Date().toISOString() };     // unchanged: no downloads
    }
    // Read every file from that exact commit, so the list is one consistent snapshot.
    if (rev) src = { ...src, base: `https://raw.githubusercontent.com/${src.repo.owner}/${src.repo.repo}/${rev}` };
    const [readme, ...pages] = await Promise.all([
      fetchText(src, "README.md", env, LIMITS.README_BYTES),
      ...LETTERS.map((l) => fetchText(src, `software/software_list_${l}.md`, env, LIMITS.PAGE_BYTES)),
    ]);
    return buildListFromFiles(readme, pages, src, rev);
  });
}

// Builds the list from the README and the 27 alphabetical pages. Shared with the
// GitHub Action that prebuilds the data (tools/build-data.mjs).
const LIST_FILES = ["README.md", ...LETTERS.map((l) => `software/software_list_${l}.md`)];
const CHANGELOG_FILE = "software/changelog_software_list.md";
export function buildListFromFiles(readme, pages, src, rev = null, now = Date.now()) {
  const items = [];
  for (const p of pages) { items.push(...parseTable(p, LIMITS.ROWS - items.length)); if (items.length >= LIMITS.ROWS) break; }
  if (!items.length) throw new Error("no rows parsed");
  assignIds(items);
  const m = String(readme).match(/Software list last status update:\s*([^\n]{1,200})/);
  return {
    apiVersion: 1,
    source: src.web,
    sourceLabel: src.label,
    sourceId: src.id,
    sourceRevision: rev,
    official: src.official,
    sourceArchived: false,
    columns: COLUMNS,
    listUpdated: m ? cleanText(m[1], LIMITS.LIST_UPDATED) : null,
    fetchedAt: new Date(now).toISOString(),
    count: items.length,
    items,
  };
}

// ---------------------------------------------------------------------------
// Product IDs: short, stable, URL-safe names used for product links and the public API,
// e.g. "cisco--cisco-meraki-dashboard". Always computed here, never taken from input.
function slug(s, max) {
  return String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, max).replace(/-+$/, "");
}
export function productId(supplier, product) {
  return `${slug(supplier, 60) || "x" + hash(String(supplier))}--${slug(product, 70) || "x" + hash(String(product))}`;
}
const ID_RE = /^[a-z0-9][a-z0-9-]{0,150}$/;
function assignIds(items) {
  const used = new Set();
  for (const it of items) {
    const base = productId(it.supplier, it.product);
    let id = base, n = 1;
    while (used.has(id)) id = `${base}-${++n}`;
    used.add(id);
    it.id = id;
  }
  return items;
}

// ---------------------------------------------------------------------------
// Prebuilt data from Workers KV. Treated as untrusted: every field is checked and
// cleaned again, exactly as if it had been parsed from the Markdown.
const SHA_RE = /^[0-9a-f]{40}$/;
async function readKv(env, key) {
  if (!hasKv(env)) return null;
  try {
    const text = await env.DATA.get(key);
    if (typeof text !== "string" || !text || text.length > LIMITS.KV_BYTES) return null;
    return JSON.parse(text);
  } catch (err) { console.warn(`Reading ${key} from KV failed: ${err.message}`); return null; }
}
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function freshIso(v, now) {
  const t = Date.parse(v);
  return Number.isFinite(t) && t <= now + 5 * 60e3 && now - t <= KV_MAX_AGE_S * 1000 ? new Date(t).toISOString() : null;
}
function sourceFields(j) {
  return {
    source: cleanUrl(j.source) || "https://github.com/NCSC-NL/php2shell/tree/main/software",
    sourceLabel: cleanText(j.sourceLabel, LIMITS.FIELD) || "unknown",
    sourceId: cleanText(j.sourceId, 20),
    sourceRevision: typeof j.sourceRevision === "string" && SHA_RE.test(j.sourceRevision) ? j.sourceRevision : null,
    official: j.official === true,
  };
}
export function normaliseList(j, now = Date.now()) {
  if (!isObj(j) || !Array.isArray(j.items)) return null;
  const fetchedAt = freshIso(j.fetchedAt, now);
  if (!fetchedAt) return null;
  const items = [];
  for (const r of j.items.slice(0, LIMITS.ROWS)) {
    if (!isObj(r)) continue;
    const supplier = cleanText(r.supplier, LIMITS.FIELD), product = cleanText(r.product, LIMITS.FIELD);
    if (!supplier && !product) continue;
    const links = [];
    for (const l of Array.isArray(r.links) ? r.links.slice(0, LIMITS.LINKS) : []) {
      const url = isObj(l) ? cleanUrl(l.url) : null;
      if (url) links.push({ label: cleanText(l.label, LIMITS.LINK_LABEL) || "source", url });
    }
    items.push({
      supplier, product,
      version: cleanText(r.version, LIMITS.FIELD),
      s1: cleanText(r.s1, LIMITS.STATUS),
      s2: cleanText(r.s2, LIMITS.STATUS),
      notes: (Array.isArray(r.notes) ? r.notes.slice(0, LIMITS.NOTES) : []).map((n) => cleanText(n, LIMITS.NOTE)).filter(Boolean),
      links,
    });
  }
  if (!items.length) return null;
  assignIds(items);
  return {
    apiVersion: 1,
    ...sourceFields(j),
    sourceArchived: j.sourceArchived === true,
    columns: COLUMNS,
    listUpdated: j.listUpdated == null ? null : cleanText(j.listUpdated, LIMITS.LIST_UPDATED) || null,
    fetchedAt,
    prebuilt: true,
    count: items.length,
    items,
  };
}
export function normaliseTimeline(j, now = Date.now()) {
  if (!isObj(j) || !Array.isArray(j.points) || !j.points.length || j.points.length > LIMITS.POINTS) return null;
  const generatedAt = freshIso(j.generatedAt, now);
  if (!generatedAt) return null;
  const num = (v) => (Number.isFinite(v) && v >= 0 && v <= 1e7 ? Math.floor(v) : null);
  const points = [];
  for (const p of j.points) {
    if (!isObj(p)) return null;
    const t = Date.parse(p.t);
    if (!Number.isFinite(t)) return null;
    const q = { t: new Date(t).toISOString(), total: num(p.total), Unknown: num(p.Unknown) };
    for (const st of BUCKET_STATUSES) q[st] = num(p[st]);
    if (Object.values(q).some((v) => v === null)) return null;
    points.push(q);
  }
  const step = Number(j.stepHours), first = Date.parse(j.firstEntry);
  if (![1, 6, 24].includes(step) || !Number.isFinite(first)) return null;
  return {
    apiVersion: 1,
    disclosure: DISCLOSURE,
    firstEntry: new Date(first).toISOString(),
    stepHours: step,
    statuses: BUCKET_STATUSES,
    listUpdated: j.listUpdated == null ? null : cleanText(j.listUpdated, LIMITS.LIST_UPDATED) || null,
    generatedAt,
    points,
    ...sourceFields(j),
    prebuilt: true,
  };
}

// ---------------------------------------------------------------------------
// Cache: stale-while-revalidate with single-flight refresh and failure cooldown.
const inflight = new Map();   // per-isolate: cache key -> Promise of a fresh body
const cooldownUntil = new Map();
// Test hook: forget per-isolate refresh state between tests.
export function _resetState() { inflight.clear(); cooldownUntil.clear(); }

function jsonResponse(body, maxAge, extra = {}) {
  return new Response(body, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${maxAge}`, ...extra },
  });
}

export async function cached(name, build, env, ctx, origin, now = Date.now) {
  const cache = caches.default;
  const key = `${origin}/api/__cache/${CACHE_VERSION}/${configId(env)}/${name}`;
  const coolKey = `${key}/cooldown`;

  const refresh = (prevText) => {
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        let prev = null;
        try { prev = prevText ? JSON.parse(prevText) : null; } catch { prev = null; }
        const body = JSON.stringify(await build(prev));
        await cache.put(key, jsonResponse(body, STALE_TTL, { "x-fetched-at": String(now()) }));
        cooldownUntil.delete(key);
        await cache.delete(coolKey).catch(() => {});   // upstream recovered: clear the failure marker
        return body;
      } catch (err) {
        const wait = err && err.rateLimited ? RATE_LIMIT_COOLDOWN_S : COOLDOWN_S;
        cooldownUntil.set(key, now() + wait * 1000);
        await cache.put(coolKey, jsonResponse("1", wait)).catch(() => {});
        throw err;
      } finally { inflight.delete(key); }
    })();
    inflight.set(key, p);
    return p;
  };
  const coolingDown = async () => (cooldownUntil.get(key) || 0) > now() || !!(await cache.match(coolKey));

  const hit = await cache.match(key);
  if (hit) {
    const body = await hit.text();
    const age = (now() - Number(hit.headers.get("x-fetched-at") || 0)) / 1000;
    const ttl = hasKv(env) ? KV_CACHE_TTL : CACHE_TTL;
    if (age < ttl) return { body, state: "HIT" };
    // Expired: serve the saved copy now and refresh in the background (unless upstream is failing).
    const failing = await coolingDown();
    if (!failing) ctx.waitUntil(refresh(body).catch((e) => console.warn(`Background refresh failed: ${e.message}`)));
    return { body, state: failing || age > ttl * 4 ? "STALE" : "REVALIDATING" };
  }
  if (await coolingDown()) throw new Error("upstream cooling down after a recent failure");
  return { body: await refresh(), state: "MISS" };
}

const PUBLIC_ERROR = JSON.stringify({ error: "The software list is temporarily unavailable.", code: "UPSTREAM_UNAVAILABLE" });
function errorResponse(err) {
  console.warn(`Serving error response: ${err && err.message}`); // details stay in the logs
  return new Response(PUBLIC_ERROR, { status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "retry-after": "120" } });
}

const getList = (env, ctx, origin) => cached("list", (prev) => buildData(env, prev), env, ctx, origin);


// ---------------------------------------------------------------------------
// Timeline: rebuilt from software/changelog_software_list.md. For each time bucket we take
// each product's most recent status and count products by the less-resolved of its two CVE
// statuses. Only products still in the current list are counted, so the last point matches it.
const DISCLOSURE = "2026-10-21T00:00:00+02:00"; // PHP fixed releases + advisory, 21 Oct 2026
const SEVERITY = Object.freeze(Object.assign(Object.create(null), { "Vulnerable": 0, "Workaround": 1, "Investigation": 2, "Fix": 3, "Not vuln": 4 }));
const BUCKET_STATUSES = ["Vulnerable", "Workaround", "Investigation", "Fix", "Not vuln"];
const known = (s) => typeof s === "string" && Object.hasOwn(SEVERITY, s);
const worstOf = (a, b) => {
  const x = known(a) ? SEVERITY[a] : 9, y = known(b) ? SEVERITY[b] : 9;
  const w = x <= y ? a : b;
  return known(w) ? w : "Unknown";
};
const keyOf = (supplier, product) => `${supplier}\u0000${product}`.toLowerCase();

// Changelog rows with full detail (for /api/changes). Columns: date, supplier, product,
// version, status 109618, status 109619, notes, links.
export function parseChangelogRows(md, max = LIMITS.EVENTS) {
  const out = [];
  for (const line of String(md).split("\n")) {
    if (out.length >= max) break;
    if (!/^\|\d{4}-\d{2}-\d{2} /.test(line)) continue;
    const c = splitRow(line);
    if (c.length < 6) continue;
    const m = c[0].match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/);
    if (!m) continue;
    const t = Date.parse(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`);
    if (Number.isNaN(t)) continue;
    const supplier = cleanText(c[1], LIMITS.FIELD), product = cleanText(c[2], LIMITS.FIELD);
    if (!supplier && !product) continue;
    out.push({
      t, supplier, product,
      version: cleanText(c[3], LIMITS.FIELD),
      s1: cleanText(c[4], LIMITS.STATUS),
      s2: cleanText(c[5], LIMITS.STATUS),
      note: cleanText(String(c[6] ?? "").split(/<br\s*\/?>/i)[0], LIMITS.CHANGE_NOTE),
      links: parseLinks(c.slice(7).join("|")).slice(0, LIMITS.CHANGE_LINKS),
    });
  }
  return out;
}

// Status changes for products that are still in the list, newest first. Each event says what
// the status was before ("prev"); prev is null when the product was first added.
export function buildChangesFrom(changelogMd, list, now = Date.now()) {
  const ids = new Map();
  for (const it of list.items) { const k = keyOf(it.supplier, it.product); if (!ids.has(k)) ids.set(k, it.id); }
  const rows = parseChangelogRows(changelogMd).filter((r) => r.t <= now).sort((a, b) => a.t - b.t);
  const since = now - CHANGES_DAYS * 86_400_000;
  const prevOf = new Map(), events = [];
  for (const r of rows) {
    const key = keyOf(r.supplier, r.product);
    const before = prevOf.get(key) || null;
    prevOf.set(key, { s1: r.s1, s2: r.s2 });
    if (r.t < since || !ids.has(key)) continue;
    if (before && before.s1 === r.s1 && before.s2 === r.s2) continue;     // no status change
    events.push({ t: new Date(r.t).toISOString(), id: ids.get(key), supplier: r.supplier, product: r.product,
      version: r.version, s1: r.s1, s2: r.s2, prev: before, note: r.note, links: r.links });
  }
  events.reverse();
  if (events.length > LIMITS.CHANGES) events.length = LIMITS.CHANGES;
  return { apiVersion: 1, days: CHANGES_DAYS, listUpdated: list.listUpdated, generatedAt: new Date(now).toISOString(), count: events.length, events };
}

export function normaliseChanges(j, now = Date.now()) {
  if (!isObj(j) || !Array.isArray(j.events) || j.events.length > LIMITS.CHANGES) return null;
  const generatedAt = freshIso(j.generatedAt, now);
  if (!generatedAt) return null;
  const st = (v) => cleanText(v, LIMITS.STATUS);
  const events = [];
  for (const e of j.events) {
    if (!isObj(e)) return null;
    const t = Date.parse(e.t);
    if (!Number.isFinite(t) || typeof e.id !== "string" || !ID_RE.test(e.id)) return null;
    const links = [];
    for (const l of Array.isArray(e.links) ? e.links.slice(0, LIMITS.CHANGE_LINKS) : []) {
      const url = isObj(l) ? cleanUrl(l.url) : null;
      if (url) links.push({ label: cleanText(l.label, LIMITS.LINK_LABEL) || "source", url });
    }
    events.push({ t: new Date(t).toISOString(), id: e.id, supplier: cleanText(e.supplier, LIMITS.FIELD), product: cleanText(e.product, LIMITS.FIELD),
      version: cleanText(e.version, LIMITS.FIELD), s1: st(e.s1), s2: st(e.s2),
      prev: isObj(e.prev) ? { s1: st(e.prev.s1), s2: st(e.prev.s2) } : null,
      note: cleanText(e.note, LIMITS.CHANGE_NOTE), links });
  }
  return {
    apiVersion: 1, days: CHANGES_DAYS,
    listUpdated: j.listUpdated == null ? null : cleanText(j.listUpdated, LIMITS.LIST_UPDATED) || null,
    generatedAt, count: events.length, events, ...sourceFields(j), prebuilt: true,
  };
}

export function parseChangelog(md, max = LIMITS.EVENTS) {
  const out = [];
  for (const line of String(md).split("\n")) {
    if (out.length >= max) break;
    if (!/^\|\d{4}-\d{2}-\d{2} /.test(line)) continue;
    const c = splitRow(line);
    if (c.length < 6) continue;
    const m = c[0].match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/);
    if (!m) continue;
    const t = Date.parse(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`);
    if (Number.isNaN(t)) continue;
    out.push({ t, key: keyOf(cleanText(c[1], LIMITS.FIELD), cleanText(c[2], LIMITS.FIELD)), status: worstOf(c[4], c[5]) });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function buildTimelineFrom(changelogMd, list, now = Date.now()) {
  const current = new Map(list.items.map((r) => [keyOf(r.supplier, r.product), worstOf(r.s1, r.s2)]));
  const events = parseChangelog(changelogMd).filter((e) => current.has(e.key) && e.t <= now);
  if (!events.length) throw new Error("no dated entries in the changelog");
  const start = Math.min(Date.parse(DISCLOSURE), events[0].t);
  const spanH = (now - start) / 3.6e6;
  const step = (spanH <= 72 ? 1 : spanH <= 24 * 14 ? 6 : 24) * 3.6e6;
  const status = new Map();
  const points = [];
  let i = 0;
  const snapshot = (t) => {
    const p = { t: new Date(t).toISOString(), total: status.size, Unknown: 0 };
    for (const s of BUCKET_STATUSES) p[s] = 0;
    for (const s of status.values()) p[s] += 1;   // s is always a bucket status or "Unknown"
    points.push(p);
  };
  for (let t = start; t < now && points.length < 2000; t += step) {
    while (i < events.length && events[i].t <= t) { status.set(events[i].key, events[i].status); i++; }
    snapshot(t);
  }
  while (i < events.length) { status.set(events[i].key, events[i].status); i++; }
  for (const [k, s] of current) status.set(k, s);   // final point = the current list
  snapshot(now);
  return {
    apiVersion: 1,
    disclosure: DISCLOSURE,
    firstEntry: new Date(events[0].t).toISOString(),
    stepHours: step / 3.6e6,
    statuses: BUCKET_STATUSES,
    listUpdated: list.listUpdated,
    generatedAt: new Date(now).toISOString(),
    points,
  };
}

// Timeline and changes are both derived from the changelog. Prebuilt copies in KV are used
// first; otherwise the changelog is read from the same commit as the list.
function derived(name, kvKey, normalise, buildFrom, env, ctx, origin) {
  return cached(name, async (prev) => {
    if (hasKv(env)) {
      const kv = normalise(await readKv(env, kvKey));
      if (kv) return kv;
      console.warn(`Prebuilt ${kvKey} is missing, invalid or more than 3 hours old; reading GitHub instead`);
      if (prev && prev.prebuilt) prev = null;
    }
    const list = JSON.parse((await getList(env, ctx, origin)).body);
    // Same commit as last time: the changelog hasn't changed, so don't download it again.
    if (prev && list.sourceRevision && prev.sourceRevision === list.sourceRevision && prev.sourceId === list.sourceId) return prev;
    return fromSources(env, async (src) => {
      // Read the changelog from the same commit as the list when it came from this source.
      if (src.repo && list.sourceRevision && src.id === list.sourceId) src = { ...src, base: `https://raw.githubusercontent.com/${src.repo.owner}/${src.repo.repo}/${list.sourceRevision}` };
      const md = await fetchText(src, CHANGELOG_FILE, env, LIMITS.CHANGELOG_BYTES);
      return { ...buildFrom(md, list), sourceLabel: src.label, sourceId: list.sourceId, sourceRevision: list.sourceRevision, official: src.official };
    }, list.sourceId);
  }, env, ctx, origin);
}
const getTimelineBody = (env, ctx, origin) => derived("timeline", "timeline.json", normaliseTimeline, buildTimelineFrom, env, ctx, origin);
const getChangesBody = (env, ctx, origin) => derived("changes", "changes.json", normaliseChanges, buildChangesFrom, env, ctx, origin);

// Compact version for the main page: only the newest change per product, without notes or links
// (about a tenth of the size). Rebuilt from the cached changes whenever those are refreshed.
export function recentFrom(changes) {
  const seen = new Set(), events = [];
  for (const e of changes.events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    events.push({ t: e.t, id: e.id, s1: e.s1, s2: e.s2, prev: e.prev });
  }
  return { apiVersion: 1, generatedAt: changes.generatedAt, count: events.length, events };
}
const getRecentBody = (env, ctx, origin) => cached("recent", async () => recentFrom(JSON.parse((await getChangesBody(env, ctx, origin)).body)), env, ctx, origin);

async function respond(getBody, env, ctx, origin) {
  try {
    const { body, state } = await getBody(env, ctx, origin);
    return jsonResponse(body, 300, { "x-data-cache": state });
  } catch (err) { return errorResponse(err); }
}

// ---------------------------------------------------------------------------
// Atom feed of status changes, optionally narrowed to a watchlist (?v=..., same entries
// as on the site: "s:Supplier", "p:Supplier::Product" or a keyword). Everything is
// escaped for XML and all text uses type="text", so nothing in it is rendered as HTML.
const XML_BAD = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;
const xml = (v) => String(v ?? "").replace(XML_BAD, "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
export function cleanEntry(v) {
  const s = String(v ?? "").replace(CONTROL_RE, "").replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "");
  return s.slice(0, /^[sp]:/.test(s) ? 240 : 80);
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function watchMatcher(entries) {
  const suppliers = new Set(), products = new Set(), words = [];
  for (const v of entries) {
    if (v.startsWith("s:") && v.length > 2) { suppliers.add(v.slice(2).toLowerCase()); continue; }
    if (v.startsWith("p:")) {
      const i = v.indexOf("::", 2);
      if (i > 2 && i + 2 < v.length) { products.add(`${v.slice(2, i)}\u0000${v.slice(i + 2)}`.toLowerCase()); continue; }
    }
    words.push(escRe(v.toLowerCase()));
  }
  // All keywords in one pattern, each matched as a whole word or phrase.
  const re = words.length ? new RegExp("(^|[^\\p{L}\\p{N}])(?:" + words.join("|") + ")($|[^\\p{L}\\p{N}])", "u") : null;
  if (!entries.length) return () => true;
  return (e) => {
    const sup = e.supplier.toLowerCase(), prod = e.product.toLowerCase();
    return suppliers.has(sup) || products.has(`${sup}\u0000${prod}`) || (re !== null && re.test(`${sup} ${prod}`));
  };
}
const CVE1 = "CVE-2026-109618", CVE2 = "CVE-2026-109619";
export function changeSummary(e) {
  const st = (v) => v || "no status";
  if (!e.prev) return e.s1 === e.s2 ? `Added: ${st(e.s1)}` : `Added: ${CVE1} ${st(e.s1)}, ${CVE2} ${st(e.s2)}`;
  if (e.s1 === e.s2 && e.prev.s1 === e.prev.s2) return `${st(e.prev.s1)} → ${st(e.s1)}`;
  const parts = [];
  if (e.prev.s1 !== e.s1) parts.push(`${CVE1} ${st(e.prev.s1)} → ${st(e.s1)}`);
  if (e.prev.s2 !== e.s2) parts.push(`${CVE2} ${st(e.prev.s2)} → ${st(e.s2)}`);
  return parts.join("; ");
}
export function buildFeed(changes, origin, entries) {
  const host = new URL(origin).hostname;
  const match = watchMatcher(entries);
  const events = [];
  for (const e of changes.events) { if (match(e)) { events.push(e); if (events.length >= LIMITS.FEED_ENTRIES) break; } }
  const qs = entries.map((v) => "v=" + encodeURIComponent(v)).join("&");
  const self = `${origin}/feed.xml${qs ? "?" + qs : ""}`;
  const updated = events[0]?.t || changes.generatedAt;
  const out = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `<title>${xml(entries.length ? "PHP2List: status changes for your watchlist" : "PHP2List: PHP2Shell status changes")}</title>`,
    `<subtitle>${xml("Status changes in the NCSC-NL php2shell software list. PHP2List is an unofficial site, not affiliated with NCSC-NL or php2shell.com. Accuracy is not guaranteed.")}</subtitle>`,
    `<link rel="self" type="application/atom+xml" href="${xml(self)}"/>`,
    `<link rel="alternate" type="text/html" href="${xml(origin + "/changes")}"/>`,
    `<id>${xml(`tag:${host},2026:feed:${hash(entries.join("\n").toLowerCase())}`)}</id>`,
    `<updated>${xml(updated)}</updated>`,
    `<author><name>PHP2List (unofficial)</name></author>`,
  ];
  for (const e of events) {
    const body = [
      changeSummary(e),
      e.version ? `Version (see status): ${e.version}` : "",
      `${CVE1}: ${e.s1 || "no status"} · ${CVE2}: ${e.s2 || "no status"}`,
      e.note,
      ...e.links.map((l) => `${l.label}: ${l.url}`),
      "Source: NCSC-NL php2shell software list. Unofficial copy; verify with the vendor.",
    ].filter(Boolean).join("\n\n");
    out.push("<entry>",
      `<title>${xml(`${e.product} (${e.supplier}): ${changeSummary(e)}`)}</title>`,
      `<link rel="alternate" type="text/html" href="${xml(`${origin}/#p=${e.id}`)}"/>`,
      `<id>${xml(`tag:${host},2026:change:${e.id}:${Date.parse(e.t)}`)}</id>`,
      `<updated>${xml(e.t)}</updated>`,
      `<content type="text">${xml(body)}</content>`,
      "</entry>");
  }
  out.push("</feed>");
  return out.join("\n");
}
// Someone opening the feed address in a browser tab gets a readable "how to subscribe" page
// instead of raw XML. Browsers mark tab navigations with Sec-Fetch-Dest: document; feed readers
// (and scripts) don't, so they still receive the feed. ?view=xml shows the raw feed anyway.
export function isBrowserNavigation(request, url) {
  return request.headers.get("sec-fetch-dest") === "document" && request.headers.get("sec-fetch-mode") === "navigate" && !url.searchParams.has("view");
}
function subscribeRedirect(url) {
  const qs = url.searchParams.getAll("v").map(cleanEntry).filter(Boolean).slice(0, LIMITS.FEED_WATCH).map((v) => "v=" + encodeURIComponent(v)).join("&");
  return new Response(null, { status: 303, headers: { location: "/subscribe" + (qs ? "?" + qs : ""), "cache-control": "no-store", vary: "Sec-Fetch-Dest, Sec-Fetch-Mode" } });
}
async function getFeed(url, env, ctx) {
  const entries = [...new Set(url.searchParams.getAll("v").map(cleanEntry).filter(Boolean))].slice(0, LIMITS.FEED_WATCH);
  const cache = caches.default;
  // The cache key is a hash of the normalised watchlist, so long or random lists can't create huge keys.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(entries.map((v) => v.toLowerCase()).sort().join("\n")));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = `${url.origin}/api/__cache/${CACHE_VERSION}/${configId(env)}/feed/${hex}`;
  const hit = await cache.match(key);
  if (hit) return feedResponse(await hit.text());
  try {
    const { body } = await getChangesBody(env, ctx, url.origin);
    const feed = buildFeed(JSON.parse(body), url.origin, entries);
    ctx.waitUntil(cache.put(key, new Response(feed, { headers: { "cache-control": "public, max-age=300" } })).catch(() => {}));
    return feedResponse(feed);
  } catch (err) { return errorResponse(err); }
}
const feedResponse = (feed) => new Response(feed, { headers: { "content-type": "application/atom+xml; charset=utf-8", "cache-control": "public, max-age=300", vary: "Sec-Fetch-Dest, Sec-Fetch-Mode" } });

// ---------------------------------------------------------------------------
// Security headers. Static files get the same set from public/_headers.
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const API_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";

function withSecurityHeaders(res, csp) {
  const out = new Response(res.body, res);
  const h = out.headers;
  h.set("content-security-policy", csp);
  h.set("strict-transport-security", "max-age=31536000");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "no-referrer");
  h.set("x-frame-options", "DENY");
  h.set("cross-origin-opener-policy", "same-origin");
  h.set("cross-origin-resource-policy", "same-origin");
  h.set("permissions-policy", "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()");
  return out;
}

// Test hooks. The Workers runtime only accepts functions as named exports, so constants
// are exposed through this function rather than exported directly.
export function _internals() {
  return { LIMITS, COLUMNS, PAGE_CSP, API_CSP, worstOf, CACHE_TTL, STALE_TTL, COOLDOWN_S, RATE_LIMIT_COOLDOWN_S, KV_CACHE_TTL, KV_MAX_AGE_S, LIST_FILES, CHANGELOG_FILE };
}

// Public API index (/api/v1): what's available and where the documentation is.
function apiIndex(origin) {
  return JSON.stringify({
    apiVersion: 1,
    name: "PHP2List public API (unofficial)",
    docs: `${origin}/api-docs`,
    endpoints: {
      software: `${origin}/api/v1/software`,
      timeline: `${origin}/api/v1/timeline`,
      changes: `${origin}/api/v1/changes`,
      feed: `${origin}/feed.xml`,
    },
    data: "NCSC-NL php2shell software list (EUPL-1.2, TLP:CLEAR). PHP2List is not affiliated with NCSC-NL. Accuracy is not guaranteed.",
  }, null, 2);
}

const ROUTES = {
  software: (env, ctx, origin) => respond(getList, env, ctx, origin),
  timeline: (env, ctx, origin) => respond(getTimelineBody, env, ctx, origin),
  changes: (env, ctx, origin) => respond(getChangesBody, env, ctx, origin),
};
// Used by the site only (not part of the public /api/v1).
const INTERNAL = { recent: (env, ctx, origin) => respond(getRecentBody, env, ctx, origin) };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, HEAD, OPTIONS", "access-control-max-age": "86400" };

function finish(res, { cors = false } = {}) {
  const out = withSecurityHeaders(res, API_CSP);
  out.headers.set("x-robots-tag", "noindex");
  if (cors) {
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    out.headers.set("cross-origin-resource-policy", "cross-origin");   // public data, no credentials
  }
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const v1 = path === "/api/v1" || path.startsWith("/api/v1/");
    const isApi = path === "/api" || path.startsWith("/api/") || path === "/feed.xml";
    if (isApi) {
      const cors = v1 || path === "/feed.xml";
      if (request.method === "OPTIONS" && cors) return finish(new Response(null, { status: 204 }), { cors });
      if (request.method !== "GET" && request.method !== "HEAD") {
        return finish(new Response("Method not allowed", { status: 405, headers: { allow: cors ? "GET, HEAD, OPTIONS" : "GET, HEAD", "content-type": "text/plain; charset=utf-8" } }), { cors });
      }
      if (path === "/feed.xml") return finish(isBrowserNavigation(request, url) ? subscribeRedirect(url) : await getFeed(url, env, ctx), { cors });
      if (path === "/api/v1") return finish(new Response(apiIndex(url.origin), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600" } }), { cors });
      const name = v1 ? path.slice("/api/v1/".length) : path.slice("/api/".length);
      if (Object.hasOwn(ROUTES, name)) return finish(await ROUTES[name](env, ctx, url.origin), { cors });
      if (!v1 && Object.hasOwn(INTERNAL, name)) return finish(await INTERNAL[name](env, ctx, url.origin));
      return finish(new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json; charset=utf-8" } }), { cors });
    }
    // Normally unreachable (_routes.json sends only /api/* and /feed.xml here); kept as a safe fallback.
    return withSecurityHeaders(await env.ASSETS.fetch(request), PAGE_CSP);
  },
};
