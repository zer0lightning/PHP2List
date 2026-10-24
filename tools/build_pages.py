# SPDX-License-Identifier: MIT
"""Generates the content pages (disclaimer, privacy, acknowledgements, charts, 404) from
the shared header and footer in public/index.html, so every page stays consistent.

Usage:  python3 tools/build_pages.py            (writes into ./public)
        python3 tools/build_pages.py <public-dir>
Run it after changing the header/footer in index.html or any page text below.
All text below is static and authored here; no external input is inserted."""
import re, sys, os

# The site's public address, used for canonical links, robots.txt and the sitemap.
SITE_URL = "https://php2list.com"
pub = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
idx = open(f"{pub}/index.html").read()

head_meta = idx[:idx.index("<title>")]          # doctype .. theme scripts
topbar = re.search(r'(    <div class="topbar">.*?\n    </div>\n)', idx, re.S).group(1)
footer = re.search(r'(<footer class="site-footer">.*?</footer>)', idx, re.S).group(1)
footer = footer.replace('<span id="foot-updated"></span>', "")   # the update time is only filled in on the main page

def page(slug, title, desc, h1, lede, body, wide=False, script=None):
    f = footer.replace(f'<a href="/{slug}">', f'<a href="/{slug}" aria-current="page">')
    # Header tabs: the main page's "current" marker moves to this page's tab.
    tb = topbar.replace(' aria-current="page"', '').replace(f'<a href="/{slug}">', f'<a href="/{slug}" aria-current="page">')
    return f"""{head_meta}<title>{title} · PHP2List - PHP2Shell Software List</title>
<meta name="description" content="{desc}">
<meta name="color-scheme" content="light dark">
{'<meta name="robots" content="noindex">' if slug == "404" else f'<link rel="canonical" href="{SITE_URL}/{slug}">'}
<link rel="alternate" type="application/atom+xml" title="PHP2List: status changes" href="/feed.xml">
<script src="/assets/theme-init.js"></script>
<script src="/assets/theme.js" defer></script>
<script src="/assets/consent.js" defer></script>
<script src="/assets/leave.js" defer></script>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23233a6b'/%3E%3Cpath d='M12 10l-6 6 6 6M20 10l6 6-6 6' stroke='%23ffb547' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="site-header">
  <div class="container">
{tb}    <div class="page-hero{' wide' if wide else ''}">
      <div class="crumbs"><a href="/">PHP2List</a> / {h1}</div>
      <h1>{h1}</h1>
      <p>{lede}</p>
    </div>
  </div>
</header>
<main class="container" id="content">
{('<div class="charts-page">' + body.strip() + '</div>') if wide else ('<article class="prose">' + chr(10) + body.strip() + chr(10) + '</article>')}
</main>
{f}
{f'<script src="{script}" defer></script>' if script else ''}
</body>
</html>
"""

NEW = 'target="_blank" rel="noopener noreferrer"'
REPO_URL = "https://github.com/zer0lightning/PHP2List"   # placeholder until the repository is published
# Privacy contact address shown on the Privacy page. Leave empty until you have one
# (for example privacy@php2list.com via Cloudflare Email Routing), then rebuild the pages.
CONTACT_EMAIL = ""
import html as _html
CONTACT_HTML = (f'<a href="mailto:{_html.escape(CONTACT_EMAIL)}">{_html.escape(CONTACT_EMAIL)}</a>' if CONTACT_EMAIL
                else '<span class="contact-pending">contact details will be published here.</span>')
ICONS = {
  "info": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  "warn": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/></svg>',
  "danger": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
}
def notice(kind, title, body):
    return f'<div class="notice notice-{kind}"><span class="n-ic">{ICONS[kind]}</span><div class="n-body"><span class="n-title">{title}</span>{body}</div></div>'


