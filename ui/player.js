/* The player window. It only shows what the pill's music player is doing and sends commands back;
   the audio itself keeps playing in the main page. */
(() => {
'use strict';
const T = window.__TAURI__, invoke = (c, a) => T.core.invoke(c, a).catch(() => {}), listen = T.event.listen, emit = T.event.emit;
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cmd = (c, more) => emit('player-cmd', { c, ...(more || {}) });

const S0 = '<svg viewBox="0 0 24 24">', S1 = '</svg>', ST = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const I = {
  play: S0 + '<path fill="currentColor" d="M8 5.2v13.6a1 1 0 0 0 1.5.9l11-6.8a1 1 0 0 0 0-1.8l-11-6.8A1 1 0 0 0 8 5.2z"/>' + S1,
  pause: S0 + '<rect fill="currentColor" x="6" y="5" width="4.4" height="14" rx="1.2"/><rect fill="currentColor" x="13.6" y="5" width="4.4" height="14" rx="1.2"/>' + S1,
  next: S0 + '<path fill="currentColor" d="M5 6.3v11.4a.8.8 0 0 0 1.3.7l8-5.7a.8.8 0 0 0 0-1.4l-8-5.7A.8.8 0 0 0 5 6.3z"/><rect fill="currentColor" x="16.5" y="5.5" width="2.6" height="13" rx="1.2"/>' + S1,
  prev: S0 + '<path fill="currentColor" d="M19 6.3v11.4a.8.8 0 0 1-1.3.7l-8-5.7a.8.8 0 0 1 0-1.4l8-5.7a.8.8 0 0 1 1.3.7z"/><rect fill="currentColor" x="4.9" y="5.5" width="2.6" height="13" rx="1.2"/>' + S1,
  shuffle: S0 + `<path ${ST} d="M4 7h3c4.5 0 5.5 10 10 10h3M4 17h3c1.7 0 2.9-1.7 4-3.6M13.2 8.5C14.2 7.6 15.3 7 17 7h3M17.5 4.5L20 7l-2.5 2.5M17.5 14.5L20 17l-2.5 2.5"/>` + S1,
  repeat: S0 + `<path ${ST} d="m17 2 4 4-4 4"/><path ${ST} d="M3 11v-1a4 4 0 0 1 4-4h14"/><path ${ST} d="m7 22-4-4 4-4"/><path ${ST} d="M21 13v1a4 4 0 0 1-4 4H3"/>` + S1,
  repeat1: S0 + `<path ${ST} d="m17 2 4 4-4 4"/><path ${ST} d="M3 11v-1a4 4 0 0 1 4-4h14"/><path ${ST} d="m7 22-4-4 4-4"/><path ${ST} d="M21 13v1a4 4 0 0 1-4 4H3"/><path ${ST} d="M11 10h1v4"/>` + S1,
  note: S0 + '<path fill="currentColor" d="M10 4v10.2a3.2 3.2 0 1 0 2 3V8h5V4z"/>' + S1,
  volume: S0 + `<path fill="currentColor" d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z"/><path ${ST} d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>` + S1,
  back10: S0 + `<path ${ST} d="M12 5V2.2L7.6 6 12 9.800V7a6 6 0 1 1-6 6"/><text x="12" y="16.400" text-anchor="middle" font-size="7.400" font-weight="700" font-family="Segoe UI, sans-serif" fill="currentColor" stroke="none">10</text>` + S1,
  fwd10: S0 + `<path ${ST} d="M12 5V2.2L16.400 6 12 9.800V7a6 6 0 1 0 6 6"/><text x="12" y="16.400" text-anchor="middle" font-size="7.400" font-weight="700" font-family="Segoe UI, sans-serif" fill="currentColor" stroke="none">10</text>` + S1,
  lyrics: S0 + `<path ${ST} d="M4 7h10M4 12h7M4 17h5"/><path fill="currentColor" d="M17 6v8.100a2.200 2.200 0 1 0 1.400 2V9h3V6z"/>` + S1,
  nolyrics: S0 + `<path fill="currentColor" d="M10 4v10.200a3.200 3.200 0 1 0 2 3V8h5V4z"/><path ${ST} d="M4 4l16 16"/>` + S1,
  again: S0 + `<path ${ST} d="M20 12a8 8 0 1 1-2.400-5.700M20 4v4.500h-4.500"/>` + S1,
  file: S0 + `<path ${ST} d="M7 3.500h6.500L18 8v10.500a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM13 3.500V8h5M9 13h6M9 16.500h4"/>` + S1,
  muted: S0 + `<path fill="currentColor" d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z"/><path ${ST} d="M16 9.5l5 5M21 9.5l-5 5"/>` + S1,
};
const put = (el, k) => { if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = I[k]; } };
put($('#c-back'), 'back10'); put($('#c-fwd'), 'fwd10'); put($('#lyric'), 'lyrics'); put($('#c-prev'), 'prev'); put($('#c-next'), 'next'); put($('#c-shuffle'), 'shuffle'); put($('#c-play'), 'play'); put($('#c-repeat'), 'repeat');


// ---- the window's colour: soft gradient from the theme / cover colour at the top down to near-black
const layers = [document.createElement('div'), document.createElement('div')], grain = document.createElement('div');
layers.forEach((l) => { l.className = 'pt-layer'; }); grain.className = 'pt-grain';
$('#card').prepend(layers[1], layers[0], $('#look'), grain);      // gradient underlay, the theme's animation, grain on top
let layerNow = 1, topNow = null;
const rgbOf = (css) => { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); g.fillStyle = '#2a2c33'; g.fillStyle = css; g.fillRect(0, 0, 1, 1); return Array.from(g.getImageData(0, 0, 1, 1).data).slice(0, 3); };
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function gradientOf(top) {
  const dark = [5, 5, 7], N = 32, stops = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, k = Math.pow(smoother(t), 0.9);
    stops.push(`rgb(${top.map((v, j) => Math.round(v * 0.7 * (1 - k) + dark[j] * k))}) ${(t * 100).toFixed(1)}%`);
  }
  return `radial-gradient(120% 55% at 50% 0%, rgba(${top},.26), transparent 70%), linear-gradient(180deg, ${stops.join(',')})`;
}
function paintTheme(css) {
  const key = css || '#2a2c33';
  if (key === topNow) return;
  topNow = key;
  const next = layers[layerNow ^ 1], old = layers[layerNow];    // gradients cannot transition, so two layers crossfade
  next.style.background = gradientOf(rgbOf(key));
  next.classList.add('on'); old.classList.remove('on'); layerNow ^= 1;
  $('#card').style.setProperty('--pt-top', `rgb(${rgbOf(key)})`);
}
paintTheme('');

