/* Living background for the player window. The colours come from the cover (up to three clearly different hues),
   the blobs are pure CSS (see player.css), and the whole thing can be switched off from the "Synced" panel.
   Saved as localStorage "poyzen.aurora" = "off"; anything else means on. */
(() => {
'use strict';
const card = document.getElementById('card');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- the layers: slipped in right after the default gradient layers, under the skin canvas and the grain
const aur = document.createElement('div'), shade = document.createElement('div');
aur.className = 'aur'; aur.innerHTML = '<i class="b1"></i><i class="b2"></i><i class="b3"></i>'; shade.className = 'shade';
const layers = card.querySelectorAll('.pt-layer');
(layers.length ? layers[layers.length - 1] : card.firstChild).after(aur, shade);

// ---- on / off
let on = true; try { on = localStorage.getItem('poyzen.aurora') !== 'off'; } catch { /* default: on */ }
const btns = [...document.querySelectorAll('#auseg button')];
function paint() { card.classList.toggle('aur-on', on); btns.forEach((b) => b.classList.toggle('on', (b.dataset.a === 'on') === on)); }
btns.forEach((b) => b.addEventListener('click', () => { on = b.dataset.a === 'on'; try { localStorage.setItem('poyzen.aurora', on ? 'on' : 'off'); } catch { /* not remembered */ } paint(); }));
paint();

// ---- colours from the cover: by AREA. The colour that covers most of the cover gets the biggest, strongest blob;
//      the 2nd and 3rd get smaller, softer ones. Greys and darks are real colours too (a grey cover stays greyish).
const lin = (c) => { c /= 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
const gam = (c) => { c = clamp(c, 0, 1); return Math.round(255 * (c <= .0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - .055)); };
const toLab = (r, g, b) => { r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s]; };
const fromLab = (L, a, b) => { const l = Math.pow(L + .3963377774 * a + .2158037573 * b, 3), m = Math.pow(L - .1055613458 * a - .0638541728 * b, 3), s = Math.pow(L - .0894841775 * a - 1.291485548 * b, 3);
  return [gam(4.0767416621 * l - 3.3077115913 * m + .2309699292 * s), gam(-1.2684380046 * l + 2.6097574011 * m - .3413193965 * s), gam(-.0041960863 * l - .7034186147 * m + 1.707614701 * s)]; };
const dist = (p, q) => Math.hypot(p[0] - q[0], (p[1] - q[1]) * 1.1, (p[2] - q[2]) * 1.1);
const GRAPHITE = { cols: [[52, 62, 80], [34, 42, 58], [24, 30, 42]], w: [1, .55, .35] };

// RGBA pixels (square, any size) -> { cols: [[r,g,b] x3], w: [1, .., ..] }  (w = share of the area relative to the biggest colour)
function paletteFromPixels(d) {
  // 1) 16 levels per channel: count the pixels of each little colour cell
  const cells = new Map(); let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const k = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4), c = cells.get(k);
    if (c) { c.n++; c.r += d[i]; c.g += d[i + 1]; c.b += d[i + 2]; } else cells.set(k, { n: 1, r: d[i], g: d[i + 1], b: d[i + 2] });
    total++;
  }
  if (!total) return null;
  let cl = [...cells.values()].map((c) => ({ n: c.n, lab: toLab(c.r / c.n, c.g / c.n, c.b / c.n) })).sort((a, b) => b.n - a.n);
  // 2) merge cells that look alike (perceptually, in OKLab) into clusters, twice, because the centres drift
  const T = .085;
  for (let pass = 0; pass < 2; pass++) {
    const out = [];
    for (const c of cl) {
      let near = null, nd = T;
      for (const o of out) { const dd = dist(o.lab, c.lab); if (dd < nd) { nd = dd; near = o; } }
      if (near) { const n = near.n + c.n; near.lab = near.lab.map((v, j) => (v * near.n + c.lab[j] * c.n) / n); near.n = n; } else out.push({ n: c.n, lab: c.lab.slice() });
    }
    cl = out.sort((a, b) => b.n - a.n);
  }
  // 3) the three biggest that are clearly different; tiny specks (< 2 %) are not colours of the cover
  const top = [], minShare = .02;
  for (const c of cl) { if (top.length >= 3) break; if (c.n / total < minShare) break; if (top.every((t) => dist(t.lab, c.lab) > .15)) top.push(c); }
  if (!top.length) top.push(cl[0]);
  // 4) lift them to the stage: keep the real hue, the real greyness; only guard against pure black and glare
  const cols = top.map((c) => { const [L, a, b] = c.lab, ch = Math.hypot(a, b), k = ch > .03 ? Math.min(1.18, .22 / ch) : 1;
    return fromLab(clamp(L, .36, .8), a * k, b * k); });
  const w = top.map((c) => c.n / top[0].n);
  while (cols.length < 3) {                                         // a one- or two-colour cover: soft neighbours of the main colour
    const [L, a, b] = top[0].lab, i = cols.length;
    cols.push(fromLab(clamp(L + (i === 1 ? .1 : -.08), .3, .85), a * .9, b * .9)); w.push(i === 1 ? .38 : .25);
  }
  return { cols, w };
}

