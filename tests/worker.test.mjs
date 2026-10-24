// SPDX-License-Identifier: MIT
// Unit tests for public/_worker.js. Run with:  npm test   (Node 20+, no dependencies)
// Each block names the finding from docs/SECURITY-REVIEW.md that it guards.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import worker, { parseSource, sourcesFrom, cleanText, cleanUrl, parseTable, parseChangelog, buildTimelineFrom, cached, _internals, _resetState, buildListFromFiles, normaliseList, normaliseTimeline, productId, buildChangesFrom, normaliseChanges, buildFeed, watchMatcher, cleanEntry, changeSummary } from "../public/_worker.js";

const root = new URL("..", import.meta.url);
const { LIMITS, PAGE_CSP, worstOf } = _internals();

// ---------------------------------------------------------------- test doubles
class FakeCache {
  constructor() { this.store = new Map(); }
  async match(key) { const r = this.store.get(String(key)); return r ? r.clone() : undefined; }
  async put(key, res) { this.store.set(String(key), res.clone()); }
  async delete(key) { return this.store.delete(String(key)); }
}
function installCache() { const c = new FakeCache(); globalThis.caches = { default: c }; _resetState(); return c; }
function ctx() { const pending = []; return { pending, waitUntil: (p) => pending.push(p), settle: () => Promise.allSettled(pending) }; }

const TABLE_HEAD = "| Supplier | Product | Version (see Status) | Status CVE-2026-109618 | Status CVE-2026-109619 | Notes | Links |\n|:--|:--|:--:|:--:|:--:|:--|--:|\n";
const row = (s, p, st = "Vulnerable", link = "[source](<https://example.org/a>)") => `|${s}|${p}||${st}|${st}|note|${link}|\n`;

// ---------------------------------------------------------------- source configuration
describe("source configuration (F-05, SSRF hardening)", () => {
  test("accepts GitHub shorthands", () => {
    assert.equal(parseSource("NCSC-NL/php2shell").base, "https://raw.githubusercontent.com/NCSC-NL/php2shell/main");
    assert.equal(parseSource("me/fork@mirror-2026").base, "https://raw.githubusercontent.com/me/fork/mirror-2026");
    assert.equal(parseSource("me/fork").github, true);
  });
  test("rejects unsafe or ambiguous values", () => {
    for (const bad of ["http://plain.example/x", "https://u:p@host.example/x", "https://h.example/x?q=1", "https://h.example/x#f",
      "https://h.example:8443/x", "javascript:alert(1)", "../../etc", "a/b@../../x", "./repo", "a/./b", "", " ", "x".repeat(600)]) {
      assert.equal(parseSource(bad), null, `should reject ${bad}`);
    }
  });
  test("URL mirrors expose only their hostname publicly", () => {
    const s = parseSource("https://mirror.example.org/secret-path-123/php2shell");
    assert.equal(s.label, "mirror.example.org");
    assert.ok(!s.web.includes("secret-path-123"));
    assert.equal(s.github, false);
  });
  test("falls back to the official source and caps the list", () => {
    assert.deepEqual(sourcesFrom({}).map((s) => s.label), ["NCSC-NL/php2shell@main"]);
    assert.equal(sourcesFrom({}).at(0).official, true);
    const many = sourcesFrom({ SOURCE_FALLBACKS: Array.from({ length: 20 }, (_, i) => `o${i}/r`).join(",") });
    assert.equal(many.length, 5);
    assert.deepEqual(sourcesFrom({ SOURCE_PRIMARY: "http://bad" }).map((s) => s.label), ["NCSC-NL/php2shell@main"]);
  });
});