// ---- state from the main page
let S = { on: false, playing: false, idx: -1, pos: 0, dur: 0, vol: 50, mute: false, shuffle: false, repeat: 0, count: 0, scanning: false, folder: '' };
let at = performance.now(), tracks = [], folder = '', coverId = -1, query = '', shown = 200, matches = [], lastIdx = -2, scrubbing = false, scrubR = 0, volDrag = false;

const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const folderName = (f) => f.split(/[\\/]/).filter(Boolean).pop() || f;

listen('player-state', (e) => {
  const m = e.payload || {};
  if (m.t === 'list') { tracks = m.tracks || []; folder = m.folder || ''; applyFilter(); paintFolder(); }
  else if (m.t === 'cover') {
    if (m.id === coverId) return;
    coverId = m.id; window.__coverData = m.data || '';
    const url = m.data ? `url(data:image/png;base64,${m.data})` : '';
    $('#cover').style.backgroundImage = url; $('#cover').firstElementChild.style.display = m.data ? 'none' : '';
    $('#bg').style.backgroundImage = url; $('#bg').classList.toggle('none', !m.data);
    if (window.Aurora) window.Aurora.cover(m.data);
  } else if (m.t === 'state') {
    const now = performance.now(), age = m.ts ? clamp(Date.now() - m.ts, 0, 400) : 0, reported = m.pos + (m.playing ? age : 0);
    if (S.playing && m.playing && S.idx === m.idx && !scrubbing) {
      const predicted = S.pos + (now - at), err = reported - predicted;
      m.pos = Math.abs(err) < 350 ? predicted + err * 0.5 : reported;      // a small difference is eased in; a seek or a new song snaps
    } else m.pos = reported;
    S = m; at = now;
    paintTheme(m.top);
    if (window.PlayerLook) window.PlayerLook.set(m);
    if (window.Aurora) window.Aurora.state(m);
    if (m.folder !== folder) { folder = m.folder; paintFolder(); }
    paintState();
  }
});
cmd('hello');

