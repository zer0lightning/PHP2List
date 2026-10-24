// SPDX-License-Identifier: MIT
// PHP2List "you are leaving" notice, shared by every page.
// Any link to another website first shows where it goes, so visitors know they are leaving
// PHP2List (which is unofficial) for a site PHP2List does not control. Vendor links in the
// list come from public data, so the full address is shown before the visitor continues.
// Visitors can turn the notice off ("Don't show this again"), and back on in Privacy choices.
// The choice is saved in this browser unless they chose "Don't save my settings", in which
// case it lasts until the page is reloaded or closed.
(() => {
  const KEY = "php2list.leaveNotice";      // "off" = don't show the notice
  let dlg = null, pending = null, offForPage = false;
  const canSave = () => { try { return localStorage.getItem("php2list.privacy") !== "nostore"; } catch (e) { return false; } };
  const isOff = () => { if (offForPage) return true; try { return localStorage.getItem(KEY) === "off"; } catch (e) { return false; } };
  function turnOff(){
    offForPage = true;
    if (canSave()) { try { localStorage.setItem(KEY, "off"); } catch (e) {} }
  }
  // Privacy choices can switch the notice back on.
  document.addEventListener("php2list:leave-notice", (e) => { offForPage = e.detail === "off"; });

  function build(){
    dlg = document.createElement("dialog");
    dlg.className = "leave-dlg";
    dlg.setAttribute("aria-labelledby", "leave-h");
    dlg.setAttribute("aria-describedby", "leave-d");
    // Static markup only; the destination is filled in with textContent below.
    dlg.innerHTML = `
      <form method="dialog">
        <h3 id="leave-h">You're leaving PHP2List</h3>
        <p id="leave-d">This link goes to an external website that PHP2List doesn't run or control. Check the address before you continue.</p>
        <div class="leave-dest">
          <span class="leave-host"></span>
          <span class="leave-url"></span>
        </div>
        <label class="leave-off"><input type="checkbox"> Don't show this again</label>
        <p class="leave-off-hint">Turn it back on any time in Privacy choices, in the page footer.</p>
        <div class="dlg-actions">
          <button class="btn" value="cancel" type="submit">Stay here</button>
          <button class="btn primary" value="go" type="submit">Continue to site ↗</button>
        </div>
      </form>`;
    dlg.addEventListener("close", () => {
      const p = pending; pending = null;
      const off = dlg.querySelector(".leave-off input");
      if (off.checked) turnOff();
      if (!p || dlg.returnValue !== "go") { if (p && p.from && p.from.isConnected) p.from.focus(); return; }
      go(p.url, p.newTab);
    });
    document.body.appendChild(dlg);
  }

  function external(a){
    if (!a || !a.href || a.hasAttribute("download")) return null;
    let u;
    try { u = new URL(a.href, location.href); } catch (e) { return null; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.origin === location.origin) return null;
    return u;
  }

  function go(url, newTab){
    if (newTab) window.open(url, "_blank", "noopener,noreferrer");
    else location.assign(url);
  }

  function show(a, u, newTab){
    if (isOff()) { go(u.href, newTab); return; }
    if (!dlg) build();
    dlg.querySelector(".leave-off input").checked = false;
    dlg.querySelector(".leave-off-hint").textContent = canSave()
      ? "Turn it back on any time in Privacy choices, in the page footer."
      : "You chose not to save settings, so this lasts until you reload or leave the page.";
    pending = { url: u.href, newTab, from: a };
    dlg.querySelector(".leave-host").textContent = u.hostname;
    dlg.querySelector(".leave-url").textContent = u.href;
    dlg.returnValue = "";
    dlg.showModal();
    dlg.querySelector('[value="go"]').focus();
  }

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = e.target.closest && e.target.closest("a[href]");
    const u = external(a);
    if (!u) return;
    e.preventDefault();
    show(a, u, a.target === "_blank" || e.ctrlKey || e.metaKey || e.shiftKey);
  });
  // Middle-click opens a new tab without a "click" event; show the notice for it too.
  document.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    const a = e.target.closest && e.target.closest("a[href]");
    const u = external(a);
    if (!u) return;
    e.preventDefault();
    show(a, u, true);
  });
})();