disclaimer = f"""
{notice("danger", "In short: use at your own risk", """<ul>
    <li><b>This is not NCSC-NL or php2shell.com.</b> PHP2List is an unofficial, independent site, not affiliated with or endorsed by NCSC-NL, php2shell.com or the PHP2Shell researchers.</li>
    <li><b>Accuracy is not guaranteed.</b> The information may be incomplete, out of date or wrong.</li>
    <li><b>Use it at your own risk.</b> You are responsible for any decisions you make based on it.</li>
    <li><b>Always verify</b> with the vendor's own advisory before acting.</li>
    <li><b>It is not security advice</b>, and no warranty of any kind is given.</li>
    <li><b>No support is offered.</b> Questions, corrections, new entries and feature requests are not handled here; list changes go to <a href="https://github.com/NCSC-NL/php2shell" {NEW}>NCSC-NL/php2shell</a>.</li>
  </ul>""")}

<h2 id="not-ncsc">Not NCSC-NL, not php2shell.com, not an official source</h2>
{notice("warn", "PHP2List is not NCSC-NL and not php2shell.com", "<p>PHP2List is an independent, unofficial website. It is <b>not</b> NCSC-NL (the National Cyber Security Centre of the Netherlands) and is <b>not</b> operated by or on behalf of NCSC-NL or the Dutch government. It is also <b>not</b> php2shell.com, the official site of the researchers who found the PHP2Shell vulnerabilities. PHP2List is not affiliated with, sponsored by or endorsed by any of them.</p>")}
<p>The site displays a list that NCSC-NL and its contributors publish openly on GitHub under the EUPL-1.2 licence. Showing that list, naming NCSC-NL as its source and linking to it are attribution, not a claim of any relationship. Nothing on PHP2List should be read as a statement, assessment or advice from NCSC-NL.</p>
<p>Likewise, PHP2List has no connection with the PHP2Shell researchers (Wiz Research, OpenAI and Calif), the PHP project, The PHP Foundation, CERT-EU, ENISA, or any other organisation named on this site. The name "PHP2Shell" refers to the vulnerabilities, not to this website.</p>
<p>Please do not contact php2shell.com or the researchers about this website either. For official information, go directly to the sources: the <a href="https://github.com/NCSC-NL/php2shell" {NEW}>NCSC-NL/php2shell repository</a>, <a href="https://www.php2shell.com/" {NEW}>php2shell.com</a>, the <a href="https://www.php.net/archive/2026.php#2026-10-21-5" {NEW}>PHP security advisory</a>, and your vendors' advisories. Please do not contact NCSC-NL about this website; it has nothing to do with them.</p>

<h2>Where the data comes from</h2>
<p>Every entry shown on PHP2List comes from the software list in the <a href="https://github.com/NCSC-NL/php2shell" {NEW}>NCSC-NL/php2shell</a> repository on GitHub, maintained by NCSC-NL and its contributors and published under the EUPL-1.2 licence. PHP2List reads that list automatically and displays it; it does not add, remove or change entries, statuses, versions or notes.</p>
<p>The source list itself states that it is not complete, that no guarantees are made about its completeness or accuracy, and that entries should be verified against upstream or vendor sources before acting on them. The same applies here.</p>

<h2>Not security advice</h2>
<p>Nothing on this site is professional security, legal or compliance advice. A status in the list is an investigation lead, not a verdict about your systems. In particular:</p>
<ul>
  <li><b>Investigation</b> means a product may be affected and is still being assessed.</li>
  <li>A product that is <b>missing</b> from the list may still be affected. The vulnerabilities are in PHP itself, so any software that runs on or bundles an affected PHP runtime can be exposed.</li>
  <li><b>Custom PHP applications</b> developed or deployed by your own organisation are not covered by the list.</li>
  <li>Products may ship embedded PHP runtimes, receive vendor backports, or be rebuilt later than upstream releases. Always confirm with the vendor's own advisory.</li>
</ul>
<p>For authoritative guidance, start with the <a href="https://www.php.net/archive/2026.php#2026-10-21-5" {NEW}>PHP security advisory</a>, <a href="https://www.php2shell.com/" {NEW}>php2shell.com</a>, your vendors' advisories, and your national CSIRT.</p>

<h2>Timeliness</h2>
<p>PHP2List checks the source list for changes about every 30 minutes, so it can lag behind the repository. If GitHub cannot be reached, the site keeps showing the last copy it fetched successfully, for up to seven days. The time shown as "Software list last status update" is the time reported by the source repository, not the time PHP2List last checked.</p>

<h2>Your vendor watchlist and exports</h2>
<p>Vendor matching is a convenience based on names. A watchlist entry is matched as a whole word against supplier and product names in the list, so it can miss products listed under a different company name, or match products you do not use. Review exported files before relying on them, for example in reports or audits.</p>

<h2>No support</h2>
<p>PHP2List is provided as a free convenience, without any support. In particular:</p>
<ul>
  <li><b>No maintenance commitment.</b> There is no promise that the site will be kept up to date, fixed when something breaks, or kept online. It may be changed, paused or taken down at any time without notice.</li>
  <li><b>No help with the list.</b> Questions about specific products, statuses or your own exposure are not answered here. Please contact the vendor concerned, or your national CSIRT.</li>
  <li><b>No new entries or corrections.</b> PHP2List cannot add, remove or correct entries; it only displays the source list. To suggest a change, follow the <a href="https://github.com/NCSC-NL/php2shell#contributions-welcome" {NEW}>contribution guidelines</a> of the NCSC-NL/php2shell repository. Once a change is accepted there, it appears here automatically.</li>
  <li><b>No feature requests.</b> Requests for new features or changes to how the site works are not taken.</li>
</ul>

<h2>Links to other websites</h2>
<p>This site links to vendor advisories, research publications and other third-party pages. PHP2List does not control and is not responsible for their content, availability or accuracy.</p>

<h2>Use at your own risk; no warranty</h2>
<p>The accuracy, completeness and timeliness of the information on PHP2List are not guaranteed. You use this site and the information it displays entirely at your own risk, and you remain responsible for verifying it and for any decisions or actions you take based on it.</p>
<p>PHP2List and the information on it are provided "as is" and "as available", without warranty of any kind, express or implied, including any warranty of accuracy, completeness, merchantability or fitness for a particular purpose. To the extent permitted by law, the operator of PHP2List is not liable for any loss or damage, direct or indirect, arising from use of, or reliance on, this site or the information it displays.</p>

<h2>Information sharing (TLP)</h2>
<p>The source repository marks its content <span class="tlp">TLP:CLEAR</span>, meaning it may be shared without restriction.</p>

<p class="meta-line">Last updated: 22 October 2026</p>
"""