// ---- the list
function applyFilter() {
  const q = query.trim().toLowerCase();
  matches = [];
  for (let i = 0; i < tracks.length; i++) if (!q || (tracks[i][0] + ' ' + tracks[i][1]).toLowerCase().includes(q)) matches.push(i);
  shown = 200; lastIdx = -2; renderList();
}
function rowFor(i, k) {
  const [title, artist, thumb] = tracks[i];
  const row = document.createElement('div'); row.className = 'row' + (i === S.idx ? ' cur' : ''); row.dataset.i = i; row.style.setProperty('--k', Math.min(k || 0, 12));
  const n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1;
  const cov = document.createElement('span'); cov.className = 'cov';
  if (thumb) cov.style.backgroundImage = 'url(' + thumb + ')'; else cov.innerHTML = I.note;
  const t = document.createElement('span'); t.className = 't';
  const b = document.createElement('b'); b.textContent = title; b.dir = 'auto';
  const a = document.createElement('span'); a.textContent = artist; a.dir = 'auto';
  t.append(b, a); row.append(n, cov, t);
  row.addEventListener('click', () => { cmd('play', { i }); setList(false); });
  return row;
}
function renderList() {
  const list = $('#list'); list.textContent = '';
  if (!folder) { list.innerHTML = '<div class="empty">Pick the folder your music lives in</div>'; return; }
  if (S.scanning && !tracks.length) { list.innerHTML = '<div class="empty">Reading the folder…</div>'; return; }
  if (!tracks.length) { list.innerHTML = '<div class="empty">No music found in this folder</div>'; return; }
  if (!matches.length) { list.innerHTML = '<div class="empty">Nothing matches</div>'; return; }
  const frag = document.createDocumentFragment();
  matches.slice(0, shown).forEach((i, k) => frag.appendChild(rowFor(i, k)));
  list.appendChild(frag);
}
$('#list').addEventListener('scroll', () => {
  const l = $('#list');
  if (shown >= matches.length || l.scrollTop + l.clientHeight < l.scrollHeight - 80) return;
  const from = shown; shown = Math.min(matches.length, from + 200);
  for (let k = from; k < shown; k++) l.appendChild(rowFor(matches[k]));
});
// scroll only the list itself (scrollIntoView would also scroll the short card around it)
function keepInView(row) {
  const l = $('#list'), top = row.offsetTop - l.offsetTop;
  if (top < l.scrollTop) l.scrollTop = top; else if (top + row.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = top + row.offsetHeight - l.clientHeight;
}
function markNow() {
  if (S.idx === lastIdx) return;
  lastIdx = S.idx;
  const list = $('#list'), old = list.querySelector('.row.cur'); if (old) old.classList.remove('cur');
  const cur = list.querySelector(`.row[data-i="${S.idx}"]`);
  if (cur) { cur.classList.add('cur'); if (!query) keepInView(cur); }
}
$('#q').addEventListener('input', (e) => { query = e.target.value; applyFilter(); });
function paintFolder() {
  $('#folder').textContent = folder ? folderName(folder) + (tracks.length ? ' · ' + tracks.length : '') : 'No music folder yet';
  $('#folder').title = folder; $('#pick').textContent = folder ? 'Change' : 'Choose folder';
  renderList();
}
$('#pick').addEventListener('click', () => cmd('pick'));

// the List button raises the list over the player; picking a song, the button, or Esc lowers it again (the window never changes size)
const setList = (on) => {
  const card = $('#card'); if (card.classList.contains('open') === on) return;
  card.classList.toggle('open', on);
  $('#listbtn').setAttribute('aria-expanded', String(on)); $('#listbtn').title = on ? 'Hide the music list' : 'Show the music list';
  if (on) { const cur = $('#list .row.cur'); if (cur) keepInView(cur); }
};
$('#listbtn').addEventListener('click', () => setList(!$('#card').classList.contains('open')));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setList(false); });

// ---- the now-playing part
function paintState() {
  $('#title').textContent = S.on ? (S.title || 'Unknown title') : 'Nothing playing';
  $('#artist').textContent = S.on ? (S.artist || '') : '';
  put($('#c-play'), S.playing ? 'pause' : 'play');
  $('#cover').classList.toggle('playing', !!S.playing);
  $('#c-shuffle').classList.toggle('on', !!S.shuffle);
  put($('#c-repeat'), S.repeat === 2 ? 'repeat1' : 'repeat');
  $('#c-repeat').classList.toggle('on', !!S.repeat);
  $('#c-repeat').title = ['Repeat: off', 'Repeat: all', 'Repeat: one'][S.repeat] || 'Repeat';
  const v = S.mute ? 0 : S.vol;
  if (!volDrag) { $('#vfill').style.width = v + '%'; $('#vknob').style.left = v + '%'; $('#vnum').textContent = v; }
  put($('#volbtn'), v === 0 ? 'muted' : 'volume'); put($('#vmute'), v === 0 ? 'muted' : 'volume');
  $('#seek').classList.toggle('off', !(S.on && S.dur > 0));
  markNow();
  lyrTrack();
  if (!tracks.length || (S.scanning && !tracks.length)) renderList();
}
// waveform seek bar: bars shaped from the song's name, so every song keeps its own look (the player can't see the audio itself)
const wvEl = $('#wave'), wvx = wvEl.getContext('2d');
let wvKey = null, wvBars = [], wvW = 0, wvH = 0, wvN = 0, wvFilled = -1;
function wvBuild(key, n) {
  let a = 2166136261; for (let i = 0; i < key.length; i++) { a ^= key.charCodeAt(i); a = Math.imul(a, 16777619); }
  const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const p1 = rnd() * 6, p2 = rnd() * 6, f1 = .12 + rnd() * .1, f2 = .31 + rnd() * .2;
  wvBars = []; for (let i = 0; i < n; i++) wvBars.push(clamp((.5 + .28 * Math.sin(i * f1 + p1) + .18 * Math.sin(i * f2 + p2)) * (.6 + .4 * rnd()), .12, 1));
}
function drawWave(r) {
  const w = wvEl.clientWidth, h = wvEl.clientHeight; if (!w || !h) return;      // hidden in lyrics view
  const key = S.on ? (S.title || '') + '\u0001' + (S.artist || '') : 'poyzen', n = Math.max(8, Math.floor((w + 2) / 5)), dpr = window.devicePixelRatio || 1;
  const resized = w !== wvW || h !== wvH;
  if (resized) { wvW = w; wvH = h; wvEl.width = Math.round(w * dpr); wvEl.height = Math.round(h * dpr); }
  if (key !== wvKey || n !== wvN) { wvKey = key; wvN = n; wvBuild(key, n); wvFilled = -1; }
  const filled = Math.floor(r * n + (r > 0 ? .5 : 0));
  if (!resized && filled === wvFilled) return;
  wvFilled = filled;
  wvx.setTransform(dpr, 0, 0, dpr, 0, 0); wvx.clearRect(0, 0, w, h);
  const bw = (w - (n - 1) * 2) / n;
  for (let i = 0; i < n; i++) {
    const bh = Math.max(3, wvBars[i] * h), x = i * (bw + 2), y = (h - bh) / 2;
    wvx.fillStyle = i < filled ? '#fff' : 'rgba(255,255,255,.28)';
    wvx.beginPath(); if (wvx.roundRect) wvx.roundRect(x, y, bw, bh, Math.min(bw / 2, 2)); else wvx.rect(x, y, bw, bh); wvx.fill();
  }
}
(function loop() {
  const pos = scrubbing ? scrubR * S.dur : clamp(S.pos + (S.playing ? performance.now() - at : 0), 0, S.dur || 0);
  const r = S.dur > 0 ? pos / S.dur : 0;
  $('#seek-fill').style.width = (r * 100).toFixed(2) + '%'; $('#seek-knob').style.left = (r * 100).toFixed(2) + '%';
  drawWave(r);
  lyrTick(pos);
  $('#t-now').textContent = fmt(pos); $('#t-all').textContent = fmt(S.dur || 0);
  requestAnimationFrame(loop);
})();

