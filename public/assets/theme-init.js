// SPDX-License-Identifier: MIT
// Applies a saved theme before the page paints (loaded synchronously in <head>).
try{var t=localStorage.getItem("php2list.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}