privacy = f"""
{notice("info", "In short", "<p>PHP2List itself sets <b>no cookies</b>, has no accounts, and runs no analytics, advertising or tracking scripts. Its pages load nothing from other websites. Your settings (watchlist, theme and similar) are saved only in your own browser, and only if you want them to be.</p><p>The site is hosted by <b>Cloudflare</b>, which handles every request. Cloudflare processes request data such as your IP address to deliver and protect the site, and may set its own strictly necessary security cookies. Details are below.</p>")}

<h2 id="choices">Your privacy choices</h2>
<p>You can decide whether PHP2List may save your watchlist, theme, link-notice choice and last-visit time in this browser. Turning it off deletes anything already saved. The watchlist keeps working through the page address, but it won't be remembered next time.</p>
<div class="choices-box"><a class="btn primary" href="#choices" data-privacy-choices>Open privacy choices</a></div>

<h2>Who is responsible</h2>
<p>The operator of PHP2List, an independent website (see the <a href="/disclaimer#not-ncsc">disclaimer</a>), is responsible for this website ("controller" under the EU and UK General Data Protection Regulation, GDPR).</p>
<p>Contact for privacy questions or requests: {CONTACT_HTML}</p>

<h2>Cookies and browser storage</h2>
<ul>
  <li><b>Cookies set by PHP2List:</b> none.</li>
  <li><b>Cookies set by Cloudflare:</b> depending on the security features active at the time, Cloudflare may set cookies such as <code>__cf_bm</code> (bot detection; expires after 30 minutes of inactivity) or <code>cf_clearance</code> (set when you pass a security check). Cloudflare describes these as strictly necessary and says it does not use <code>__cf_bm</code> to track users from site to site. See <a href="https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/" {NEW}>Cloudflare's cookie list</a> and <a href="https://www.cloudflare.com/cookie-policy/" {NEW}>cookie policy</a>.</li>
  <li><b>Local storage</b> (kept on your device and not sent to the server):
    <ul>
      <li><code>php2list.vendors</code>: your vendor watchlist, saved when you add vendors.</li>
      <li><code>php2list.theme</code>: light or dark theme, saved only if you switch away from your system setting.</li>
      <li><code>php2list.leaveNotice</code>: saved only if you turn off the notice shown before opening an external site. Turn it back on in Privacy choices.</li>
      <li><code>php2list.visit</code>: the time of your previous and latest visit, so the list can show what changed since you last looked. Saved only after you select OK in the privacy notice.</li>
      <li><code>php2list.privacy</code>: remembers that you've seen the privacy notice and your choice, so it isn't shown on every visit.</li>
    </ul>
  </li>
</ul>
<p>PHP2List's local storage is used only to provide features you choose to use, and to remember your privacy choice. Storage that is strictly necessary for a service you request, and security cookies needed to protect a site, are generally exempt from consent under the EU ePrivacy rules. We still let you switch PHP2List's own storage off, as described above. Cloudflare's security cookies are controlled by Cloudflare, not by this setting.</p>

<h2>What is processed, and why</h2>
<h3>When you visit the site</h3>
<p>Like any website, your browser sends technical information with each request: your IP address, browser and device details (user agent), the page requested (but not the part of the address after <code>#</code>), the referring page if your browser sends one, and the time. Every request passes through Cloudflare, which processes this information to deliver the site, protect it from attacks and bots, and run its network.</p>
<p>What the operator can see: Cloudflare's dashboard shows the operator aggregated traffic statistics, such as request counts. Cloudflare's developer tools can also show live request details for troubleshooting. The operator does not export, store or combine this information, and does not use it to identify or profile visitors.</p>
<ul>
  <li><b>Purpose:</b> delivering the website, keeping it secure, and troubleshooting.</li>
  <li><b>Legal basis (GDPR):</b> legitimate interests (Article 6(1)(f)) in providing a working, secure website.</li>
  <li><b>Retention:</b> Cloudflare keeps logs according to its own policies. The operator does not keep its own copies.</li>
</ul>
<h3>Your watchlist, searches and exports</h3>
<p>Vendor names, searches and filters are handled in your browser. They are kept in your device's local storage and in the part of the page address after <code>#</code>, which browsers don't include in requests to the server. CSV and JSON exports are created on your device and are not uploaded. If you share a link, anyone who receives it can see the vendor names in it.</p>
<h3>Feeds and the public API</h3>
<p>The status-change feed (<code>/feed.xml</code>) and the API (<code>/api/v1/...</code>) are ordinary requests to the site and are processed by Cloudflare as described above. A feed for your watchlist is different from the rest of the site: <b>your watchlist entries are part of the feed address</b> (after <code>?</code>), so your feed reader sends them to the site, and Cloudflare, every time it checks for updates. Use the general feed if you don't want that.</p>
<h3>The software list itself</h3>
<p>The list is fetched from GitHub by the PHP2List server, not by your browser. It describes software products and companies, not visitors.</p>

<h2>Hosting provider and international transfers</h2>
<p>PHP2List runs on <b>Cloudflare Pages</b>. Cloudflare processes request data on the operator's behalf under its Data Processing Addendum. Cloudflare operates a global network, so data may be processed outside the EU, UK or your country. For transfers from the EU, UK and Switzerland, Cloudflare relies on the EU Standard Contractual Clauses in its Data Processing Addendum and its certification under the EU-U.S. Data Privacy Framework and its UK and Swiss extensions. See the <a href="https://www.cloudflare.com/privacypolicy/" {NEW}>Cloudflare Privacy Policy</a> and <a href="https://www.cloudflare.com/trust-hub/gdpr/" {NEW}>Cloudflare's GDPR information</a>.</p>
<p>The operator does not sell visitor data, share it for advertising, or use it for profiling or automated decision-making. How Cloudflare handles data it processes as a provider is set out in its own policies, linked above.</p>

<h2>Your rights</h2>
<p>If the GDPR applies to you (for example in the EU, EEA or UK), you have the right to access, correct or erase personal data about you, to restrict or object to its processing, and to data portability. The operator does not keep its own records about visitors, so there will normally be nothing for the operator itself to provide or delete. Request data processed by Cloudflare can be raised with the operator, who can follow up with Cloudflare, or with Cloudflare directly.</p>
<p>You also have the right to complain to a data protection authority, for example the authority in the EU country where you live or work, or the Information Commissioner's Office (ICO) in the UK. Outside the EU and UK you may have similar rights under local law, such as Canada's PIPEDA or US state privacy laws.</p>

<h2>Links to other websites</h2>
<p>PHP2List links to vendor advisories, research and other sites. Those sites have their own privacy policies. When you follow a link, PHP2List tells your browser not to pass on the page address as a "referrer".</p>

<h2>Changes to this notice</h2>
<p>If the way PHP2List handles information changes, for example if analytics are ever added, this notice will be updated first and the date below will change.</p>

<p class="meta-line">Last updated: 22 October 2026</p>
"""

def person(name, url, org):
    return f'<div class="person"><b><a href="{url}" {NEW}>{name}</a></b><span>{org}</span></div>'

ack = f"""
<p>PHP2List would not exist without the people and organisations below. Thanking them does not mean they are involved with, or endorse, this unofficial site. All credit for the research and the software list belongs to them. The names here are as credited on <a href="https://www.php2shell.com/" {NEW}>php2shell.com</a> and in the <a href="https://github.com/NCSC-NL/php2shell" {NEW}>NCSC-NL/php2shell</a> repository.</p>

<h2>The software list</h2>
<p>The inventory of potentially affected software is maintained by <b>NCSC-NL</b>, the National Cyber Security Centre of the Netherlands, together with everyone who has contributed entries, corrections and vendor information to the <a href="https://github.com/NCSC-NL/php2shell" {NEW}>NCSC-NL/php2shell</a> repository. See the <a href="https://github.com/NCSC-NL/php2shell/graphs/contributors" {NEW}>full list of contributors</a> on GitHub.</p>
<p>The list is published under the <a href="https://github.com/NCSC-NL/php2shell/blob/main/LICENSE" {NEW}>European Union Public Licence v1.2 (EUPL-1.2)</a> and marked TLP:CLEAR. PHP2List displays it unmodified. Corrections should go to the source: see <a href="https://github.com/NCSC-NL/php2shell#contributions-welcome" {NEW}>how to contribute</a>.</p>

<h2>The PHP2Shell research</h2>
<p>CVE-2026-109618 and CVE-2026-109619 were discovered and reported by the following researchers. Their own write-ups have the technical details.</p>

<div class="org">Wiz Research</div>
<div class="people">
  {person("Sagi Tzadik", "https://x.com/sagitz_", "Wiz Research")}
  {person("Shir Tamari", "https://x.com/shirtamari", "Wiz Research")}
  {person("Nir Ohfeld", "https://x.com/nirohfeld", "Wiz Research")}
  {person("Tomer Schwartz", "https://x.com/tom41sh", "Wiz Research")}
</div>
<div class="org">OpenAI Codex Security</div>
<div class="people">
  {person("Amy Burnett", "https://x.com/itszn13", "OpenAI Codex Security")}
</div>
<div class="org">Calif</div>
<div class="people">
  {person("Ryan A.", "https://x.com/lcfr_hax", "Calif")}
</div>

<h3>Research write-ups</h3>
<ul>
  <li><a href="https://www.php2shell.com/" {NEW}>php2shell.com</a> — the official PHP2Shell site</li>
  <li><a href="https://www.wiz.io/blog/php2shell-php-rce" {NEW}>Wiz Research blog</a></li>
  <li><a href="https://openai.com/index/coordinated-disclosure-of-critical-vulnerabilities" {NEW}>OpenAI blog</a></li>
  <li><a href="https://calif.io/php2shell/" {NEW}>Calif blog</a></li>
</ul>

<h2>Coordination and fixes</h2>
<p>As credited on php2shell.com, the researchers worked with the <b>PHP security team</b> and the <b>Gemini team at Google</b> on discovery, coordination and patch verification. Thanks to the PHP project and <b>The PHP Foundation</b> for the fixed releases (PHP 8.5.12, 8.4.27, 8.3.36 and 8.2.35) and the security advisory.</p>
<ul>
  <li><a href="https://www.php.net/archive/2026.php#2026-10-21-5" {NEW}>PHP security advisory</a></li>
  <li><a href="https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/" {NEW}>The PHP Foundation blog</a></li>
</ul>

<h2>Industry partners</h2>
<p>php2shell.com also thanks Google Cloud, Cloudflare, AWS, Microsoft, Automattic, Fastly, Akamai, Imperva, Vercel and other partners for preparing customer guidance, detections and temporary mitigations, and lists Corelight, CrowdStrike, Unit 42 and Cisco Talos among the collaborators. Their published guidance:</p>
<ul class="linklist">
  <li><a href="https://www.akamai.com/blog/security-research/critical-remote-code-execution-vulnerabilities-php-core" {NEW}>Akamai</a></li>
  <li><a href="https://www.imperva.com/blog/php2shell-vulnerability-updates" {NEW}>Imperva</a></li>
  <li><a href="https://blog.cloudflare.com/php-vulnerabilities-waf-protection/" {NEW}>Cloudflare</a></li>
  <li><a href="https://corelight.com/blog/php2shell-detection-before-disclosure" {NEW}>Corelight</a></li>
  <li><a href="https://www.crowdstrike.com/en-us/blog/crowdstrike-protects-customers-from-php-rce-zero-days/" {NEW}>CrowdStrike</a></li>
  <li><a href="https://unit42.paloaltonetworks.com/cve-2026-109618-cve-2026-109619/" {NEW}>Unit 42 (Palo Alto Networks)</a></li>
  <li><a href="https://blog.talosintelligence.com/two-critical-rces-in-php-core/" {NEW}>Cisco Talos</a></li>
  <li><a href="https://vercel.com/kb/bulletin/php2shell-security-bulletin" {NEW}>Vercel</a></li>
</ul>

<h2>CSIRTs and advisories</h2>
<p>Thanks to the national and EU CSIRTs publishing guidance, including <a href="https://cert.europa.eu/publications/security-advisories/2026-018/" {NEW}>CERT-EU (Security Advisory 2026-018)</a> and the <a href="https://github.com/enisaeu/CNW/blob/main/advisories/2026/CNW-2026-04_php.md" {NEW}>EU CSIRTs Network advisory list</a> maintained with ENISA.</p>

<h2>Something missing or wrong?</h2>
<p>If a credit here is incomplete or inaccurate, the authoritative sources are php2shell.com and the NCSC-NL repository; this page follows them.</p>

<p class="meta-line">Last updated: 22 October 2026</p>
"""