$('#c-play').addEventListener('click', () => cmd('toggle'));
$('#c-next').addEventListener('click', () => cmd('next'));
$('#c-prev').addEventListener('click', () => cmd('prev'));
$('#c-shuffle').addEventListener('click', () => cmd('shuffle'));
$('#c-repeat').addEventListener('click', () => cmd('repeat'));

// seek bar: drag, apply on release
const seekEl = $('#seek'), ratio = (el, e) => { const r = el.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };
seekEl.addEventListener('pointerdown', (e) => { if (!(S.on && S.dur > 0)) return; scrubbing = true; scrubR = ratio(seekEl, e); seekEl.classList.add('drag'); try { seekEl.setPointerCapture(e.pointerId); } catch { /* gone */ } });
seekEl.addEventListener('pointermove', (e) => { if (scrubbing) scrubR = ratio(seekEl, e); });
const seekEnd = (apply) => {
  if (!scrubbing) return;
  scrubbing = false; seekEl.classList.remove('drag');
  if (apply) { const ms = Math.round(scrubR * S.dur); S.pos = ms; at = performance.now(); cmd('seek', { ms }); }
};
seekEl.addEventListener('pointerup', () => seekEnd(true)); seekEl.addEventListener('pointercancel', () => seekEnd(false));

// volume bar (the system volume, like the pill's)
const vt = $('#vtrack');
let vSent = 0;
function volFrom(e) {
  const v = Math.round(ratio(vt, e) * 100);
  $('#vfill').style.width = v + '%'; $('#vknob').style.left = v + '%'; $('#vnum').textContent = v;
  const now = performance.now();
  if (now - vSent > 40) { vSent = now; cmd('vol', { v }); }
  vt.dataset.v = v;
}
vt.addEventListener('pointerdown', (e) => { volDrag = true; vt.classList.add('drag'); try { vt.setPointerCapture(e.pointerId); } catch { /* gone */ } volFrom(e); });
vt.addEventListener('pointermove', (e) => { if (volDrag) volFrom(e); });
const volEnd = () => { if (!volDrag) return; volDrag = false; vt.classList.remove('drag'); cmd('vol', { v: Number(vt.dataset.v) || 0 }); };
vt.addEventListener('pointerup', volEnd); vt.addEventListener('pointercancel', volEnd);
document.addEventListener('wheel', (e) => { if (e.target.closest('.list, .lyrics, .timing')) return; e.preventDefault(); cmd('vol', { v: clamp((S.mute ? 0 : S.vol) - Math.sign(e.deltaY) * 3, 0, 100) }); volPoke(); }, { passive: false });
// the volume is a small pill that opens from the speaker button (or on the mouse wheel) and tucks itself away again
const vpop = $('#volpop'), vbtn = $('#volbtn'); let vTimer = 0;
put(vbtn, 'volume'); put($('#vmute'), 'volume');
function volShow(on) { vpop.classList.toggle('on', on); vbtn.classList.toggle('on', on); $('#card').classList.toggle('vol-on', on); vbtn.setAttribute('aria-expanded', on); clearTimeout(vTimer); if (on) vTimer = setTimeout(volIdle, 2600); }
function volIdle() { if (volDrag || vpop.matches(':hover')) { vTimer = setTimeout(volIdle, 900); return; } volShow(false); }
function volPoke() { volShow(true); }
vbtn.addEventListener('click', () => volShow(!vpop.classList.contains('on')));
$('#vmute').addEventListener('click', () => { cmd('mute'); volPoke(); });
vpop.addEventListener('pointerdown', volPoke); vpop.addEventListener('pointermove', () => { if (volDrag) volPoke(); });
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#volpop, #volbtn')) volShow(false); });


