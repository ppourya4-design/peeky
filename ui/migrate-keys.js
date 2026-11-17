/* One-time carry-over of saved preferences from the app's earlier name (localStorage keys "peeky.*" -> "poyzen.*"). */
(() => {
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('peeky.')) continue;
      const nk = 'poyzen.' + k.slice(6);
      if (localStorage.getItem(nk) === null) localStorage.setItem(nk, localStorage.getItem(k));
      localStorage.removeItem(k);
    }
  } catch { /* storage blocked: nothing to carry */ }
})();
