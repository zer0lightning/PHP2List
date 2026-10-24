// SPDX-License-Identifier: MIT
// PHP2List "Changes" page: recent status changes from /api/changes, grouped by day,
// optionally narrowed to the visitor's watchlist. All data is escaped before it is inserted.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const str = (v, max) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, max);
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,150}$/;
  const STATUSES = ["Vulnerable", "Workaround", "Investigation", "Fix", "Not vuln"];
  const SEV = Object.freeze(Object.assign(Object.create(null), { "Vulnerable": 0, "Workaround": 1, "Investigation": 2, "Fix": 3, "Not vuln": 4 }));
  const sev = (s) => (Object.hasOwn(SEV, s) ? SEV[s] : 9);
  const worst = (a, b) => (sev(a) <= sev(b) ? a : b);
  const DONE = new Set(["Fix", "Not vuln"]), OPEN_BAD = new Set(["Vulnerable", "Workaround"]);
  const chip = (s) => STATUSES.includes(s) ? `<span class="st st-${s.replace(/\s/g, "")}">${esc(s)}</span>` : `<span class="st-none">${s ? esc(s) : "—"}</span>`;
  const CVE1 = "CVE-2026-109618", CVE2 = "CVE-2026-109619";

  // Watchlist: from a shared link (#v=...) if present, otherwise the one saved in this browser.
  // Matching follows the main page: "s:Supplier", "p:Supplier::Product" or a whole-word keyword.
  const cleanEntry = (v) => { const s = String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim(); return s.slice(0, /^[sp]:/.test(s) ? 240 : 80); };
  function readWatch(){
    const fromUrl = new URLSearchParams(location.hash.slice(1)).getAll("v").map(cleanEntry).filter(Boolean).slice(0, 500);
    if (fromUrl.length) return fromUrl;
    try { const s = JSON.parse(localStorage.getItem("php2list.vendors") || "[]"); return Array.isArray(s) ? s.filter(x => typeof x === "string").map(cleanEntry).filter(Boolean).slice(0, 500) : []; } catch (e) { return []; }
  }
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function matcher(entries){
    const tests = entries.map(v => {
      if (v.startsWith("s:") && v.length > 2){ const sup = v.slice(2).toLowerCase(); return e => e.supplier.toLowerCase() === sup; }
      if (v.startsWith("p:")){ const i = v.indexOf("::", 2); if (i > 2 && i + 2 < v.length){ const sup = v.slice(2, i).toLowerCase(), prod = v.slice(i + 2).toLowerCase(); return e => e.supplier.toLowerCase() === sup && e.product.toLowerCase() === prod; } }
      const re = new RegExp("(^|[^\\p{L}\\p{N}])" + escRe(v.toLowerCase()) + "($|[^\\p{L}\\p{N}])", "u");
      return e => re.test(`${e.supplier} ${e.product}`.toLowerCase());
    });
    return e => tests.some(t => t(e));
  }

  const watch = readWatch();
  const fromLink = new URLSearchParams(location.hash.slice(1)).getAll("v").length > 0;
  const inWatch = matcher(watch);
  let events = [], period = 7, kind = "changes", onlyWatch = false, limit = 200;
  // A link can preselect the type of change, e.g. /changes#kind=all (only known values are accepted).
  const KINDS = ["changes", "fixed", "vuln", "added", "all"];
  const kindFromLink = new URLSearchParams(location.hash.slice(1)).get("kind");
  if (KINDS.includes(kindFromLink)) { kind = kindFromLink; $("chgKind").value = kind; }

  function normEvent(e){
    if (!e || typeof e !== "object" || typeof e.id !== "string" || !ID_RE.test(e.id)) return null;
    const ts = Date.parse(e.t); if (!Number.isFinite(ts)) return null;
    const prev = e.prev && typeof e.prev === "object" ? { s1: str(e.prev.s1, 40), s2: str(e.prev.s2, 40) } : null;
    return {
      ts, id: e.id, supplier: str(e.supplier, 500), product: str(e.product, 500), version: str(e.version, 500),
      s1: str(e.s1, 40), s2: str(e.s2, 40), prev, note: str(e.note, 600),
      links: Array.isArray(e.links) ? e.links.slice(0, 3).filter(l => l && typeof l.url === "string" && /^https?:\/\//i.test(l.url) && l.url.length <= 2000).map(l => ({ label: str(l.label, 100) || "source", url: l.url })) : [],
    };
  }
  function kindOf(e){
    const now = worst(e.s1, e.s2), was = e.prev ? worst(e.prev.s1, e.prev.s2) : null;
    if (!e.prev) return "added";
    if (DONE.has(now) && !DONE.has(was)) return "fixed";
    if (OPEN_BAD.has(now) && !OPEN_BAD.has(was)) return "vuln";
    return "other";
  }
  function transition(e){
    if (!e.prev) return `<span class="ci-tag">Added</span>${e.s1 === e.s2 ? chip(e.s1) : `<span class="ci-cve">${CVE1}</span>${chip(e.s1)}<span class="ci-cve">${CVE2}</span>${chip(e.s2)}`}`;
    if (e.s1 === e.s2 && e.prev.s1 === e.prev.s2) return `${chip(e.prev.s1)}<span class="ci-arrow" aria-label="changed to">→</span>${chip(e.s1)}`;
    const part = (label, a, b) => a === b ? "" : `<span class="ci-line"><span class="ci-cve">${label}</span>${chip(a)}<span class="ci-arrow" aria-label="changed to">→</span>${chip(b)}</span>`;
    return part(CVE1, e.prev.s1, e.s1) + part(CVE2, e.prev.s2, e.s2);
  }
  const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });
  const fmtTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

  function render(){
    const cutoff = Date.now() - period * 86400e3;
    const shown = events.filter(e => e.ts > cutoff && (!onlyWatch || inWatch(e)) && (kind === "all" || (kind === "changes" ? kindOf(e) !== "added" : kindOf(e) === kind)));
    const what = { all: "changes and additions", changes: "status changes", fixed: "products newly fixed or not vulnerable", vuln: "products newly vulnerable or with a workaround", added: "products added to the list" }[kind];
    $("chgCount").innerHTML = `<strong>${shown.length.toLocaleString()}</strong> ${what} in the last ${period === 1 ? "24 hours" : period + " days"}${onlyWatch ? " in your watchlist" : ""}`;
    if (!shown.length){
      $("chgList").innerHTML = `<p class="chg-empty">Nothing matches. Try a longer period${onlyWatch ? " or include all products" : ""}.</p>`;
      return;
    }
    const days = new Map();
    for (const e of shown.slice(0, limit)){
      const d = new Date(e.ts), key = d.toDateString();
      if (!days.has(key)) days.set(key, { label: fmtDay.format(d), items: [] });
      days.get(key).items.push(e);
    }
    let html = "";
    for (const { label, items } of days.values()){
      html += `<section class="chg-day"><h2>${esc(label)}</h2><ol class="chg-items">` + items.map(e => `
        <li class="chg-item k-${kindOf(e)}">
          <div class="ci-head"><time class="ci-time" datetime="${esc(new Date(e.ts).toISOString())}">${esc(fmtTime.format(new Date(e.ts)))}</time>
            <a class="ci-name" href="/#p=${e.id}">${esc(e.product)}</a><span class="ci-sup">${esc(e.supplier)}</span></div>
          <div class="ci-status">${transition(e)}</div>
          ${e.version ? `<p class="ci-ver"><span>Version:</span> ${esc(e.version)}</p>` : ""}
          ${e.note ? `<p class="ci-note${e.note.length > 220 ? " clamp" : ""}">${esc(e.note)}</p>${e.note.length > 220 ? `<button type="button" class="linkish ci-more" aria-expanded="false">Read more</button>` : ""}` : ""}
          ${e.links.length ? `<div class="links ci-links">${e.links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">${esc(l.label)}</a>`).join("")}</div>` : ""}
        </li>`).join("") + `</ol></section>`;
    }
    if (shown.length > limit) html += `<p class="chg-more"><button type="button" class="btn" id="chgMore">Show ${Math.min(200, shown.length - limit)} more</button></p>`;
    $("chgList").innerHTML = html;
  }

  // Controls
  $("chgPeriod").addEventListener("click", e => {
    const b = e.target.closest("[data-period]"); if (!b) return;
    period = Number(b.dataset.period); limit = 200;
    for (const x of $("chgPeriod").querySelectorAll("[data-period]")) x.setAttribute("aria-pressed", String(x === b));
    render();
  });
  $("chgKind").addEventListener("change", e => { kind = e.target.value; limit = 200; render(); });
  $("chgWatch").addEventListener("change", e => { onlyWatch = e.target.checked; limit = 200; render(); });
  $("chgList").addEventListener("click", e => {
    if (e.target.closest("#chgMore")){ limit += 200; render(); return; }
    const more = e.target.closest(".ci-more");
    if (more){ const note = more.previousElementSibling, open = note.classList.toggle("clamp") === false; more.setAttribute("aria-expanded", String(open)); more.textContent = open ? "Show less" : "Read more"; }
  });
  if (watch.length){
    $("chgWatchWrap").hidden = false;
    if (fromLink){ onlyWatch = true; $("chgWatch").checked = true; period = 30; for (const x of $("chgPeriod").querySelectorAll("[data-period]")) x.setAttribute("aria-pressed", String(x.dataset.period === "30")); }
    $("chgWatchN").textContent = `(${watch.length} item${watch.length === 1 ? "" : "s"})`;
    $("feedWatch").hidden = false;
  }

  // Feed links: copied to the clipboard and shown in a box, so they can be pasted into a reader.
  function showFeed(url, btn){
    const box = $("feedUrl");
    box.hidden = false; box.value = url; box.select();
    const done = () => { const t = btn.textContent; btn.textContent = "Copied ✓"; setTimeout(() => { btn.textContent = t; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => {});
  }
  $("feedAll").addEventListener("click", e => showFeed(`${location.origin}/feed.xml`, e.currentTarget));
  $("feedWatch").addEventListener("click", e => showFeed(`${location.origin}/feed.xml?` + watch.map(v => "v=" + encodeURIComponent(v)).join("&"), e.currentTarget));

  fetch("/api/changes").then(r => r.ok ? r.json() : Promise.reject(new Error("unavailable"))).then(j => {
    if (!j || !Array.isArray(j.events)) throw new Error("unexpected response");
    events = j.events.slice(0, 5000).map(normEvent).filter(Boolean).sort((a, b) => b.ts - a.ts);
    render();
  }).catch(() => {
    $("chgCount").textContent = "";
    $("chgList").innerHTML = `<div class="notice notice-danger" role="alert"><div class="n-body"><span class="n-title">Couldn't load recent changes</span><p>This is usually temporary. Please try again in a few minutes.</p></div></div>`;
  });
})();