CHARTS = """
<section class="notice notice-info charts-intro"><span class="n-ic">""" + ICONS["info"] + """</span><div class="n-body">
  <span class="n-title">How to read these charts</span>
  <p>Each product is counted once, by the <b>less resolved</b> of its two CVE statuses. For example, "Fix" for one CVE and "Investigation" for the other counts as under investigation. <b>Still open</b> means vulnerable, workaround only, under investigation, or no status yet. The history is rebuilt from the <a href="https://github.com/NCSC-NL/php2shell/blob/main/software/changelog_software_list.md" target="_blank" rel="noopener noreferrer">NCSC-NL changelog</a>. The list only covers products someone has added to it, so a rise in the total means the list grew, not that more products became vulnerable. Accuracy is not guaranteed.</p>
</div></section>

<div id="chartsError" class="notice notice-danger" role="alert" hidden><span class="n-ic">""" + ICONS["danger"] + """</span><div class="n-body">
  <span class="n-title">Couldn't load the chart data</span><p>The data is read from GitHub, which didn't respond as expected (<span class="n-detail"></span>). This is usually temporary.</p>
  <div class="n-actions"><button type="button" class="btn" id="chartsRetry">Try again</button></div>
</div></div>

<div id="chartsBody">
  <p class="loading" id="chartsLoading"><span class="spinner"></span>Loading chart data…</p>

  <section class="kpis" id="kpis" aria-label="Current totals"></section>

  <section class="chart-card" aria-labelledby="h-now">
    <div class="chart-head"><div><h2 id="h-now">Where things stand now</h2><p id="asOf"></p></div></div>
    <div class="breakdown" id="breakdown" role="img" aria-label="Share of listed products by status"></div>
    <ul class="legend-row" id="breakdownLegend"></ul>
  </section>

  <section class="chart-card" aria-labelledby="h-progress">
    <div class="chart-head"><div><h2 id="h-progress">Fixed vs still open since disclosure</h2>
      <p>Number of listed products that are fixed or not vulnerable, compared with those still open, from 21 Oct 2026.</p></div></div>
    <div class="plot"><svg id="progress" role="img" aria-label="Line chart of fixed versus still-open products over time. The same numbers are in the data table below."></svg><div class="tip" hidden></div></div>
    <ul class="legend-row" id="progressLegend"></ul>
  </section>

  <section class="chart-card" aria-labelledby="h-stack">
    <div class="chart-head">
      <div><h2 id="h-stack">Status of every listed product over time</h2><p>All five statuses stacked. Switch to percentages to see the share rather than the count.</p></div>
      <div class="seg" role="group" aria-label="Chart units">
        <button type="button" data-mode="count" aria-pressed="true">Count</button><button type="button" data-mode="pct" aria-pressed="false">Percent</button>
      </div>
    </div>
    <div class="plot"><svg id="stack" role="img" aria-label="Stacked area chart of product statuses over time. The same numbers are in the data table below."></svg><div class="tip" hidden></div></div>
    <ul class="legend-row" id="stackLegend"></ul>
    <p class="fineprint" id="stepNote"></p>
  </section>

  <section class="chart-card" aria-labelledby="h-sup">
    <div class="chart-head"><div><h2 id="h-sup">Suppliers with the most open products</h2><p>Top 12 suppliers by number of products still open. Select a supplier to see its products in the list.</p></div></div>
    <ol class="hbars" id="suppliers"></ol>
    <ul class="legend-row" id="supplierLegend"></ul>
  </section>

  <section class="chart-card" aria-labelledby="h-table">
    <details>
      <summary><h2 id="h-table">Timeline data table</h2><span>The numbers behind the timeline charts</span></summary>
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th scope="col">Time</th><th scope="col">Listed</th><th scope="col">Still open</th><th scope="col">Vulnerable</th><th scope="col">Investigation</th><th scope="col">Workaround</th><th scope="col">Fixed</th><th scope="col">Not vuln</th><th scope="col">Resolved</th></tr></thead>
        <tbody id="tlTable"></tbody>
      </table></div>
    </details>
  </section>
</div>
"""