function paletteFromImage(img) {
  const N = 64, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, m = Math.min(w, h) || 1;
  g.drawImage(img, (w - m) / 2, (h - m) / 2, m, m, 0, 0, N, N);
  return paletteFromPixels(g.getImageData(0, 0, N, N).data) || GRAPHITE;
}
if (typeof module !== 'undefined') module.exports = { paletteFromPixels };

// ---- smooth hand-over: colours are blended in OKLab, weights (opacity / size) glide together
const ease = (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
let shown = null, raf = 0;                                          // shown = { lab: [3x[L,a,b]], w: [3] }
const toState = (p) => ({ lab: p.cols.map((c) => toLab(...c)), w: p.w.slice(0, 3) });
function paintState(st) {
  st.lab.forEach((l, i) => {
    const wn = clamp(st.w[i], 0, 1), rgb = fromLab(...l);
    card.style.setProperty('--c' + (i + 1), `rgb(${rgb})`);
    card.style.setProperty('--o' + (i + 1), (.3 + .6 * Math.pow(wn, .8)).toFixed(3));       // the bigger the share, the stronger
    card.style.setProperty('--s' + (i + 1), (.7 + .55 * wn).toFixed(3));                   // ... and the bigger the blob
  });
  const [r, g, b] = fromLab(...st.lab[0]);
  card.style.setProperty('--base', `rgba(${r},${g},${b},.5)`);      // the main colour also floods the ground softly
}
function goTo(p, ms = 1500) {
  const to = toState(p);
  cancelAnimationFrame(raf);
  if (!shown) { shown = to; paintState(shown); return; }
  const from = { lab: shown.lab.map((l) => l.slice()), w: shown.w.slice() }, t0 = performance.now();
  const step = (now) => {
    const k = ease(clamp((now - t0) / ms, 0, 1));
    shown = { lab: from.lab.map((l, i) => l.map((v, j) => v + (to.lab[i][j] - v) * k)), w: from.w.map((v, i) => v + (to.w[i] - v) * k) };
    paintState(shown);
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
const probe = document.createElement('canvas'); probe.width = probe.height = 1;
const pg = probe.getContext('2d', { willReadFrequently: true });
const cssRgb = (css) => { pg.clearRect(0, 0, 1, 1); pg.fillStyle = '#343e50'; pg.fillStyle = css; pg.fillRect(0, 0, 1, 1); return Array.from(pg.getImageData(0, 0, 1, 1).data).slice(0, 3); };   // any css colour (hex, rgb, hsl)
const fromPal = (pal) => ({ cols: pal.slice(0, 3).map(cssRgb), w: [1, .6, .4] });

let haveCover = false, fallback = null, token = 0;
window.Aurora = {
  cover(b64) {                                                        // called with every new cover (base64 png, or nothing)
    haveCover = !!b64; const my = ++token;
    if (!b64) { goTo(fallback ? fromPal(fallback) : GRAPHITE); return; }
    const img = new Image();
    img.onload = () => { if (my !== token) return; try { goTo(paletteFromImage(img)); } catch { goTo(fallback ? fromPal(fallback) : GRAPHITE); } };
    img.src = `data:image/png;base64,${b64}`;
  },
  state(m) {                                                          // the pill's own three colours, used when a song has no cover
    fallback = Array.isArray(m.pal) && m.pal.length >= 3 ? m.pal : null;
    card.classList.toggle('skin', !!m.look && m.look !== 'black');
    card.classList.toggle('is-playing', !!m.playing);
    if (!haveCover && fallback) goTo(fromPal(fallback));
  },
};
})();
