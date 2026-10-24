// SPDX-License-Identifier: MIT
// PHP2List charts page. Draws SVG charts from /api/software (current list) and
// /api/timeline (status history rebuilt from the NCSC-NL changelog).
// All text from the data is inserted with textContent or escaped, never as raw HTML.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const NS = "http://www.w3.org/2000/svg";
  const STATUS = ["Vulnerable", "Workaround", "Investigation", "Unknown", "Fix", "Not vuln"];
  const LABEL = { "Vulnerable": "Vulnerable", "Workaround": "Workaround", "Investigation": "Under investigation", "Unknown": "No status yet", "Fix": "Fixed", "Not vuln": "Not vulnerable" };
  const COLOR = { "Vulnerable": "var(--vuln-bar)", "Workaround": "var(--wa-bar)", "Investigation": "var(--inv-bar)", "Unknown": "var(--faint)", "Fix": "var(--fix-bar)", "Not vuln": "var(--nv-bar)" };
  const SEV = Object.freeze(Object.assign(Object.create(null), { "Vulnerable": 0, "Workaround": 1, "Investigation": 2, "Fix": 3, "Not vuln": 4 }));
  const isStatus = (s) => typeof s === "string" && Object.hasOwn(SEV, s);
  const OPEN = ["Vulnerable", "Workaround", "Investigation", "Unknown"];
  const DONE = ["Fix", "Not vuln"];
  const worst = (r) => { const w = [r.s1, r.s2].sort((a, b) => (isStatus(a) ? SEV[a] : 9) - (isStatus(b) ? SEV[b] : 9))[0]; return isStatus(w) ? w : "Unknown"; };
  const sum = (p, keys) => keys.reduce((a, k) => a + (p[k] || 0), 0);
  const pct = (n, d) => d ? Math.round(n / d * 1000) / 10 : 0;
  const fmtN = (n) => n.toLocaleString();
  const fmtTime = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const fmtDay = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
  const fmtHour = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

  let items = [], tl = null, mode = "count";

  function el(tag, attrs = {}, parent){
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, str, attrs = {}){
    const t = el("text", { x, y, ...attrs }, parent); t.textContent = str; return t;
  }

  // ---------------- headline numbers ----------------
  function renderKpis(){
    const c = Object.create(null); items.forEach(r => { const w = worst(r); c[w] = (c[w] || 0) + 1; });
    const total = items.length, fixed = c.Fix || 0, nv = c["Not vuln"] || 0, open = sum(c, OPEN);
    // change over the last 24 hours, from the timeline
    const last = tl.points[tl.points.length - 1];
    const dayAgo = Date.parse(last.t) - 864e5;
    const prev = [...tl.points].reverse().find(p => Date.parse(p.t) <= dayAgo && p.total > 0);
    const delta = (now, then) => {
      if (then == null) return "";
      const d = now - then;
      return d === 0 ? "no change in 24 h" : `${d > 0 ? "+" : "−"}${fmtN(Math.abs(d))} in last 24 h`;
    };
    const cards = [
      { k: "total", label: "Products listed", n: total, sub: prev ? delta(total, prev.total) : "", color: "var(--accent)" },
      { k: "open", label: "Still open", n: open, sub: `${pct(open, total)}% · vulnerable, no fix or under investigation`, color: "var(--vuln-bar)", d: prev ? delta(open, sum(prev, OPEN)) : "" },
      { k: "fixed", label: "Fixed", n: fixed, sub: `${pct(fixed, total)}% of listed products`, color: "var(--fix-bar)", d: prev ? delta(fixed, prev.Fix || 0) : "" },
      { k: "nv", label: "Not vulnerable", n: nv, sub: `${pct(nv, total)}% of listed products`, color: "var(--nv-bar)", d: prev ? delta(nv, prev["Not vuln"] || 0) : "" },
    ];
    const box = $("kpis"); box.textContent = "";
    for (const k of cards){
      const d = document.createElement("div"); d.className = "kpi"; d.style.setProperty("--k", k.color);
      const l = document.createElement("div"); l.className = "kpi-l"; l.textContent = k.label;
      const n = document.createElement("div"); n.className = "kpi-n"; n.textContent = fmtN(k.n);
      const s = document.createElement("div"); s.className = "kpi-s"; s.textContent = k.sub;
      d.append(l, n, s);
      if (k.d){ const dd = document.createElement("div"); dd.className = "kpi-d"; dd.textContent = k.d; d.append(dd); }
      box.append(d);
    }
  }

  // ---------------- shared time axis ----------------
  function frame(svgId, height){
    const svg = $(svgId); svg.textContent = "";
    const W = Math.max(300, svg.parentElement.clientWidth), H = height;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", W); svg.setAttribute("height", H);
    const m = { l: 46, r: 14, t: 14, b: 40 };
    const t0 = Date.parse(tl.points[0].t), t1 = Date.parse(tl.points[tl.points.length - 1].t);
    const x = (t) => m.l + (t - t0) / (t1 - t0 || 1) * (W - m.l - m.r);
    return { svg, W, H, m, x, t0, t1 };
  }
  // Round an axis maximum up to a "nice" value with 4 even steps (e.g. 782 -> 800).
  function niceMax(v){
    if (v <= 0) return 4;
    const raw = v / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw);
    return step * 4;
  }
  function axes(f, yMax, yFmt){
    const { svg, W, H, m, x, t0, t1 } = f;
    const y = (v) => H - m.b - v / (yMax || 1) * (H - m.t - m.b);
    const g = el("g", { class: "axis" }, svg);
    const ticks = 4;
    for (let i = 0; i <= ticks; i++){
      const v = yMax / ticks * i, yy = y(v);
      el("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: i ? "grid" : "base" }, g);
      text(g, m.l - 8, yy + 4, yFmt(v), { "text-anchor": "end" });
    }
    // time ticks: one per day at midnight, plus intermediate hours if space allows
    const span = t1 - t0, px = W - m.l - m.r;
    const stepH = span / 3.6e6 <= 72 ? (px > 700 ? 6 : 12) : 24;
    const start = new Date(t0); start.setMinutes(0, 0, 0);
    for (let t = start.getTime(); t <= t1; t += 3.6e6){
      const d = new Date(t);
      if (d.getHours() % stepH) continue;
      const xx = x(t); if (xx < m.l - 1 || xx > W - m.r + 1) continue;
      el("line", { x1: xx, x2: xx, y1: H - m.b, y2: H - m.b + 4, class: "base" }, g);
      const midnight = d.getHours() === 0;
      text(g, xx, H - m.b + 16, midnight ? fmtDay.format(d) : fmtHour.format(d), { "text-anchor": "middle", class: midnight ? "strong" : "" });
    }
    // shade the period between disclosure and the list's first publication (no data yet)
    const tD = Date.parse(tl.disclosure), tF = Date.parse(tl.firstEntry);
    if (tF > tD && tD >= t0){
      const x0 = x(tD), x1 = x(tF);
      el("rect", { x: x0, y: m.t, width: Math.max(0, x1 - x0), height: H - m.t - m.b, class: "prelist" }, g);
      if (x1 - x0 > 120) text(g, (x0 + x1) / 2, (m.t + H - m.b) / 2, "List not yet published", { "text-anchor": "middle", class: "prelist-l" });
    }
    // disclosure + list-published markers; stagger the labels if they would overlap
    const marks = [[tD, "Fixes released & disclosed"], [tF, "List first published"]];
    let lastX = -1e9, row = 0;
    for (const [t, label] of marks){
      if (t < t0 || t > t1) continue;
      const xx = x(t);
      el("line", { x1: xx, x2: xx, y1: m.t, y2: H - m.b, class: "marker" }, g);
      row = xx - lastX < 170 ? row + 1 : 0; lastX = xx;
      const lbl = text(g, xx + 4, m.t + 10 + row * 14, label, { class: "marker-l" });
      if (xx > W - 170) { lbl.setAttribute("text-anchor", "end"); lbl.setAttribute("x", xx - 4); }
    }
    return y;
  }
  function hover(f, y, onAt){
    const { svg, H, m, x } = f;
    const guide = el("line", { y1: m.t, y2: H - m.b, class: "guide", visibility: "hidden" }, svg);
    const overlay = el("rect", { x: m.l, y: m.t, width: f.W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" }, svg);
    const tip = svg.parentElement.querySelector(".tip");
    const pts = tl.points.map(p => ({ p, x: x(Date.parse(p.t)) }));
    const show = (clientX) => {
      const r = svg.getBoundingClientRect();
      const px = (clientX - r.left) * (f.W / r.width);
      let best = pts[0]; for (const q of pts) if (Math.abs(q.x - px) < Math.abs(best.x - px)) best = q;
      guide.setAttribute("x1", best.x); guide.setAttribute("x2", best.x); guide.setAttribute("visibility", "visible");
      onAt(best.p, tip);
      tip.hidden = false;
      const left = best.x / f.W * r.width;
      tip.style.left = Math.min(Math.max(left, 90), r.width - 90) + "px";
    };
    overlay.addEventListener("pointermove", e => show(e.clientX));
    overlay.addEventListener("pointerdown", e => show(e.clientX));
    overlay.addEventListener("pointerleave", () => { guide.setAttribute("visibility", "hidden"); tip.hidden = true; });
  }
  function tipRows(tip, title, rows){
    tip.textContent = "";
    const h = document.createElement("b"); h.textContent = title; tip.append(h);
    for (const [label, val, color] of rows){
      const d = document.createElement("div");
      const i = document.createElement("i"); i.style.background = color;
      const l = document.createElement("span"); l.textContent = label;
      const v = document.createElement("em"); v.textContent = val;
      d.append(i, l, v); tip.append(d);
    }
  }

  // ---------------- chart 1: fixed vs still open ----------------
  function renderProgress(){
    const f = frame("progress", 300);
    const pts = tl.points.filter(p => p.total > 0);
    const yMax = niceMax(Math.max(...pts.map(p => p.total)));
    const y = axes(f, yMax, (v) => fmtN(Math.round(v)));
    const series = [
      { label: "Still open", color: "var(--vuln-bar)", v: (p) => sum(p, OPEN), cls: "" },
      { label: "Fixed or not vulnerable", color: "var(--fix-bar)", v: (p) => sum(p, DONE), cls: "" },
      { label: "Total listed", color: "var(--faint)", v: (p) => p.total, cls: "dashed" },
    ];
    for (const s of series){
      const d = pts.map((p, i) => `${i ? "L" : "M"}${f.x(Date.parse(p.t)).toFixed(1)},${y(s.v(p)).toFixed(1)}`).join("");
      el("path", { d, class: `line ${s.cls}`, stroke: s.color }, f.svg);
      const lp = pts[pts.length - 1];
      el("circle", { cx: f.x(Date.parse(lp.t)), cy: y(s.v(lp)), r: 3.5, fill: s.color }, f.svg);
    }
    hover(f, y, (p, tip) => tipRows(tip, fmtTime.format(new Date(p.t)), series.map(s => [s.label, fmtN(s.v(p)), s.color])));
    legend("progressLegend", series.map(s => [s.label, s.color, s.cls === "dashed"]));
  }

  // ---------------- chart 2: stacked status breakdown ----------------
  function renderStack(){
    const f = frame("stack", 320);
    const pts = tl.points.filter(p => p.total > 0);
    const val = (p, s) => mode === "pct" ? (p.total ? (p[s] || 0) / p.total * 100 : 0) : (p[s] || 0);
    const yMax = mode === "pct" ? 100 : niceMax(Math.max(...pts.map(p => p.total)));
    const y = axes(f, yMax, (v) => mode === "pct" ? Math.round(v) + "%" : fmtN(Math.round(v)));
    // stack bottom-up: resolved first so "still open" sits on top
    const order = ["Not vuln", "Fix", "Unknown", "Investigation", "Workaround", "Vulnerable"];
    const base = pts.map(() => 0);
    for (const s of order){
      if (!pts.some(p => p[s])) continue;
      const top = pts.map((p, i) => base[i] + val(p, s));
      const xs = pts.map(p => f.x(Date.parse(p.t)).toFixed(1));
      const d = "M" + xs.map((xx, i) => `${xx},${y(top[i]).toFixed(1)}`).join("L") +
                "L" + xs.map((xx, i) => `${xx},${y(base[i]).toFixed(1)}`).reverse().join("L") + "Z";
      el("path", { d, fill: COLOR[s], class: "area" }, f.svg);
      top.forEach((v, i) => base[i] = v);
    }
    hover(f, y, (p, tip) => tipRows(tip, fmtTime.format(new Date(p.t)) + ` · ${fmtN(p.total)} listed`,
      order.slice().reverse().filter(s => p[s]).map(s => [LABEL[s], mode === "pct" ? `${pct(p[s], p.total)}%` : fmtN(p[s]), COLOR[s]])));
    legend("stackLegend", STATUS.filter(s => pts.some(p => p[s])).map(s => [LABEL[s], COLOR[s]]));
  }

  // ---------------- chart 3: suppliers with most open products ----------------
  function renderSuppliers(){
    const by = new Map();
    for (const r of items){
      const w = worst(r); if (!OPEN.includes(w)) continue;
      const g = by.get(r.supplier) || { n: 0, Vulnerable: 0, Workaround: 0, Investigation: 0, Unknown: 0 };
      g.n++; g[w]++; by.set(r.supplier, g);
    }
    const top = [...by].sort((a, b) => b[1].n - a[1].n || b[1].Vulnerable - a[1].Vulnerable || a[0].localeCompare(b[0])).slice(0, 12);
    const max = top.length ? top[0][1].n : 1;
    const list = $("suppliers"); list.textContent = "";
    for (const [name, g] of top){
      const row = document.createElement("li");
      const a = document.createElement("a");
      a.href = "/#q=" + encodeURIComponent(name);    // opens the main list searched for this supplier
      a.textContent = name; a.title = `Show ${name} in the list`;
      const bar = document.createElement("span"); bar.className = "hbar";
      for (const s of ["Vulnerable", "Workaround", "Investigation", "Unknown"]){
        if (!g[s]) continue;
        const seg = document.createElement("span");
        seg.style.width = (g[s] / max * 100) + "%"; seg.style.background = COLOR[s];
        seg.title = `${LABEL[s]}: ${g[s]}`;
        bar.append(seg);
      }
      const n = document.createElement("b"); n.textContent = fmtN(g.n);
      row.append(a, bar, n); list.append(row);
    }
    legend("supplierLegend", ["Vulnerable", "Workaround", "Investigation", "Unknown"].filter(s => top.some(([, g]) => g[s])).map(s => [LABEL[s], COLOR[s]]));
  }

  function legend(id, entries){
    const ul = $(id); ul.textContent = "";
    for (const [label, color, dashed] of entries){
      const li = document.createElement("li");
      const i = document.createElement("i"); i.style.background = color; if (dashed) i.className = "dashed";
      const t = document.createElement("span"); t.textContent = label;
      li.append(i, t); ul.append(li);
    }
  }

  // ---------------- data table (accessible alternative to the charts) ----------------
  function renderTable(){
    const tb = $("tlTable"); tb.textContent = "";
    for (const p of tl.points.filter(p => p.total > 0)){
      const tr = document.createElement("tr");
      const cells = [fmtTime.format(new Date(p.t)), p.total, sum(p, OPEN), p.Vulnerable || 0, p.Investigation || 0, p.Workaround || 0, p.Fix || 0, p["Not vuln"] || 0, `${pct(sum(p, DONE), p.total)}%`];
      cells.forEach((c, i) => { const td = document.createElement(i ? "td" : "th"); td.textContent = typeof c === "number" ? fmtN(c) : c; tr.append(td); });
      tb.append(tr);
    }
  }

  function renderAll(){ renderKpis(); renderProgress(); renderStack(); renderSuppliers(); renderTable(); }

  // ---------------- controls + load ----------------
  document.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => {
    mode = b.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    renderStack();
  }));
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (tl) { renderProgress(); renderStack(); } }, 150); });
  // charts use CSS colours, which change with the theme; re-render so the SVGs repaint immediately
  new MutationObserver(() => { if (tl) { renderProgress(); renderStack(); } }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  function showError(msg){
    $("chartsBody").hidden = true;
    const box = $("chartsError"); box.hidden = false;
    box.querySelector(".n-detail").textContent = msg;
  }
  function load(){
    $("chartsError").hidden = true; $("chartsBody").hidden = false; $("chartsLoading").hidden = false;
    Promise.all([fetch("/api/software"), fetch("/api/timeline")])
      .then(rs => Promise.all(rs.map(r => r.json().then(j => { if (!r.ok) throw new Error(typeof j?.error === "string" ? j.error.slice(0, 200) : "Unexpected response"); return j; }))))
      .then(([list, timeline]) => {
        // Untrusted API data: keep only well-formed fields and points.
        const s = (v, m) => (typeof v === "string" ? v : "").slice(0, m);
        if (!Array.isArray(list.items) || !timeline || !Array.isArray(timeline.points)) throw new Error("Unexpected response");
        items = list.items.slice(0, 20000).filter(r => r && typeof r === "object").map(r => ({ supplier: s(r.supplier, 500), product: s(r.product, 500), s1: s(r.s1, 40), s2: s(r.s2, 40) }));
        const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
        const points = timeline.points.slice(0, 2000).filter(p => p && !Number.isNaN(Date.parse(p.t)))
          .map(p => ({ t: p.t, total: num(p.total), Vulnerable: num(p.Vulnerable), Workaround: num(p.Workaround), Investigation: num(p.Investigation), Fix: num(p.Fix), "Not vuln": num(p["Not vuln"]), Unknown: num(p.Unknown) }));
        if (!points.length) throw new Error("Unexpected response");
        tl = { points, disclosure: s(timeline.disclosure, 40), firstEntry: s(timeline.firstEntry, 40), stepHours: num(timeline.stepHours) || 1 };
        list = { listUpdated: s(list.listUpdated, 100), official: list.official, sourceLabel: s(list.sourceLabel, 120) };
        $("chartsLoading").hidden = true;
        $("asOf").textContent = (list.listUpdated ? `List updated ${list.listUpdated}` : "") +
          (list.official === false ? ` · Loaded from a mirror (${list.sourceLabel || "unknown"}), not the official NCSC-NL repository.` : "");
        $("stepNote").textContent = `Timeline points every ${tl.stepHours === 1 ? "hour" : tl.stepHours + " hours"}, shown in your local time.`;
        renderAll();
      })
      .catch(err => showError(err.message));
  }
  $("chartsRetry").addEventListener("click", load);
  load();
})();
