/* Living background for the player window. The colours come from the cover (up to three clearly different hues),
   the blobs are pure CSS (see player.css), and the whole thing can be switched off from the "Synced" panel.
   Saved as localStorage "peeky.aurora" = "off"; anything else means on. */
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
let on = true; try { on = localStorage.getItem('peeky.aurora') !== 'off'; } catch { /* default: on */ }
const btns = [...document.querySelectorAll('#auseg button')];
function paint() { card.classList.toggle('aur-on', on); btns.forEach((b) => b.classList.toggle('on', (b.dataset.a === 'on') === on)); }
btns.forEach((b) => b.addEventListener('click', () => { on = b.dataset.a === 'on'; try { localStorage.setItem('peeky.aurora', on ? 'on' : 'off'); } catch { /* not remembered */ } paint(); }));
paint();

// ---- colours from the cover: strongest hue first, then the strongest hue that is clearly different from those already taken
const hsl = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2; let h = 0;
  if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l]; };
const rgbOf = (h, s, l) => { const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const v = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return v.map((q) => Math.round((q + m) * 255)); };
const gap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const GRAPHITE = ['rgb(52,62,80)', 'rgb(34,42,58)', 'rgb(24,30,42)'];

function paletteFromImage(img, count = 3) {
  const N = 48, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, m = Math.min(w, h) || 1;
  g.drawImage(img, (w - m) / 2, (h - m) / 2, m, m, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N).data, B = 24, bins = Array.from({ length: B }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const [hh, s, l] = hsl(d[i], d[i + 1], d[i + 2]);
    if (s < .22 || l < .1 || l > .92) continue;                       // grey, black and white carry no hue
    const wt = Math.pow(s, 1.3) * (1 - Math.abs(l - .5)), b = bins[Math.floor(hh / 15) % B];
    b.w += wt; b.r += d[i] * wt; b.g += d[i + 1] * wt; b.b += d[i + 2] * wt;
  }
  const picked = [];
  while (picked.length < count) {
    let best = -1, bw = 0.4;
    bins.forEach((b, k) => { if (b.w > bw && picked.every((p) => gap(p.h, k * 15 + 7) > 35)) { bw = b.w; best = k; } });
    if (best < 0) break;
    const b = bins[best]; picked.push({ h: best * 15 + 7, rgb: [b.r / b.w, b.g / b.w, b.b / b.w] });
  }
  if (!picked.length) return GRAPHITE;                                // a grey cover stays calm and grey
  const out = picked.map((p) => { const [hh, s, l] = hsl(...p.rgb); return rgbOf(hh, clamp(s, .55, .95), clamp(l, .42, .58)); });
  for (let i = 0; out.length < count; i++) {                          // a one-colour cover: neighbouring shades of it
    const [hh, s, l] = hsl(...out[i % picked.length]); out.push(rgbOf((hh + 22 * (i + 1)) % 360, s, clamp(l + (i % 2 ? .08 : -.08), .35, .65)));
  }
  return out.map((c) => `rgb(${c})`);
}

let haveCover = false, fallback = null;
function apply(cols) { cols.slice(0, 3).forEach((c, i) => card.style.setProperty('--c' + (i + 1), c)); }
window.Aurora = {
  cover(b64) {                                                        // called with every new cover (base64 png, or nothing)
    haveCover = !!b64;
    if (!b64) { if (fallback) apply(fallback); return; }
    const img = new Image();
    img.onload = () => { try { apply(paletteFromImage(img)); } catch { if (fallback) apply(fallback); } };
    img.src = `data:image/png;base64,${b64}`;
  },
  state(m) {                                                          // the pill's own three colours, used when a song has no cover
    fallback = Array.isArray(m.pal) && m.pal.length >= 3 ? m.pal : null;
    card.classList.toggle('skin', !!m.look && m.look !== 'black');
    card.classList.toggle('is-playing', !!m.playing);
    if (!haveCover && fallback) apply(fallback);
  },
};
})();
