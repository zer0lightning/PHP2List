# SPDX-License-Identifier: MIT
"""Browser security tests for PHP2List: XSS payloads through every input path, plus CSP checks.

Requires: pip install playwright && python -m playwright install chromium
Usage:    npm run dev              (in another terminal; serves http://127.0.0.1:8788)
          BASE_URL=http://127.0.0.1:8788 python3 tests/browser/xss_test.py
Exits non-zero if any payload executes or is injected into the page.
"""
import asyncio, json, os, sys, urllib.parse
from playwright.async_api import async_playwright
B = os.environ.get("BASE_URL", "http://127.0.0.1:8788").rstrip("/")

PAYLOADS = [
    '<img src=x onerror="window.__xss=1;alert(1)">',
    '<svg/onload=window.__xss=1>',
    '"><script>window.__xss=1</script>',
    "'><iframe srcdoc=\"<script>parent.__xss=1</script>\">",
    '</textarea><img src=x onerror=window.__xss=1>',
    'javascript:window.__xss=1',
    '<a href="javascript:window.__xss=1">x</a>',
    '{{constructor.constructor("window.__xss=1")()}}',
    '${window.__xss=1}',
    '<details open ontoggle=window.__xss=1>',
    '‮<b onmouseover=window.__xss=1>rtl',
    '&lt;img src=x onerror=window.__xss=1&gt;',
    '.*+?^${}()|[]\\',            # regex metacharacters (search highlighting)
    'a' * 5000,                   # oversized input
]

def frag(**kw):
    p = []
    for k, vs in kw.items():
        for v in (vs if isinstance(vs, list) else [vs]):
            p.append(f"{k}={urllib.parse.quote(v, safe='')}")
    return "#" + "&".join(p)