// window: drag by the title bar, minimize, close; Space = play / pause
$('#drag').addEventListener('pointerdown', (e) => { if (e.button === 0 && !e.target.closest('button')) invoke('player_drag'); });
$('#w-min').addEventListener('click', () => invoke('player_min'));
$('#w-close').addEventListener('click', () => invoke('player_close'));
document.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target.id !== 'q') { e.preventDefault(); cmd('toggle'); } });

// ---------------------------------------------------------------- lyrics (LRCLIB)
// The Lyrics button turns the player into a lyrics view: small cover and title on top, the lyrics gliding with the song, ±10s buttons.
var L = { on: false, key: '', tok: 0, state: 'idle', data: null, off: 0, active: -2, els: [], ws: [], wt: [], manual: 0, manualAt: 0, timer: 0, tr: false, fa: null, en: false, trBusy: false, trFailAt: 0 };
try { L.tr = localStorage.getItem('poyzen.lyr.tr') === '1'; } catch { /* not remembered */ }
// how the sung word shows: 'line' = the whole line lights up, 'fill' = every word fills as it is sung, 'pop' = the word lifts and lights up
let WM = 'fill'; try { const m = localStorage.getItem('poyzen.lyr.wm'); if (m === 'line' || m === 'fill' || m === 'pop') WM = m; } catch { /* default */ }
const lyEl = $('#lyrics'), lnEl = $('#lines'), lmsg = $('#lmsg'), lpill = $('#lpill'), tmEl = $('#timing');
const lyrKey = () => (S.on && S.title ? S.title + '\u0001' + (S.artist || '') : '');
const offText = (ms) => (ms > 0 ? '+' : ms < 0 ? '−' : '') + (Math.abs(ms) / 1000).toFixed(1) + 's';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const msgBox = (icon, head, text, acts) => `<div class="big">${icon}</div><h3>${esc(head)}</h3><p>${esc(text)}</p>${acts ? '<div class="acts"><button id="l-again">' + I.again + 'Search again</button><button id="l-file">' + I.file + 'Load .lrc file</button></div>' : ''}`;

