// SPDX-License-Identifier: MIT
// PHP2List "Subscribe" page: shows the feed address to paste into a feed reader.
// Watchlist entries come from this page's address and are only displayed with textContent.
(() => {
  const $ = (id) => document.getElementById(id);
  const cleanEntry = (v) => { const s = String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim(); return s.slice(0, /^[sp]:/.test(s) ? 240 : 80); };
  const entries = [...new Set(new URLSearchParams(location.search).getAll("v").map(cleanEntry).filter(Boolean))].slice(0, 25);
  const qs = entries.map(v => "v=" + encodeURIComponent(v)).join("&");
  const feed = `${location.origin}/feed.xml${qs ? "?" + qs : ""}`;
  const label = (v) => {
    if (v.startsWith("s:") && v.length > 2) return `Supplier: ${v.slice(2)}`;
    if (v.startsWith("p:")){ const i = v.indexOf("::", 2); if (i > 2 && i + 2 < v.length) return `Product: ${v.slice(i + 2)} (${v.slice(2, i)})`; }
    return `Keyword: ${v}`;
  };

  $("subTitle").textContent = entries.length ? "Feed for your watchlist" : "Feed for all status changes";
  $("subUrl").value = feed;
  if (entries.length){
    $("subWatch").hidden = false;
    const ul = $("subEntries");
    for (const v of entries){ const li = document.createElement("li"); li.textContent = label(v); ul.appendChild(li); }
  }
  $("subChanges").href = "/changes" + (qs ? "#" + qs : "");
  $("subRaw").href = "/feed.xml?" + (qs ? qs + "&" : "") + "view=xml";
  $("subCopy").addEventListener("click", (e) => {
    const b = e.currentTarget;
    $("subUrl").select();
    if (navigator.clipboard) navigator.clipboard.writeText(feed).then(() => { b.textContent = "Copied ✓"; setTimeout(() => { b.textContent = "Copy address"; }, 1800); }, () => {});
  });
})();