CHECK = """() => ({
  flag: !!window.__xss,
  injected: [...document.querySelectorAll('main img, main svg:not([aria-hidden]) , main iframe, main script, main details, .watch img, .watch iframe, .watch svg[onload], dialog img, .toasts img, [onerror], [onload], [ontoggle], [onmouseover], a[href^="javascript" i]')].map(e => e.outerHTML.slice(0, 80)),
})"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        failures = []; csp = []; alerts = []

        async def page(ctx):
            await ctx.add_init_script("try{localStorage.setItem('php2list.privacy','ok')}catch(e){}")
            pg = await ctx.new_page()
            pg.on("dialog", lambda d: (alerts.append(d.message), asyncio.ensure_future(d.dismiss())))
            pg.on("console", lambda m: csp.append(m.text) if "Content Security Policy" in m.text else None)
            return pg

        async def check(pg, label):
            await pg.wait_for_timeout(250)
            r = await pg.evaluate(CHECK)
            if r["flag"] or r["injected"]:
                failures.append((label, r))

        # --- 1. payloads in shared links (vendors, search, letter, status, sort)
        ctx = await b.new_context(viewport={"width": 1280, "height": 900})
        pg = await page(ctx)
        for i, pl in enumerate(PAYLOADS):
            url = B + "/" + frag(v=[pl, "Cisco", "s:" + pl, "p:" + pl + "::" + pl, "p:Cisco::" + pl], q=pl[:300], l=pl[:50], status=pl[:50], sort=pl[:30], cve=pl[:30])
            await pg.goto("about:blank"); await pg.goto(url)
            await pg.wait_for_selector("#body tr td:not(.loading)", timeout=20000)
            await check(pg, f"link payload {i}")
            # open the share dialog (renders vendor names into hints and the link box)
            await pg.click("#vshare"); await check(pg, f"share dialog {i}")
            await pg.keyboard.press("Escape")

        # --- 2. payloads typed / pasted by the visitor
        await pg.goto(B + "/"); await pg.wait_for_selector("td.c-product")
        for i, pl in enumerate(PAYLOADS[:12]):
            await pg.fill("#vq", pl[:200]); await pg.wait_for_timeout(120); await check(pg, f"suggestions {i}")
            await pg.keyboard.press("Enter"); await check(pg, f"typed vendor {i}")
            await pg.fill("#q", pl[:200]); await pg.wait_for_timeout(250); await check(pg, f"search {i}")
        await pg.fill("#q", "")
        if await pg.is_visible("#vpaste"): await pg.click("#vpaste")
        else: await pg.click("#vmore summary"); await pg.click('[data-more="paste"]')
        await pg.fill("#vpasteText", "\n".join(PAYLOADS)); await pg.click("#pasteDlg button[value=ok]")
        await pg.click(".vmore-tok") if await pg.is_visible(".vmore-tok") else None
        await check(pg, "expanded token list")
        await check(pg, "paste dialog + toast")
        # remove one token -> toast with vendor name
        await pg.click('.vtok button[data-rm="0"]'); await check(pg, "remove toast")
        await ctx.close()

        # --- 3. malicious data coming from the list itself
        ctx = await b.new_context(viewport={"width": 1280, "height": 900})
        pg = await page(ctx)
        evil_items = [{
            "supplier": pl, "product": pl, "version": pl, "s1": pl if i % 2 else "Vulnerable", "s2": pl,
            "notes": [pl, "second " + pl], "links": [{"label": pl, "url": "javascript:window.__xss=1"}, {"label": "ok", "url": "https://example.org/" + pl}],
        } for i, pl in enumerate(PAYLOADS[:12])]
        body = json.dumps({"listUpdated": PAYLOADS[0], "count": len(evil_items), "items": evil_items})
        await pg.route("**/api/software", lambda r: r.fulfill(status=200, content_type="application/json", body=body))
        await pg.goto(B + "/" + frag(v=["img", "svg"]))
        await pg.wait_for_selector("#body tr td:not(.loading)")
        await check(pg, "malicious data render")
        await pg.fill("#q", "img"); await pg.wait_for_timeout(250); await check(pg, "malicious data + highlight")
        await pg.fill("#q", ""); await pg.wait_for_timeout(200)
        if await pg.is_visible("#vview"): await pg.click('#vview [data-view="all"]')
        pins = await pg.query_selector_all("#body .pin")
        for i in range(min(3, len(pins))):
            pins = await pg.query_selector_all("#body .pin"); await pins[i].click(); await check(pg, f"star malicious row {i}")
        print("starred malicious rows:", (await pg.inner_text("#vtokens"))[:120].replace(chr(10), " "))
        for kind in ("supplier", "product"):
            await pg.fill("#vq", "img"); await pg.wait_for_timeout(150)
            li = await pg.query_selector(f"#vsug li.k-{kind}")
            if li: await li.click(); await check(pg, f"pick malicious {kind}")
        if await pg.is_visible("#vshare"): await pg.click("#vshare"); await check(pg, "share dialog with malicious entries"); await pg.keyboard.press("Escape")
        # javascript: links must have been neutralised
        hrefs = await pg.evaluate("[...document.querySelectorAll('.links a')].map(a => a.getAttribute('href'))")
        bad = [h for h in hrefs if not h.startswith("https://") and h != "#"]
        if bad: failures.append(("link hrefs", bad))
        for row in await pg.query_selector_all(".links a[href='#']"):
            await row.click(); break
        await check(pg, "clicking neutralised link")
        await pg.fill("#vq", "<img src=x onerror=window.__xss=1>"); await pg.wait_for_timeout(150); await check(pg, "suggestions from evil suppliers")
        # error path with hostile error detail
        await pg.unroute("**/api/software")
        await pg.route("**/api/software", lambda r: r.fulfill(status=502, content_type="application/json", body=json.dumps({"error": PAYLOADS[0], "detail": PAYLOADS[2]})))
        await pg.goto(B + "/"); await pg.wait_for_selector(".notice-danger"); await check(pg, "hostile error message")
        await ctx.close()

        # --- 3b. charts page with malicious list + timeline data
        ctx = await b.new_context(viewport={"width": 1280, "height": 900})
        pg = await page(ctx)
        evil_list = json.dumps({"listUpdated": PAYLOADS[0], "official": False, "sourceLabel": PAYLOADS[2], "items": [
            {"supplier": pl, "product": pl, "version": "", "s1": "Vulnerable", "s2": "Investigation", "notes": [], "links": []} for pl in PAYLOADS[:12]]})
        evil_tl = json.dumps({"disclosure": "2026-10-21T00:00:00+02:00", "firstEntry": "2026-10-21T11:41:09Z", "stepHours": 1,
            "points": [{"t": "2026-10-21T12:00:00Z", "total": 12, "Vulnerable": 12}, {"t": "2026-10-22T12:00:00Z", "total": 12, "Vulnerable": 6, "Fix": 6}]})
        await pg.route("**/api/software", lambda r: r.fulfill(status=200, content_type="application/json", body=evil_list))
        await pg.route("**/api/timeline", lambda r: r.fulfill(status=200, content_type="application/json", body=evil_tl))
        await pg.goto(B + "/charts"); await pg.wait_for_selector(".kpi")
        r = await pg.evaluate("""() => ({flag: !!window.__xss, injected: [...document.querySelectorAll('.charts-page img, .charts-page iframe, .charts-page script, [onerror], [onload], [ontoggle], [onmouseover]')].length,
            supplierHrefs: [...document.querySelectorAll('#suppliers a')].map(a => a.getAttribute('href')).filter(h => !h.startsWith('/#q='))})""")
        if r["flag"] or r["injected"] or r["supplierHrefs"]: failures.append(("charts page", r))
        print("charts page with malicious data:", r)
        await ctx.close()

        # --- 3c. recent changes (main page strip/markers, product links, Changes page) with malicious data
        ctx = await b.new_context(viewport={"width": 1280, "height": 900})
        await ctx.add_init_script("localStorage.setItem('php2list.privacy','ok'); localStorage.setItem('php2list.visit', JSON.stringify({prev: 1, last: 2})); localStorage.setItem('php2list.vendors', JSON.stringify(['<img src=x onerror=window.__xss=1>']))")
        pg = await page(ctx)
        import datetime
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        good_ids = [f"evil--item-{i}" for i in range(12)]
        evil_items2 = [{"id": good_ids[i] if i % 3 else pl, "supplier": pl, "product": pl, "version": pl, "s1": "Fix", "s2": pl, "notes": [pl], "links": []} for i, pl in enumerate(PAYLOADS[:12])]
        evil_changes = json.dumps({"events": [
            {"t": now_iso, "id": good_ids[i] if i % 2 else pl, "supplier": pl, "product": pl, "version": pl, "s1": pl, "s2": "Fix",
             "prev": {"s1": pl, "s2": "Vulnerable"} if i % 3 else None, "note": pl,
             "links": [{"label": pl, "url": "javascript:window.__xss=1"}, {"label": pl, "url": "https://example.org/?" + pl}]}
            for i, pl in enumerate(PAYLOADS[:12])] + [{"t": now_iso, "id": "x", "__proto__": {"polluted": 1}}, None, "x", 5]})
        await pg.route("**/api/software", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"listUpdated": PAYLOADS[2], "fetchedAt": PAYLOADS[0], "sourceArchived": True, "items": evil_items2})))
        await pg.route("**/api/changes", lambda r: r.fulfill(status=200, content_type="application/json", body=evil_changes))
        await pg.goto(B + "/" + frag(p=PAYLOADS[2]))
        await pg.wait_for_timeout(1200); await check(pg, "hostile product link (#p=)")
        await pg.goto(B + "/"); await pg.reload(); await pg.wait_for_selector("#changesStrip:not([hidden])")
        await check(pg, "changes strip + markers + archived banner")
        for sel in ('[data-changed="24h"]', '[data-changed="visit"]'):
            if await pg.is_enabled(sel): await pg.click(sel); await pg.wait_for_timeout(200); await check(pg, f"filter {sel}")
        ids = await pg.evaluate("[...document.querySelectorAll('.plink')].length")
        hrefs_ok = await pg.evaluate("[...document.querySelectorAll('#body tr')].length")
        print("rows with product-link buttons:", ids, "of", hrefs_ok, "(rows whose id was a payload get none)")
        await pg.goto(B + "/changes"); await pg.wait_for_selector(".chg-item")
        await check(pg, "Changes page")
        r = await pg.evaluate("""() => ({flag: !!window.__xss, injected: [...document.querySelectorAll('.chg-page img, .chg-page iframe, .chg-page script, [onerror], [onload], [ontoggle], [onmouseover]')].length,
            badHref: [...document.querySelectorAll('.chg-page a')].map(a => a.getAttribute('href')).filter(h => !(h.startsWith('https://') || /^\\/#p=[a-z0-9-]+$/.test(h) || h.startsWith('/'))),
            items: document.querySelectorAll('.chg-item').length})""")
        if r["flag"] or r["injected"] or r["badHref"]: failures.append(("changes page", r))
        print("changes page with malicious data:", r)
        await pg.check("#chgWatch"); await check(pg, "Changes page, watchlist filter with hostile entry")
        await pg.click("#feedWatch"); await check(pg, "watchlist feed link with hostile entry")
        await ctx.close()

        # --- 3d. subscribe page with hostile watchlist entries in its address
        ctx = await b.new_context(viewport={"width": 1280, "height": 900})
        pg = await page(ctx)
        await pg.goto(B + "/feed.xml?" + "&".join("v=" + urllib.parse.quote(pl, safe="") for pl in PAYLOADS[:10]))
        await pg.wait_for_selector("#subUrl"); await check(pg, "subscribe page via feed redirect")
        r = await pg.evaluate("""() => ({flag: !!window.__xss, injected: [...document.querySelectorAll('main img, main iframe, main script, [onerror], [onload], [ontoggle], [onmouseover]')].length,
            hrefs: [...document.querySelectorAll('main a')].map(a => a.getAttribute('href')).filter(h => /^javascript:/i.test(h))})""")
        if r["flag"] or r["injected"] or r["hrefs"]: failures.append(("subscribe page", r))
        print("subscribe page with malicious entries:", r, "| url:", pg.url[:60])
        await pg.click("#subChanges"); await pg.wait_for_timeout(800); await check(pg, "changes page from hostile feed link")
        await ctx.close()

        # --- 4. headers
        ctx = await b.new_context(); pg = await ctx.new_page()
        for path in ("/", "/changes", "/api-docs", "/charts", "/privacy", "/api/software", "/api/v1/software", "/api/changes", "/feed.xml"):
            r = await pg.goto(B + path); h = r.headers
            print(f"{path:16} CSP: {h.get('content-security-policy','MISSING')[:95]}")
            print(f"{'':16} nosniff={h.get('x-content-type-options')} frame={h.get('x-frame-options')} coop={h.get('cross-origin-opener-policy')}")
        # CSP really blocks inline script injected at runtime
        await pg.goto(B + "/"); await pg.wait_for_selector("td.c-product")
        blocked = await pg.evaluate("""() => new Promise(res => {
            window.__inl = 0; const s = document.createElement('script'); s.textContent = 'window.__inl=1';
            document.body.appendChild(s); setTimeout(() => res(window.__inl === 0), 100); })""")
        print("runtime inline <script> blocked by CSP:", blocked)
        await b.close()

        print("\nalerts:", alerts)
        print("CSP violations logged:", len(csp))
        print("FAILURES:", failures if failures else "none")
        if failures or alerts or csp: sys.exit(1)

asyncio.run(main())
