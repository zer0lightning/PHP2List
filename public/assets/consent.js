// SPDX-License-Identifier: MIT
// PHP2List privacy notice, shared by every page.
// PHP2List itself sets no cookies and runs no analytics or tracking scripts. What the site
// itself can store is the visitor's own vendor watchlist and theme choice, in this
// browser's local storage. The hosting provider (Cloudflare) processes request data and may
// set its own strictly necessary security cookies; the notice says so. Visitors can switch
// PHP2List's own storage off here.
(() => {
  const KEY = "php2list.privacy";           // "ok" | "nostore"
  const DATA_KEYS = ["php2list.vendors", "php2list.theme", "php2list.leaveNotice", "php2list.visit"];
  const LEAVE_KEY = "php2list.leaveNotice";
  const ls = {
    get(k){ try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v){ try { localStorage.setItem(k, v); } catch (e) {} },
    del(k){ try { localStorage.removeItem(k); } catch (e) {} },
  };
  let available = true;
  try { localStorage.setItem("php2list.test", "1"); localStorage.removeItem("php2list.test"); } catch (e) { available = false; }

  let box = null;
  function close(){
    if (!box) return;
    box.remove(); box = null;
  }
  function choose(value){
    ls.set(KEY, value);
    if (value === "nostore") {
      DATA_KEYS.forEach(ls.del);
      delete document.documentElement.dataset.theme;      // fall back to the system theme
      document.dispatchEvent(new CustomEvent("php2list:privacy", { detail: value }));
    }
    close();
  }
  function open(fromLink){
    close();
    const state = ls.get(KEY);
    box = document.createElement("section");
    box.className = "privacy-banner";
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Privacy notice");
    // Static markup only: nothing from the page, URL or data is inserted here.
    box.innerHTML = `
      <div class="pb-text">
        <b>Your privacy</b>
        <p>PHP2List itself sets <strong>no cookies</strong> and runs <strong>no analytics or tracking scripts</strong>. Your watchlist, theme, link-notice choice and the time of your last visit (to show what changed since) are saved <strong>in this browser only</strong>, so they're still there next time. It isn't sent to the server.</p>
        <p>The site is hosted by Cloudflare, which processes basic request data such as your IP address to deliver and protect the site. Cloudflare may also set its own security cookies, for example to tell people apart from bots.</p>
        <p class="pb-state"></p>
        <label class="pb-leave"><input type="checkbox"> Warn me before opening an external site</label>
      </div>
      <div class="pb-actions">
        <button type="button" class="btn primary" data-choice="ok">OK</button>
        <button type="button" class="btn" data-choice="nostore">Don't save my settings</button>
        <a class="pb-link" href="/privacy">Privacy notice</a>
      </div>
      <button type="button" class="pb-close" aria-label="Close privacy notice">×</button>`;
    const st = box.querySelector(".pb-state");
    if (!available) st.textContent = "Your browser is blocking local storage, so nothing can be saved anyway.";
    else if (state === "nostore") st.textContent = "Current setting: nothing is saved. Your watchlist still works through the page address, but won't be remembered.";
    else if (state === "ok") st.textContent = "Current setting: your settings and last-visit time are saved in this browser.";
    else st.hidden = true;
    if (state === "nostore") box.querySelector('[data-choice="ok"]').textContent = "Allow saving";
    const leave = box.querySelector(".pb-leave input");
    leave.checked = ls.get(LEAVE_KEY) !== "off";
    leave.addEventListener("change", () => {
      if (leave.checked) { ls.del(LEAVE_KEY); document.dispatchEvent(new CustomEvent("php2list:leave-notice", { detail: "on" })); }
      else if (ls.get(KEY) !== "nostore") ls.set(LEAVE_KEY, "off");
      else document.dispatchEvent(new CustomEvent("php2list:leave-notice", { detail: "off" }));
    });
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-choice]");
      if (b) choose(b.dataset.choice);
      if (e.target.closest(".pb-close")) { if (!ls.get(KEY)) ls.set(KEY, "ok"); close(); }
    });
    box.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!ls.get(KEY)) ls.set(KEY, "ok"); close(); } });
    document.body.appendChild(box);
    if (fromLink) box.querySelector("[data-choice]").focus();
  }

  window.php2listStorageAllowed = () => ls.get(KEY) !== "nostore";
  document.addEventListener("click", (e) => {
    const link = e.target.closest("[data-privacy-choices]");
    if (link) { e.preventDefault(); open(true); }
  });
  const init = () => { if (!ls.get(KEY) && available) open(false); if (location.hash === "#choices") open(true); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