const lyrLines = (r) => (r && r.synced && r.synced.length) ? r.synced.map((x) => x[1]) : (r && Array.isArray(r.plain)) ? r.plain : (r && r.plain) ? Lyr.parsePlain(r.plain) : [];
const trBtns = [...document.querySelectorAll('#trseg button')], trstat = $('#trstat');
function paintTr() {
  trBtns.forEach((b) => b.classList.toggle('on', (b.dataset.t === 'fa') === L.tr));
  trstat.textContent = L.trBusy ? 'Translating…' : (Date.now() - L.trFailAt < 2500 ? 'Offline' : 'all songs');
}
trBtns.forEach((b) => b.addEventListener('click', () => {
  L.tr = b.dataset.t === 'fa';
  try { localStorage.setItem('poyzen.lyr.tr', L.tr ? '1' : '0'); } catch { /* not remembered */ }
  if (L.tr) trFetch();
  paintTr(); lyrRender(); lyrScroll();
}));
async function trFetch() {
  if (!L.en || L.fa || L.trBusy || !L.data) return;
  const key = L.key, tok = L.tok, cached = Lyr.store.get(key + '#fa');
  if (Array.isArray(cached)) { L.fa = cached; lyrRender(); lyrScroll(); return; }
  L.trBusy = true; paintTr();
  try {
    const fa = await Lyr.translateFa(lyrLines(L.data));
    if (tok === L.tok && key === L.key) {
      if (fa.some((x) => x)) { L.fa = fa; Lyr.store.put(key + '#fa', fa); }
      else { L.trFailAt = Date.now(); setTimeout(paintTr, 2600); }      // nothing came back: say so on the pill instead of staying silent
    }
  } catch { if (tok === L.tok && key === L.key) { L.trFailAt = Date.now(); setTimeout(paintTr, 2600); } }
  L.trBusy = false; paintTr(); lyrRender(); lyrScroll();
}
const GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
function lyrPill() {
  paintTr();
  const s = L.state, p = lpill;
  const stat = s === 'search' ? 'Searching…' : s === 'synced' ? 'Synced' + (L.off ? ' · ' + offText(L.off) : '') : s === 'plain' ? 'Unsynced' : s === 'instr' ? 'Instrumental' : s === 'error' ? 'Offline' : s === 'none' ? 'No lyrics' : '';
  p.hidden = s === 'idle';
  p.className = 'lpill' + (s === 'search' ? ' busy' : '') + (s === 'synced' ? ' ok' : '') + (s === 'synced' || s === 'plain' ? ' can' : '') + (tmEl.hidden ? '' : ' on');
  p.innerHTML = GEAR + (s === 'synced' ? '<span class="dot"></span>' : '');
  p.title = stat;
  const ts = $('#tmstat'); if (ts) ts.textContent = stat;
  if (s !== 'synced' && s !== 'plain') tmEl.hidden = true;
  $('#lyrbtn').classList.toggle('has', s === 'synced' || s === 'plain');
}
// word-by-word: an enhanced .lrc brings its own word times; otherwise the line's time is shared out between its words by their length
const mkWord = (txt) => { const w = document.createElement('span'); w.className = 'w'; w.textContent = txt; const f = document.createElement('span'); f.className = 'f'; f.textContent = txt; w.appendChild(f); return { el: w, f }; };
// How fast is this song sung? Learnt from the lines that follow each other without a break (characters per millisecond);
// a fixed guess made fast lines crawl and left the words far behind the voice.
const PAUSE = /[,;:.!?…،؛؟]$/, PAUSE_UNITS = 2.2;
function unitsOf(parts) { let total = 0; const lens = parts.map((p, j) => { const u = p.length + 1 + (j < parts.length - 1 && PAUSE.test(p) ? PAUSE_UNITS : 0); total += u; return u; }); return { lens, total }; }
function singRate(rows) {
  if (rows._rate) return rows._rate;
  const r = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const parts = (rows[i][1] || '').split(/\s+/).filter(Boolean), gap = rows[i + 1][0] - rows[i][0];
    if (parts.length >= 2 && gap > 900 && gap < 7000) r.push(unitsOf(parts).total / gap);
  }
  r.sort((a, b) => a - b);
  // lines are sung a little faster than the time to the next line (that includes the breath), so take the quicker end
  const rate = r.length >= 3 ? r[Math.floor(r.length * 0.7)] * 1.08 : 1 / 80;
  return (rows._rate = clamp(rate, 1 / 170, 1 / 40));
}
function buildWords(x, rows, i) {
  const t0 = rows[i][0], nxt = i + 1 < rows.length ? rows[i + 1][0] : t0 + 5000, ws = [], wt = [];
  if (rows[i][2]) {
    const tok = rows[i][2];
    tok.forEach(([t, txt], j) => {
      const w = mkWord(txt.trimEnd()); x.appendChild(w.el); if (/\s$/.test(txt)) x.appendChild(document.createTextNode(' '));
      ws.push(w); wt.push({ s: t, e: j + 1 < tok.length ? tok[j + 1][0] : Math.min(nxt, t + 900) });
    });
  } else {
    const parts = rows[i][1].split(/\s+/).filter(Boolean), { lens, total } = unitsOf(parts);
    const span = clamp(total / singRate(rows), 350, Math.max(350, (nxt - t0) * 0.95));
    let acc = 0;
    parts.forEach((p, j) => {
      const w = mkWord(p); x.appendChild(w.el); if (j < parts.length - 1) x.appendChild(document.createTextNode(' '));
      const pause = j < parts.length - 1 && PAUSE.test(p), end = acc + (pause ? p.length + 0.6 : lens[j]);     // a comma lets the voice rest before the next word
      ws.push(w); wt.push({ s: t0 + span * acc / total, e: t0 + span * end / total }); acc += lens[j];
    });
  }
  L.ws[i] = ws; L.wt[i] = wt;
}
function setRowWords(i, full) {
  const ws = L.ws[i]; if (!ws) return;
  for (const w of ws) { w.f.style.width = full ? '100%' : '0'; w.el.classList.remove('on'); }
}
const SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="16" rx="4"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.500L20 17"/></svg>';
function lyrRender() {
  const s = L.state;
  lyEl.className = 'lyrics' + (s === 'plain' ? ' plain' : '') + (s === 'synced' || s === 'plain' ? '' : ' msg') + (s === 'synced' && WM !== 'line' ? ' wm' : '');
  lnEl.textContent = ''; L.els = []; L.ws = []; L.wt = []; L.active = -2; lnEl.style.transform = '';
  if (s === 'synced' || s === 'plain') {
    const frag = document.createDocumentFragment();
    const rows = s === 'synced' ? L.data.synced : L.data.plain.map((t) => [-1, t]);
    rows.forEach(([t, text], i) => {
      const row = document.createElement('div'); row.className = 'ln' + (text ? '' : ' gap'); row.dataset.i = i;
      const tm = document.createElement('span'); tm.className = 'tm'; tm.textContent = t >= 0 ? fmt(t) : '';
      const x = document.createElement('span'); x.className = 'x'; x.dir = 'auto';
      if (s === 'synced' && WM !== 'line' && text) buildWords(x, rows, i); else x.textContent = text || '♪';
      if (t >= 0) row.append(tm, x); else row.append(x);
      if (text) { const sb = document.createElement('button'); sb.className = 'shr'; sb.title = 'Share this line as a picture'; sb.innerHTML = SHARE_ICON; row.appendChild(sb); if (t >= 0) row.classList.add('has-tm'); }
      if (L.tr && L.fa && L.fa[i]) { const tr = document.createElement('div'); tr.className = 'tr'; tr.textContent = L.fa[i]; row.appendChild(tr); }
      row.style.setProperty('--d', 4);
      frag.appendChild(row); L.els.push(row);
    });
    lnEl.appendChild(frag);
    if (s === 'plain') lyEl.scrollTop = 0;
  } else if (s === 'search') {
    lmsg.innerHTML = Date.now() - (L.searchAt || 0) < 350 ? '' : '<div class="sker"><i style="width:86%"></i><i style="width:100%"></i><i style="width:62%"></i><i style="width:92%"></i><i style="width:48%"></i></div><p>Matching title, artist, album and length…</p>';   // a fast match never flashes the skeleton
  } else if (s === 'none') lmsg.innerHTML = msgBox(I.nolyrics, 'No lyrics found', 'LRCLIB has nothing for this track yet.', true);
  else if (s === 'error') lmsg.innerHTML = msgBox(I.nolyrics, "Can't reach LRCLIB", 'Check the internet connection and try again.', true);
  else if (s === 'instr') lmsg.innerHTML = msgBox(I.note, 'Instrumental', 'This track has no lyrics.', false);
  else lmsg.innerHTML = msgBox(I.note, 'Nothing playing', 'Play a song to see its lyrics.', false);
}
function setLyr(state) { L.state = state; lyrPill(); lyrRender(); }
function applyLyr(r) {
  L.data = r; L.fa = null; L.en = !!(r && !r.instrumental && Lyr.isEnglish(lyrLines(r)));
  const rd = r && r.dur > 0 && S.dur > 0 ? (S.dur / 1000) / r.dur : 1;      // a slowed / sped-up copy of the song: stretch the
  if (r && r.synced && rd > 0.7 && rd < 1.45 && Math.abs(rd - 1) > 0.03)    // line stamps (and word stamps) by the same ratio
    L.data = { ...r, synced: r.synced.map(([t, x, w]) => [Math.round(t * rd), x, w ? w.map(([wt, wx]) => [Math.round(wt * rd), wx]) : w]) };
  if (r.instrumental) setLyr('instr');
  else if (r.synced && r.synced.length) setLyr('synced');
  else if (r.plain) { r.plain = Array.isArray(r.plain) ? r.plain : Lyr.parsePlain(r.plain); setLyr('plain'); }
  else setLyr('none');
  if (L.tr && L.en) trFetch();
}
async function lyrSearch(tok) {
  try {
    const r = await Lyr.find(S.title, S.artist, S.dur / 1000);
    if (tok !== L.tok) return;
    if (r) { Lyr.store.put(L.key, r); applyLyr(r); } else setLyr('none');
  } catch { if (tok === L.tok) setLyr('error'); }
}
// called with every state message: a new song starts a new look-up (only once the person has opened Lyrics at least once)
function lyrTrack(force) {
  const key = lyrKey();
  if (key === L.key && !force) return;
  L.key = key; L.tok++; clearTimeout(L.timer); L.data = null; L.fa = null; L.en = false; L.off = key ? Lyr.store.offset(key) : 0;
  if (!key) { setLyr('idle'); return; }
  const c = Lyr.store.get(key);
  if (c) { if (c.plain && !Array.isArray(c.plain)) c.plain = Lyr.parsePlain(c.plain); applyLyr(c); return; }
  if (!L.on && !Lyr.store.flag('used')) { setLyr('idle'); return; }
  L.searchAt = Date.now(); setLyr('search');
  const tok = L.tok; setTimeout(() => { if (L.state === 'search' && L.tok === tok) lyrRender(); }, 380);   // the skeleton only appears if the search is really taking a while
  L.timer = setTimeout(() => lyrSearch(tok), 450);      // skipping through songs quickly does not search for each one
}
function lyrAgain() { Lyr.store.drop(L.key); lyrTrack(true); }

