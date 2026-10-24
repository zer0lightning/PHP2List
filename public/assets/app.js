// SPDX-License-Identifier: MIT
// PHP2List page logic. Kept out of the HTML so the Content Security Policy can forbid inline scripts.
(() => {
  const API_URL = "/api/software";
  const CHANGES_URL = "/api/recent";    // compact: newest change per product
  const LS_VENDORS = "php2list.vendors";
  const LS_VISIT = "php2list.visit";
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,150}$/;

  const COLS = [
    {key:"supplier", label:"Supplier", cls:"c-supplier", sort:true},
    {key:"product",  label:"Product",  cls:"c-product",  sort:true},
    {key:"version",  label:"Version (see Status)", cls:"c-version", sort:true},
    {key:"s1",       label:"Status CVE-2026-109618", cls:"c-s", sort:true},
    {key:"s2",       label:"Status CVE-2026-109619", cls:"c-s", sort:true},
    {key:"notes",    label:"Notes", cls:"c-notes"},
    {key:"links",    label:"Links", cls:"c-links"},
  ];
  const STATUSES = ["Vulnerable","Workaround","Investigation","Fix","Not vuln"];
  const BG = {"Vulnerable":"bg-vuln","Workaround":"bg-wa","Investigation":"bg-inv","Fix":"bg-fix","Not vuln":"bg-nv"};
  const bg = (s) => Object.hasOwn(BG, s) ? BG[s] : "bg-nv";
  const SEVERITY = Object.freeze(Object.assign(Object.create(null), {"Vulnerable":0,"Workaround":1,"Investigation":2,"Fix":3,"Not vuln":4,"":5}));
  const sev = (s) => (typeof s === "string" && Object.hasOwn(SEVERITY, s)) ? SEVERITY[s] : 9;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const safeUrl = (u) => /^https?:\/\//i.test(u) ? u : "#";
  const cls = (s) => "st-" + s.replace(/\s/g,"");
  const store = {
    get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
    // Respect the visitor's privacy choice: when they chose "Don't save my settings", only removals happen.
    set(k,v){ try { if (v != null && localStorage.getItem("php2list.privacy") === "nostore") return; v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch(e){} },
  };

  let data = [], terms = [], listUpdated = "", suppliers = [], loaded = false, lastRows = [];
  let fetchedAt = 0;                 // when the site last fetched the list (from the API)
  let changeById = new Map();        // product id -> its newest status change
  let changesLoaded = false;

  // "Since your last visit": the time of the previous visit, kept in this browser only and
  // only when the visitor accepted saving settings. A visit is a gap of 30+ minutes.
  let visitPrev = null;
  (() => {
    let ok = false; try { ok = localStorage.getItem("php2list.privacy") === "ok"; } catch (e) {}
    if (!ok) return;
    const now = Date.now(); let v = null;
    try { v = JSON.parse(store.get(LS_VISIT) || "null"); } catch (e) {}
    const last = v && Number.isFinite(v.last) ? v.last : null;
    let prev = v && Number.isFinite(v.prev) ? v.prev : null;
    if (last && now - last > 30 * 60e3) prev = last;
    visitPrev = prev && prev < now ? prev : null;
    store.set(LS_VISIT, JSON.stringify({ prev: visitPrev, last: now }));
  })();

  // Relative times such as "5 min ago". Numbers only, safe to insert as HTML.
  function ago(t){
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  }
  const CVE1 = "CVE-2026-109618", CVE2 = "CVE-2026-109619";
  function changeSummary(e){
    const st = (v) => v || "no status";
    if (!e.prev) return e.s1 === e.s2 ? `Added: ${st(e.s1)}` : `Added: ${CVE1} ${st(e.s1)}, ${CVE2} ${st(e.s2)}`;
    if (e.s1 === e.s2 && e.prev.s1 === e.prev.s2) return `${st(e.prev.s1)} → ${st(e.s1)}`;
    const parts = [];
    if (e.prev.s1 !== e.s1) parts.push(`${CVE1} ${st(e.prev.s1)} → ${st(e.s1)}`);
    if (e.prev.s2 !== e.s2) parts.push(`${CVE2} ${st(e.prev.s2)} → ${st(e.s2)}`);
    return parts.join("; ");
  }
  const DAY = 86400e3;
  const recentCutoff = () => Date.now() - DAY;
  // Which change window a product falls in: "24h", "visit" (since the last visit) or "".
  function changedIn(r, which){
    const e = changeById.get(r.id); if (!e) return false;
    return which === "visit" ? !!visitPrev && e.ts > visitPrev : e.ts > recentCutoff();
  }

  // ================= icons, notices, toasts =================
  const ICON = {
    info:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    warn:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/></svg>',
    danger: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    check:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };
  // kind: info | warn | danger | neutral. body is trusted HTML built by this script.
  function notice(kind, title, body, actions = ""){
    const ic = ICON[kind === "neutral" ? "search" : kind] || ICON.info;
    return `<div class="notice notice-${kind}" role="${kind === "danger" ? "alert" : "status"}"><span class="n-ic">${ic}</span>
      <div class="n-body"><span class="n-title">${title}</span>${body}${actions ? `<div class="n-actions">${actions}</div>` : ""}</div></div>`;
  }
  function toast(msg, opts = {}){
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<span class="t-ic${opts.warn ? " warn" : ""}">${opts.warn ? ICON.warn : ICON.check}</span><span class="t-msg"></span>`;
    el.querySelector(".t-msg").textContent = msg;
    let timer;
    const close = () => { clearTimeout(timer); el.classList.add("out"); setTimeout(() => el.remove(), 170); };
    if (opts.action){
      const b = document.createElement("button"); b.type = "button"; b.textContent = opts.action.label;
      b.addEventListener("click", () => { opts.action.fn(); close(); });
      el.appendChild(b);
    }
    const box = $("toasts");
    while (box.children.length >= 3) box.firstChild.remove();
    box.appendChild(el);
    timer = setTimeout(close, opts.action ? 7000 : 4000);
    el.addEventListener("mouseenter", () => clearTimeout(timer));
    el.addEventListener("mouseleave", () => { timer = setTimeout(close, 2500); });
  }
  const state = { q:"", statuses:new Set(), cve:"any", letter:"", sortKey:"supplier", sortDir:1, vendors:[], changed:"", pid:"" };
  // sharedView: the page was opened from a link whose watchlist differs from the visitor's saved one.
  // While true, the visitor's own saved watchlist is left untouched.
  let sharedView = false;
  // view: "watch" shows only watchlist matches; "all" shows everything (so you can browse and star rows).
  let view = "watch";
  let matchedRows = [];
  const savedVendors = () => { try { const s = JSON.parse(store.get(LS_VENDORS) || "[]"); return Array.isArray(s) ? s.filter(x => typeof x === "string").map(cleanVendor).filter(Boolean).slice(0, 500) : []; } catch(e){ return []; } };
  // Vendor names come from links and paste: strip control characters, collapse spaces, cap length.
  const cleanVendor = (v) => {
    const s = String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "");
    return s.slice(0, /^[sp]:/.test(s) ? 240 : 80);
  };
  const sameList = (a, b) => a.length === b.length && a.every(x => b.some(y => y.toLowerCase() === x.toLowerCase()));

  // ================= watchlist entries =================
  // Three kinds of entry, stored as plain strings (in the URL, browser storage and exports):
  //   "s:<supplier>"              exact supplier, e.g. "s:WordPress project"
  //   "p:<supplier>::<product>"   one exact product, e.g. "p:WordPress project::WordPress"
  //   anything else               keyword: a whole word or phrase anywhere in supplier or product
  const PSEP = "::";
  function parseEntry(v){
    if (v.startsWith("s:") && v.length > 2) return { type: "supplier", supplier: v.slice(2) };
    if (v.startsWith("p:")){ const i = v.indexOf(PSEP, 2); if (i > 2 && i + 2 < v.length) return { type: "product", supplier: v.slice(2, i), product: v.slice(i + 2) }; }
    return { type: "keyword", text: v };
  }
  const KIND = { keyword: "Keyword", supplier: "Supplier", product: "Product" };
  const KIND_ICON = {
    keyword:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>',
    supplier: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3"/></svg>',
    product:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/></svg>',
  };
  const narrow = matchMedia("(max-width: 760px)");
  const tokenLimit = () => narrow.matches ? 4 : 8;   // more than this many items fold into "+N more"
  let tokensExpanded = false;
  function tokenHtml(v, i, p){
    const t = parseEntry(v).type, label = entryLabel(v);
    const tip = p ? `${KIND[t]}: ${label}. ${p.n ? `${p.n} product${p.n === 1 ? "" : "s"}${p.vuln ? `, ${p.vuln} vulnerable` : ""}` : "Not in the list"}` : `${KIND[t]}: ${label}`;
    const count = p ? `<span class="n${p.vuln ? " vuln" : ""}${p.n ? "" : " zero"}">${p.n}</span>` : "";
    return `<span class="vtok k-${t}${p && !p.n ? " none" : ""}" title="${esc(tip)}"><span class="vk">${KIND_ICON[t]}<span class="sr-only">${KIND[t]}:</span></span><span class="vl">${esc(label)}</span>${count}<button type="button" data-rm="${i}" aria-label="Remove ${esc(label)}">×</button></span>`;
  }
  function tokensHtml(per){
    const n = state.vendors.length, lim = tokenLimit(), fold = n > lim && !tokensExpanded;
    const shown = fold ? lim - 1 : n;
    let html = state.vendors.slice(0, shown).map((v, i) => tokenHtml(v, i, per && per[i])).join("");
    if (fold) html += `<button type="button" class="vmore-tok" data-tokens="more">+${n - shown} more</button>`;
    else if (n > lim) html += `<button type="button" class="vmore-tok" data-tokens="less">Show less</button>`;
    return html;
  }
  narrow.addEventListener("change", () => { if (loaded) renderWatch(scoped()); });
  // The watchlist box is only shown once there is a watchlist, or after "Create watchlist".
  // When it appears because a row was starred, the star handler keeps that row in place on screen.
  let watchOpen = false;
  function showWatchSection(){
    const sec = $("watchSection"), want = state.vendors.length > 0 || watchOpen;
    document.body.classList.toggle("no-watch", !want);
    if (sec.hidden !== want) return;
    sec.hidden = !want;
  }
  function setWatchChrome(){
    const has = state.vendors.length > 0, card = $("watchCard");
    showWatchSection();
    card.classList.toggle("has-items", has);
    $("vpaste").hidden = has; $("vshare").hidden = !has; $("vfeed").hidden = !has; $("vmore").hidden = !has;
    $("vclose").hidden = has;
    if (!has) $("vmore").open = false;
    $("vhelpToggle").hidden = !has;
    $("vhelp").hidden = has && $("vhelpToggle").getAttribute("aria-expanded") !== "true";
  }
  function entryLabel(v){
    const e = parseEntry(v);
    return e.type === "product" ? `${e.product} (${e.supplier})` : e.type === "supplier" ? e.supplier : e.text;
  }
  const productEntry = (r) => `p:${r.supplier}${PSEP}${r.product}`;
  const hasEntry = (v) => state.vendors.some(x => x.toLowerCase() === v.toLowerCase());

  // ================= vendor matching =================
  // A vendor term matches as a whole word (or phrase) in the supplier or product name,
  // so "SAP" matches "SAP SE" but not "SAPI" or "WhatsApp", and "WordPress" matches "WordPress.com".
  const vendorRe = (v) => new RegExp("(^|[^\\p{L}\\p{N}])" + escRe(v.toLowerCase()) + "($|[^\\p{L}\\p{N}])", "u");
  let vendorMatchers = [];
  function compileVendors(){
    vendorMatchers = state.vendors.map(v => {
      const e = parseEntry(v);
      if (e.type === "supplier"){ const s = e.supplier.toLowerCase(); return { v, test: r => r._sup === s }; }
      if (e.type === "product"){ const s = e.supplier.toLowerCase(), p = e.product.toLowerCase(); return { v, test: r => r._sup === s && r._prod === p }; }
      const re = vendorRe(e.text); return { v, test: r => re.test(r._vhay) };
    });
  }
  function vendorsFor(r){ return vendorMatchers.filter(m => m.test(r)).map(m => m.v); }

  function addVendors(list, replace){
    const before = state.vendors.slice();
    if (replace) state.vendors = [];
    const have = new Set(state.vendors.map(v => v.toLowerCase()));
    let added = 0, dup = 0;
    for (let v of list){
      v = cleanVendor(v);
      if (!v) continue;
      if (have.has(v.toLowerCase())){ dup++; continue; }
      have.add(v.toLowerCase()); state.vendors.push(v); added++;
    }
    vendorsChanged();
    return { added, dup, before };
  }
  function removeVendor(i){
    const before = state.vendors.slice(), name = state.vendors[i];
    watchOpen = true;                 // removing the last item keeps the box open, so you can add more
    state.vendors.splice(i, 1); vendorsChanged();
    toast(`Removed “${entryLabel(name)}” from your watchlist`, { action: { label: "Undo", fn: () => { state.vendors = before; vendorsChanged(); } } });
  }
  function vendorsChanged(){
    compileVendors();
    if (!sharedView) store.set(LS_VENDORS, state.vendors.length ? JSON.stringify(state.vendors) : null);
    render();
  }

  // ================= URL state (shareable links) =================
  function readUrl(){
    const p = new URLSearchParams(location.hash.slice(1) || location.search);
    state.q = p.get("q") || "";
    state.cve = ["s1","s2"].includes(p.get("cve")) ? p.get("cve") : "any";
    state.letter = p.get("l") || "";
    (p.get("status")||"").split(",").filter(s => STATUSES.includes(s)).forEach(s => state.statuses.add(s));
    if (!/^(0-9|[A-Z])$/.test(state.letter)) state.letter = "";
    state.q = state.q.slice(0, 200);
    const sk = p.get("sort"); if (COLS.some(c => c.sort && c.key === sk)) state.sortKey = sk;
    if (p.get("dir") === "desc") state.sortDir = -1;
    state.changed = ["24h", "visit"].includes(p.get("ch")) ? p.get("ch") : "";
    state.pid = ID_RE.test(p.get("p") || "") ? p.get("p") : "";
    const fromUrl = p.getAll("v").map(cleanVendor).filter(Boolean).slice(0, 500);
    const saved = savedVendors();
    if (fromUrl.length){ state.vendors = fromUrl; sharedView = !sameList(fromUrl, saved); }
    else { state.vendors = saved; sharedView = false; }
    compileVendors();
  }
  // A shared link pasted into an already-open tab only changes the part after "#": re-read it.
  let lastHash = "";
  addEventListener("hashchange", () => {
    if (location.hash === lastHash) return;
    state.statuses.clear(); state.vendors = []; state.letter = ""; state.sortKey = "supplier"; state.sortDir = 1; state.changed = ""; state.pid = ""; view = "watch";
    readUrl(); $("q").value = state.q; $("cve").value = state.cve;
    if (loaded) render(); else renderWatch([]);
  });
  function writeUrl(){
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.statuses.size) p.set("status", [...state.statuses].join(","));
    if (state.cve !== "any") p.set("cve", state.cve);
    if (state.letter) p.set("l", state.letter);
    if (state.sortKey !== "supplier") p.set("sort", state.sortKey);
    if (state.sortDir === -1) p.set("dir", "desc");
    if (state.changed) p.set("ch", state.changed);
    if (state.pid) p.set("p", state.pid);
    state.vendors.forEach(v => p.append("v", v));
    const qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "#" + qs : ""));
    lastHash = location.hash;
  }

  // ================= filtering =================
  const initial = (s) => { const c = (s||"").trim().charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : "0-9"; };
  const haystack = (r) => (r.supplier+" "+r.product+" "+r.version+" "+r.s1+" "+r.s2+" "+r.notes.join(" ")).toLowerCase();
  const statusVals = (r) => state.cve === "s1" ? [r.s1] : state.cve === "s2" ? [r.s2] : [...new Set([r.s1, r.s2])];
  const worst = (r) => [r.s1, r.s2].sort((a,b) => sev(a) - sev(b))[0] || "";

  // Rows in scope of the watchlist (all rows when the watchlist is empty).
  function scoped(){
    matchedRows = [];
    for (const r of data){ r._vm = vendorMatchers.length ? vendorsFor(r) : []; if (r._vm.length) matchedRows.push(r); }
    return vendorMatchers.length && view === "watch" ? matchedRows : data;
  }
  function filtered(base){
    terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    return (base || scoped()).filter(r => {
      if (state.letter && r._initial !== state.letter) return false;
      if (state.changed && changesLoaded && !changedIn(r, state.changed)) return false;
      if (state.statuses.size && !statusVals(r).some(v => state.statuses.has(v))) return false;
      return terms.every(t => r._hay.includes(t));
    });
  }
  function sorted(rows){
    const k = state.sortKey, d = state.sortDir;
    const val = (r) => (k === "s1" || k === "s2") ? sev(r[k]) : (r[k]||"").toLowerCase();
    return rows.slice().sort((a,b) => {
      const x = val(a), y = val(b);
      if (x < y) return -d; if (x > y) return d;
      return a.supplier.localeCompare(b.supplier) || a.product.localeCompare(b.product);
    });
  }

  // Highlight search terms. Works on the raw text and escapes every piece, so nothing
  // from the data or the search box can ever be interpreted as HTML.
  function hl(text){
    text = String(text ?? "");
    if (!terms.length) return esc(text);
    const re = new RegExp("(" + terms.map(escRe).join("|") + ")", "gi");
    return text.split(re).map((part, i) => i % 2 ? `<mark>${esc(part)}</mark>` : esc(part)).join("");
  }
  const badge = (s) => s ? `<span class="st ${esc(cls(s))}">${hl(s)}</span>` : `<span class="st-none">—</span>`;

  // ================= rendering =================
  function renderHead(){
    $("head").innerHTML = COLS.map(c => {
      const active = c.sort && state.sortKey === c.key;
      const arr = active ? `<span class="arr">${state.sortDir === 1 ? " ▲" : " ▼"}</span>` : "";
      const label = esc(c.label).replace(/^(Status|Version) /, "$1<br>").replace(/(CVE-\d+-\d+)/, '<span class="nowrap">$1</span>');
      return `<th class="${c.cls}" scope="col" ${c.sort ? `data-sort="${c.key}" tabindex="0" aria-sort="${active ? (state.sortDir===1?"ascending":"descending") : "none"}"` : ""}>${label}${arr}</th>`;
    }).join("");
    const sel = $("sortSel"), want = state.sortKey + ":1";
    if ([...sel.options].some(o => o.value === want)) sel.value = want;
    const col = COLS.find(c => c.key === state.sortKey);
  }

  function renderShared(){
    const box = $("vshared");
    box.hidden = !sharedView;
    if (!sharedView){ box.innerHTML = ""; return; }
    const mine = savedVendors();
    // One compact line: what this is, and the two choices. Static text plus numbers only.
    box.innerHTML = `<div class="shared-bar" role="status">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.2 1.2"/><path d="M14 10a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.2-1.2"/></svg>
      <span class="sb-text"><b>Shared list</b> · ${state.vendors.length} item${state.vendors.length === 1 ? "" : "s"}<span class="sb-sub"> · your own watchlist${mine.length ? ` (${mine.length})` : ""} is unchanged</span></span>
      <span class="sb-actions"><button type="button" class="btn primary sm" data-shared="save">Save as mine</button><button type="button" class="btn sm" data-shared="back">${mine.length ? "Back to mine" : "Close"}</button></span>
    </div>`;
  }
  function renderWatch(base){
    renderShared();
    if (!loaded){
      $("vtokens").innerHTML = tokensHtml(null);
      setWatchChrome();
      $("vfoot").hidden = !state.vendors.length;
      $("vsummary").textContent = state.vendors.length ? "Checking your watchlist against the list…" : "";
      return;
    }
    // tokens with per-vendor counts
    const per = state.vendors.map(v => ({ v, n: 0, vuln: 0 }));
    const idx = new Map(state.vendors.map((v,i) => [v, i]));
    for (const r of matchedRows) for (const v of r._vm){ const p = per[idx.get(v)]; p.n++; if (r.s1 === "Vulnerable" || r.s2 === "Vulnerable") p.vuln++; }
    $("vtokens").innerHTML = tokensHtml(per);
    setWatchChrome();
    $("vq").placeholder = state.vendors.length ? "Add a supplier, product or keyword…" : "Type a supplier, product or keyword — e.g. WordPress, Fortinet, Cisco";
    $("vview").hidden = !state.vendors.length;
    $("vview").querySelectorAll("[data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
    // numbers only, so innerHTML is safe here; short labels are used on phones
    $("vviewWatch").innerHTML = `Watchlist <b>${matchedRows.length.toLocaleString()}</b>`;
    $("vviewAll").innerHTML = `<span class="lg">All products</span><span class="sm">All</span> <b>${data.length.toLocaleString()}</b>`;
    if (!state.vendors.length){ $("vsummary").innerHTML = ""; return; }
    // Totals are already in the stat cards below, so only call out items with no matches.
    const missing = per.filter(p => !p.n).map(p => entryLabel(p.v));
    $("vfoot").hidden = !missing.length;
    $("vsummary").innerHTML = missing.length
      ? `<span class="missing"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>Not in the list: ${missing.map(esc).join(", ")}</span>`
      : "";
  }

  function renderStats(base){
    const c = Object.create(null);   // keyed by data values, so no inherited properties
    for (const r of base) statusVals(r).forEach(v => { if (v) c[v] = (c[v]||0) + 1; });
    const shown = STATUSES.filter(s => c[s] || state.statuses.has(s));
    const n = base.length;
    $("stats").innerHTML =
      `<div class="stat" data-all="1"><div class="lbl">${state.vendors.length && view === "watch" ? "Products in your watchlist" : "Products listed"}</div><div class="num">${n.toLocaleString()}</div></div>` +
      shown.map(s => `<button type="button" class="stat" data-status="${esc(s)}" aria-pressed="${state.statuses.has(s)}" title="Filter by ${esc(s)}">
        <div class="lbl"><span class="dot ${bg(s)}"></span>${esc(s)}</div>
        <div class="num">${(c[s]||0).toLocaleString()}</div>
        <span class="bar ${bg(s)}" data-w="${n ? Math.round((c[s]||0)/n*100) : 0}"></span>
      </button>`).join("");
    const total = shown.reduce((a,s) => a + (c[s]||0), 0) || 1;
    $("dist").innerHTML = shown.map(s => `<span class="${bg(s)}" data-w="${(c[s]||0)/total*100}"></span>`).join("");
    // Widths are applied through the DOM (allowed by the strict CSP) rather than inline style attributes.
    for (const el of document.querySelectorAll("#stats [data-w], #dist [data-w]")) el.style.width = Math.max(0, Math.min(100, Number(el.dataset.w) || 0)) + "%";
    // Toolbar shows only the active status filter(s), so they stay visible while scrolling.
    $("chips").innerHTML = [...state.statuses].map(s =>
      `<button type="button" class="chip on" data-status="${esc(s)}" aria-label="Remove filter ${esc(s)}"><span class="chip-k">Status</span><span class="st ${cls(s)}">${esc(s)}</span><span aria-hidden="true">✕</span></button>`
    ).join("") + (state.statuses.size > 1 ? `<button type="button" class="chip clear" data-clear="1">Clear all</button>` : "");
    $("filters").classList.toggle("no-chips", !state.statuses.size);
  }

  // A–Z supplier index (shown on desktop and tablet; hidden on phones, where search is quicker).
  function renderLetters(base){
    const present = new Set(base.map(r => r._initial));
    if (state.letter && !present.has(state.letter)) state.letter = "";
    const L = ["0-9", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
    $("letters").innerHTML = `<button type="button" data-letter="" aria-pressed="${!state.letter}">All</button>` +
      L.map(l => `<button type="button" data-letter="${l}" aria-pressed="${state.letter===l}" ${present.has(l)?"":"disabled"}>${l}</button>`).join("");
  }


  // First visit shows only the first part of the full list so the page is quick to scroll past.
  // Once the visitor clicks "Show all" or narrows the list in any way, the full list is shown
  // from then on, so clearing the search later brings back every product.
  const FIRST_PAGE = 50;
  let showAll = false;
  function renderSingle(rows){
    const box = $("single");
    box.hidden = !state.pid;
    if (!state.pid){ box.innerHTML = ""; return; }
    box.innerHTML = rows.length
      ? `<div class="single-bar" role="status"><span><b>Showing one product</b> from a product link.</span><button type="button" class="btn sm" data-single-clear>Show all products</button></div>`
      : notice("warn", "This product link doesn't match the current list", "<p>The product may have been renamed or removed from NCSC-NL's list since the link was made.</p>", `<button type="button" class="btn" data-single-clear>Show all products</button>`);
  }
  function renderBody(base){
    base = base || scoped();
    if (state.pid){
      const rows = data.filter(r => r.id === state.pid);
      renderSingle(rows);
      $("count").textContent = "";
      if (!rows.length){ $("body").innerHTML = ""; return; }
      lastRows = rows;
      $("body").innerHTML = rows.map(rowHtml).join("");
      for (const tr of $("body").rows) tr.classList.add("notes-open");
      scheduleNotes();
      return;
    }
    renderSingle([]);
    const rows = sorted(filtered(base));
    const filteredOn = state.q || state.statuses.size || state.letter || state.changed;
    const inWatch = state.vendors.length && view === "watch";
    if (filteredOn || inWatch) showAll = true;
    const limited = !showAll && rows.length > FIRST_PAGE;
    const scope = inWatch ? `${base.length.toLocaleString()} products in your watchlist` : `${data.length.toLocaleString()} products`;
    $("count").innerHTML = filteredOn
      ? (rows.length ? `<strong>${rows.length.toLocaleString()}</strong> of ${scope} match` : `No matches among ${scope}`)
      : inWatch ? `Showing <strong>${rows.length.toLocaleString()}</strong> products in your watchlist (of ${data.length.toLocaleString()})`
      : limited ? `Showing the first <strong>${FIRST_PAGE}</strong> of ${data.length.toLocaleString()} products`
      : `Showing all <strong>${data.length.toLocaleString()}</strong> products`;
    if (!rows.length){
      const what = [state.q && "search", state.statuses.size && "status filter", state.letter && "letter filter", state.changed && "recent-changes filter"].filter(Boolean);
      const tip = what.length
        ? `<p>Try fewer or different words${state.statuses.size || state.letter ? ", or clear the " + what.filter(w => w !== "search").join(" and ") : ""}.</p>`
        : `<p>None of the products for your watchlist vendors match. Check the vendor names in your watchlist.</p>`;
      $("body").innerHTML = `<tr><td colspan="7" class="state-cell">${notice("neutral", "No products match", tip,
        what.length ? `<button type="button" class="btn" data-reset="1">Clear search and filters</button>` : "")}</td></tr>`;
      return;
    }
    lastRows = rows;
    stopBatches();
    if (limited){
      $("body").innerHTML = rows.slice(0, FIRST_PAGE).map(rowHtml).join("") + `<tr class="more-row"><td colspan="7"><button type="button" class="btn" data-show-all>Show all ${rows.length.toLocaleString()} products</button><span class="more-hint">or search above to find a product</span></td></tr>`;
    } else {
      rendered = Math.min(rows.length, BATCH);
      $("body").innerHTML = rows.slice(0, rendered).map(rowHtml).join("") + (rendered < rows.length ? SENTINEL : "");
      watchSentinel();
    }
    scheduleNotes();
  }

  // Long lists are drawn in batches: the first BATCH rows straight away, the rest as the visitor
  // scrolls toward the end. Laying out hundreds of rows of wrapped notes at once is what made
  // "Show all" slow. Exports and search always use the full list, not what's on screen.
  const BATCH = 200;
  const SENTINEL = '<tr class="more-sentinel" aria-hidden="true"><td colspan="7"></td></tr>';
  let rendered = 0, batchObserver = null;
  function stopBatches(){ if (batchObserver){ batchObserver.disconnect(); batchObserver = null; } }
  function appendBatch(n = BATCH){
    const s = $("body").querySelector(".more-sentinel"); if (!s) return;
    const end = Math.min(lastRows.length, rendered + n);
    s.insertAdjacentHTML("beforebegin", lastRows.slice(rendered, end).map((r, k) => rowHtml(r, rendered + k)).join(""));
    rendered = end;
    if (rendered >= lastRows.length){ s.remove(); stopBatches(); }
    scheduleNotes();
  }
  function watchSentinel(){
    const s = $("body").querySelector(".more-sentinel"); if (!s) return;
    if (!("IntersectionObserver" in window)){ appendBatch(lastRows.length); return; }
    batchObserver = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) appendBatch(); }, { rootMargin: "1500px 0px" });
    batchObserver.observe(s);
  }
  // Printing (or saving as PDF) should include every row.
  addEventListener("beforeprint", () => appendBatch(lastRows.length));

  const LINK_ICON = '<i class="i-link" aria-hidden="true"></i>';   // drawn by CSS: fewer elements per row
  // A small "Changed 3 h ago" / "Added" marker for products changed in the last 24 hours
  // or since the last visit. Text is built from fixed words, statuses and times, all escaped.
  function changeMark(r){
    const e = changeById.get(r.id);
    if (!e || !(e.ts > recentCutoff() || (visitPrev && e.ts > visitPrev))) return "";
    const unseen = visitPrev && e.ts > visitPrev;
    const tip = `${changeSummary(e)} · ${new Date(e.ts).toLocaleString()}${unseen ? " · new since your last visit" : ""}`;
    return `<span class="chg${unseen ? " unseen" : ""}" title="${esc(tip)}">${e.prev ? "Changed" : "Added"} ${ago(e.ts)}<span class="sr-only">: ${esc(changeSummary(e))}</span></span>`;
  }
  function rowHtml(r, i){
    const showVm = view === "all" && state.vendors.length > 0;
    const on = hasEntry(productEntry(r));
    return `<tr>
      <td class="c-supplier">${hl(r.supplier)}${showVm && r._vm.length ? `<br><span class="vm" title="${esc("In your watchlist via: " + r._vm.map(entryLabel).join(", "))}">In watchlist</span>` : ""}</td>
      <td class="c-product"><div class="prod"><span class="pname">${hl(r.product)}</span><button type="button" class="pin" data-pin="${i}" aria-pressed="${on}" title="${on ? "Remove this product from your watchlist" : "Add this exact product to your watchlist"}" aria-label="${on ? "Unwatch" : "Watch"} ${esc(r.product)}">${on ? "★" : "☆"}<span>${on ? "Watching" : "Watch"}</span></button>${r.id ? `<button type="button" class="plink" data-plink="${i}" title="Copy a link to this product" aria-label="Copy a link to ${esc(r.product)}">${LINK_ICON}</button>` : ""}</div>${changeMark(r)}</td>
      <td class="c-version" data-label="Version">${hl(r.version)}</td>
      <td class="c-s" data-label="CVE-2026-109618">${badge(r.s1)}</td>
      <td class="c-s" data-label="CVE-2026-109619">${badge(r.s2)}</td>
      <td class="c-notes"><div class="notes">${r.notes.map(n => `<p>${hl(n)}</p>`).join("")}</div><button type="button" class="more-notes linkish" data-more-notes aria-expanded="false" hidden>Read more</button></td>
      <td class="c-links"><div class="links">${r.links.map(l => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">${esc(l.label)}</a>`).join("")}</div></td>
    </tr>`;
  }

  // "What changed" strip under the status overview. Numbers and fixed text only.
  // "What changed" bar under the status overview. Left: counts that filter the table (plain text
  // when there's nothing to filter). Right: links to all changes, patch progress and the feed.
  // Only numbers, fixed words and escaped dates are inserted.
  let latestChange = 0;
  function renderStrip(base){
    const box = $("changesStrip");
    if (!loaded){ box.hidden = true; return; }
    box.hidden = false;
    const links = `<span class="cs-links"><a href="/changes#kind=all">All changes</a><a href="/charts">Patch progress</a>
      ${state.vendors.length || watchOpen ? "" : `<button type="button" class="btn sm cs-create" data-create-watch>＋ Create watchlist</button>`}</span>`;
    const icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
    if (!changesLoaded){ box.innerHTML = `<span class="cs-main">${icon}<span class="cs-label">Recent changes</span></span>${links}`; return; }
    const inWatch = state.vendors.length && view === "watch";
    const n24 = base.filter(r => changedIn(r, "24h")).length;
    const nVisit = visitPrev ? base.filter(r => changedIn(r, "visit")).length : 0;
    const chip = (key, n, text, tip) => n || state.changed === key
      ? `<button type="button" class="cs-btn" data-changed="${key}" aria-pressed="${state.changed === key}"${tip ? ` title="${esc(tip)}"` : ""}><b>${n.toLocaleString()}</b> ${text}</button>`
      : "";
    const parts = [chip("24h", n24, "in the last 24 hours"), visitPrev ? chip("visit", nVisit, "since your last visit", `Since ${new Date(visitPrev).toLocaleString()}`) : ""].filter(Boolean);
    const quiet = !n24 ? `<span class="cs-quiet">${parts.length ? "" : "None in the last 24 hours"}${latestChange ? `${parts.length ? "" : " · "}last change ${ago(latestChange)}` : ""}</span>` : "";
    box.innerHTML = `<span class="cs-main">${icon}<span class="cs-label">${inWatch ? "Changes in your watchlist" : "Recent changes"}</span>${parts.join("")}${quiet}</span>${links}`;
  }
  function openWatch(){
    watchOpen = true; render();
    $("watchSection").scrollIntoView({ block: "start", behavior: "smooth" });
    $("vq").focus({ preventScroll: true });
  }
  $("vclose").addEventListener("click", () => { watchOpen = false; render(); });
  $("vfeed").addEventListener("click", () => {
    location.href = "/subscribe?" + state.vendors.map(v => "v=" + encodeURIComponent(v)).join("&");
  });
  $("changesStrip").addEventListener("click", e => {
    if (e.target.closest("[data-create-watch]")) { openWatch(); return; }
    const b = e.target.closest("[data-changed]"); if (!b || b.disabled) return;
    state.changed = state.changed === b.dataset.changed ? "" : b.dataset.changed;
    showAll = true; render();
    if (state.changed) $("results").scrollIntoView({ block: "start" });
  });
  $("single").addEventListener("click", e => {
    if (!e.target.closest("[data-single-clear]")) return;
    state.pid = ""; render();
  });
  async function copyText(text){
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
  }
  const productUrl = (r) => `${location.origin}/#p=${r.id}`;

  // Show "Read more" only on rows whose note text is actually cut off.
  function markClampedNotes(){
    if (!$("wrap").classList.contains("clamp")) { for (const b of $("body").querySelectorAll("[data-more-notes]")) b.hidden = true; return; }
    const cells = [...$("body").querySelectorAll("td.c-notes:not([data-measured])")];
    for (const td of cells) td.dataset.measured = "1";
    const cut = cells.map(td => [...td.querySelectorAll(".notes p + p")].some(p => p.scrollHeight > p.clientHeight + 1));   // read all first
    cells.forEach((td, i) => { const b = td.querySelector("[data-more-notes]"); if (b && !td.closest("tr").classList.contains("notes-open")) b.hidden = !cut[i]; });  // then write
  }
  let notesFrame;
  const scheduleNotes = () => { cancelAnimationFrame(notesFrame); notesFrame = requestAnimationFrame(markClampedNotes); };
  // Width changes (and switching note clamping back on) need every row measured again.
  const remeasureNotes = () => { for (const td of $("body").querySelectorAll("td.c-notes[data-measured]")) delete td.dataset.measured; scheduleNotes(); };
  addEventListener("resize", remeasureNotes);

  function render(){
    const base = scoped();
    renderHead(); renderWatch(base); renderStats(base); renderStrip(base); renderLetters(base); renderBody(base); writeUrl();
  }

  $("body").addEventListener("click", e => {
    if (e.target.closest("[data-show-all]")){
      showAll = true; renderBody();
      const next = $("body").rows[FIRST_PAGE];
      if (next) { const b = next.querySelector("button, a"); if (b) b.focus({ preventScroll: true }); }
      return;
    }
    if (e.target.closest("[data-reset]")){
      state.q = ""; $("q").value = ""; state.statuses.clear(); state.letter = ""; state.changed = ""; render(); $("q").focus();
    }
    if (e.target.closest("[data-retry]")) load();
    const more = e.target.closest("[data-more-notes]");
    if (more){
      const tr = more.closest("tr"), open = !tr.classList.contains("notes-open");
      tr.classList.toggle("notes-open", open);
      more.setAttribute("aria-expanded", String(open));
      more.textContent = open ? "Show less" : "Read more";
      return;
    }
    const pl = e.target.closest("[data-plink]");
    if (pl){
      const r = lastRows[+pl.dataset.plink]; if (!r || !ID_RE.test(r.id)) return;
      copyText(productUrl(r)).then(ok => {
        if (ok) toast(`Link to ${r.product} copied`, { action: { label: "Open", fn: () => { location.hash = "p=" + r.id; } } });
        else location.hash = "p=" + r.id;
      });
      return;
    }
    const pin = e.target.closest("[data-pin]");
    if (pin){
      const r = lastRows[+pin.dataset.pin]; if (!r) return;
      // Keep the clicked row where it is on screen, even if the watchlist box appears above it.
      const idx = pin.dataset.pin, y0 = pin.getBoundingClientRect().top;
      const keepPlace = () => { const nb = $("body").querySelector(`[data-pin="${idx}"]`); if (nb) scrollBy({ top: nb.getBoundingClientRect().top - y0, behavior: "instant" }); };
      const v = productEntry(r), wasEmpty = !state.vendors.length;
      if (hasEntry(v)){
        const before = state.vendors.slice();
        state.vendors = state.vendors.filter(x => x.toLowerCase() !== v.toLowerCase()); vendorsChanged();
        toast(`Stopped watching ${r.product}`, { action: { label: "Undo", fn: () => { state.vendors = before; vendorsChanged(); } } });
      } else {
        if (wasEmpty) view = "all";       // keep browsing the full list while starring
        addVendors([v]); keepPlace();
        requestAnimationFrame(() => requestAnimationFrame(keepPlace));   // again after "Read more" links settle
        toast(`Watching ${r.product} (${r.supplier})`, view === "all"
          ? { action: { label: "Show watchlist", fn: () => { view = "watch"; render(); $("results").scrollIntoView(); } } } : {});
      }
    }
  });
  $("vview").addEventListener("click", e => {
    const b = e.target.closest("[data-view]"); if (!b) return;
    view = b.dataset.view; render();
  });

  // ================= exports =================
  function download(name, text, type){
    const blob = new Blob([text], {type});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return name;
  }
  const today = () => new Date().toISOString().slice(0,10);
  const fileBase = () => `php2list${state.vendors.length ? "-watchlist" : ""}-${today()}`;
  // Prefix cells that a spreadsheet could treat as a formula (OWASP CSV injection guidance),
  // including after leading whitespace and the full-width variants some spreadsheets accept.
  const csvCell = (v) => { let s = String(v ?? ""); if (/^[\s\u3000]*[=+\-@\t\r|\uFF1D\uFF0B\uFF0D\uFF20]/.test(s)) s = "'" + s; return `"${s.replace(/"/g,'""')}"`; };
  const csv = (rows) => "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n");

  // Where the data came from and how this file was made, written at the top of every export.
  const SOURCE_URL = "https://github.com/NCSC-NL/php2shell/tree/main/software";
  function filtersText(){
    const parts = [];
    if (state.vendors.length) parts.push(`Watchlist (${view === "watch" ? "watchlist view" : "all products view"}): ${state.vendors.map(entryLabel).join("; ")}`);
    if (state.q) parts.push(`Search: ${state.q}`);
    if (state.statuses.size) parts.push(`Status: ${[...state.statuses].join(", ")} (${state.cve === "s1" ? "CVE-2026-109618" : state.cve === "s2" ? "CVE-2026-109619" : "either CVE"})`);
    if (state.letter) parts.push(`Supplier letter: ${state.letter}`);
    if (state.changed) parts.push(state.changed === "24h" ? "Changed in the last 24 hours" : "Changed since the last visit");
    return parts.join(" | ") || "None (full list)";
  }
  function provenance(count, countLabel){
    const now = new Date();
    return [
      ["PHP2List export"],
      ["Source list", "NCSC-NL php2shell software list (NCSC-NL and contributors)"],
      ["Source address", SOURCE_URL],
      ["Source licence", "EUPL-1.2 · TLP:CLEAR"],
      ["Source list last updated", listUpdated || "Unknown"],
      ["Generated by", `PHP2List (${location.origin})`],
      ["Generated at", `${now.toISOString()} (UTC) · ${now.toLocaleString()} local time`],
      [countLabel, count],
      ["Filters applied", filtersText()],
      ["Notice", "PHP2List is an unofficial site, not affiliated with NCSC-NL or php2shell.com. This is a copy of public data and may be out of date or incomplete. Accuracy is not guaranteed; check the source list and your vendors before acting on it."],
      [],
    ];
  }

  function exportProducts(){
    const rows = sorted(filtered());
    const withV = state.vendors.length > 0;
    const out = [...provenance(rows.length, "Products in this export"), [...(withV ? ["Matched watchlist item"] : []), ...COLS.map(c => c.label), "Highest status (either CVE)", "PHP2List link"]];
    for (const r of rows){
      out.push([...(withV ? [r._vm.map(entryLabel).join("; ")] : []), r.supplier, r.product, r.version, r.s1, r.s2, r.notes.join(" | "), r.links.map(l => l.url).join(" "), worst(r), r.id ? productUrl(r) : ""]);
    }
    const f = download(`${fileBase()}-products.csv`, csv(out), "text/csv;charset=utf-8");
    toast(`Downloaded ${f} · ${rows.length.toLocaleString()} product${rows.length === 1 ? "" : "s"}`);
  }

  function exportSummary(){
    const rows = filtered();
    const order = ["Vulnerable","Workaround","Investigation","Fix","Not vuln"];
    const groups = new Map();
    const keyList = state.vendors.length ? state.vendors : [...new Set(rows.map(r => r.supplier))].sort((a,b) => a.localeCompare(b));
    keyList.forEach(k => groups.set(k, { n:0, c:Object.create(null) }));
    for (const r of rows){
      const keys = state.vendors.length ? r._vm : [r.supplier];
      for (const k of keys){ const g = groups.get(k); if (!g) continue; g.n++; const w = sev(worst(r)) < 5 ? worst(r) : "Unknown"; g.c[w] = (g.c[w]||0) + 1; }
    }
    const withV = state.vendors.length > 0;
    const out = [...provenance(groups.size, withV ? "Watchlist items in this export" : "Suppliers in this export"), [withV ? "Watchlist item" : "Supplier", ...(withV ? ["Type"] : []), "Products in list", ...order, "Unknown", "Status"]];
    for (const [k, g] of groups){
      const status = !g.n ? "Not in list" : g.c.Vulnerable ? "Has vulnerable products" : g.c.Workaround ? "Workaround available" : g.c.Investigation ? "Under investigation" : "Fixed / not vulnerable";
      out.push([withV ? entryLabel(k) : k, ...(withV ? [KIND[parseEntry(k).type]] : []), g.n, ...order.map(s => g.c[s] || 0), g.c.Unknown || 0, status]);
    }
    out.push([]);
    out.push(["Counts use the highest-severity status of CVE-2026-109618 and CVE-2026-109619 for each product."]);
    const f = download(`${fileBase()}-vendor-summary.csv`, csv(out), "text/csv;charset=utf-8");
    toast(`Downloaded ${f} · ${groups.size.toLocaleString()} row${groups.size === 1 ? "" : "s"}`);
  }

  function exportJson(){
    const rows = sorted(filtered());
    const payload = {
      source: { name: "NCSC-NL php2shell software list", publisher: "NCSC-NL and contributors", url: SOURCE_URL, licence: "EUPL-1.2", tlp: "CLEAR", lastUpdated: listUpdated || null },
      generatedBy: `PHP2List (${location.origin})`,
      generatedAt: new Date().toISOString(),
      notice: "PHP2List is an unofficial site, not affiliated with NCSC-NL or php2shell.com. This is a copy of public data and may be out of date or incomplete. Accuracy is not guaranteed; check the source list and your vendors before acting on it.",
      filtersApplied: filtersText(),
      filters: { search: state.q || null, statuses: [...state.statuses], statusAppliesTo: state.cve, letter: state.letter || null,
        watchlist: state.vendors.map(v => ({ ...parseEntry(v), label: entryLabel(v) })), view },
      count: rows.length,
      items: rows.map(r => ({
        ...(state.vendors.length ? { matchedWatchlist: r._vm.map(entryLabel) } : {}),
        id: r.id || null, url: r.id ? productUrl(r) : null,
        supplier: r.supplier, product: r.product, version: r.version,
        "CVE-2026-109618": r.s1, "CVE-2026-109619": r.s2, highestStatus: worst(r),
        notes: r.notes, links: r.links,
      })),
    };
    const f = download(`${fileBase()}-products.json`, JSON.stringify(payload, null, 2), "application/json");
    toast(`Downloaded ${f} · ${rows.length.toLocaleString()} product${rows.length === 1 ? "" : "s"}`);
  }

  // ================= vendor input + suggestions =================
  const vq = $("vq"), vsug = $("vsug");
  let sugItems = [], sugIdx = -1;
  function openSug(){
    const raw = vq.value.trim(), t = raw.toLowerCase();
    if (!t){ closeSug(); return; }
    const rank = (name) => { const i = name.toLowerCase().indexOf(t); return i < 0 ? -1 : i === 0 ? 0 : 1; };
    const sup = suppliers.filter(s => rank(s.name) >= 0 && !hasEntry("s:" + s.name))
      .sort((x, y) => rank(x.name) - rank(y.name) || x.name.localeCompare(y.name)).slice(0, 6)
      .map(s => ({ kind: "supplier", value: "s:" + s.name, name: s.name, n: s.n }));
    const prod = data.filter(r => rank(r.product) >= 0 && !hasEntry(productEntry(r)))
      .sort((x, y) => rank(x.product) - rank(y.product) || x.product.localeCompare(y.product)).slice(0, 6)
      .map(r => ({ kind: "product", value: productEntry(r), name: r.product, sub: r.supplier, n: 1 }));
    const kw = hasEntry(raw) ? [] : [{ kind: "keyword", value: raw, name: raw, n: data.filter(r => vendorRe(t).test(r._vhay)).length }];
    // Exact supplier name typed? offer that first; otherwise the keyword comes first.
    const exactSup = sup.findIndex(s => s.name.toLowerCase() === t);
    const groups = exactSup >= 0
      ? [["Suppliers", sup], ["Products", prod], ["Keyword", kw]]
      : [["Keyword", kw], ["Suppliers", sup], ["Products", prod]];
    sugItems = []; let html = "";
    for (const [title, items] of groups){
      if (!items.length) continue;
      html += `<li class="grp" role="presentation">${title}</li>`;
      for (const s of items){
        const i = sugItems.push(s) - 1;
        const main = s.kind === "keyword" ? `Any name containing the word “${esc(s.name)}”` : esc(s.name);
        const sub = s.kind === "product" ? `<em>${esc(s.sub)}</em>` : "";
        html += `<li role="option" id="vs${i}" data-i="${i}" class="k-${s.kind}"><span>${main}${sub}</span><small>${s.n} product${s.n === 1 ? "" : "s"}</small></li>`;
      }
    }
    if (!sugItems.length){ closeSug(); return; }
    sugIdx = 0;
    vsug.innerHTML = html;
    vsug.querySelector("#vs0").setAttribute("aria-selected", "true");
    vsug.hidden = false; vq.setAttribute("aria-expanded", "true"); vq.setAttribute("aria-activedescendant", "vs0");
    placeSug();
  }
  // Fit the list to the space on screen: open below if there's room, otherwise above, never off-screen.
  function placeSug(){
    if (vsug.hidden) return;
    const r = $("vfield").getBoundingClientRect(), gap = 12;
    const below = innerHeight - r.bottom - gap, above = r.top - gap;
    const up = below < 220 && above > below;
    vsug.classList.toggle("up", up);
    vsug.style.maxHeight = Math.max(140, Math.min(360, up ? above : below)) + "px";
  }
  addEventListener("resize", placeSug);
  addEventListener("scroll", placeSug, { passive: true });
  function closeSug(){ vsug.hidden = true; vq.setAttribute("aria-expanded", "false"); vq.removeAttribute("aria-activedescendant"); sugItems = []; sugIdx = -1; }
  function moveSug(d){
    if (!sugItems.length) return;
    sugIdx = (sugIdx + d + sugItems.length) % sugItems.length;
    vsug.querySelectorAll("[role=option]").forEach(li => li.setAttribute("aria-selected", String(+li.dataset.i === sugIdx)));
    vq.setAttribute("aria-activedescendant", "vs" + sugIdx);
    $("vs" + sugIdx).scrollIntoView({block:"nearest"});
  }
  function pickSug(i){
    const s = sugItems[i]; if (!s || !s.name) return;
    vq.value = ""; closeSug(); addVendors([s.value]); vq.focus();
  }
  vq.addEventListener("input", () => {
    // Typing or pasting a comma/semicolon/newline-separated list adds them all at once.
    if (/[,;\n]/.test(vq.value)){ const parts = vq.value.split(/[,;\n]+/); vq.value = parts.pop(); addVendors(parts); }
    openSug();
  });
  vq.addEventListener("keydown", e => {
    if (e.key === "ArrowDown"){ e.preventDefault(); moveSug(1); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); moveSug(-1); }
    else if (e.key === "Enter"){ e.preventDefault(); if (sugItems.length) pickSug(Math.max(sugIdx, 0)); else if (vq.value.trim()) { addVendors([vq.value]); vq.value = ""; } }
    else if (e.key === "Escape"){ closeSug(); }
    else if (e.key === "Backspace" && !vq.value && state.vendors.length){ removeVendor(state.vendors.length - 1); }
  });
  vq.addEventListener("blur", () => setTimeout(closeSug, 150));
  vsug.addEventListener("mousedown", e => { const li = e.target.closest("li[data-i]"); e.preventDefault(); if (li) pickSug(+li.dataset.i); });
  $("vfield").addEventListener("click", e => {
    const rm = e.target.closest("button[data-rm]");
    if (rm){ removeVendor(+rm.dataset.rm); return; }
    if (e.target === $("vfield")) vq.focus();
  });
  $("vshared").addEventListener("click", e => {
    const b = e.target.closest("[data-shared]"); if (!b) return;
    if (b.dataset.shared === "save"){
      const prev = savedVendors();
      sharedView = false; store.set(LS_VENDORS, JSON.stringify(state.vendors)); render();
      toast(`Saved ${state.vendors.length} vendor${state.vendors.length === 1 ? "" : "s"} as your watchlist`,
        prev.length ? { action: { label: "Undo", fn: () => { store.set(LS_VENDORS, JSON.stringify(prev)); state.vendors = prev; vendorsChanged(); } } } : {});
    } else {
      sharedView = false; state.vendors = savedVendors(); vendorsChanged();
      toast(state.vendors.length ? "Back to your own watchlist" : "Closed the shared list");
    }
  });

  // ---- share dialog ----
  const shareDlg = $("shareDlg");
  function shareLink(what){
    const p = new URLSearchParams();
    if (what === "all"){
      if (state.q) p.set("q", state.q);
      if (state.statuses.size) p.set("status", [...state.statuses].join(","));
      if (state.cve !== "any") p.set("cve", state.cve);
      if (state.letter) p.set("l", state.letter);
      if (state.sortKey !== "supplier") p.set("sort", state.sortKey);
      if (state.sortDir === -1) p.set("dir", "desc");
    }
    state.vendors.forEach(v => p.append("v", v));
    const qs = p.toString();
    return location.origin + location.pathname + (qs ? "#" + qs : "");
  }
  function updateShareDlg(){
    const what = shareDlg.querySelector("input[name=shareWhat]:checked").value;
    $("shareUrl").value = shareLink(what);
    const n = state.vendors.length;
    $("shareVendorsHint").textContent = n ? `${n} item${n === 1 ? "" : "s"}: ${state.vendors.slice(0, 4).map(entryLabel).join(", ")}${n > 4 ? ", …" : ""}` : "No vendors in your watchlist yet; this links to the full list";
    const f = [state.q && `search “${state.q}”`, state.statuses.size && [...state.statuses].join(" / "), state.letter && `letter ${state.letter}`].filter(Boolean);
    $("shareAllHint").textContent = f.length ? `Also keeps: ${f.join(", ")}` : "No search or filters are active right now";
  }
  $("vshare").addEventListener("click", () => {
    const anyFilter = state.q || state.statuses.size || state.letter;
    shareDlg.querySelector(`input[value=${state.vendors.length || !anyFilter ? "vendors" : "all"}]`).checked = true;
    $("bmKey").textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘D" : "Ctrl+D";
    $("shareNative").hidden = !navigator.share;
    updateShareDlg(); shareDlg.showModal(); $("shareCopy").focus();
  });
  shareDlg.addEventListener("change", updateShareDlg);
  $("shareUrl").addEventListener("focus", e => e.target.select());
  $("shareCopy").addEventListener("click", async () => {
    const url = $("shareUrl").value;
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; }
    catch(e){ const i = $("shareUrl"); i.focus(); i.select(); try { ok = document.execCommand("copy"); } catch(_){} }
    if (ok){ $("shareCopy").textContent = "Copied"; setTimeout(() => $("shareCopy").textContent = "Copy link", 1600); toast("Link copied. Paste it anywhere to share, or bookmark it."); }
    else toast("Couldn't copy automatically. The link is selected, so press Ctrl+C (⌘C on Mac) to copy it.", { warn: true });
  });
  $("shareNative").addEventListener("click", async () => {
    try { await navigator.share({ title: "PHP2List – my watchlist", text: "PHP2Shell software list filtered to my watchlist (unofficial viewer)", url: $("shareUrl").value }); } catch(e){}
  });

  $("vtokens").addEventListener("click", e => {
    const b = e.target.closest("[data-tokens]"); if (!b) return;
    e.stopPropagation();
    tokensExpanded = b.dataset.tokens === "more"; renderWatch(scoped());
  });
  $("vhelpToggle").addEventListener("click", e => {
    const open = e.currentTarget.getAttribute("aria-expanded") !== "true";
    e.currentTarget.setAttribute("aria-expanded", String(open));
    e.currentTarget.textContent = open ? "Hide help" : "How it works";
    $("vhelp").hidden = !open;
  });
  $("vmore").addEventListener("click", e => {
    const b = e.target.closest("[data-more]"); if (!b) return;
    $("vmore").open = false;
    if (b.dataset.more === "paste") $("vpaste").click();
    if (b.dataset.more === "clear") clearAll();
  });
  document.addEventListener("click", e => { if (!e.target.closest("#vmore")) $("vmore").open = false; });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && $("vmore").open){ $("vmore").open = false; $("vmore").querySelector("summary").focus(); } });

  function clearAll(){
    const before = state.vendors.slice();
    state.vendors = []; tokensExpanded = false; vendorsChanged();
    toast(`Cleared ${before.length} item${before.length === 1 ? "" : "s"} from your watchlist`, { action: { label: "Undo", fn: () => { state.vendors = before; vendorsChanged(); } } });
  }

  // paste dialog
  const dlg = $("pasteDlg");
  $("vpaste").addEventListener("click", () => { $("vpasteText").value = ""; $("vreplace").checked = false; dlg.showModal(); $("vpasteText").focus(); });
  dlg.addEventListener("close", () => {
    if (dlg.returnValue !== "ok") return;
    // One item per line (or comma/semicolon/tab). "Supplier :: Product" pins an exact product;
    // "supplier: Name" pins an exact supplier; anything else is a keyword.
    const list = $("vpasteText").value.split(/[\n,;\t]+/).map(x => {
      x = x.trim();
      const pm = x.match(/^(.+?)\s*::\s*(.+)$/); if (pm) return `p:${pm[1]}${PSEP}${pm[2]}`;
      const sm = x.match(/^supplier\s*:\s*(.+)$/i); if (sm) return `s:${sm[1]}`;
      return x;
    });
    const r = addVendors(list, $("vreplace").checked);
    const msg = r.added ? `Added ${r.added} item${r.added === 1 ? "" : "s"} to your watchlist` : "Nothing new to add";
    toast(msg + (r.dup ? ` · ${r.dup} already there` : ""), { warn: !r.added,
      action: r.added || $("vreplace").checked ? { label: "Undo", fn: () => { state.vendors = r.before; vendorsChanged(); } } : null });
  });

  // ================= other events =================
  let t;
  $("q").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); renderBody(); writeUrl(); }, 120); });
  $("cve").addEventListener("change", e => { state.cve = e.target.value; render(); });
  const toggleStatus = (e) => {
    const b = e.target.closest("button"); if (!b) return false;
    if (b.dataset.clear) state.statuses.clear();
    else if (b.dataset.status) { const s = b.dataset.status; state.statuses.has(s) ? state.statuses.delete(s) : state.statuses.add(s); }
    else return false;
    render(); return true;
  };
  $("chips").addEventListener("click", toggleStatus);
  $("stats").addEventListener("click", e => { if (toggleStatus(e)) $("results").scrollIntoView(); });
  $("letters").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    state.letter = b.dataset.letter; render();
  });
  const sortBy = (th) => {
    const k = th.dataset.sort; if (!k) return;
    if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = 1; }
    renderHead(); renderBody(); writeUrl();
  };
  $("sortSel").addEventListener("change", e => {
    const [k] = e.target.value.split(":"); state.sortKey = k; state.sortDir = 1;
    renderHead(); renderBody(); writeUrl();
  });
  $("head").addEventListener("click", e => { const th = e.target.closest("th"); if (th) sortBy(th); });
  $("head").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.dataset.sort){ e.preventDefault(); sortBy(e.target); } });
  $("toggleNotes").addEventListener("click", e => {
    const on = $("wrap").classList.toggle("clamp");
    e.currentTarget.setAttribute("aria-pressed", String(!on));
    e.currentTarget.textContent = on ? "Expand notes" : "Collapse notes";
    remeasureNotes();
  });
  $("export").addEventListener("click", e => {
    const b = e.target.closest("button[data-export]"); if (!b) return;
    if (!data.length){ toast("The list hasn't loaded yet, so there's nothing to export.", { warn: true }); $("export").open = false; return; }
    ({ csv: exportProducts, summary: exportSummary, json: exportJson })[b.dataset.export]();
    $("export").open = false;
  });
  document.addEventListener("click", e => { if (!e.target.closest("#export")) $("export").open = false; });
  document.addEventListener("keydown", e => {
    if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $("q").focus(); }
    if (e.key === "Escape") $("export").open = false;
  });
  const toTop = $("toTop");
  addEventListener("scroll", () => toTop.classList.toggle("show", scrollY > 700), {passive:true});
  toTop.addEventListener("click", () => scrollTo({top:0}));

  // ================= load =================
  readUrl();
  $("q").value = state.q; $("cve").value = state.cve;
  renderHead(); renderWatch([]);
  // Data from the API is treated as untrusted: coerce every field to the expected type and size,
  // keep only http(s) links, and drop anything malformed, so bad data can't break the page.
  const str = (v, max) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, max);
  function normItem(r){
    if (!r || typeof r !== "object") return null;
    const it = {
      id: typeof r.id === "string" && ID_RE.test(r.id) ? r.id : "",
      supplier: str(r.supplier, 500), product: str(r.product, 500), version: str(r.version, 500),
      s1: str(r.s1, 40), s2: str(r.s2, 40),
      notes: Array.isArray(r.notes) ? r.notes.slice(0, 20).map(n => str(n, 4000)).filter(Boolean) : [],
      links: Array.isArray(r.links) ? r.links.slice(0, 20).filter(l => l && typeof l.url === "string" && /^https?:\/\//i.test(l.url) && l.url.length <= 2000)
        .map(l => ({ label: str(l.label, 100) || "source", url: l.url })) : [],
    };
    return it.supplier || it.product ? it : null;
  }
  function load(){
    $("body").innerHTML = `<tr><td colspan="7" class="loading"><div class="spinner"></div>Loading the software list…</td></tr>`;
    $("count").textContent = "Loading…";
    fetch(API_URL).then(r => r.json().then(j => ({ok:r.ok, j, cache:r.headers.get("x-data-cache")}))).then(({ok, j, cache}) => {
      if (!ok || !j || !Array.isArray(j.items)) throw new Error(typeof j?.error === "string" ? j.error.slice(0, 200) : "Unexpected response");
      data = j.items.slice(0, 20000).map(normItem).filter(Boolean).map(r => ({...r, _hay: haystack(r), _vhay: (r.supplier + " " + r.product).toLowerCase(), _sup: r.supplier.toLowerCase(), _prod: r.product.toLowerCase(), _initial: initial(r.supplier), _vm: []}));
      loaded = true;
      const counts = new Map();
      data.forEach(r => counts.set(r.supplier, (counts.get(r.supplier)||0) + 1));
      suppliers = [...counts].map(([name, n]) => ({ name, n })).sort((a,b) => a.name.localeCompare(b.name));
      listUpdated = str(j.listUpdated, 100);
      const f = Date.parse(j.fetchedAt);
      fetchedAt = Number.isFinite(f) && f <= Date.now() + 5 * 60e3 ? f : 0;
      showFreshness();
      const arch = $("archived");
      arch.hidden = j.sourceArchived !== true;
      if (j.sourceArchived === true) arch.innerHTML = notice("warn", "This list is no longer being updated",
        `<p>NCSC-NL has archived the php2shell software list. What you see here is its final version${listUpdated ? `, last updated ${esc(listUpdated)}` : ""}. Check with vendors directly for anything newer.</p>`);
      // Say so whenever the data comes from a mirror rather than the official repository.
      const sn = $("srcNote");
      sn.hidden = j.official !== false;
      if (j.official === false) sn.textContent = `Loaded from a mirror (${str(j.sourceLabel, 120) || "unknown"}), not the official NCSC-NL repository.`;
      const stale = $("stale");
      stale.hidden = cache !== "STALE";
      if (cache === "STALE") stale.innerHTML = notice("warn", "Showing a saved copy of the list",
        `<p>GitHub couldn't be reached just now, so changes made in the last few hours may be missing. The list will refresh automatically when GitHub is available again.</p>`);
      render();
    }).catch(err => {
      $("count").textContent = "";
      $("updated").textContent = "List status unavailable";
      $("body").innerHTML = `<tr><td colspan="7" class="state-cell">${notice("danger", "Couldn't load the software list",
        `<p>${esc(err.message)} The list is read from GitHub, which didn't respond as expected. This is usually temporary.</p>`,
        `<button type="button" class="btn" data-retry="1">Try again</button><a class="btn" href="https://github.com/NCSC-NL/php2shell/tree/main/software" target="_blank" rel="noopener noreferrer">Open the list on GitHub</a>`)}</td></tr>`;
      renderWatch([]);
      if (state.vendors.length) $("vsummary").textContent = "Vendor matches will show once the list loads.";
    });
  }
  // When the list was updated by NCSC-NL, and when this site last checked it.
  function showFreshness(){
    const checked = fetchedAt ? `checked ${ago(fetchedAt)}` : "";
    $("updated").textContent = [listUpdated && `List updated ${listUpdated}`, checked].filter(Boolean).join(" · ");
    if (fetchedAt) $("updated").title = `NCSC-NL's last status update: ${listUpdated || "unknown"}. This site last fetched the list ${new Date(fetchedAt).toLocaleString()}.`;
  }
  setInterval(() => { if (loaded) showFreshness(); }, 60e3);

  // Recent status changes: optional. If they can't be loaded, the page works as before.
  function loadChanges(){
    fetch(CHANGES_URL).then(r => r.ok ? r.json() : null).then(j => {
      if (!j || !Array.isArray(j.events)) return;
      const m = new Map();
      for (const e of j.events.slice(0, 5000)){
        if (!e || typeof e !== "object" || typeof e.id !== "string" || !ID_RE.test(e.id)) continue;
        const ts = Date.parse(e.t);
        if (!Number.isFinite(ts) || m.has(e.id)) continue;          // newest first: keep the first
        const p = e.prev && typeof e.prev === "object" ? { s1: str(e.prev.s1, 40), s2: str(e.prev.s2, 40) } : null;
        m.set(e.id, { ts, s1: str(e.s1, 40), s2: str(e.s2, 40), prev: p });
      }
      changeById = m; changesLoaded = true;
      latestChange = Math.max(0, ...[...m.values()].map(e => e.ts).filter(t => t <= Date.now()));
      if (state.changed) showAll = true;
      if (loaded) render();
    }).catch(() => {});
  }
  load();
  loadChanges();     // in parallel with the list; markers appear once both have arrived
})();