ABOUT = f"""
{notice("danger", "In short", "<p>PHP2Shell is a family of <b>critical</b> memory-safety vulnerabilities in PHP itself, tracked as CVE-2026-109618 and CVE-2026-109619 (CVSS 9.2). They can let an <b>unauthenticated</b> attacker run code on a server that uses PHP to serve web requests, or read secrets from its memory. PHP released fixes on <b>21 October 2026</b>: update to <b>8.5.12, 8.4.27, 8.3.36 or 8.2.35</b> (or a vendor-patched package), then restart every PHP process.</p>")}

<h2>What PHP2Shell is</h2>
<p>The bugs are in the PHP runtime, not in any particular application. When a request is cut short by a fatal error, for example by running out of its memory allowance, PHP could leave internal data half-built or pointing at memory that has already been freed. A carefully crafted request can then turn that leftover state into code execution or a leak of memory belonging to other requests.</p>
<p>Because the flaw sits below the application, a fully up-to-date WordPress, Drupal or other PHP application is still exposed if the PHP runtime underneath is unpatched. The researchers report that even a minimal "Hello World" PHP page on an affected version can be attacked.</p>

<h2>The two vulnerabilities</h2>
<p>Descriptions follow the official PHP advisory.</p>
<div class="table-scroll"><table class="data-table prose-table">
  <thead><tr><th scope="col">CVE</th><th scope="col">What goes wrong</th><th scope="col">Advisory</th></tr></thead>
  <tbody>
    <tr><th scope="row">CVE-2026-109618</th><td>Remote code execution via out-of-memory corruption. Hitting the memory limit at the wrong moment can leave request data partly initialised, which PHP later treats as valid during cleanup.</td><td><a href="https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w" {NEW}>GHSA-w8hw-w9fx-j79w</a></td></tr>
    <tr><th scope="row">CVE-2026-109619</th><td>Remote code execution via stale global state. Internal state belonging to one request can outlive its memory and be used by the next request on the same worker (a use-after-free).</td><td><a href="https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp" {NEW}>GHSA-6wmf-4rv5-p3rp</a></td></tr>
  </tbody>
</table></div>
<p>Both are rated CVSS 9.2. PHP considers Apache with <code>mod_php</code> the highest-risk setup: there, with a demonstrated exploit, an unauthenticated request can trigger the attack before any application code runs.</p>

<h2>Who is affected</h2>
<ul>
  <li><b>Any PHP installation that serves web requests</b>, including PHP-FPM, Apache with mod_php, php-cgi, FrankenPHP and LiteSpeed.</li>
  <li><b>Versions:</b> affected releases date back to PHP 5.4, and nearly every version before the fix has at least one of the bugs. Exposure depends on the version, the configuration and how PHP is run.</li>
  <li><b>Products that bundle PHP</b>: appliances, control panels, hosting platforms and other software that ship their own PHP runtime need an update from their vendor. The <a href="/">PHP2List software list</a> tracks known products.</li>
  <li><b>Demonstrated targets:</b> the researchers showed pre-authentication code execution against widely used applications including WordPress, Drupal and Joomla.</li>
</ul>
<div class="table-scroll"><table class="data-table prose-table versions">
  <thead><tr><th scope="col">PHP branch</th><th scope="col">Fixed in</th><th scope="col">Notes</th></tr></thead>
  <tbody>
    <tr><th scope="row">8.5</th><td>8.5.12</td><td></td></tr>
    <tr><th scope="row">8.4</th><td>8.4.27</td><td></td></tr>
    <tr><th scope="row">8.3</th><td>8.3.36</td><td></td></tr>
    <tr><th scope="row">8.2</th><td>8.2.35</td><td>8.2 reaches end of life on 31 December 2026.</td></tr>
    <tr><th scope="row">8.1 and older</th><td>No official release</td><td>End of life. Get a backported package from your distribution or LTS vendor, or upgrade. PHP published minimal source backports for 7.4, 8.0 and 8.1.</td></tr>
  </tbody>
</table></div>

<h2>What to do</h2>
<ol class="steps">
  <li><b>Update the PHP runtime everywhere it runs</b>, using your operating system's packages, your hosting provider, or the fixed releases. Updating an application or CMS does <em>not</em> update PHP.</li>
  <li><b>Restart</b> Apache, PHP-FPM and any long-running PHP workers, so the fixed code is actually loaded.</li>
  <li><b>Check products that bundle PHP</b> (appliances, panels, container images) and apply vendor updates. Use the <a href="/">software list</a> to see what's known.</li>
  <li><b>If you can't patch straight away</b>, CERT-EU advises isolating internet-facing applications from public networks until the fix is applied and verified. PHP's advisory lists temporary configuration changes (such as disabling <code>session.upload_progress</code> and adjusting memory limits) that block some attack paths. These are <b>partial</b> and don't make an installation safe, and some have side effects, so follow the exact guidance in the <a href="https://www.php.net/archive/2026.php#2026-10-21-5" {NEW}>PHP advisory</a> rather than a summary.</li>
  <li><b>After patching</b>, review any temporary settings you changed. The fix introduces a new hard memory limit (described in PHP's advisory and summarised on php2shell.com), so check that <code>memory_limit</code> and <code>post_max_size</code> fit your application.</li>
</ol>

<h2>Signs to look for</h2>
<p>Because the bugs act below the application, application logs may show little. Wiz Research suggests watching for:</p>
<ul>
  <li>unusual multipart (file-upload style) requests followed by memory-limit errors;</li>
  <li>bursts of HTTP 500 responses;</li>
  <li>unusually large or malformed <code>PHPSESSID</code> cookies;</li>
  <li>PHP workers crashing or restarting without explanation.</li>
</ul>
<p>Several security vendors have published detections and protections; see the sources below. Proof-of-concept material circulated after an early leak. The PHP security team said it had not identified any functional exploits among it at the time of release, but CERT-EU warns that attackers may already be exploiting the flaws.</p>

<h2>Timeline</h2>
<ul class="timeline">
  <li><b>2024</b>: while fixing an issue found in an external security audit, a PHP developer spots the first signs of the out-of-memory problem. An exploit is theorised, but no concrete attack is found.</li>
  <li><b>August–September 2026</b>: Calif and OpenAI independently report the same root cause on 11 August. Wiz Research reports further attack vectors on 24 August, and OpenAI on 18 September.</li>
  <li><b>20 October 2026</b>: the CVE identifiers leak early, without technical details. PHP publishes a pre-announcement and moves the release forward by a day.</li>
  <li><b>21 October 2026</b>: PHP releases 8.5.12, 8.4.27, 8.3.36 and 8.2.35 and publishes its advisory; the researchers publish their write-ups.</li>
</ul>
<p>Dates are from the PHP Foundation's account of the release. The people who found the bugs are credited on our <a href="/acknowledgements">acknowledgements</a> page.</p>

<h2>Official sources</h2>
<p>This page is PHP2List's own summary. For anything you act on, rely on the official sources below; if they differ from this page, they are right.</p>
<ul class="sources">
  <li><a href="https://www.php2shell.com/" {NEW}>php2shell.com</a><span>The official PHP2Shell site, published by Wiz, crediting all the research teams: overview, affected versions, mitigations and links to every write-up.</span></li>
  <li><a href="https://www.php.net/archive/2026.php#2026-10-21-5" {NEW}>PHP security advisory (php.net)</a><span>The authoritative advisory with fixed versions and exact temporary mitigations.</span></li>
  <li><a href="https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w" {NEW}>GHSA-w8hw-w9fx-j79w</a> and <a href="https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp" {NEW}>GHSA-6wmf-4rv5-p3rp</a><span>PHP's GitHub security advisories for each CVE.</span></li>
  <li><a href="https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/" {NEW}>The PHP Foundation blog</a><span>How the bugs were found and fixed, the full timeline, and what's changing.</span></li>
  <li><a href="https://www.wiz.io/blog/php2shell-php-rce" {NEW}>Wiz Research</a><span>Technical write-up and detection guidance.</span></li>
  <li><a href="https://calif.io/php2shell/" {NEW}>Calif</a><span>Technical write-up of the attack paths and demonstrated targets.</span></li>
  <li><a href="https://openai.com/index/coordinated-disclosure-of-critical-vulnerabilities" {NEW}>OpenAI</a><span>How the disclosure was coordinated.</span></li>
  <li><a href="https://cert.europa.eu/publications/security-advisories/2026-018/" {NEW}>CERT-EU Security Advisory 2026-018</a><span>Affected versions and recommendations for organisations.</span></li>
  <li><a href="https://github.com/NCSC-NL/php2shell" {NEW}>NCSC-NL php2shell repository</a><span>Operational information and the software list this site displays.</span></li>
  <li><a href="https://github.com/enisaeu/CNW/blob/main/advisories/2026/CNW-2026-04_php.md" {NEW}>EU CSIRTs Network advisory list</a><span>Advisories from national CSIRTs across the EU.</span></li>
</ul>
<p class="meta-line">Summary written by PHP2List from the sources above. Last checked: 22 October 2026.</p>
"""