// the line that is being sung: the last one whose time (shifted by the song's own nudge) has passed
const LEAD = 90;      // ms: lines and words light up a touch early, because the glow takes a moment to be seen
function lyrTick(pos) {
  if (!L || !L.on || L.state !== 'synced') return;      // (the first frame runs before this section is set up)
  const rows = L.data.synced, at = pos + LEAD - L.off;
  let lo = 0, hi = rows.length - 1, idx = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (rows[mid][0] <= at) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  if (L.manual && performance.now() - L.manualAt > 2600) { L.manual = 0; lyrScroll(); }
  if (idx !== L.active) lyrPick(idx); else lyrWords(idx, at);
}
function lyrWords(idx, at) {      // the words of the line being sung, every frame
  const ws = L.ws[idx], wt = L.wt[idx]; if (WM === 'line' || !ws) return;
  for (let j = 0; j < ws.length; j++) {
    const v = clamp((at - wt[j].s) / Math.max(1, wt[j].e - wt[j].s), 0, 1);
    if (WM === 'fill') ws[j].f.style.width = (v * 100).toFixed(1) + '%';
    else { ws[j].f.style.width = v > 0 ? '100%' : '0'; ws[j].el.classList.toggle('on', v > 0 && v < 1); }
  }
}
function lyrPick(idx) {
  const prev = L.active; L.active = idx;
  if (prev >= 0) setRowWords(prev, prev < idx);
  for (let i = 0; i < L.els.length; i++) {
    const el = L.els[i], d = Math.min(4, Math.abs(i - Math.max(idx, 0)));
    el.style.setProperty('--d', idx < 0 ? Math.min(4, i + 1) : d); el.classList.toggle('cur', i === idx);
  }
  lyrScroll();
}
function lyrScroll() {
  const el = L.els[Math.max(L.active, 0)]; if (!el) return;
  lnEl.style.transform = `translateY(${Math.round(lyEl.clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2) + L.manual)}px)`;
}
lyEl.addEventListener('wheel', (e) => {            // look around while the song goes on; it glides back after a moment
  if (L.state !== 'synced') return;
  e.preventDefault();
  L.manual = clamp(L.manual - e.deltaY, -lnEl.offsetHeight, lnEl.offsetHeight); L.manualAt = performance.now(); lyrScroll();
}, { passive: false });
lnEl.addEventListener('click', (e) => {            // a tap on a line jumps there
  const sb = e.target.closest('.shr');                // ... except the little picture button: that one makes a share card
  if (sb) { e.stopPropagation(); if (window.LyricShare) window.LyricShare.open(Number(sb.closest('.ln').dataset.i)); return; }
  const row = e.target.closest('.ln'); if (!row || L.state !== 'synced') return;
  const ms = clamp(L.data.synced[Number(row.dataset.i)][0] + L.off, 0, S.dur || 1e9);
  S.pos = ms; at = performance.now(); cmd('seek', { ms }); L.manual = 0;
});
lmsg.addEventListener('click', (e) => {
  if (e.target.closest('#l-again')) lyrAgain();
  else if (e.target.closest('#l-file')) $('#lrcfile').click();
});
$('#lrcfile').addEventListener('change', async (e) => {      // a .lrc (or plain text) file the person has
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f || !L.key) return;
  try {
    const text = await f.text(), synced = Lyr.parseLRC(text);
    const r = synced.length ? { src: 'file', synced, plain: null } : { src: 'file', synced: null, plain: Lyr.parsePlain(text) };
    if (!synced.length && !text.trim()) return;
    Lyr.store.put(L.key, r); applyLyr(r);
  } catch { /* unreadable file: leave things as they were */ }
});