// ---------------------------------------------------------------- untrusted text
describe("untrusted upstream content (F-03)", () => {
  test("cleanText strips control, zero-width and bidi-override characters and caps length", () => {
    assert.equal(cleanText("a\u0000b‮c⁦d​e﻿", 100), "a b c d e");
    assert.equal(cleanText("x".repeat(50), 10).length, 10);
    assert.equal(cleanText(undefined, 10), "");
    assert.equal(cleanText({ toString: () => "obj" }, 10), "obj");
  });
  test("cleanText removes simple HTML tags but keeps comparison operators in version text", () => {
    assert.equal(cleanText("23 October 2026 00:48 CEST<br>", 100), "23 October 2026 00:48 CEST");
    assert.equal(cleanText("a<br/>b<BR >c <b>bold</b>", 100), "a b c bold");
    assert.equal(cleanText(">=5.4.0 before fix; branches <8.2.35, <8.3.36", 100), ">=5.4.0 before fix; branches <8.2.35, <8.3.36");
    assert.equal(cleanText("x <script>alert(1)</script>", 100), "x <script>alert(1)</script>");  // not stripped: escaped by the browser instead
  });
  test("listUpdated from the README loses a trailing <br>", async () => {
    installCache();
    const files = siteFiles(row("Acme", "Widget"));
    files["README.md"] = "Software list last status update: 23 October 2026 00:48 CEST<br>\n";
    mockUpstream((u) => files[u.replace(/^https:\/\/raw\.githubusercontent\.com\/NCSC-NL\/php2shell\/main\//, "")], []);
    const j = await (await worker.fetch(req("/api/software"), env0, ctx())).json();
    assert.equal(j.listUpdated, "23 October 2026 00:48 CEST");
  });
  test("cleanUrl allows only http(s) without credentials", () => {
    assert.equal(cleanUrl("https://example.org/a"), "https://example.org/a");
    assert.equal(cleanUrl("http://example.org/a"), "http://example.org/a");
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "vbscript:x", "file:///etc/passwd",
      "https://user:pw@example.org/", "//example.org", "not a url", "https://" + "a".repeat(2100) + ".org", 42, null]) {
      assert.equal(cleanUrl(bad), null, `should reject ${String(bad).slice(0, 40)}`);
    }
  });
  test("parseTable drops unsafe links, keeps safe ones, unescapes pipes", () => {
    const md = TABLE_HEAD
      + row("Acme", "Widget", "Vulnerable", "[x](<javascript:alert(1)>)<br>[ok](<https://example.org/ok>)<br>[d](<data:text/html,hi>)")
      + "|Pipe \\| Co|P||Fix|Fix|a \\|\\| b|[s](<https://e.org>)|\n";
    const rows = parseTable(md);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].links, [{ label: "ok", url: "https://example.org/ok" }]);
    assert.equal(rows[1].supplier, "Pipe | Co");
    assert.equal(rows[1].notes[0], "a || b");
  });
  test("parseTable caps rows, field sizes, notes and links", () => {
    let md = TABLE_HEAD;
    const longNotes = Array.from({ length: 50 }, (_, i) => `n${i}`).join("<br>");
    const manyLinks = Array.from({ length: 50 }, (_, i) => `[l${i}](<https://e.org/${i}>)`).join("<br>");
    md += `|${"S".repeat(5000)}|P||${"V".repeat(500)}|Fix|${longNotes}|${manyLinks}|\n`;
    for (let i = 0; i < 30; i++) md += row(`S${i}`, `P${i}`);
    const rows = parseTable(md, 10);
    assert.equal(rows.length, 10);
    assert.ok(rows[0].supplier.length <= LIMITS.FIELD);
    assert.ok(rows[0].s1.length <= LIMITS.STATUS);
    assert.equal(rows[0].notes.length, LIMITS.NOTES);
    assert.equal(rows[0].links.length, LIMITS.LINKS);
  });
  test("parser is linear on hostile input (no catastrophic backtracking)", () => {
    const evil = "|" + "\\".repeat(50_000) + "|" + "[".repeat(50_000) + "](" + "<".repeat(50_000) + "|\n";
    const t0 = performance.now();
    parseTable(TABLE_HEAD + evil.repeat(5));
    parseChangelog(evil.repeat(5));
    assert.ok(performance.now() - t0 < 2000, "parsing hostile input took too long");
  });
});

// ---------------------------------------------------------------- status handling
describe("status handling (F-06)", () => {
  test("inherited property names are not treated as statuses", () => {
    for (const k of ["toString", "__proto__", "constructor", "hasOwnProperty", "valueOf"]) {
      assert.equal(worstOf(k, k), "Unknown");
    }
    assert.equal(worstOf("Fix", "Vulnerable"), "Vulnerable");
    assert.equal(worstOf("Not vuln", "Fix"), "Fix");
    assert.equal(worstOf("garbage", "Fix"), "Fix");
  });
  test("timeline counts stay numeric with hostile statuses, and the last point matches the list", () => {
    const list = { listUpdated: "x", items: [
      { supplier: "A", product: "1", s1: "Vulnerable", s2: "Vulnerable" },
      { supplier: "B", product: "2", s1: "toString", s2: "__proto__" },
      { supplier: "C", product: "3", s1: "Fix", s2: "Fix" },
    ] };
    const md = "|2026-10-21 13:41:09 +0200|A|1||Investigation|Investigation|n|l|\n"
      + "|2026-10-21 14:00:00 +0200|B|2||toString|constructor|n|l|\n"
      + "|2026-10-21 15:00:00 +0200|C|3||Fix|Fix|n|l|\n"
      + "|2099-01-01 00:00:00 +0000|A|1||Fix|Fix|future|l|\n";
    const tl = buildTimelineFrom(md, list, Date.parse("2026-10-22T12:00:00Z"));
    const last = tl.points.at(-1);
    assert.equal(last.total, 3);
    assert.equal(last.Vulnerable, 1);
    assert.equal(last.Fix, 1);
    assert.equal(last.Unknown, 1);
    for (const p of tl.points) for (const v of Object.values(p)) if (typeof v !== "string") assert.ok(Number.isFinite(v));
    assert.ok(tl.points.length <= 2001);
  });
});

