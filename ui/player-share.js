/* Lyric share card: pick a line (or a few) of the song and turn it into a picture for a story or a chat.
   Drawn on a canvas from what the player already has (the lyrics, the cover, the theme colour): nothing is uploaded anywhere.
   Opened by the small share button that appears on a lyric line when the cursor is on it. */
(() => {
'use strict';
// the player keeps its state private; it hands out these two readers at the end of player.js
const getL = () => window.PlayerData.L(), getS = () => window.PlayerData.S();
const root = document.getElementById('share'), cv = document.getElementById('sh-cv'), ctx = cv.getContext('2d');
const $s = (id) => document.getElementById(id);
const FMT = { story: [1080, 1920], square: [1080, 1080] };
const MAX_LINES = 4;
const SH = { open: false, i: 0, n: 1, fmt: 'story', sty: 'cover', tr: false, img: null, imgSrc: '' };
try {
  const f = localStorage.getItem('poyzen.share.fmt'), s = localStorage.getItem('poyzen.share.sty');
  if (FMT[f]) SH.fmt = f;
  if (['cover', 'color', 'light', 'black'].includes(s)) SH.sty = s;
} catch { /* defaults */ }
const remember = () => { try { localStorage.setItem('poyzen.share.fmt', SH.fmt); localStorage.setItem('poyzen.share.sty', SH.sty); } catch { /* not remembered */ } };

const allLines = () => (getL().state === 'synced' && getL().data && getL().data.synced) ? getL().data.synced.map((x) => x[1] || '') : (getL().state === 'plain' && getL().data && Array.isArray(getL().data.plain)) ? getL().data.plain : [];
// the chosen lines: from the picked one on, empty (instrumental) rows skipped, at most MAX_LINES
function chosen() {
  const rows = allLines(), out = [];
  for (let k = SH.i; k < rows.length && out.length < SH.n; k++) if ((rows[k] || '').trim()) out.push(k);
  return out;
}
const hasFa = () => !!(getL().fa && getL().en);
const rtl = (t) => /[؀-ۿ]/.test(t);
const FONT = '"Vazirmatn","Segoe UI Variable Display","Segoe UI",system-ui,sans-serif';

function themeRGB() {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(getComputedStyle(document.getElementById('card')).getPropertyValue('--pt-top') || '');
  return m ? [+m[1], +m[2], +m[3]] : [42, 44, 51];
}
function loadCover() {
  const data = window.__coverData || '';
  if (!data) { SH.img = null; SH.imgSrc = ''; return Promise.resolve(); }
  if (SH.imgSrc === data && SH.img) return Promise.resolve();
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => { SH.img = im; SH.imgSrc = data; res(); };
    im.onerror = () => { SH.img = null; SH.imgSrc = ''; res(); };
    im.src = 'data:image/png;base64,' + data;
  });
}
function wrap(g, text, maxW) {
  const words = text.split(/\s+/).filter(Boolean), lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && g.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function coverFit(g, im, W, H, zoom) {
  const k = Math.max(W / im.width, H / im.height) * zoom, w = im.width * k, h = im.height * k;
  g.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
}

async function draw() {
  try { await document.fonts.load('700 40px Vazirmatn'); await document.fonts.load('400 40px Vazirmatn'); } catch { /* the system font will do */ }
  await loadCover();
  const [W, H] = FMT[SH.fmt], story = SH.fmt === 'story';
  cv.width = W; cv.height = H;
  const g = ctx, top = themeRGB(), light = SH.sty === 'light';
  // ---- background
  if (SH.sty === 'cover' && SH.img) {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.filter = 'blur(70px) saturate(1.35)'; coverFit(g, SH.img, W, H, 1.5); g.filter = 'none';
    const v = g.createLinearGradient(0, 0, 0, H); v.addColorStop(0, 'rgba(0,0,0,.28)'); v.addColorStop(0.55, 'rgba(0,0,0,.5)'); v.addColorStop(1, 'rgba(0,0,0,.78)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  } else if (SH.sty === 'light') {
    g.fillStyle = '#f3eee4'; g.fillRect(0, 0, W, H);
    const r = g.createRadialGradient(W * 0.5, 0, 0, W * 0.5, 0, H * 0.7); r.addColorStop(0, `rgba(${top},.28)`); r.addColorStop(1, `rgba(${top},0)`);
    g.fillStyle = r; g.fillRect(0, 0, W, H);
  } else if (SH.sty === 'black') {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  } else {            // 'color' (also the fallback of 'cover' when the song has no picture)
    const l = g.createLinearGradient(0, 0, 0, H);
    l.addColorStop(0, `rgb(${top.map((v) => Math.round(v * 0.85))})`); l.addColorStop(1, '#050507');
    g.fillStyle = l; g.fillRect(0, 0, W, H);
    const r = g.createRadialGradient(W * 0.5, 0, 0, W * 0.5, 0, H * 0.6); r.addColorStop(0, `rgba(${top},.35)`); r.addColorStop(1, `rgba(${top},0)`);
    g.fillStyle = r; g.fillRect(0, 0, W, H);
  }
  const ink = light ? '#15151a' : '#ffffff', soft = light ? 'rgba(21,21,26,.62)' : 'rgba(255,255,255,.68)';
  g.textBaseline = 'alphabetic'; g.textAlign = 'center';
  // ---- the wordmark
  g.fillStyle = soft; g.font = `700 34px ${FONT}`; g.direction = 'ltr';
  g.fillText('P O Y Z E N', W / 2, story ? 150 : 96);
  // ---- the lyric block, as large as it can be while it still fits
  const idx = chosen(), rows = allLines();
  const paras = idx.map((k) => ({ t: (rows[k] || '').trim(), fa: (SH.tr && hasFa() && getL().fa[k]) ? String(getL().fa[k]).trim() : '' }));
  const padX = 96, maxW = W - padX * 2, areaTop = story ? 360 : 170, areaBot = story ? H - 480 : H - 330, maxH = areaBot - areaTop;
  let size = story ? 96 : 84, layout = null;
  for (; size >= 38; size -= 4) {
    const items = []; let h = 0;
    for (const p of paras) {
      g.font = `700 ${size}px ${FONT}`; g.direction = rtl(p.t) ? 'rtl' : 'ltr';
      const ls = wrap(g, p.t, maxW); h += ls.length * size * 1.38; items.push({ ls, size, rtl: rtl(p.t), fa: false });
      if (p.fa) { const fs = Math.round(size * 0.6); g.font = `400 ${fs}px ${FONT}`; g.direction = 'rtl'; const fl = wrap(g, p.fa, maxW); h += fl.length * fs * 1.6 + fs * 0.2; items.push({ ls: fl, size: fs, rtl: true, fa: true }); }
      h += size * 0.5;
    }
    h -= size * 0.5; layout = { items, h };
    if (h <= maxH) break;
  }
  let y = areaTop + (maxH - layout.h) / 2;
  // a soft opening quote mark above the lines
  g.direction = 'ltr'; g.fillStyle = light ? `rgba(${top},.55)` : 'rgba(255,255,255,.28)'; const qs = Math.round(size * 1.6); g.font = `700 ${qs}px Georgia, serif`;
  g.fillText('“', W / 2, y - size * 0.1 + qs * 0.4);   // the mark sits just above the first line
  for (const it of layout.items) {
    g.font = `${it.fa ? 400 : 700} ${it.size}px ${FONT}`; g.direction = it.rtl ? 'rtl' : 'ltr';
    g.fillStyle = it.fa ? soft : ink;
    if (!light && !it.fa) { g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 24; g.shadowOffsetY = 4; }
    const lh = it.size * (it.fa ? 1.6 : 1.38);
    for (const line of it.ls) { y += lh; g.fillText(line, W / 2, y - lh * 0.22); }
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
    y += it.fa ? it.size * 0.2 + 0 : it.size * 0.5;
  }
  // ---- the song: cover, title, artist
  const cs = story ? 168 : 132, cy = story ? H - 330 : H - 250;
  const rt = rtl(getS().title || '');            // a Persian title: the cover goes to the right and the words to its left
  const cx = rt ? W - padX - cs : padX;
  if (SH.img) {
    g.save(); roundRect(g, cx, cy, cs, cs, cs * 0.2); g.clip(); g.drawImage(SH.img, cx, cy, cs, cs); g.restore();
  } else {
    g.fillStyle = light ? 'rgba(21,21,26,.12)' : 'rgba(255,255,255,.14)'; roundRect(g, cx, cy, cs, cs, cs * 0.2); g.fill();
  }
  g.textAlign = 'left'; g.direction = rtl(getS().title || '') ? 'rtl' : 'ltr';
  const tx = rt ? cx - 36 : cx + cs + 36, tw = rt ? tx - padX : W - padX - tx;
  const fit = (txt, weight, start) => { let s = start; g.font = `${weight} ${s}px ${FONT}`; while (s > 24 && g.measureText(txt).width > tw) { s -= 2; g.font = `${weight} ${s}px ${FONT}`; } return txt; };
  g.textAlign = rtl(getS().title || '') ? 'right' : 'left';
  const tpos = tx;
  g.fillStyle = ink; g.fillText(fit(getS().title || '', 700, story ? 52 : 46), tpos, cy + cs * 0.46);
  g.direction = rtl(getS().artist || '') ? 'rtl' : 'ltr'; g.textAlign = rtl(getS().artist || '') ? 'right' : 'left';
  g.fillStyle = soft; g.fillText(fit(getS().artist || '', 400, story ? 42 : 38), rtl(getS().artist || '') ? (rt ? tx : W - padX) : (rt ? padX : tx), cy + cs * 0.46 + (story ? 64 : 56));
  g.direction = 'ltr'; g.textAlign = 'center';
}

let busy = 0;
async function repaint() {
  const my = ++busy;
  await draw();
  if (my !== busy) return;
  paintUi();
}
function paintUi() {
  document.querySelectorAll('#sh-fmt button').forEach((b) => b.classList.toggle('on', b.dataset.f === SH.fmt));
  document.querySelectorAll('#sh-sty button').forEach((b) => b.classList.toggle('on', b.dataset.s === SH.sty));
  $s('sh-less').disabled = SH.n <= 1;
  const rows = allLines(); let more = 0; for (let k = SH.i; k < rows.length; k++) if ((rows[k] || '').trim()) more++;
  $s('sh-more').disabled = SH.n >= MAX_LINES || SH.n >= more;
  $s('sh-n').textContent = SH.n + (SH.n === 1 ? ' line' : ' lines');
  const tb = $s('sh-tr'); tb.hidden = !hasFa(); tb.classList.toggle('on', SH.tr);
}
function open(i) {
  if (!allLines().length) return;
  SH.i = i; SH.n = 1; SH.tr = !!(getL().tr && hasFa());
  SH.open = true; root.hidden = false; document.getElementById('card').classList.add('sh-on');
  $s('sh-copy').textContent = 'Copy'; $s('sh-save').textContent = 'Save PNG';
  repaint();
}
function close() { SH.open = false; root.hidden = true; document.getElementById('card').classList.remove('sh-on'); }
window.LyricShare = { open, close };

$s('sh-x').addEventListener('click', close);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && SH.open) { e.stopPropagation(); close(); } }, true);
$s('sh-fmt').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; SH.fmt = b.dataset.f; remember(); repaint(); });
$s('sh-sty').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; SH.sty = b.dataset.s; remember(); repaint(); });
$s('sh-less').addEventListener('click', () => { if (SH.n > 1) { SH.n--; repaint(); } });
$s('sh-more').addEventListener('click', () => { if (SH.n < MAX_LINES) { SH.n++; repaint(); } });
$s('sh-prev').addEventListener('click', () => { const rows = allLines(); let k = SH.i - 1; while (k >= 0 && !(rows[k] || '').trim()) k--; if (k >= 0) { SH.i = k; repaint(); } });
$s('sh-next').addEventListener('click', () => { const rows = allLines(); let k = SH.i + 1; while (k < rows.length && !(rows[k] || '').trim()) k++; if (k < rows.length) { SH.i = k; repaint(); } });
$s('sh-tr').addEventListener('click', () => { SH.tr = !SH.tr; repaint(); });
const blob = () => new Promise((res) => cv.toBlob(res, 'image/png'));
const fileName = () => ((getS().title || 'lyric') + (getS().artist ? ' - ' + getS().artist : '')).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) + '.png';
const say = (el, text, was) => { el.textContent = text; setTimeout(() => { el.textContent = was; }, 1600); };
$s('sh-copy').addEventListener('click', async () => {
  const b = $s('sh-copy');
  try { const bl = await blob(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': bl })]); say(b, 'Copied', 'Copy'); }
  catch { say(b, 'Could not copy', 'Copy'); }
});
$s('sh-save').addEventListener('click', async () => {
  const b = $s('sh-save');
  try {
    const bl = await blob(), url = URL.createObjectURL(bl), a = document.createElement('a');
    a.href = url; a.download = fileName(); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000); say(b, 'Saved', 'Save PNG');
  } catch { say(b, 'Could not save', 'Save PNG'); }
});
document.addEventListener('langchange', () => { if (SH.open) repaint(); });
})();