ABOUT_LIST = f"""
<p>PHP2List, created by zer0lightning, is an independent, unofficial website that makes the public <a href="https://github.com/NCSC-NL/php2shell" {NEW}>NCSC-NL php2shell software list</a> easier to search, filter, share and export during the response to the <a href="/what-is-php2shell">PHP2Shell vulnerabilities</a>.</p>

<h2>Why it exists</h2>
<p>When PHP2Shell was disclosed, NCSC-NL and its contributors began publishing a valuable inventory of software that depends on PHP, with a status for each product. It's published as 27 alphabetical Markdown pages on GitHub, which works well for maintaining it, but is hard to use when you need a quick answer:</p>
<ul>
  <li>You can't search across all the pages at once, or filter by status.</li>
  <li>There's no easy way to keep an eye on just the vendors and products your organisation actually uses.</li>
  <li>Getting the data into a spreadsheet or ticket for your team takes manual work.</li>
  <li>It's hard to see the bigger picture: how many listed products are fixed, and how fast that's changing.</li>
</ul>
<p>PHP2List adds a fast, searchable view on top of the same data, without changing it, so defenders can spend less time looking things up and more time patching.</p>

<h2>What you can use it for</h2>
<ul>
  <li><b>Check your software:</b> search by supplier, product, version or note text, and filter by status for either CVE.</li>
  <li><b>Track what you run:</b> build a watchlist of exact suppliers, exact products or keywords, and see only those.</li>
  <li><b>Share with your team:</b> send a link that opens the same watchlist and filters, or bookmark it to come back to.</li>
  <li><b>Feed your process:</b> export to CSV or JSON for asset inventories, tickets or reports, including a per-vendor summary.</li>
  <li><b>Follow progress:</b> the <a href="/charts">patch progress</a> page shows how many listed products are fixed or still open since disclosure.</li>
  <li><b>Brief others:</b> the status overview and charts give a quick picture for colleagues or management.</li>
</ul>

<h2>What it is not</h2>
<ul>
  <li><b>Not an official source.</b> PHP2List is not NCSC-NL or php2shell.com and is not affiliated with or endorsed by them, or by the PHP project. It only displays NCSC-NL's public list.</li>
  <li><b>Not a vulnerability scanner.</b> It doesn't check your servers. To know whether you're exposed, check the PHP version actually running on each system and your vendors' advisories.</li>
  <li><b>Not a complete inventory.</b> The list covers products someone has added to it. A product that isn't listed may still be affected, and your own custom PHP applications aren't covered at all.</li>
  <li><b>Not a verdict.</b> Statuses come from the source list and are investigation leads. PHP2List doesn't verify vendor claims.</li>
  <li><b>Not security advice, and not a support service.</b> See the <a href="/disclaimer">disclaimer</a>. Corrections to the list belong with <a href="https://github.com/NCSC-NL/php2shell#contributions-welcome" {NEW}>NCSC-NL</a>.</li>
  <li><b>Not collecting your data.</b> Your watchlist stays in your browser; see the <a href="/privacy">privacy notice</a>.</li>
</ul>

<h2>How it works</h2>
<ul>
  <li>The site reads the list from the NCSC-NL repository on GitHub about every 30 minutes and shows it with the same columns: Supplier, Product, Version, the status for each CVE, Notes and Links.</li>
  <li>Nothing in the data is added, removed or edited. If GitHub can't be reached, the last copy is shown with a clear warning.</li>
  <li>The patch progress charts are rebuilt from the list's own changelog.</li>
  <li>The site loads nothing from other websites and has no analytics or tracking.</li>
</ul>

<h2>Open source</h2>
<ul>
  <li><b>PHP2List's code</b> is open source under the <b>MIT licence</b>: <a href="{REPO_URL}" {NEW}>PHP2List on GitHub</a>. You're free to use, copy, modify and run your own copy.</li>
  <li><b>The software list</b> is not part of PHP2List's code. It's © NCSC-NL and contributors under the <a href="https://github.com/NCSC-NL/php2shell/blob/main/LICENSE" {NEW}>EUPL-1.2 licence</a> (TLP:CLEAR), and those terms also apply to the data in exports.</li>
  <li>If you run your own copy, it can read from a fork or mirror of the list if the original ever becomes unavailable.</li>
</ul>

<h2>Credits</h2>
<p>All credit for the list belongs to NCSC-NL and its contributors, and for the research to the PHP2Shell researchers. See the <a href="/acknowledgements">acknowledgements</a>.</p>
"""

