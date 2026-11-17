/* The player window's backdrop. It wears exactly what the pill wears: the theme's own animation
   (liquid camo, nebula, venom …) or, on plain Black, the night sky in the colours of the cover.
   It never turns a theme into a flat colour. The same painters as the pill, scaled up to the window,
   fed by the same loopback levels (the Rust side broadcasts "levels" to every window). */
(() => {
'use strict';
const T = window.__TAURI__;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cv = document.getElementById('look'), g = cv.getContext('2d');

// ---- what the pill tells us (see sendPlayer in app.js)
let cfg = { look: 'black', pal: ['hsl(222 9% 21%)', 'hsl(222 9% 29%)', 'hsl(222 9% 39%)'], live: false, react: true, active: false };
const DEFAULT_PAL = cfg.pal.slice();

// ---- size: the card, in css pixels; the canvas is drawn at the screen's pixel ratio
let W = 380, H = 490, dpr = 1;
const CELL = 2, K = 3;                        // liquid field: one number per 2px, pattern drawn K times larger than on the pill
const fcan = document.createElement('canvas'), fctx = fcan.getContext('2d');
let FW = 0, FH = 0, fimg = null;
function size() {
  const r = cv.parentElement.getBoundingClientRect();
  W = Math.round(r.width) || 380; H = Math.round(r.height) || 490; dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  FW = Math.ceil(W / CELL); FH = Math.ceil(H / CELL); fcan.width = FW; fcan.height = FH; fimg = fctx.createImageData(FW, FH);
}
size(); window.addEventListener('resize', size);

// ---- audio levels, smoothed exactly like the pill does
const NB = 24, levels = new Float32Array(NB);
let bass = 0, bassSlow = 0, energy = 0, heard = null, heardAt = 0;
if (T && T.event) T.event.listen('levels', (e) => { heard = e.payload; heardAt = performance.now(); });
function sampleLevels(t, playing) {
  if (playing && heard && t - heardAt < 400) {
    for (let i = 0; i < NB; i++) { const v = heard[i] || 0; levels[i] += (v - levels[i]) * (v > levels[i] ? 0.55 : 0.16); }
  } else for (let i = 0; i < NB; i++) levels[i] *= 0.9;
  let b = 0, e = 0;
  for (let i = 0; i < 4; i++) b += levels[i];
  for (let i = 0; i < NB; i++) e += levels[i];
  bass += (clamp(b / 4, 0, 1) - bass) * 0.5; bassSlow += (bass - bassSlow) * 0.04; energy = e / NB;
}
const band = (x) => levels[clamp(Math.floor(x / W * NB), 0, NB - 1)];

// ---- colours: any css colour -> rgb, and the sky's three colours glide to the next cover instead of jumping
const probe = document.createElement('canvas'); probe.width = probe.height = 1;
const pg = probe.getContext('2d', { willReadFrequently: true });
function rgbOf(css) { pg.clearRect(0, 0, 1, 1); pg.fillStyle = '#2a2c33'; pg.fillStyle = css; pg.fillRect(0, 0, 1, 1); return Array.from(pg.getImageData(0, 0, 1, 1).data).slice(0, 3); }
let target = cfg.pal.map(rgbOf), shown = target.map((c) => c.slice());
const rgb = (c, a) => a === undefined ? `rgb(${c.map(Math.round)})` : `rgba(${c.map(Math.round)},${a})`;
function glide(dt) { const k = 1 - Math.pow(0.9, dt * 60); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) shown[i][j] += (target[i][j] - shown[i][j]) * k; }

// ---- stars and shooting stars (the night sky, nebula)
const stars = Array.from({ length: 70 }, (_, i) => ({
  x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.1, ph: Math.random() * 6.28, sp: 0.8 + Math.random() * 2.6,
  drift: 4 + Math.random() * 12, band: 2 + Math.floor(Math.random() * (NB - 4)), big: i % 9 === 0,
}));
const shooting = []; let lastShot = 0;
function sparkle(x, y, R) {
  g.beginPath();
  g.moveTo(x, y - R); g.quadraticCurveTo(x, y, x + R, y); g.quadraticCurveTo(x, y, x, y + R);
  g.quadraticCurveTo(x, y, x - R, y); g.quadraticCurveTo(x, y, x, y - R); g.fill();
}
function drawStars(t, dt, A, every) {
  g.fillStyle = '#fff';
  for (let i = 0; i < stars.length; i += every) {
    const s = stars[i];
    s.x -= s.drift * dt * (1 + energy * 3) / W;
    if (s.x < -0.02) { s.x = 1.02; s.y = Math.random(); }
    const lv = levels[s.band], tw = 0.5 + 0.5 * Math.sin(t * 0.001 * s.sp + s.ph), x = s.x * W, y = s.y * H;
    g.globalAlpha = A * clamp((0.3 + 0.7 * tw) * (0.4 + lv * 1.6), 0, 1);
    if (s.big) sparkle(x, y, Math.min(8, s.r * (3.2 + lv * 4 + bass * 1.5)));
    else { g.beginPath(); g.arc(x, y, s.r * (0.9 + lv * 1.0), 0, 6.283); g.fill(); }
  }
}
function drawShooting(dt, A) {
  if (bass - bassSlow > 0.14 && performance.now() - lastShot > 1500) {
    lastShot = performance.now();
    shooting.push({ x: Math.random() * W * 0.7, y: -4, vx: 260 + Math.random() * 160, vy: 190 + Math.random() * 90, life: 0 });
  }
  for (let i = shooting.length - 1; i >= 0; i--) {
    const s = shooting[i];
    s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt;
    if (s.life > 0.8 || s.y > H + 10) { shooting.splice(i, 1); continue; }
    const tx = s.x - s.vx * 0.12, ty = s.y - s.vy * 0.12, lg = g.createLinearGradient(s.x, s.y, tx, ty);
    lg.addColorStop(0, 'rgba(255,255,255,.95)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalAlpha = A * clamp(1 - s.life / 0.8, 0, 1); g.strokeStyle = lg; g.lineWidth = 1.8; g.lineCap = 'round';
    g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(tx, ty); g.stroke();
  }
}

// ---- painters
function paintSky(t, dt, A) {            // the cover's colours, soft lights that swell with the music, stars, a shooting star on a beat
  glide(dt);
  const grad = g.createLinearGradient(0, 0, W * 0.55, H);
  grad.addColorStop(0, rgb(shown[0])); grad.addColorStop(0.55, rgb(shown[1])); grad.addColorStop(1, rgb(shown[2]));
  g.globalAlpha = A * clamp(0.85 + bass * 0.15, 0, 1); g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const v = (levels[i * 7 + 1] + levels[i * 7 + 3] + levels[i * 7 + 5]) / 3;
    const cx = (0.5 + 0.42 * Math.sin(t * 0.0004 * (1 + i * 0.37) + i * 2.1)) * W, cy = (0.28 + 0.2 * i) * H + Math.cos(t * 0.0006 + i * 1.7) * 30;
    const rad = 90 + v * 150, rg = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    rg.addColorStop(0, `rgba(255,255,255,${clamp(0.05 + v * 0.2, 0, 0.26).toFixed(3)})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalAlpha = A; g.fillStyle = rg; g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  drawStars(t, dt, A, 1);
  drawShooting(dt, A);
}
const LIQ = {
  reactor: { bg: [3, 5, 4], lo: [36, 140, 10], hi: [165, 255, 55], spec: [235, 255, 200], thr: 0.8, speed: 1 },
  ember: { bg: [12, 2, 4], lo: [150, 8, 22], hi: [255, 52, 40], spec: [255, 200, 170], thr: 0.78, speed: 1 },
  crystal: { bg: [9, 8, 46], lo: [44, 48, 205], hi: [140, 105, 255], spec: [236, 232, 255], thr: 0.45, speed: 0.8 },
  venom: { bg: [0, 0, 1], lo: [14, 15, 19], hi: [38, 41, 50], spec: [150, 156, 170], thr: 0.62, speed: 0.55 },
};
function paintLiquid(t, dt, A, P) {      // liquid camo: dark surface, bright veins drifting sideways, floods with colour on the beat
  const d = fimg.data, tt = t * 0.0006 * P.speed, scroll = t * 0.021 * P.speed;
  const flood = energy * 0.9 + bass * 0.22, bg = P.bg, lo = P.lo, hi = P.hi, sp = P.spec;
  for (let x = 0; x < FW; x++) {
    const px = x * CELL, u = (px / K + scroll) / 23;
    const thr = Math.max(0.02, P.thr - flood - band(px) * 0.45);
    for (let y = 0; y < FH; y++) {
      const v = (y * CELL / K) / 12;
      const n = 0.6 * Math.sin(u * 2 + 1.7 * Math.sin(v * 2.6 + u * 0.7 + tt * 0.7)) + 0.4 * Math.sin(v * 3.1 - u * 1.1 + 1.3 * Math.sin(u * 1.9 - tt * 0.5));
      const fill = clamp((n - thr) / 0.16, 0, 1), vein = 1 - Math.min(1, Math.abs(n - thr + 0.4) / 0.055);
      const k = Math.max(fill, vein * 0.85), h = fill * fill, s = clamp((n - thr - 0.3) / 0.12, 0, 1) * 0.7, i = (y * FW + x) * 4;
      for (let c = 0; c < 3; c++) { let val = bg[c] + (lo[c] - bg[c]) * k; val += (hi[c] - val) * h; val += (sp[c] - val) * s; d[i + c] = val; }
      d[i + 3] = 255;
    }
  }
  fctx.putImageData(fimg, 0, 0);
  g.globalAlpha = A; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(fcan, 0, 0, FW, FH, 0, 0, W, H);
}
function paintNebula(t, dt, A) {         // a dark galaxy: clouds of magenta and violet drifting over black
  g.globalAlpha = A; g.fillStyle = '#08030f'; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  const C = ['255,45,150', '130,60,255', '60,80,230', '255,90,200', '170,40,220'];
  for (let i = 0; i < 5; i++) {
    const v = (levels[2 + i * 4] + levels[3 + i * 4]) / 2, span = W + 300;
    const cx = -150 + ((((i * 0.2 * span - t * 0.03 * (1 + i * 0.13)) % span) + span) % span);
    const cy = (0.12 + i * 0.19) * H + Math.cos(t * 0.0005 + i * 2.3) * 40, rad = 120 + v * 140 + (i % 2) * 40;
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    rg.addColorStop(0, `rgba(${C[i]},${clamp(0.34 + v * 0.36, 0, 0.6).toFixed(3)})`); rg.addColorStop(1, `rgba(${C[i]},0)`);
    g.globalAlpha = A; g.fillStyle = rg; g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  drawStars(t, dt, A * 0.8, 2);
}
const PAINT = { sky: paintSky, nebula: paintNebula };
for (const k of Object.keys(LIQ)) PAINT[k] = (t, dt, A) => paintLiquid(t, dt, A, LIQ[k]);
PAINT.lava = PAINT.ember;                 // the parked skins fall back to the closest living one
const painterFor = (look) => PAINT[look] || paintSky;

// ---- venom: the window itself turns to black goo (same recipe as the pill: a wavy outline, lumps crawling along the edge,
// tendrils that reach out and snap back, melted together by the SVG filter in player.html). It lives in the transparent margin around the card.
const MARGIN = 20, RAD = 24;
const goo = document.getElementById('goo'), gg = goo.getContext('2d');
const lumps = Array.from({ length: 44 }, () => ({ s: Math.random(), v: (0.006 + Math.random() * 0.012) * (Math.random() < 0.5 ? 1 : -1), ph: Math.random() * 6.283, sp: 0.8 + Math.random() * 1.8, r: 4.5 + Math.random() * 3.5 }));
const tendrils = Array.from({ length: 10 }, () => ({ s: Math.random(), len: 0, to: 0, at: 0, ph: Math.random() * 6.283 }));
function sizeGoo() { goo.width = W + 2 * MARGIN; goo.height = H + 2 * MARGIN; }
sizeGoo(); window.addEventListener('resize', sizeGoo);
function onEdge(f) {                 // a point on the card's outline (a rounded rectangle) and which way is "out"
  const R = RAD, fw = W - 2 * R, fh = H - 2 * R, arc = Math.PI * R / 2, L = 2 * fw + 2 * fh + 4 * arc;
  let d = (((f % 1) + 1) % 1) * L; const x0 = MARGIN, y0 = MARGIN;
  if (d < fw) return [x0 + R + d, y0, 0, -1];                                    // top, left to right
  d -= fw; if (d < arc) { const a = -Math.PI / 2 + d / R; return [x0 + W - R + Math.cos(a) * R, y0 + R + Math.sin(a) * R, Math.cos(a), Math.sin(a)]; }
  d -= arc; if (d < fh) return [x0 + W, y0 + R + d, 1, 0];                       // right, downwards
  d -= fh; if (d < arc) { const a = d / R; return [x0 + W - R + Math.cos(a) * R, y0 + H - R + Math.sin(a) * R, Math.cos(a), Math.sin(a)]; }
  d -= arc; if (d < fw) return [x0 + W - R - d, y0 + H, 0, 1];                   // bottom, right to left
  d -= fw; if (d < arc) { const a = Math.PI / 2 + d / R; return [x0 + R + Math.cos(a) * R, y0 + H - R + Math.sin(a) * R, Math.cos(a), Math.sin(a)]; }
  d -= arc; return [x0, y0 + H - R - d, -1, 0];                                  // left, upwards
}
const PERIM = () => 2 * (W - 2 * RAD) + 2 * (H - 2 * RAD) + 2 * Math.PI * RAD;
let gooOn = false;
function drawGoo(t, dt, on, live) {
  if (!on) { if (gooOn) { gooOn = false; gg.clearRect(0, 0, goo.width, goo.height); goo.style.opacity = 0; document.body.classList.remove('venom'); } return; }
  if (!gooOn) { gooOn = true; goo.style.opacity = 1; document.body.classList.add('venom'); }
  const g2 = gg, L = PERIM();
  g2.clearRect(0, 0, goo.width, goo.height); g2.fillStyle = '#000';
  g2.beginPath();
  for (let d = 0; d < L; d += 4) {
    const [x, y, nx, ny] = onEdge(d / L);
    const off = 1.6 + 2.2 * Math.sin(d * 0.085 + t * 0.0021) + 1.7 * Math.sin(d * 0.041 - t * 0.0013 + 1.3) + 1.0 * Math.sin(d * 0.19 + t * 0.004) + bass * 3.5;
    if (d === 0) g2.moveTo(x + nx * off, y + ny * off); else g2.lineTo(x + nx * off, y + ny * off);
  }
  g2.closePath(); g2.fill();
  const nLumps = lumps.length, nTen = tendrils.length, slow = 420 / L;      // the walk speeds were made for a small pill: scale them to this outline
  for (let li = 0; li < nLumps; li++) {
    const l = lumps[li]; l.s += l.v * slow * dt * (1 + energy * 4) * 10;
    const [x, y, nx, ny] = onEdge(l.s), out = -3 + 7 * (0.5 + 0.5 * Math.sin(t * 0.0016 * l.sp + l.ph)) + bass * 5;
    g2.beginPath(); g2.arc(x + nx * out, y + ny * out, l.r + Math.sin(t * 0.002 * l.sp + l.ph * 2) * 1.2, 0, 6.283); g2.fill();
  }
  for (let ti = 0; ti < nTen; ti++) {
    const td = tendrils[ti];
    if (t > td.at) {
      const reach = Math.random() < (live ? 0.5 + bass : 0.3);
      td.to = reach ? 9 + Math.random() * (live ? 6 + bass * 6 : 5) : 0;
      if (td.len < 1 && reach) td.s = Math.random();
      td.at = t + (reach ? 500 + Math.random() * 700 : 700 + Math.random() * 2600);
    }
    td.len += (td.to - td.len) * Math.min(1, dt * (td.to > td.len ? 7 : 3.2));
    if (td.len < 0.6) continue;
    const [x, y, nx, ny] = onEdge(td.s), n = 6;
    for (let i = 0; i <= n; i++) {
      const q = i / n, w = Math.sin(t * 0.004 + td.ph + q * 3) * 2 * q;
      g2.beginPath(); g2.arc(x + nx * td.len * q - ny * w, y + ny * td.len * q + nx * w, 5.5 * (1 - q * 0.7), 0, 6.283); g2.fill();
    }
  }
}

// ---- the loop
// Plain Black is completely plain (no animation at all, just the cover-coloured gradient the page paints itself).
// A skin animates *behind the cover and the title* only: it fades out before the seek bar, so the controls always sit on calm dark.
let A = 0, drawn = 'nebula', lastT = 0, lastPaint = 0, idle = false;
function frame(t) {
  requestAnimationFrame(frame);
  const skin = cfg.look && cfg.look !== 'black' && cfg.look;
  const want = skin || null;
  const live = !!(cfg.live && cfg.react);
  const dt = Math.min(0.05, (t - lastT) / 1000);
  if (want && want !== drawn) A = Math.min(A, 0.15);          // one look gives way to another: the new one fades in
  if (want) drawn = want;
  A += ((want ? 1 : 0) - A) * (1 - Math.pow(0.93, Math.max(dt, 0.016) * 60));
  if (!want && A < 0.01) {
    if (!idle) { g.clearRect(0, 0, W, H); drawGoo(t, 0, false); idle = true; }
    lastT = t; return;
  }
  idle = false;
  if (t - lastPaint < (live ? 24 : 40)) return;               // a resting theme moves slowly: about 25 frames a second is plenty
  lastPaint = t; lastT = t;
  sampleLevels(t, live);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  g.clearRect(0, 0, W, H);
  const liquid = !!LIQ[drawn] || drawn === 'lava';
  painterFor(drawn)(t, dt, A * (liquid ? (live ? 0.62 : 0.55) : (live ? 0.8 : 0.72)));
  g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 1;      // melt the animation away downwards
  const fade = g.createLinearGradient(0, 0, 0, H * 0.56);
  for (let i = 0; i <= 10; i++) { const p = i / 10, k = p * p * (3 - 2 * p); fade.addColorStop(p, `rgba(0,0,0,${(0.22 + k * 0.78).toFixed(3)})`); }
  g.fillStyle = fade; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  drawGoo(t, dt, drawn === 'venom' && A > 0.5, live);
}
requestAnimationFrame(frame);

// ---- the player page calls this with every state message from the pill
window.PlayerLook = {
  set(m) {
    const pal = Array.isArray(m.pal) && m.pal.length >= 3 ? m.pal : DEFAULT_PAL;
    if (pal.join() !== cfg.pal.join()) { cfg.pal = pal; target = pal.map(rgbOf); }
    cfg.look = m.look || 'black'; cfg.live = !!m.live; cfg.react = m.react !== false; cfg.active = !!m.active;
  },
};
})();