// ---------------------------------------------------------------- cache behaviour
describe("cache: stale-while-revalidate, single-flight, cooldown (F-02, F-13)", () => {
  let cache;
  beforeEach(() => { cache = installCache(); });
  const ORIGIN = "https://php2list.example";
  test("miss builds once; hit does not rebuild; key is under the site's own origin", async () => {
    let builds = 0; const c = ctx();
    const build = async () => { builds++; return { v: 1 }; };
    assert.equal((await cached("t1", build, {}, c, ORIGIN)).state, "MISS");
    assert.equal((await cached("t1", build, {}, c, ORIGIN)).state, "HIT");
    assert.equal(builds, 1);
    for (const k of cache.store.keys()) assert.ok(k.startsWith(`${ORIGIN}/api/__cache/`), k);
  });
  test("concurrent misses share one upstream build", async () => {
    let builds = 0; const c = ctx();
    const build = async () => { builds++; await new Promise((r) => setTimeout(r, 30)); return { v: 1 }; };
    const results = await Promise.all(Array.from({ length: 25 }, () => cached("t2", build, {}, c, ORIGIN)));
    assert.equal(builds, 1);
    assert.ok(results.every((r) => r.body === '{"v":1}'));
  });
  test("expired entry is served immediately and refreshed in the background", async () => {
    let builds = 0, t = 1_000_000_000_000; const c = ctx();
    const now = () => t;
    const build = async () => { builds++; return { v: builds }; };
    await cached("t3", build, {}, c, ORIGIN, now);
    t += 31 * 60 * 1000;                       // past the 30-minute freshness window
    const r = await cached("t3", build, {}, c, ORIGIN, now);
    assert.equal(r.state, "REVALIDATING");
    assert.equal(r.body, '{"v":1}');           // old copy served without waiting
    await c.settle();
    assert.equal(builds, 2);
    assert.equal((await cached("t3", build, {}, c, ORIGIN, now)).body, '{"v":2}');
  });
  test("upstream failure: cooldown stops repeated upstream calls; a saved copy is served as STALE", async () => {
    let builds = 0, fail = false, t = 1_000_000_000_000; const c = ctx();
    const now = () => t;
    const build = async () => { builds++; if (fail) throw new Error("boom"); return { v: 1 }; };
    // no saved copy + failure -> error, then cooldown blocks further upstream attempts
    fail = true;
    await assert.rejects(cached("t4", build, {}, c, ORIGIN, now));
    await assert.rejects(cached("t4", build, {}, c, ORIGIN, now));
    assert.equal(builds, 1, "second request during cooldown must not hit upstream");
    // with a saved copy: expired + failing upstream -> STALE, still served
    cache.store.clear(); builds = 0; fail = false;
    await cached("t5", build, {}, c, ORIGIN, now);
    fail = true; t += 31 * 60 * 1000;
    await cached("t5", build, {}, c, ORIGIN, now); await c.settle();      // background refresh fails -> cooldown
    const r = await cached("t5", build, {}, c, ORIGIN, now);
    assert.equal(r.state, "STALE");
    assert.equal(r.body, '{"v":1}');
    // upstream recovers after the cooldown: marker cleared, data fresh again
    fail = false; t += 3 * 60 * 1000;
    const marker = [...cache.store.keys()].find((k) => k.endsWith("/cooldown"));
    cache.store.delete(marker);                                         // the 2-minute marker has expired
    await cached("t5", build, {}, c, ORIGIN, now); await c.settle();    // background refresh succeeds
    assert.ok(![...cache.store.keys()].some((k) => k.endsWith("/cooldown")));
    assert.equal((await cached("t5", build, {}, c, ORIGIN, now)).state, "HIT");
  });
});

// ---------------------------------------------------------------- HTTP behaviour with a mocked upstream
function md(files) { return files; }
function mockUpstream(map, calls) {
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: { ...(init.headers || {}) }, redirect: init.redirect });
    const entry = map(String(url), init);
    if (entry instanceof Response) return entry;
    if (entry == null) return new Response("nope", { status: 404 });
    return new Response(entry, { status: 200, headers: { "content-type": "text/plain" } });
  };
}
const LETTERS = ["0-9", ..."abcdefghijklmnopqrstuvwxyz"];
function siteFiles(rowsMd) {
  const files = { "README.md": "Software list last status update: 22 October 2026 17:23 CEST\n", "software/changelog_software_list.md": "" };
  for (const l of LETTERS) files[`software/software_list_${l}.md`] = TABLE_HEAD + (l === "a" ? rowsMd : "");
  return files;
}
const env0 = { ASSETS: { fetch: async () => new Response("asset") } };
const req = (path, method = "GET") => new Request(`https://php2list.example${path}`, { method });