CHANGES = """
<div class="chg-page">
<p class="chg-intro">Every status change in NCSC-NL's list over the last 30 days, newest first, rebuilt from the list's own changelog. Select a product to see its current entry in the full list.</p>
<div class="chg-controls">
  <div class="seg" id="chgPeriod" role="group" aria-label="Period">
    <button type="button" data-period="1" aria-pressed="false">24 hours</button><button type="button" data-period="7" aria-pressed="true">7 days</button><button type="button" data-period="30" aria-pressed="false">30 days</button>
  </div>
  <select id="chgKind" aria-label="Type of change">
    <option value="all">All changes</option>
    <option value="fixed">Newly fixed or not vulnerable</option>
    <option value="vuln">Newly vulnerable or workaround</option>
    <option value="added">Added to the list</option>
  </select>
  <label class="chk" id="chgWatchWrap" hidden><input type="checkbox" id="chgWatch"> Only my watchlist <span id="chgWatchN"></span></label>
</div>
<div class="feedbox">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14"/><circle cx="6" cy="18" r="1.5"/></svg>
  <span class="fb-text"><b>Follow changes in a feed reader</b> (RSS/Atom), with no account or email needed.</span>
  <span class="fb-actions"><button type="button" class="btn sm" id="feedAll">Copy feed link</button><button type="button" class="btn sm" id="feedWatch" hidden>Copy feed for my watchlist</button></span>
  <input id="feedUrl" class="feed-url" type="text" readonly aria-label="Feed link" spellcheck="false" hidden>
  <p class="fb-note"><a href="/subscribe">How to subscribe</a>. A watchlist feed puts your watchlist entries in the feed address, so your feed reader sends them to this site (see <a href="/privacy">Privacy</a>).</p>
</div>
<p class="chg-count" id="chgCount">Loading recent changes…</p>
<div id="chgList" aria-live="polite"><div class="loading"><div class="spinner"></div>Loading…</div></div>
</div>
"""

API = f"""
{notice("info", "In short", "<p>The same data the site shows is available as JSON, free and without a key, for scripts and security tools. It is <b>unofficial</b>: check important findings against the <a href='https://github.com/NCSC-NL/php2shell/tree/main/software' " + NEW + ">NCSC-NL source list</a> and your vendors. There is no uptime guarantee and no support.</p>")}

<h2 id="endpoints">Endpoints</h2>
<p>All endpoints are read-only (<code>GET</code>), need no authentication, and allow requests from any website (CORS <code>Access-Control-Allow-Origin: *</code>). Responses are JSON in UTF-8.</p>
<table class="api-table">
  <thead><tr><th scope="col">Endpoint</th><th scope="col">What it returns</th></tr></thead>
  <tbody>
    <tr><td><code>/api/v1/software</code></td><td>The full software list: one item per product, with both CVE statuses, notes and links.</td></tr>
    <tr><td><code>/api/v1/changes</code></td><td>Status changes in the last 30 days, newest first, each with the status before and after.</td></tr>
    <tr><td><code>/api/v1/timeline</code></td><td>Counts per status over time since disclosure (the data behind <a href="/charts">Patch progress</a>).</td></tr>
    <tr><td><code>/api/v1</code></td><td>A short index of the endpoints above.</td></tr>
    <tr><td id="feed"><code>/feed.xml</code></td><td>An Atom feed of the latest 50 status changes. Add <code>?v=</code> once per watchlist entry to narrow it, for example <code>/feed.xml?v=s%3ACisco&amp;v=wordpress</code>.</td></tr>
  </tbody>
</table>

<h2 id="example">Example</h2>
<pre class="code"><code>curl -s https://php2list.com/api/v1/software | jq '.items[] | select(.s1 == "Vulnerable") | .id'</code></pre>

<h2 id="software">Fields: <code>/api/v1/software</code></h2>
<ul>
  <li><code>apiVersion</code>: always <code>1</code> for this version.</li>
  <li><code>listUpdated</code>: NCSC-NL's "last status update" text, as published (not a machine-readable date).</li>
  <li><code>fetchedAt</code>: when PHP2List last fetched the list (ISO 8601, UTC).</li>
  <li><code>sourceRevision</code>: the NCSC-NL commit the data comes from, when known. <code>official</code>: <code>false</code> if it came from a mirror. <code>sourceArchived</code>: <code>true</code> once the source list is no longer updated.</li>
  <li><code>count</code> and <code>items</code>. Each item has:
    <ul>
      <li><code>id</code>: a stable, URL-safe product ID such as <code>cisco--cisco-meraki-dashboard</code>. The product page is <code>/#p=&lt;id&gt;</code>.</li>
      <li><code>supplier</code>, <code>product</code>, <code>version</code> (the "Version (see Status)" column).</li>
      <li><code>s1</code> and <code>s2</code>: status for CVE-2026-109618 and CVE-2026-109619: <code>Vulnerable</code>, <code>Workaround</code>, <code>Investigation</code>, <code>Fix</code>, <code>Not vuln</code> or empty.</li>
      <li><code>notes</code> (array of text) and <code>links</code> (array of <code>{{label, url}}</code>).</li>
    </ul>
  </li>
</ul>

<h2 id="changes">Fields: <code>/api/v1/changes</code></h2>
<ul>
  <li><code>days</code> (30), <code>generatedAt</code>, <code>count</code> and <code>events</code>, newest first.</li>
  <li>Each event has <code>t</code> (when the change was recorded, ISO 8601), <code>id</code>, <code>supplier</code>, <code>product</code>, <code>version</code>, the new <code>s1</code>/<code>s2</code>, <code>prev</code> (the statuses before, or <code>null</code> when the product was added), the first <code>note</code> and up to three <code>links</code>.</li>
</ul>

<h2 id="use">Fair use</h2>
<ul>
  <li><b>Please cache.</b> The data changes a few times a day at most. Checking every 15 to 30 minutes is plenty; responses can be cached for 5 minutes.</li>
  <li>Abusive request rates may be blocked to keep the site available for everyone.</li>
  <li><b>Stability:</b> within <code>v1</code>, fields won't be removed or change meaning. New fields may be added, so ignore ones you don't know. The internal <code>/api/software</code> addresses used by the site itself may change without notice.</li>
</ul>

<h2 id="licence">Licence and attribution</h2>
<p>The data is NCSC-NL's php2shell software list, © NCSC-NL and contributors, licensed under <a href="https://interoperable-europe.ec.europa.eu/collection/eupl/eupl-text-eupl-12" {NEW}>EUPL-1.2</a> and marked <span class="tlp">TLP:CLEAR</span>. If you republish it, credit NCSC-NL and its contributors and link to the <a href="https://github.com/NCSC-NL/php2shell/tree/main/software" {NEW}>source list</a>. PHP2List is not affiliated with NCSC-NL; please don't present this API as an NCSC-NL service. The <a href="/disclaimer">disclaimer</a> applies to the API and feeds too.</p>
<p>Problems or suggestions: open an issue on the <a href="{REPO_URL}/issues" {NEW}>PHP2List repository</a>. Corrections to the list itself go to <a href="https://github.com/NCSC-NL/php2shell" {NEW}>NCSC-NL</a>.</p>
"""

