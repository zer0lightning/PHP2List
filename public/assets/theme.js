// SPDX-License-Identifier: MIT
// PHP2List theme toggle, shared by every page.
// Follows the system theme by default; a click switches it and the choice is remembered in this browser.
(() => {
  const KEY = "php2list.theme";
  const root = document.documentElement;
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const btn = document.getElementById("themeToggle");
  // Saving is skipped when the visitor chose "Don't save my settings" in the privacy notice.
  const save = (v) => { try { if (v && localStorage.getItem("php2list.privacy") === "nostore") return; v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (e) {} };

  function apply(){
    const t = root.dataset.theme;
    const dark = t ? t === "dark" : mq.matches;
    root.classList.toggle("is-dark", dark);
    if (btn){
      const label = dark ? "Switch to light theme" : "Switch to dark theme";
      btn.setAttribute("aria-label", label);
      btn.title = label;
    }
  }
  if (btn) btn.addEventListener("click", () => {
    const next = root.classList.contains("is-dark") ? "light" : "dark";
    // If the choice matches the system setting, forget it so the page keeps following the system.
    if ((next === "dark") === mq.matches){ delete root.dataset.theme; save(null); }
    else { root.dataset.theme = next; save(next); }
    apply();
  });
  mq.addEventListener("change", apply);
  document.addEventListener("php2list:privacy", apply);
  apply();
})();