// the ±10s buttons, with a small bubble above the seek bar
let toastT = 0;
function skip(delta) {
  if (!S.on || !(S.dur > 0)) return;
  const cur = clamp(S.pos + (S.playing ? performance.now() - at : 0), 0, S.dur), ms = Math.round(clamp(cur + delta, 0, S.dur));
  S.pos = ms; at = performance.now(); cmd('seek', { ms });
  const t = $('#toast'), r = ms / S.dur;
  t.innerHTML = (delta > 0 ? I.fwd10 : I.back10) + (delta > 0 ? '+10s' : '−10s');
  t.style.left = clamp(r * 100, 16, 84) + '%'; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1000);
}
$('#c-back').addEventListener('click', () => skip(-10000));
$('#c-fwd').addEventListener('click', () => skip(10000));

// settings: click "Synced" to nudge this song's lyrics by 0.1s and to pick how the sung word shows
function nudge(ms) {
  L.off = clamp(Math.round((L.off + ms) / 100) * 100, -15000, 15000);
  Lyr.store.setOffset(L.key, L.off);
  $('#t-val').textContent = offText(L.off); lyrPill(); lpill.classList.toggle('on', !tmEl.hidden); L.active = -2;
}
lpill.addEventListener('click', () => {
  if (L.state !== 'synced' && L.state !== 'plain') return;
  tmEl.hidden = !tmEl.hidden; $('#t-val').textContent = offText(L.off); lpill.classList.toggle('on', !tmEl.hidden);
});
$('#t-minus').addEventListener('click', () => nudge(-100));
$('#t-plus').addEventListener('click', () => nudge(100));
$('#t-reset').addEventListener('click', () => nudge(-L.off));
// word animation: Line / Fill / Pop (kept for every song)
const wmBtns = [...document.querySelectorAll('#wmseg button')], paintWm = () => wmBtns.forEach((b) => b.classList.toggle('on', b.dataset.m === WM));
wmBtns.forEach((b) => b.addEventListener('click', () => {
  WM = b.dataset.m; try { localStorage.setItem('poyzen.lyr.wm', WM); } catch { /* not remembered */ }
  paintWm(); lyrRender(); lyrScroll();
}));
paintWm();
document.addEventListener('pointerdown', (e) => { if (!tmEl.hidden && !e.target.closest('#timing, #lpill')) { tmEl.hidden = true; lpill.classList.remove('on'); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !tmEl.hidden) { tmEl.hidden = true; lpill.classList.remove('on'); e.stopImmediatePropagation(); } }, true);

// the Lyrics button
function setLyrics(on) {
  L.on = on; $('#card').classList.toggle('lyr-on', on);
  $('#lyrbtn').setAttribute('aria-pressed', String(on)); $('#lyrbtn').title = on ? 'Back to the player' : 'Show the lyrics';
  if (on) { setList(false); Lyr.store.flag('used', true); if (L.state === 'idle' && L.key) lyrTrack(true); else lyrRender(), lyrPill(); L.active = -2; }
  else tmEl.hidden = true;
  requestAnimationFrame(lyrScroll);
}
$('#lyrbtn').addEventListener('click', () => setLyrics(!L.on));
setLyr('idle');
window.PlayerData = { S: () => S, L: () => L };      // read-only doors for player-share.js
})();