SUBSCRIBE = f"""
<h2 id="subTitle">Feed for all status changes</h2>
<p>This is a <b>feed</b> (RSS/Atom). Browsers don't display feeds; instead, copy the address below into a feed reader, and new status changes will show up there automatically. No account or email is needed.</p>
<div class="sub-box">
  <input id="subUrl" class="feed-url" type="text" readonly aria-label="Feed address" spellcheck="false" value="https://php2list.com/feed.xml">
  <button type="button" class="btn primary" id="subCopy">Copy address</button>
</div>
<div id="subWatch" hidden>
  <p>It only includes changes that match these watchlist entries:</p>
  <ul id="subEntries" class="sub-entries"></ul>
  <p class="meta-line">Your watchlist entries are part of this address, so your feed reader sends them to this site each time it checks for updates. See <a href="/privacy">Privacy</a>.</p>
</div>
<h2>How to subscribe</h2>
<ol>
  <li>Copy the address above.</li>
  <li>In your feed reader (Feedly, Inoreader, NetNewsWire, Thunderbird, Outlook and most others), choose the option to add a feed or subscription, usually called <b>Add feed</b>, <b>Follow</b> or <b>Subscribe</b>, and paste the address.</li>
  <li>The reader checks for new changes by itself. Most check every 15 to 60 minutes.</li>
</ol>
<p>Each entry shows the product, what changed (for example <i>Investigation → Fix</i>), the vendor's note and links, and a link back to the product here.</p>
<p class="sub-links"><a id="subChanges" href="/changes">See these changes on the Changes page</a> · <a id="subRaw" href="/feed.xml?view=xml">View the raw feed (XML)</a> · <a href="/api-docs#feed">Feed details</a></p>
"""

pages = {
  "disclaimer": ("Disclaimer", "Disclaimer for PHP2List, an unofficial viewer of the NCSC-NL php2shell software list.", "Disclaimer",
                 "What PHP2List is, where its data comes from, and the limits of what it can tell you.", disclaimer),
  "privacy": ("Privacy", "Privacy notice for PHP2List: no accounts, no cookies, no analytics.", "Privacy",
              "What information this site does and doesn't handle.", privacy),
  "what-is-php2shell": ("What is PHP2Shell", "A plain-language summary of the PHP2Shell vulnerabilities (CVE-2026-109618, CVE-2026-109619): what they are, who is affected and what to do, with links to the official sources.", "What is PHP2Shell?",
                      "A plain-language summary of the vulnerabilities: what they are, who is affected and what to do. Official sources are listed at the end.", ABOUT),
  "about": ("About PHP2List", "Why PHP2List exists, what it's useful for during the PHP2Shell response, and what it isn't. An unofficial, independent viewer of the NCSC-NL list.", "About PHP2List",
            "Why this site exists, what it's useful for, and what it isn't.", ABOUT_LIST),
  "acknowledgements": ("Acknowledgements", "Credits for the PHP2Shell research and the NCSC-NL software list.", "Acknowledgements",
                       "Credit to the researchers who found PHP2Shell, and to NCSC-NL and the contributors who maintain the software list.", ack),
}
for slug, (title, desc, h1, lede, body) in pages.items():
    open(f"{pub}/{slug}.html", "w").write(page(slug, title, desc, h1, lede, body))
    print("wrote", slug)
open(f"{pub}/charts.html", "w").write(page("charts", "Patch progress",
    "Charts of how many products in the php2shell software list are fixed versus still open since the 21 Oct 2026 disclosure. Unofficial viewer.",
    "Patch progress", "How many listed products are fixed, and how many are still vulnerable or unresolved, since the PHP2Shell patches were disclosed.",
    CHARTS, wide=True, script="/assets/charts.js"))
print("wrote charts")
open(f"{pub}/changes.html", "w").write(page("changes", "Changes",
    "Recent status changes in the NCSC-NL php2shell software list, newest first, with a feed for your watchlist. Unofficial viewer.",
    "Recent changes", "What changed in the list: products that were added, fixed, or found vulnerable.",
    CHANGES, wide=True, script="/assets/changes.js"))
print("wrote changes")
open(f"{pub}/api-docs.html", "w").write(page("api-docs", "API and feeds",
    "Free JSON API and Atom feed for the php2shell software list: endpoints, fields and fair use. Unofficial.",
    "API and feeds", "Use the list in your own scripts and tools.", API))
print("wrote api-docs")
open(f"{pub}/subscribe.html", "w").write(page("subscribe", "Subscribe to changes",
    "Follow status changes in the php2shell software list in your feed reader (RSS/Atom). Unofficial.",
    "Subscribe to changes", "Get new status changes in your feed reader.", SUBSCRIBE, script="/assets/subscribe.js"))
print("wrote subscribe")
open(f"{pub}/404.html", "w").write(page("404", "Page not found", "This page doesn't exist on PHP2List.", "Page not found",
    "The page you asked for doesn't exist.", '<p>Try the <a href="/">software list</a>, the <a href="/charts">patch progress charts</a> or the <a href="/disclaimer">disclaimer</a>.</p>'))
print("wrote 404")

# robots.txt and sitemap.xml, so search engines index php2list.com (not the pages.dev copy).
SITEMAP = ["", "changes", "what-is-php2shell", "charts", "about", "api-docs", "disclaimer", "privacy", "acknowledgements"]
open(f"{pub}/robots.txt", "w").write(f"User-agent: *\nDisallow: /api/\n\nSitemap: {SITE_URL}/sitemap.xml\n")
open(f"{pub}/sitemap.xml", "w").write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + "".join(f"  <url><loc>{SITE_URL}/{s}</loc></url>\n" for s in SITEMAP) + "</urlset>\n")
print("wrote robots.txt, sitemap.xml")

# Cache-busting: every page links its stylesheet and scripts with ?v=<content hash>, so after a
# deploy, browsers fetch the matching new files instead of mixing new pages with cached old ones.
import hashlib, glob
ASSETS = {os.path.basename(f): hashlib.sha256(open(f, "rb").read()).hexdigest()[:10]
          for f in glob.glob(f"{pub}/assets/*") if os.path.isfile(f)}
ASSET_RE = re.compile(r'((?:src|href)="/assets/)([A-Za-z0-9_.-]+)(?:\?v=[0-9a-f]+)?(")')
for f in sorted(glob.glob(f"{pub}/*.html")):
    html = open(f).read()
    new = ASSET_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={ASSETS[m.group(2)]}{m.group(3)}" if m.group(2) in ASSETS else m.group(0), html)
    if new != html: open(f, "w").write(new)
print("versioned asset links in", len(glob.glob(f"{pub}/*.html")), "pages")
