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
  muted: S0 + `<path fill="currentColor" d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z"/><path ${ST} d="M16 9.5l5 5M21 9.5l-5 5"/>` + S1,
};
const put = (el, k) => { if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = I[k]; } };
put($('#c-prev'), 'prev'); put($('#c-next'), 'next'); put($('#c-shuffle'), 'shuffle'); put($('#c-play'), 'play'); put($('#c-repeat'), 'repeat');


// ---- the window's colour: soft gradient from the theme / cover colour at the top down to near-black
const layers = [document.createElement('div'), document.createElement('div')], grain = document.createElement('div');
layers.forEach((l) => { l.className = 'pt-layer'; }); grain.className = 'pt-grain';
$('#card').prepend(grain, layers[1], layers[0]);
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
    coverId = m.id;
    const url = m.data ? `url(data:image/png;base64,${m.data})` : '';
    $('#cover').style.backgroundImage = url; $('#cover').firstElementChild.style.display = m.data ? 'none' : '';
    $('#bg').style.backgroundImage = url; $('#bg').classList.toggle('none', !m.data);
  } else if (m.t === 'state') {
    S = m; at = performance.now();
    paintTheme(m.top);
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
  $('#seek').classList.toggle('off', !(S.on && S.dur > 0));
  markNow();
  if (!tracks.length || (S.scanning && !tracks.length)) renderList();
}
(function loop() {
  const pos = scrubbing ? scrubR * S.dur : clamp(S.pos + (S.playing ? performance.now() - at : 0), 0, S.dur || 0);
  const r = S.dur > 0 ? pos / S.dur : 0;
  $('#seek-fill').style.width = (r * 100).toFixed(2) + '%'; $('#seek-knob').style.left = (r * 100).toFixed(2) + '%';
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
document.addEventListener('wheel', (e) => { if (e.target.closest('.list')) return; e.preventDefault(); cmd('vol', { v: clamp((S.mute ? 0 : S.vol) - Math.sign(e.deltaY) * 3, 0, 100) }); }, { passive: false });

// window: drag by the title bar, minimize, close; Space = play / pause
$('#drag').addEventListener('pointerdown', (e) => { if (e.button === 0 && !e.target.closest('button')) invoke('player_drag'); });
$('#w-min').addEventListener('click', () => invoke('player_min'));
$('#w-close').addEventListener('click', () => invoke('player_close'));
document.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target.id !== 'q') { e.preventDefault(); cmd('toggle'); } });
})();