describe("HTTP API (F-01 routing fallback, F-05 errors, F-08 headers, token handling)", () => {
  beforeEach(() => { installCache(); });
  test("serves parsed data without internal source details", async () => {
    const calls = []; const files = siteFiles(row("Acme", "Widget"));
    mockUpstream((u) => files[u.replace(/^https:\/\/raw\.githubusercontent\.com\/NCSC-NL\/php2shell\/main\//, "")], calls);
    const c = ctx(); const res = await worker.fetch(req("/api/software"), env0, c);
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.count, 1);
    assert.equal(j.items[0].supplier, "Acme");
    assert.equal(j.sourceBase, undefined);
    assert.ok(res.headers.get("content-security-policy").includes("default-src 'none'"));
    assert.equal(res.headers.get("strict-transport-security"), "max-age=31536000");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });
  test("errors are generic and never echo upstream details", async () => {
    const calls = [];
    mockUpstream(() => new Response("secret upstream body", { status: 500 }), calls);
    const env = { ...env0, SOURCE_PRIMARY: "https://mirror.example.org/secret-path-xyz" };
    const res = await worker.fetch(req("/api/software"), env, ctx());
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.ok(!/secret|mirror|HTTP 500|raw\.githubusercontent/.test(text), text);
    assert.equal(JSON.parse(text).code, "UPSTREAM_UNAVAILABLE");
  });
  test("token goes only to GitHub, without following redirects", async () => {
    const calls = []; const files = siteFiles(row("Acme", "Widget"));
    mockUpstream((u) => files[u.replace(/^https:\/\/[^/]+\/[^/]+\/[^/]+\/[^/]+\//, "").replace(/^https:\/\/mirror\.example\.org\/m\//, "")], calls);
    await worker.fetch(req("/api/software"), { ...env0, GITHUB_TOKEN: "tok_123", SOURCE_PRIMARY: "https://mirror.example.org/m" }, ctx());
    assert.ok(calls.length > 0);
    assert.ok(calls.every((c) => !c.headers.authorization), "token must not be sent to a non-GitHub mirror");
    installCache(); calls.length = 0;
    await worker.fetch(req("/api/software"), { ...env0, GITHUB_TOKEN: "tok_123" }, ctx());
    const gh = calls.filter((c) => c.url.startsWith("https://raw.githubusercontent.com/"));
    assert.ok(gh.length > 0 && gh.every((c) => c.headers.authorization === "Bearer tok_123" && c.redirect === "manual"));
  });
  test("a redirect while the token is attached is retried anonymously, not followed with the token", async () => {
    const calls = []; const files = siteFiles(row("Acme", "Widget"));
    mockUpstream((u, init) => init.headers?.authorization
      ? new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } })
      : files[u.replace(/^https:\/\/raw\.githubusercontent\.com\/NCSC-NL\/php2shell\/main\//, "")], calls);
    const res = await worker.fetch(req("/api/software"), { ...env0, GITHUB_TOKEN: "tok_123" }, ctx());
    assert.equal(res.status, 200);
    assert.ok(!calls.some((c) => c.url.includes("evil.example")));
  });
  test("oversized upstream files are rejected and the next source is used", async () => {
    const calls = []; const files = siteFiles(row("Acme", "Widget"));
    mockUpstream((u) => {
      if (u.startsWith("https://raw.githubusercontent.com/big/one/")) return new Response("x".repeat(LIMITS.PAGE_BYTES + 10), { status: 200 });
      return files[u.replace(/^https:\/\/raw\.githubusercontent\.com\/NCSC-NL\/php2shell\/main\//, "")];
    }, calls);
    const res = await worker.fetch(req("/api/software"), { ...env0, SOURCE_PRIMARY: "big/one", SOURCE_FALLBACKS: "NCSC-NL/php2shell@main" }, ctx());
    assert.equal(res.status, 200);
    assert.equal((await res.json()).official, true);
  });
  test("only GET/HEAD; unknown API paths 404; non-API paths fall back to static assets", async () => {
    mockUpstream(() => null, []);
    assert.equal((await worker.fetch(req("/api/software", "POST"), env0, ctx())).status, 405);
    assert.equal((await worker.fetch(req("/api/software", "DELETE"), env0, ctx())).headers.get("allow"), "GET, HEAD");
    assert.equal((await worker.fetch(req("/api/__cache/v4/x/list"), env0, ctx())).status, 404);
    const page = await worker.fetch(req("/"), env0, ctx());
    assert.equal(await page.text(), "asset");
    assert.ok(page.headers.get("content-security-policy").includes("script-src 'self'"));
  });
});

// ---------------------------------------------------------------- GitHub-friendly refreshes
describe("upstream load: revision check, pinned snapshot, rate-limit backoff", () => {
  const SHA1 = "a".repeat(40), SHA2 = "b".repeat(40);
  const realNow = Date.now;
  let t;
  beforeEach(() => { installCache(); t = 1_800_000_000_000; Date.now = () => t; });
  const done = () => { Date.now = realNow; };
  function upstream(files, shaRef, calls, rawStatus = null) {
    mockUpstream((u) => {
      if (u === "https://api.github.com/repos/NCSC-NL/php2shell/commits/main") return new Response(shaRef.sha, { status: 200 });
      const m = u.match(/^https:\/\/raw\.githubusercontent\.com\/NCSC-NL\/php2shell\/([^/]+)\/(.+)$/);
      if (!m) return null;
      if (rawStatus) return new Response("slow down", { status: rawStatus });
      return files[m[2]];
    }, calls);
  }
  test("downloads the list files only when the commit has changed, and pins them to that commit", async () => {
    try {
      const calls = [], ref = { sha: SHA1 }, files = siteFiles(row("Acme", "Widget"));
      upstream(files, ref, calls);
      let c = ctx();
      const first = await (await worker.fetch(req("/api/software"), env0, c)).json();
      assert.equal(first.sourceRevision, SHA1);
      const raw = calls.filter((x) => x.url.startsWith("https://raw.githubusercontent.com/"));
      assert.equal(raw.length, 28);
      assert.ok(raw.every((x) => x.url.includes(`/${SHA1}/`)), "files come from the exact commit");
      // 31 minutes later, same commit: one small API request, no file downloads
      calls.length = 0; t += 31 * 60 * 1000; c = ctx();
      await worker.fetch(req("/api/software"), env0, c); await c.settle();
      assert.deepEqual(calls.map((x) => x.url), ["https://api.github.com/repos/NCSC-NL/php2shell/commits/main"]);
      // a new commit: the files are downloaded again
      calls.length = 0; t += 31 * 60 * 1000; ref.sha = SHA2; c = ctx();
      await worker.fetch(req("/api/software"), env0, c); await c.settle();
      assert.equal(calls.filter((x) => x.url.includes(`/${SHA2}/`)).length, 28);
    } finally { done(); }
  });
  test("the token is sent to the GitHub API without following redirects; a bad answer is ignored", async () => {
    try {
      const calls = [], ref = { sha: "<script>not-a-sha" }, files = siteFiles(row("Acme", "Widget"));
      upstream(files, ref, calls);
      const j = await (await worker.fetch(req("/api/software"), { ...env0, GITHUB_TOKEN: "tok_123" }, ctx())).json();
      const api = calls.find((x) => x.url.startsWith("https://api.github.com/"));
      assert.equal(api.headers.authorization, "Bearer tok_123");
      assert.equal(api.redirect, "manual");
      assert.equal(j.sourceRevision, null, "an invalid revision is not trusted");
      assert.equal(j.count, 1, "falls back to a normal download");
    } finally { done(); }
  });
  test("GitHub rate limiting (429) pauses refreshes for 15 minutes instead of 2", async () => {
    try {
      const calls = [], ref = { sha: SHA1 };
      upstream({}, ref, calls, 429);
      const res = await worker.fetch(req("/api/software"), env0, ctx());
      assert.equal(res.status, 503);
      const marker = [...caches.default.store.entries()].find(([k]) => k.endsWith("/cooldown"));
      assert.ok(marker, "cooldown recorded");
      assert.equal(marker[1].headers.get("cache-control"), `public, max-age=${_internals().RATE_LIMIT_COOLDOWN_S}`);
      calls.length = 0;
      await worker.fetch(req("/api/software"), env0, ctx());
      assert.equal(calls.length, 0, "no upstream requests during the pause");
    } finally { done(); }
  });
});

// ---------------------------------------------------------------- prebuilt data from Workers KV
describe("prebuilt data in KV: used first, validated as untrusted, falls back when stale", () => {
  beforeEach(() => { installCache(); });
  const kvEnv = (values) => ({ ...env0, DATA: { get: async (k) => (k in values ? values[k] : null) } });
  const files = siteFiles(row("Acme", "Widget"));
  const builtList = (now = Date.now()) => buildListFromFiles(files["README.md"], LETTERS.map((l) => files[`software/software_list_${l}.md`]), sourcesFrom({})[0], "c".repeat(40), now);
  test("fresh KV data is served without any request to GitHub", async () => {
    const calls = []; mockUpstream(() => null, calls);
    const res = await worker.fetch(req("/api/software"), kvEnv({ "software.json": JSON.stringify(builtList()) }), ctx());
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.count, 1); assert.equal(j.prebuilt, true); assert.equal(j.official, true);
    assert.equal(j.sourceRevision, "c".repeat(40));
    assert.equal(calls.length, 0);
  });
  test("hostile KV content is cleaned exactly like upstream Markdown", () => {
    const now = Date.now();
    const j = normaliseList({
      fetchedAt: new Date(now).toISOString(), source: "javascript:alert(1)", sourceRevision: "<img src=x>", official: "yes",
      items: [
        null, "x", [], { supplier: "", product: "" },
        { supplier: "Evil\u202eCorp\u0000", product: "<b>P</b>", version: { toString: () => "v" }, s1: "x".repeat(500), s2: 7,
          notes: ["ok", 5, "\u200b"], links: [{ label: "a", url: "javascript:alert(1)" }, { label: "", url: "https://ok.example/" }, "https://bare.example/"],
          html: "<script>", __proto__: { polluted: true } },
      ],
    }, now);
    assert.equal(j.items.length, 1);
    const it = j.items[0];
    assert.deepEqual(Object.keys(it).sort(), ["id", "links", "notes", "product", "s1", "s2", "supplier", "version"]);
    assert.equal(it.id, "evil-corp--p");
    assert.equal(it.supplier, "Evil Corp"); assert.equal(it.product, "P"); assert.equal(it.version, "v");
    assert.ok(it.s1.length <= LIMITS.STATUS); assert.equal(it.s2, "7");
    assert.deepEqual(it.notes, ["ok", "5"]);
    assert.deepEqual(it.links, [{ label: "source", url: "https://ok.example/" }]);
    assert.ok(!j.source.startsWith("javascript:")); assert.equal(j.sourceRevision, null); assert.equal(j.official, false);
    assert.equal({}.polluted, undefined);
  });
  test("stale, missing or broken KV data falls back to GitHub", async () => {
    const hours4 = Date.now() - 4 * 3600e3;
    for (const bad of [JSON.stringify(builtList(hours4)), "{not json", JSON.stringify({ items: [] }), null, JSON.stringify(builtList(Date.now() + 3600e3))]) {
      installCache();
      const calls = []; mockUpstream((u) => files[u.replace(/^https:\/\/raw\.githubusercontent\.com\/NCSC-NL\/php2shell\/main\//, "")], calls);
      const res = await worker.fetch(req("/api/software"), kvEnv(bad == null ? {} : { "software.json": bad }), ctx());
      assert.equal(res.status, 200, String(bad).slice(0, 40));
      const j = await res.json();
      assert.notEqual(j.prebuilt, true);
      assert.ok(calls.some((c) => c.url.startsWith("https://raw.githubusercontent.com/")));
    }
  });
  test("timeline: valid KV data is served; malformed points are rejected", () => {
    const now = Date.now();
    const list = builtList(now);
    const d = new Date(now - 3600e3).toISOString();
    const stamp = `${d.slice(0, 10)} ${d.slice(11, 19)} +0000`;
    const tl = { ...buildTimelineFrom(`|${stamp}|Acme|Widget||Vulnerable|Vulnerable|\n`, list, now), sourceLabel: "x", sourceId: "y", official: true };
    const ok = normaliseTimeline(JSON.parse(JSON.stringify(tl)), now);
    assert.ok(ok && ok.prebuilt && ok.points.length === tl.points.length);
    for (const breakIt of [(t) => { t.points[0].Fix = -1; }, (t) => { t.points[0].t = "soon"; }, (t) => { t.points[0].total = "1"; },
      (t) => { t.stepHours = 5; }, (t) => { t.points = Array(LIMITS.POINTS + 1).fill(t.points[0]); }, (t) => { t.generatedAt = new Date(now - 4 * 3600e3).toISOString(); }]) {
      const copy = JSON.parse(JSON.stringify(tl)); breakIt(copy);
      assert.equal(normaliseTimeline(copy, now), null);
    }
  });
});

// ---------------------------------------------------------------- product IDs, changes, feed, public API
describe("product IDs, recent changes, Atom feed and the public API", () => {
  beforeEach(() => { installCache(); });
  const now = Date.parse("2026-10-24T12:00:00Z");
  const stamp = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} +0000`;
  const listOf = (...rows) => buildListFromFiles("", [TABLE_HEAD + rows.join("")], sourcesFrom({})[0], null, now);
  test("IDs are URL-safe, stable and unique", () => {
    assert.equal(productId("Cisco", "Cisco Meraki Dashboard"), "cisco--cisco-meraki-dashboard");
    assert.equal(productId("Ünïcode AG", "Prod/uct <x>"), "unicode-ag--prod-uct-x");
    assert.match(productId("日本", "!!!"), /^x[0-9a-z]+--x[0-9a-z]+$/);
    const l = listOf(row("Acme", "Widget"), row("Acme", "Widget"), row("ACME", "widget"));
    assert.deepEqual(l.items.map((i) => i.id), ["acme--widget", "acme--widget-2", "acme--widget-3"]);
  });
  test("changes: from → to per product, added items, no-change rows skipped, newest first", () => {
    const list = listOf(row("Acme", "Widget", "Fix"), row("Beta", "Thing", "Vulnerable"));
    const md = [
      `|${stamp("2026-10-21T08:00:00Z")}|Acme|Widget||Investigation|Investigation|first note<br>second|[s](<https://a.example/>)|`,
      `|${stamp("2026-10-22T08:00:00Z")}|Acme|Widget||Investigation|Investigation|same status again||`,
      `|${stamp("2026-10-24T09:00:00Z")}|Acme|Widget|1.2|Fix|Fix|fixed in 1.2|[advisory](<https://a.example/adv>)<br>[x](<javascript:alert(1)>)|`,
      `|${stamp("2026-10-23T09:00:00Z")}|Beta|Thing||Vulnerable|Investigation|b||`,
      `|${stamp("2026-10-23T10:00:00Z")}|Gone|Removed||Fix|Fix|not in list||`,
      `|${stamp("2026-10-25T09:00:00Z")}|Beta|Thing||Fix|Fix|future||`,
    ].join("\n");
    const c = buildChangesFrom(md, list, now);
    assert.deepEqual(c.events.map((e) => [e.id, e.prev && e.prev.s1, e.s1]), [
      ["acme--widget", "Investigation", "Fix"], ["beta--thing", null, "Vulnerable"], ["acme--widget", null, "Investigation"]]);
    assert.equal(c.events[0].note, "fixed in 1.2");
    assert.deepEqual(c.events[0].links, [{ label: "advisory", url: "https://a.example/adv" }]);
    assert.equal(changeSummary(c.events[0]), "Investigation → Fix");
    assert.equal(changeSummary(c.events[1]), "Added: CVE-2026-109618 Vulnerable, CVE-2026-109619 Investigation");
    assert.ok(normaliseChanges(JSON.parse(JSON.stringify(c)), now));
    const bad = JSON.parse(JSON.stringify(c)); bad.events[0].id = '"><script>';
    assert.equal(normaliseChanges(bad, now), null, "a malformed id rejects the prebuilt file");
  });
  test("watchlist matching on the server works like the site (whole words, exact supplier/product)", () => {
    const e = (supplier, product) => ({ supplier, product });
    assert.ok(watchMatcher(["sap"])(e("SAP SE", "x")));
    assert.ok(!watchMatcher(["sap"])(e("WhatsApp", "x")));
    assert.ok(watchMatcher(["s:WordPress project"])(e("wordpress project", "x")));
    assert.ok(!watchMatcher(["s:WordPress"])(e("WordPress project", "x")));
    assert.ok(watchMatcher(["p:Acme::Widget"])(e("Acme", "widget")));
    assert.ok(!watchMatcher(["p:Acme::Widget"])(e("Acme", "Widget Pro")));
    assert.ok(watchMatcher(["a.b(c)*"])(e("a.b(c)* corp", "x")), "regex characters are literal");
    assert.ok(watchMatcher([])(e("any", "thing")));
    assert.equal(cleanEntry("  s:Evil\u202e\u0000 Corp  "), "s:Evil Corp");
    assert.equal(cleanEntry("x".repeat(500)).length, 80);
  });
  test("feed: valid, escaped Atom; hostile text can't inject markup", () => {
    const changes = { generatedAt: new Date(now).toISOString(), events: [
      { t: "2026-10-24T09:00:00.000Z", id: "acme--widget", supplier: 'A&B "<Corp>"', product: "W]]></title><script>x</script>", version: "", s1: "Fix", s2: "Fix",
        prev: { s1: "Vulnerable", s2: "Vulnerable" }, note: "bad \u0001 char \uFFFE here", links: [{ label: "adv", url: "https://a.example/?a=1&b=2" }] },
      { t: "2026-10-23T09:00:00.000Z", id: "other--thing", supplier: "Other", product: "Thing", version: "", s1: "Fix", s2: "Fix", prev: null, note: "", links: [] },
    ] };
    const x = buildFeed(changes, "https://php2list.example", []);
    assert.ok(x.startsWith('<?xml version="1.0" encoding="utf-8"?>'));
    assert.ok(!/<script>|<Corp>|\]\]>/.test(x), "markup in data is escaped");
    assert.ok(x.includes("A&amp;B &quot;&lt;Corp&gt;&quot;"));
    assert.ok(!/[\u0001\uFFFE]/.test(x), "characters that are invalid in XML are removed");
    assert.ok(x.includes("https://a.example/?a=1&amp;b=2"));
    assert.ok(x.includes('<content type="text">'));
    assert.equal((x.match(/<entry>/g) || []).length, 2);
    const w = buildFeed(changes, "https://php2list.example", ["s:Other"]);
    assert.equal((w.match(/<entry>/g) || []).length, 1);
    assert.ok(w.includes("feed.xml?v=s%3AOther"));
  });
  test("HTTP: /api/v1 has CORS for everyone; internal endpoints don't; /feed.xml is Atom", async () => {
    const files = siteFiles(row("Acme", "Widget"));
    files["software/changelog_software_list.md"] = `|${stamp(new Date(Date.now() - 3600e3).toISOString())}|Acme|Widget||Vulnerable|Vulnerable|n||\n`;
    mockUpstream((u) => files[u.replace(/^https:\/\/raw\.githubusercontent\.com\/NCSC-NL\/php2shell\/main\//, "")], []);
    const v1 = await worker.fetch(req("/api/v1/software"), env0, ctx());
    assert.equal(v1.status, 200);
    assert.equal(v1.headers.get("access-control-allow-origin"), "*");
    assert.equal(v1.headers.get("cross-origin-resource-policy"), "cross-origin");
    const j = await v1.json();
    assert.equal(j.apiVersion, 1); assert.equal(j.items[0].id, "acme--widget");
    const internal = await worker.fetch(req("/api/software"), env0, ctx());
    assert.equal(internal.headers.get("access-control-allow-origin"), null);
    assert.equal(internal.headers.get("cross-origin-resource-policy"), "same-origin");
    const ch = await (await worker.fetch(req("/api/v1/changes"), env0, ctx())).json();
    assert.equal(ch.events.length, 1); assert.equal(ch.events[0].id, "acme--widget");
    const feed = await worker.fetch(req("/feed.xml?v=acme"), env0, ctx());
    assert.equal(feed.headers.get("content-type"), "application/atom+xml; charset=utf-8");
    assert.ok((await feed.text()).includes("<entry>"));
    const idx = await (await worker.fetch(req("/api/v1"), env0, ctx())).json();
    assert.equal(idx.endpoints.software, "https://php2list.example/api/v1/software");
    assert.equal((await worker.fetch(req("/api/v1/software", "OPTIONS"), env0, ctx())).status, 204);
    assert.equal((await worker.fetch(req("/api/v1/software", "POST"), env0, ctx())).status, 405);
    assert.equal((await worker.fetch(req("/api/v1/__proto__"), env0, ctx())).status, 404);
    assert.equal((await worker.fetch(req("/api/v1/constructor"), env0, ctx())).status, 404);
  });
  test("feed: watchlist size is capped and cache keys stay short", async () => {
    const files = siteFiles(row("Acme", "Widget"));
    files["software/changelog_software_list.md"] = `|${stamp(new Date(Date.now() - 3600e3).toISOString())}|Acme|Widget||Vulnerable|Vulnerable|n||\n`;
    mockUpstream((u) => files[u.replace(/^https:\/\/raw\.githubusercontent\.com\/NCSC-NL\/php2shell\/main\//, "")], []);
    const qs = Array.from({ length: 200 }, (_, i) => "v=" + "k".repeat(70) + i).join("&") + "&v=acme";
    const c = ctx();
    const res = await worker.fetch(req("/feed.xml?" + qs), env0, c); await c.settle();
    assert.equal(res.status, 200);
    const x = await res.text();
    assert.equal((x.match(/v=/g) || []).length, 25, "only the first 25 entries are used");
    for (const k of caches.default.store.keys()) assert.ok(k.length < 300, `cache key too long: ${k.length}`);
  });
  test("feed opened in a browser tab goes to the subscribe page; feed readers get the feed", async () => {
    const files = siteFiles(row("Acme", "Widget"));
    mockUpstream((u) => files[u.replace(/^https:\/\/raw\.githubusercontent\.com\/NCSC-NL\/php2shell\/main\//, "")], []);
    const nav = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };
    const r1 = await worker.fetch(new Request("https://php2list.example/feed.xml?v=s%3AAcme&v=%3Cimg%3E&x=1", { headers: nav }), env0, ctx());
    assert.equal(r1.status, 303);
    assert.equal(r1.headers.get("location"), "/subscribe?v=s%3AAcme&v=%3Cimg%3E", "only watchlist entries are carried over, re-encoded");
    const r2 = await worker.fetch(new Request("https://php2list.example/feed.xml?view=xml", { headers: nav }), env0, ctx());
    assert.equal(r2.status, 200); assert.match(r2.headers.get("content-type"), /atom/);
    const r3 = await worker.fetch(new Request("https://php2list.example/feed.xml"), env0, ctx());   // a feed reader: no Sec-Fetch headers
    assert.equal(r3.status, 200);
    assert.match(r3.headers.get("vary"), /Sec-Fetch-Dest/);
  });
  test("SOURCE_ARCHIVED marks the list as no longer updated", async () => {
    const files = siteFiles(row("Acme", "Widget"));
    mockUpstream((u) => files[u.replace(/^https:\/\/raw\.githubusercontent\.com\/NCSC-NL\/php2shell\/main\//, "")], []);
    const j = await (await worker.fetch(req("/api/software"), { ...env0, SOURCE_ARCHIVED: "true" }, ctx())).json();
    assert.equal(j.sourceArchived, true);
  });
});

// ---------------------------------------------------------------- deployment files
describe("deployment configuration (F-01, F-08, F-09)", () => {
  test("every named export of the worker is a function (the Workers runtime rejects anything else)", async () => {
    const mod = await import("../public/_worker.js");
    for (const [name, v] of Object.entries(mod)) if (name !== "default") assert.equal(typeof v, "function", `export ${name}`);
  });
  test("every page script compiles (catches broken escapes such as a raw line separator in a regex)", async () => {
    const { readdirSync } = await import("node:fs");
    const vm = await import("node:vm");
    const dir = fileURLToPath(new URL("public/assets/", root));
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
      const src = readFileSync(dir + f, "utf8");
      assert.doesNotThrow(() => new vm.Script(src, { filename: f }), f);
      assert.ok(!/[\u2028\u2029]/.test(src), `${f}: raw U+2028/2029 character`);
    }
  });
  test("pages link assets with the current content hash (run npm run build:pages after editing assets)", async () => {
    const { readdirSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const dir = fileURLToPath(new URL("public/", root));
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
      const html = readFileSync(dir + f, "utf8");
      for (const m of html.matchAll(/(?:src|href)="\/assets\/([A-Za-z0-9_.-]+)(\?v=([0-9a-f]+))?"/g)) {
        const want = createHash("sha256").update(readFileSync(dir + "assets/" + m[1])).digest("hex").slice(0, 10);
        assert.equal(m[3], want, `${f}: /assets/${m[1]} should be ?v=${want}`);
      }
    }
  });
  test("no element repeats an attribute (e.g. two width= on one icon)", async () => {
    const { readdirSync } = await import("node:fs");
    const files = [...readdirSync(fileURLToPath(new URL("public/", root))).filter((f) => f.endsWith(".html")).map((f) => "public/" + f),
      ...readdirSync(fileURLToPath(new URL("public/assets/", root))).filter((f) => f.endsWith(".js")).map((f) => "public/assets/" + f)];
    for (const f of files) {
      const src = readFileSync(new URL(f, root), "utf8");
      for (const m of src.matchAll(/<[a-z][a-z0-9]*\s[^<>]*>/gi)) {
        const tag = m[0].replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");   // ignore text inside values
        const names = [...tag.matchAll(/\s([a-z-]+)=/gi)].map((x) => x[1].toLowerCase());
        assert.equal(new Set(names).size, names.length, `${f}: repeated attribute in ${m[0].slice(0, 80)}`);
      }
    }
  });
  test("_routes.json runs the Worker only for /api/* and /feed.xml", () => {
    const routes = JSON.parse(readFileSync(new URL("public/_routes.json", root), "utf8"));
    assert.deepEqual(routes.include, ["/api/*", "/feed.xml"]);
  });
  test("_headers uses exactly the same CSP as the Worker, with no unsafe-inline/eval", () => {
    const headers = readFileSync(new URL("public/_headers", root), "utf8");
    const csp = headers.match(/Content-Security-Policy: (.+)/)[1].trim();
    assert.equal(csp, PAGE_CSP);
    assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp), csp);
    for (const h of ["Strict-Transport-Security", "X-Content-Type-Options: nosniff", "Referrer-Policy: no-referrer", "X-Frame-Options: DENY"]) assert.ok(headers.includes(h), h);
  });
  test("no inline scripts, inline styles or inline event handlers in any page", async () => {
    const { readdirSync } = await import("node:fs");
    const dir = fileURLToPath(new URL("public/", root));
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
      const html = readFileSync(dir + f, "utf8");
      assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), `${f}: inline <script>`);
      assert.ok(!/\sstyle="/i.test(html), `${f}: inline style attribute`);
      assert.ok(!/\son[a-z]+="/i.test(html), `${f}: inline event handler`);
    }
  });
});
