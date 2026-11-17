/* Peeky for phones: a single-window music player. The tag readers are the pill's own (from app.js),
   the waveform and the lyrics engine are the player window's (from player.js) — only the wiring differs:
   playback itself lives in the media service's native MediaPlayer (v4); this page is its remote
   control and display, fed by a 500ms state poll whose position the frame loop interpolates. */
(() => {
'use strict';
const call = (c, a) => window.__TAURI__.core.invoke(c, a);
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

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
  again: S0 + `<path ${ST} d="M20 12a8 8 0 1 1-2.400-5.700M20 4v4.500h-4.500"/>` + S1,
  nolyrics: S0 + `<path fill="currentColor" d="M10 4v10.200a3.200 3.200 0 1 0 2 3V8h5V4z"/><path ${ST} d="M4 4l16 16"/>` + S1,
  moon: S0 + `<path ${ST} d="M20 13.2A8.2 8.2 0 1 1 10.8 4a6.6 6.6 0 0 0 9.2 9.2z"/>` + S1,
  sort: S0 + `<path ${ST} d="M8 4v12.5M8 16.5l-3-3M8 16.5l3-3M16 20V7.5M16 7.5l-3 3M16 7.5l3 3"/>` + S1,
};
const put = (el, k) => { if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = I[k]; } };
put($('#c-prev'), 'prev'); put($('#c-next'), 'next'); put($('#c-shuffle'), 'shuffle'); put($('#c-play'), 'play'); put($('#c-repeat'), 'repeat'); put($('#sleep'), 'moon');

// ------------------------------------------------------------ tags (from app.js, unchanged)
function nameOf(path) {
  const parts = path.split(/[\\/]/), file = parts.pop() || '', dir = parts.pop() || '';
  let title = file.replace(/\.[^.]+$/, '').replace(/^\d{1,3}\s*[-._)]\s*/, '').replace(/_/g, ' ').trim() || file, artist = '';
  const dash = title.match(/^(.{1,60}?)\s+-\s+(.+)$/);
  if (dash) { artist = dash[1]; title = dash[2]; } else artist = dir;
  return { title, artist };
}
function id3Text(u, at, len) {
  const enc = u[at]; let b = u.subarray(at + 1, at + len), label = 'windows-1252';
  if (enc === 1) {
    if (b[0] === 0xff && b[1] === 0xfe) { label = 'utf-16le'; b = b.subarray(2); }
    else if (b[0] === 0xfe && b[1] === 0xff) { label = 'utf-16be'; b = b.subarray(2); }
    else label = 'utf-16le';
  } else if (enc === 2) label = 'utf-16be';
  else if (enc === 3) label = 'utf-8';
  return new TextDecoder(label).decode(b).split('\0')[0].trim();
}
function bytesToB64(u) {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function id3Pic(u, at, len) {
  const enc = u[at], end = at + len; let p = at + 1;
  while (p < end && u[p] !== 0) p++;
  p += 2;
  if (enc === 1 || enc === 2) { while (p + 1 < end && !(u[p] === 0 && u[p + 1] === 0)) p += 2; p += 2; }
  else { while (p < end && u[p] !== 0) p++; p += 1; }
  const img = p < end ? u.subarray(p, end) : null;
  return img && img.length > 100 && img.length < 6e6 ? bytesToB64(img) : null;
}
function readId3(buf) {
  const out = {};
  try {
    const u = new Uint8Array(buf), d = new DataView(buf);
    if (u.length < 10 || u[0] !== 0x49 || u[1] !== 0x44 || u[2] !== 0x33 || u[3] < 3 || u[3] > 4) return out;
    const safe = (at) => ((u[at] & 127) << 21) | ((u[at + 1] & 127) << 14) | ((u[at + 2] & 127) << 7) | (u[at + 3] & 127);
    const v4 = u[3] === 4, end = Math.min(10 + safe(6), u.length);
    let p = 10;
    if (u[5] & 0x40) p += v4 ? safe(p) : d.getUint32(p) + 4;
    while (p + 10 <= end) {
      const id = String.fromCharCode(u[p], u[p + 1], u[p + 2], u[p + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = v4 ? safe(p + 4) : d.getUint32(p + 4), body = p + 10;
      if (size <= 0 || body + size > u.length) break;
      if (id === 'TIT2') out.title = id3Text(u, body, size);
      else if (id === 'TPE1') out.artist = id3Text(u, body, size);
      else if (id === 'APIC' && !out.cover) out.cover = id3Pic(u, body, size);
      p = body + size;
    }
  } catch { /* a damaged tag is not worth stopping the music for */ }
  return out;
}
function mp4Child(u, d, at, end, type) {
  let p = at;
  while (p + 8 <= end) {
    let size = d.getUint32(p), hdr = 8;
    const t = String.fromCharCode(u[p + 4], u[p + 5], u[p + 6], u[p + 7]);
    if (size === 1) { size = Number(d.getBigUint64(p + 8)); hdr = 16; }
    else if (size === 0) size = end - p;
    if (size < hdr) return null;
    if (t === type) return [p + hdr, Math.min(p + size, end)];
    p += size;
  }
  return null;
}
function readMp4(buf) {
  const out = {};
  try {
    const u = new Uint8Array(buf), d = new DataView(buf), dec = new TextDecoder('utf-8');
    const moov = mp4Child(u, d, 0, u.length, 'moov'); if (!moov) return out;
    let meta = null;
    const udta = mp4Child(u, d, moov[0], moov[1], 'udta');
    if (udta) meta = mp4Child(u, d, udta[0], udta[1], 'meta');
    if (!meta) meta = mp4Child(u, d, moov[0], moov[1], 'meta');
    if (!meta) return out;
    const ilst = mp4Child(u, d, meta[0] + 4, meta[1], 'ilst'); if (!ilst) return out;
    let p = ilst[0];
    while (p + 8 <= ilst[1]) {
      let size = d.getUint32(p), hdr = 8;
      const key = String.fromCharCode(u[p + 4], u[p + 5], u[p + 6], u[p + 7]);
      if (size === 1) { size = Number(d.getBigUint64(p + 8)); hdr = 16; }
      else if (size === 0) size = ilst[1] - p;
      if (size < hdr) break;
      const data = mp4Child(u, d, p + hdr, Math.min(p + size, ilst[1]), 'data');
      if (data && data[0] + 8 <= data[1]) {
        const kind = d.getUint32(data[0]), payload = u.subarray(data[0] + 8, data[1]);
        if (key === '\u00A9nam' && kind === 1) out.title = dec.decode(payload).trim();
        else if (key === '\u00A9ART' && kind === 1) out.artist = dec.decode(payload).trim();
        else if (key === 'aART' && kind === 1 && !out.artist) out.artist = dec.decode(payload).trim();
        else if (key === 'covr' && !out.cover && payload.length > 100 && payload.length < 6e6) out.cover = bytesToB64(payload);
      }
      p += size;
    }
  } catch { /* a damaged tag is not worth stopping the music for */ }
  return out;
}
function readFlac(buf) {
  const out = {};
  try {
    const u = new Uint8Array(buf), d = new DataView(buf), dec = new TextDecoder('utf-8');
    if (u.length < 8 || u[0] !== 0x66 || u[1] !== 0x4c || u[2] !== 0x61 || u[3] !== 0x43) return out;
    let p = 4, albumArtist = '';
    while (p + 4 <= u.length) {
      const last = u[p] & 0x80, type = u[p] & 0x7f, len = (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3], body = p + 4;
      if (body >= u.length) break;
      if (type === 4) {
        let q = body;
        const le = () => { const v = d.getUint32(q, true); q += 4; return v; };
        q += 4 + le();
        const count = le();
        for (let i = 0; i < count && q + 4 <= u.length; i++) {
          const l = le(); if (q + l > u.length) break;
          const s = dec.decode(u.subarray(q, q + l)); q += l;
          const eq = s.indexOf('='); if (eq < 1) continue;
          const k = s.slice(0, eq).toUpperCase(), v = s.slice(eq + 1).trim();
          if (k === 'TITLE' && !out.title) out.title = v;
          else if (k === 'ARTIST' && !out.artist) out.artist = v;
          else if (k === 'ALBUMARTIST' && !albumArtist) albumArtist = v;
        }
      } else if (type === 6 && !out.cover) {
        let q = body;
        const be = () => { const v = d.getUint32(q); q += 4; return v; };
        be(); const ml = be(); q += ml; const dl = be(); q += dl; q += 16; const n = be();
        const img = u.subarray(q, Math.min(q + n, u.length));
        if (img.length > 100) out.cover = bytesToB64(img);
      }
      if (last || body + len <= p + 4) break;
      p = body + len;
    }
    if (!out.artist && albumArtist) out.artist = albumArtist;
  } catch { /* a damaged tag is not worth stopping the music for */ }
  return out;
}
function tagsOf(buf, ext) { const e = (ext || '').toLowerCase(); return e === 'mp3' ? readId3(buf) : e === 'm4a' ? readMp4(buf) : e === 'flac' ? readFlac(buf) : {}; }
const imgMime = (b64) => b64.startsWith('/9j/') ? 'image/jpeg' : b64.startsWith('iVBOR') ? 'image/png' : b64.startsWith('R0lGOD') ? 'image/gif' : b64.startsWith('UklGR') ? 'image/webp' : 'image/jpeg';
function thumbOf(b64) {
  return new Promise((res) => {
    if (!b64) return res('');
    const img = new Image();
    img.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = 56; const g = c.getContext('2d'); const s = Math.min(img.width, img.height); g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 56, 56); res(c.toDataURL('image/jpeg', 0.72)); } catch { res(''); } };
    img.onerror = () => res('');
    img.src = 'data:' + imgMime(b64) + ';base64,' + b64;
  });
}
const tagCache = (() => { try { return JSON.parse(localStorage.getItem('peeky.tags.v1') || '{}'); } catch { return {}; } })();
let tagSaveAt = 0;
function saveTagCache() {
  const now = Date.now(); if (now - tagSaveAt < 2500) return; tagSaveAt = now;
  try { localStorage.setItem('peeky.tags.v1', JSON.stringify(tagCache)); } catch { /* full or blocked */ }
}
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

// ------------------------------------------------------------ the player
const P = {
  list: [], idx: -1, on: false, loading: false, seq: 0, fails: 0,
  title: '', artist: '', cover: null,
  shuffle: !!lsGet('peeky.mob.shuffle', false),
  repeat: Number(lsGet('peeky.mob.repeat', 0)) || 0,
  scanning: false, scanGen: 0,
};
// a small live view the lyrics engine reads, mirroring player.js's S
const S = { on: false, playing: false, title: '', artist: '', dur: 0 };
const extOf = (path) => (path.match(/\.([^.\\/]+)$/) || [])[1] || '';

let toastT = 0;
function showToast(text) {
  const t = $('#toast'); t.textContent = text; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1800);
}
function feedAurora() {
  if (!window.Aurora) return;
  window.Aurora.cover(P.cover || null);
  window.Aurora.state({ pal: null, look: 'black', playing: S.playing });
}
function paintState() {
  S.on = P.on; S.title = P.title; S.artist = P.artist;
  S.playing = P.on && NP.playing;
  $('#title').textContent = P.on ? (P.title || 'Unknown title') : 'Nothing playing';
  $('#artist').textContent = P.on ? (P.artist || '') : '';
  put($('#c-play'), S.playing ? 'pause' : 'play');
  $('#cover').classList.toggle('playing', S.playing);
  $('#c-shuffle').classList.toggle('on', !!P.shuffle);
  put($('#c-repeat'), P.repeat === 2 ? 'repeat1' : 'repeat');
  $('#c-repeat').classList.toggle('on', !!P.repeat);
  $('#c-repeat').title = ['Repeat: off', 'Repeat: all', 'Repeat: one'][P.repeat] || 'Repeat';
  const url = P.cover ? 'url(data:' + imgMime(P.cover) + ';base64,' + P.cover + ')' : '';
  $('#cover').style.backgroundImage = url;
  $('#cover').firstElementChild.style.display = P.cover ? 'none' : '';
  $('#seek').classList.toggle('off', !(P.on && S.dur > 0));
  if (window.Aurora) window.Aurora.state({ pal: null, look: 'black', playing: S.playing });
  markNow();
}
function saveResume(posMs) {
  const tr = P.list[P.idx];
  if (!tr) return;
  lsSet('peeky.mob.resume', { path: tr.path, pos: Math.round(posMs != null ? posMs : npPos()) || 0 });
}

// ------------------------------------------------------------ the persisted library
// v2 rebuilt the library from raw paths on every launch and re-read every file's tags
// in the background, so each cold start looked like a fresh scan. The library is now
// cached — [path, title, artist, durationMs, hasCover, thumb, indexed] per track — and
// rendered instantly at boot; scan() then only diffs the phone against this cache.
const LIB_KEY = 'peeky.lib.v1';
let libSaveAt = 0, libSaveTimer = 0;
function saveLibCache(force) {
  const now = Date.now();
  if (!force && now - libSaveAt < 2500) {          // debounce like the tag cache, but never drop the last write
    clearTimeout(libSaveTimer);
    libSaveTimer = setTimeout(() => saveLibCache(true), 2600);
    return;
  }
  libSaveAt = now;
  const rows = P.list.map((tr) => [tr.path, tr.title, tr.artist, Math.round(tr.dur || 0), (tr.coverB64 || tr.thumb) ? 1 : 0, tr.thumb || '', tr.tagged ? 1 : 0]);
  try { localStorage.setItem(LIB_KEY, JSON.stringify(rows)); }
  catch {                                          // over quota: keep the metadata, drop the thumbs
    try { localStorage.setItem(LIB_KEY, JSON.stringify(rows.map((r) => [r[0], r[1], r[2], r[3], r[4], '', r[6]]))); } catch { /* blocked */ }
  }
}
function loadLibCache() {
  let rows = null;
  try { rows = JSON.parse(localStorage.getItem(LIB_KEY) || 'null'); } catch { rows = null; }
  if (!Array.isArray(rows) || !rows.length) return false;
  P.list = rows.filter((r) => Array.isArray(r) && r[0]).map((r) => {
    const named = nameOf(r[0]);
    return { path: r[0], title: r[1] || named.title, artist: r[2] || named.artist, dur: Number(r[3]) || 0, thumb: r[5] || '', coverB64: null, tagged: !!r[6] };
  });
  if (!P.list.length) return false;
  $('#count').textContent = P.list.length + ' songs';
  applyFilter();
  return true;
}

// ------------------------------------------------------------ display metadata cleaner
// Download-site spam rides along in the tags and filenames ("Damn Things
// [ GisoMusic.com ]", "Dorcci - GisoMusic.com"). Everything the user SEES —
// player header, list rows, the notification — and the lyrics lookup use the
// cleaned values; the raw tags in the library cache are never rewritten.
const DOMAIN_RE = /\b(?:www\.)?[a-z0-9][a-z0-9-]*\.(?:com|net|org|ir|io|me|fm|tv|cc|info|biz|xyz|site|online|music|app)(?:\.[a-z]{2})?\b/i;
function cleanMeta(s) {
  if (!s) return '';
  let out = String(s);
  out = out.replace(/\[[^\]]*\]/g, (m) => (DOMAIN_RE.test(m) || /music|download/i.test(m)) ? ' ' : m);
  out = out.replace(/\([^)]*\)/g, (m) => (DOMAIN_RE.test(m) ? ' ' : m));
  out = out.replace(/\S+/g, (w) => (DOMAIN_RE.test(w) ? '' : w));
  out = out.replace(/[\s\-–—|:;]+$/, '').replace(/^[\s\-–—|:;]+/, '');
  return out.replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------ native player (tauri-plugin-media, v4)
// Playback lives in the foreground service's MediaPlayer; this page is its
// remote control + display. A 500ms `state` poll keeps NP fresh and the frame
// loop interpolates the position between polls so waveform/lyrics stay smooth.
// Invoke arguments are matched BY NAME by Tauri: payload-taking commands take
// one argument named `payload` (without the wrapper every call is rejected —
// that is why the v2 notification never appeared).
const mediaCall = (c, a) => call('plugin:media|' + c, a);
const mediaInvoke = (c, a) => { try { return mediaCall(c, a).catch((e) => { try { console.warn('media|' + c + ' failed', e); } catch { /* no console */ } }); } catch { return Promise.resolve(); } };
const NP = { playing: false, posMs: 0, durMs: 0, at: 0, path: '', sleepLeftMs: -1 };
const npPos = () => NP.playing ? clamp(NP.posMs + (performance.now() - NP.at), 0, NP.durMs > 0 ? NP.durMs : Infinity) : NP.posMs;
const coverKeyOf = (tr) => (tr && tr.coverB64) ? tr.path + ':' + tr.coverB64.length : '';
function coverArtOf(b64) {
  // 512px JPEG: what One UI's expanded media panel actually displays; the
  // v2/v3 256px PNG looked soft there (and PNG is needlessly heavy for photos)
  return new Promise((res) => {
    if (!b64) return res(null);
    const img = new Image();
    img.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'); const s = Math.min(img.width, img.height); g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 512, 512); res(c.toDataURL('image/jpeg', 0.88).split(',')[1]); } catch { res(null); } };
    img.onerror = () => res(null);
    img.src = 'data:' + imgMime(b64) + ';base64,' + b64;
  });
}
function npSync(st) {
  NP.playing = !!st.playing;
  NP.posMs = st.positionMs || 0;
  NP.durMs = st.durationMs || 0;
  NP.at = performance.now();
  NP.path = st.path || '';
  NP.sleepLeftMs = typeof st.sleepTimerRemainingMs === 'number' ? st.sleepTimerRemainingMs : -1;
  if (NP.durMs > 0) {
    S.dur = NP.durMs;
    const tr = P.list[P.idx];
    if (tr && tr.path === NP.path && tr.dur !== Math.round(NP.durMs)) { tr.dur = Math.round(NP.durMs); saveLibCache(); }
  }
  paintSleep();
}
// metadata for the loaded track (title/artist/cover) — playback state is the
// service's own business now, so this only rides along on track/tag changes
let metaKey = null, metaArt = null;
async function pushMeta() {
  if (!P.on) return;
  const tr = P.list[P.idx];
  if (!tr) return;
  let cover = null;
  const key = P.cover ? tr.path + ':' + P.cover.length : '';
  if (P.cover) {
    if (metaKey !== key) { metaKey = key; metaArt = await coverArtOf(P.cover); }
    cover = metaArt;
  } else metaKey = null;
  await mediaInvoke('update', { payload: {
    title: P.title || '', artist: P.artist || '', durationMs: Math.round(NP.durMs || tr.dur || 0),
    cover, coverKey: key,
  } });
}
// queue logic stays here (order / shuffle / repeat); the service gets exactly
// one track armed ahead, so completion can advance even with the WebView dead
function computeNext() {
  const n = P.list.length;
  if (!n || P.idx < 0) return null;
  if (P.repeat === 2) return P.list[P.idx];
  if (P.shuffle) return null;      // the pick is random: a live UI advances from the "ended" event instead
  if (P.idx + 1 < n) return P.list[P.idx + 1];
  return P.repeat === 1 ? P.list[0] : null;
}
function sendSetNext() {
  const nx = computeNext();
  mediaInvoke('set_next', { payload: { path: nx ? nx.path : null, title: nx ? (cleanMeta(nx.title) || nx.title) : '', artist: nx ? cleanMeta(nx.artist) : '' } });
}
function adoptByPath(path, st) {
  const i = P.list.findIndex((t) => t.path === path);
  if (i < 0) return;
  const tr = P.list[i];
  P.idx = i; P.on = true; P.loading = false;
  P.title = cleanMeta((st && st.title) || tr.title) || tr.title;
  P.artist = cleanMeta((st && st.artist) || tr.artist);
  P.cover = tr.coverB64 || null;
  paintState(); lyrTrack(); feedAurora(); sendSetNext();
}
let pollBusy = false;
async function pollState() {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const st = await mediaCall('state');
    if (st) {
      const wasPlaying = NP.playing;
      npSync(st);
      if (st.path && P.on && st.path !== (P.list[P.idx] || {}).path) adoptByPath(st.path, st);
      if (P.on && NP.playing !== S.playing) paintState();
      if (wasPlaying && !NP.playing) saveResume();
    }
  } catch { /* service not up (nothing played yet) */ }
  pollBusy = false;
}
setInterval(() => { if (P.on) pollState(); }, 500);
try {
  const Ch = window.__TAURI__.core.Channel;
  if (Ch) {
    const ch = new Ch();
    ch.onmessage = (m) => {
      // player-initiated changes only; user controls act natively in the service
      const a = m && m.action;
      if (a === 'track' && m.path) { adoptByPath(m.path); pollState(); }
      else if (a === 'ended') {
        NP.playing = false;
        if (P.on && P.shuffle) next();          // shuffle arms no next track: advance from here
        else if (P.on) { P.on = false; paintState(); mediaInvoke('stop'); }   // playlist over: notification goes away (v3 parity)
      }
      else if (a === 'error') { if (P.on && !P.loading) failTrack(); }
      else if (a === 'timer') { NP.sleepLeftMs = -1; paintSleep(); }
    };
    call('plugin:media|register_listener', { event: 'media-action', handler: ch }).catch(() => {});
  }
} catch { /* plugin not present (e.g. a desktop preview) — the player still works */ }

async function playTrack(i, autoplay = true, resumePos = 0) {
  const n = P.list.length;
  if (!n) return;
  i = ((i % n) + n) % n;
  const seq = ++P.seq, tr = P.list[i];
  P.idx = i; P.on = true; P.loading = true;
  P.title = cleanMeta(tr.title) || tr.title; P.artist = cleanMeta(tr.artist);
  P.cover = tr.coverB64 || null;
  NP.playing = false; NP.posMs = resumePos || 0; NP.durMs = tr.dur || 0; NP.at = performance.now(); NP.path = tr.path;
  S.dur = NP.durMs;
  paintState(); lyrTrack(); feedAurora();
  const art = tr.coverB64 ? await coverArtOf(tr.coverB64) : null;
  if (seq !== P.seq) return;
  try {
    await mediaCall('play_file', { payload: {
      path: tr.path, title: P.title || '', artist: P.artist || '',
      durationMs: Math.round(tr.dur || 0), autoplay: !!autoplay,
      startPositionMs: Math.round(resumePos || 0),
      cover: art, coverKey: coverKeyOf(tr),
    } });
  } catch { if (seq === P.seq) { P.loading = false; failTrack(); } return; }
  if (seq !== P.seq) return;
  P.loading = false; P.fails = 0;
  NP.playing = !!autoplay; NP.at = performance.now();
  paintState(); saveResume(resumePos || 0); sendSetNext();
  refineCurrent(i, seq);
}
// the playing track's tags may arrive (or improve) after it has started: when
// they do, refresh the list row, the header, the lyrics lookup and the
// notification metadata — the raw library entry keeps the original tags
async function refineCurrent(i, seq) {
  const tr = P.list[i];
  if (!tr) return;
  const ext = extOf(tr.path);
  if (!/^(mp3|m4a|flac)$/i.test(ext)) return;
  let buf = null;
  try { buf = await call('music_head', { path: tr.path }); } catch { buf = null; }
  if (!buf || seq !== P.seq) return;
  if (!(buf instanceof ArrayBuffer)) buf = new Uint8Array(buf).buffer;
  const tags = tagsOf(buf, ext);
  let changed = false;
  if (tags.title && tags.title !== tr.title) { tr.title = tags.title; changed = true; }
  if (tags.artist && tags.artist !== tr.artist) { tr.artist = tags.artist; changed = true; }
  if (tags.title || tags.artist) { tagCache[tr.path] = [tr.title, tr.artist]; saveTagCache(); }
  if (tags.cover && tags.cover !== tr.coverB64) {
    tr.coverB64 = tags.cover; changed = true;
    thumbOf(tags.cover).then((t) => { if (t) { tr.thumb = t; updateRow(i); saveLibCache(); } });
  }
  if (tags.title || tags.artist || tags.cover) { tr.tagged = true; saveLibCache(); }
  if (!changed) return;
  if (P.idx === i) {
    P.title = cleanMeta(tr.title) || tr.title; P.artist = cleanMeta(tr.artist);
    if (tags.cover) P.cover = tags.cover;
    paintState(); lyrTrack(); feedAurora(); pushMeta();
  }
  updateRow(i);
}
function failTrack() {
  const tr = P.list[P.idx];
  showToast("Can't play " + (tr ? nameOf(tr.path).title : 'that track'));
  if (++P.fails < Math.min(P.list.length, 4)) setTimeout(() => next(), 600);
  else { P.fails = 0; P.on = false; P.loading = false; paintState(); }
}
function next() {
  const n = P.list.length;
  if (!n) return;
  let i = P.idx + 1;
  if (P.shuffle && n > 1) { do { i = Math.floor(Math.random() * n); } while (i === P.idx); }
  playTrack(i);
}
function prev() {
  if (npPos() > 3000) { doSeek(0); return; }
  playTrack(P.idx - 1);
}
function toggle() {
  if (!P.on) { if (P.list.length) playTrack(P.idx >= 0 ? P.idx : 0); return; }
  if (NP.playing) { mediaInvoke('pause'); NP.playing = false; }
  else { mediaInvoke('resume'); NP.playing = true; NP.at = performance.now(); }
  paintState();
}
function doSeek(ms) {
  NP.posMs = clamp(Math.round(ms), 0, NP.durMs > 0 ? NP.durMs : Math.round(ms));
  NP.at = performance.now();
  mediaInvoke('seek_to', { payload: { positionMs: Math.round(NP.posMs) } });
  saveResume(NP.posMs);
}
setInterval(() => { if (P.on && NP.playing) saveResume(); }, 5000);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveResume(); else if (P.on) pollState(); });

$('#c-play').addEventListener('click', toggle);
$('#c-next').addEventListener('click', next);
$('#c-prev').addEventListener('click', prev);
$('#c-shuffle').addEventListener('click', () => { P.shuffle = !P.shuffle; lsSet('peeky.mob.shuffle', P.shuffle); paintState(); sendSetNext(); });
$('#c-repeat').addEventListener('click', () => { P.repeat = (P.repeat + 1) % 3; lsSet('peeky.mob.repeat', P.repeat); paintState(); sendSetNext(); });

// ------------------------------------------------------------ sleep timer (armed in the service, which pauses at expiry)
const SLEEP_STEPS = [0, 15, 30, 45, 60];
function paintSleep() {
  const left = NP.sleepLeftMs, on = left > 0;
  const btn = $('#sleep');
  btn.classList.toggle('on', on);
  const num = $('#sleepnum');
  num.hidden = !on;
  if (on) num.textContent = Math.max(1, Math.ceil(left / 60000)) + '′';
  btn.title = on ? 'Sleep timer: ' + Math.ceil(left / 60000) + ' min left — tap to change' : 'Sleep timer';
}
$('#sleep').addEventListener('click', () => {
  let cur = 0;
  if (NP.sleepLeftMs > 0) {
    const m = Math.ceil(NP.sleepLeftMs / 60000);
    cur = SLEEP_STEPS.reduce((best, s) => (s >= m && (!best || s < best) ? s : best), 0) || 60;
  }
  const nextMin = SLEEP_STEPS[(SLEEP_STEPS.indexOf(cur) + 1) % SLEEP_STEPS.length];
  mediaInvoke('sleep_timer', { payload: { minutes: nextMin } });
  NP.sleepLeftMs = nextMin > 0 ? nextMin * 60000 : -1;
  showToast(nextMin > 0 ? 'تایمر خواب: ' + nextMin + ' دقیقه' : 'تایمر خواب: خاموش');
  paintSleep();
});

// (no in-app volume row on Android: the hardware volume keys own the media
// stream, and the native player plays at full volume into it)
const ratio = (el, e) => { const r = el.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };

// ------------------------------------------------------------ the list
let query = '', shown = 60, matches = [], lastIdx = -2;
let sortMode = Number(lsGet('peeky.mob.sort', 0)) || 0;   // 0 = scan order, 1 = title, 2 = artist (display only; the queue keeps library order)
const SORT_LABELS = ['Default', 'Title', 'Artist'];
function applyFilter() {
  const q = query.trim().toLowerCase();
  matches = [];
  for (let i = 0; i < P.list.length; i++) if (!q || (cleanMeta(P.list[i].title) + ' ' + cleanMeta(P.list[i].artist)).toLowerCase().includes(q)) matches.push(i);
  if (sortMode) {
    const k = sortMode === 1 ? 'title' : 'artist';
    matches.sort((a, b) => cleanMeta(P.list[a][k]).toLowerCase().localeCompare(cleanMeta(P.list[b][k]).toLowerCase()) || a - b);
  }
  shown = 60; lastIdx = -2; renderList();
}
function paintSort() {
  const b = $('#sortbtn');
  b.innerHTML = I.sort + '<span>' + SORT_LABELS[sortMode] + '</span>';
  b.classList.toggle('on', sortMode > 0);
}
function rowFor(i) {
  const tr = P.list[i];
  const row = document.createElement('div'); row.className = 'row' + (i === P.idx ? ' cur' : ''); row.dataset.i = i;
  const n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1;
  const cov = document.createElement('span'); cov.className = 'cov';
  if (tr.thumb) cov.style.backgroundImage = 'url(' + tr.thumb + ')'; else cov.innerHTML = I.note;
  const t = document.createElement('span'); t.className = 't';
  const b = document.createElement('b'); b.textContent = cleanMeta(tr.title) || tr.title; b.dir = 'auto';
  const a = document.createElement('span'); a.textContent = cleanMeta(tr.artist); a.dir = 'auto';
  t.append(b, a); row.append(n, cov, t);
  row.addEventListener('click', () => { playTrack(i); showPlayer(); });
  return row;
}
function renderList() {
  const list = $('#list'); list.textContent = '';
  if (P.scanning && !P.list.length) { list.innerHTML = '<div class="empty">Reading the phone…</div>'; return; }
  if (!P.list.length) { list.innerHTML = '<div class="empty">No music found yet.<br><br>If Android asks, allow access to audio / storage — Peeky looks in Music, Download and the rest of shared storage. Then tap the rescan button at the top.</div>'; return; }
  if (!matches.length) { list.innerHTML = '<div class="empty">Nothing matches</div>'; return; }
  const frag = document.createDocumentFragment();
  matches.slice(0, shown).forEach((i) => frag.appendChild(rowFor(i)));
  list.appendChild(frag);
}
function updateRow(i) {
  const row = $('#list').querySelector(`.row[data-i="${i}"]`);
  if (!row) return;
  const tr = P.list[i], fresh = rowFor(i);
  row.replaceWith(fresh);
  if (i === P.idx) lastIdx = -2, markNow();
}
$('#list').addEventListener('scroll', () => {
  const l = $('#list');
  if (shown >= matches.length || l.scrollTop + l.clientHeight < l.scrollHeight - 120) return;
  const from = shown; shown = Math.min(matches.length, from + 80);
  for (let k = from; k < shown; k++) l.appendChild(rowFor(matches[k]));
});
function keepInView(row) {
  const l = $('#list'), top = row.offsetTop - l.offsetTop;
  if (top < l.scrollTop) l.scrollTop = top; else if (top + row.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = top + row.offsetHeight - l.clientHeight;
}
function markNow() {
  if (P.idx === lastIdx) return;
  lastIdx = P.idx;
  const list = $('#list'), old = list.querySelector('.row.cur'); if (old) old.classList.remove('cur');
  const cur = list.querySelector(`.row[data-i="${P.idx}"]`);
  if (cur) { cur.classList.add('cur'); if (!query && $('#card').classList.contains('list-on')) keepInView(cur); }
}
$('#q').addEventListener('input', (e) => { query = e.target.value; applyFilter(); });
$('#sortbtn').addEventListener('click', () => { sortMode = (sortMode + 1) % 3; lsSet('peeky.mob.sort', sortMode); paintSort(); applyFilter(); });

// the list learns the real names in the background, two tags at a time (the pill's indexer, adapted)
async function indexOne(i, gen) {
  const tr = P.list[i];
  if (!tr || tr.tagged) return;
  tr.tagged = true;
  const ext = extOf(tr.path);
  if (!/^(mp3|m4a|flac)$/i.test(ext)) return;
  let buf = null;
  try { buf = await call('music_head', { path: tr.path }); } catch { buf = null; }
  if (!buf || gen !== P.scanGen) return;
  if (!(buf instanceof ArrayBuffer)) buf = new Uint8Array(buf).buffer;
  const tags = tagsOf(buf, ext);
  let changed = false;
  if (tags.title && tags.title !== tr.title) { tr.title = tags.title; changed = true; }
  if (tags.artist && tags.artist !== tr.artist) { tr.artist = tags.artist; changed = true; }
  if (tags.title || tags.artist) { tagCache[tr.path] = [tr.title, tr.artist]; saveTagCache(); }
  if (tags.cover) { tr.coverB64 = tags.cover; tr.thumb = await thumbOf(tags.cover); if (tr.thumb) changed = true; }
  if (tags.title || tags.artist || tags.cover) saveLibCache();
  if (!changed || gen !== P.scanGen) return;
  if (P.idx === i) { P.title = cleanMeta(tr.title) || tr.title; P.artist = cleanMeta(tr.artist); if (!P.cover && tr.coverB64) P.cover = tr.coverB64; paintState(); feedAurora(); pushMeta(); }
  updateRow(i);
}
async function indexTags(gen) {
  const queue = P.list.map((tr, i) => i).filter((i) => !P.list[i].tagged);
  let active = 0, at = 0, launched = 0;
  await new Promise((done) => {
    const step = () => {
      if (gen !== P.scanGen) return done();
      while (active < 2 && at < queue.length) {
        const i = queue[at++]; active++; launched++;
        // every few files, hand the main thread back so first paint and scrolling stay smooth
        indexOne(i, gen).then(() => { active--; if (launched % 6 === 0) setTimeout(step, 0); else step(); });
      }
      if (at >= queue.length && !active) done();
    };
    step();
  });
}

async function scan() {
  P.scanning = true; P.scanGen++;
  const gen = P.scanGen;
  renderList();
  let paths = null;
  try { paths = await call('music_scan'); } catch { paths = null; }
  if (gen !== P.scanGen) return;
  if (!Array.isArray(paths)) { P.scanning = false; renderList(); return; }   // scan failed: keep the cached library as-is
  const curPath = P.idx >= 0 && P.list[P.idx] ? P.list[P.idx].path : null;
  const old = new Map(P.list.map((tr) => [tr.path, tr]));
  P.list = paths.map((path) => {
    const prev = old.get(path);
    if (prev) return prev;                       // unchanged file: keep its names, thumb, duration and indexed flag
    const named = nameOf(path), hit = tagCache[path];
    return { path, title: (hit && hit[0]) || named.title, artist: (hit && hit[1]) || named.artist, dur: 0, thumb: '', coverB64: null, tagged: false };
  });
  P.scanning = false;
  if (curPath) { P.idx = P.list.findIndex((t) => t.path === curPath); lastIdx = -2; }
  $('#count').textContent = P.list.length ? P.list.length + ' songs' : '';
  applyFilter(); paintState();
  saveLibCache(true);
  indexTags(gen);                                // the queue only holds tracks that are new or never indexed
}
$('#rescan').addEventListener('click', () => scan());

// ------------------------------------------------------------ waveform seek bar (from player.js)
// The bars are static per song: they are painted once into two offscreen canvases (dim + lit)
// at devicePixelRatio; each frame only blits the dim layer plus the played slice of the lit one.
const wvEl = $('#wave'), wvx = wvEl.getContext('2d');
const wvDim = document.createElement('canvas'), wvLit = document.createElement('canvas');
let wvKey = null, wvBars = [], wvW = 0, wvH = 0, wvN = 0, wvFilled = -1, wvDpr = 1;
function wvBuild(key, n) {
  let a = 2166136261; for (let i = 0; i < key.length; i++) { a ^= key.charCodeAt(i); a = Math.imul(a, 16777619); }
  const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const p1 = rnd() * 6, p2 = rnd() * 6, f1 = .12 + rnd() * .1, f2 = .31 + rnd() * .2;
  wvBars = []; for (let i = 0; i < n; i++) wvBars.push(clamp((.5 + .28 * Math.sin(i * f1 + p1) + .18 * Math.sin(i * f2 + p2)) * (.6 + .4 * rnd()), .12, 1));
}
function wvPaintBase() {
  const W = wvEl.width, H = wvEl.height, n = wvN, d = wvDpr, gap = 2 * d, bw = (W - (n - 1) * gap) / n;
  for (const [cv, color] of [[wvDim, 'rgba(255,255,255,.20)'], [wvLit, '#74E5FF']]) {
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const bh = Math.max(3 * d, wvBars[i] * H), x = i * (bw + gap), y = (H - bh) / 2;
      g.beginPath(); if (g.roundRect) g.roundRect(x, y, bw, bh, Math.min(bw / 2, 2 * d)); else g.rect(x, y, bw, bh); g.fill();
    }
  }
}
function drawWave(r) {
  const w = wvEl.clientWidth, h = wvEl.clientHeight; if (!w || !h) return;
  const key = S.on ? (S.title || '') + '\u0001' + (S.artist || '') : 'peeky', n = Math.max(8, Math.floor((w + 2) / 5)), dpr = window.devicePixelRatio || 1;
  if (w !== wvW || h !== wvH || dpr !== wvDpr) { wvW = w; wvH = h; wvDpr = dpr; wvEl.width = Math.round(w * dpr); wvEl.height = Math.round(h * dpr); wvKey = null; }
  if (key !== wvKey || n !== wvN) { wvKey = key; wvN = n; wvBuild(key, n); wvPaintBase(); wvFilled = -1; }
  const filled = Math.floor(r * n + (r > 0 ? .5 : 0));
  if (filled === wvFilled) return;
  wvFilled = filled;
  wvx.setTransform(1, 0, 0, 1, 0, 0);
  wvx.clearRect(0, 0, wvEl.width, wvEl.height);
  wvx.drawImage(wvDim, 0, 0);
  const fx = Math.round((filled / n) * wvEl.width);
  if (fx > 0) wvx.drawImage(wvLit, 0, 0, fx, wvEl.height, 0, 0, fx, wvEl.height);
}
let scrubbing = false, scrubR = 0;
const seekEl = $('#seek');
seekEl.addEventListener('pointerdown', (e) => { if (!(P.on && S.dur > 0)) return; scrubbing = true; scrubR = ratio(seekEl, e); seekEl.classList.add('drag'); try { seekEl.setPointerCapture(e.pointerId); } catch { /* gone */ } });
seekEl.addEventListener('pointermove', (e) => { if (scrubbing) scrubR = ratio(seekEl, e); });
const seekEnd = (apply) => {
  if (!scrubbing) return;
  scrubbing = false; seekEl.classList.remove('drag');
  if (apply && S.dur > 0) doSeek(scrubR * S.dur);
};
seekEl.addEventListener('pointerup', () => seekEnd(true));
seekEl.addEventListener('pointercancel', () => seekEnd(false));

// ------------------------------------------------------------ lyrics (from player.js; seek goes to the native player)
var L = { on: false, key: '', tok: 0, state: 'idle', data: null, off: 0, active: -2, els: [], ws: [], wt: [], manual: 0, manualAt: 0, timer: 0 };
let WM = 'fill'; try { const m = localStorage.getItem('peeky.lyr.wm'); if (m === 'line' || m === 'fill' || m === 'pop') WM = m; } catch { /* default */ }
const lyEl = $('#lyrics'), lnEl = $('#lines'), lmsg = $('#lmsg'), lpill = $('#lpill'), tmEl = $('#timing');
const lyrKey = () => (S.on && S.title ? S.title + '\u0001' + (S.artist || '') : '');
const offText = (ms) => (ms > 0 ? '+' : ms < 0 ? '−' : '') + (Math.abs(ms) / 1000).toFixed(1) + 's';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const msgBox = (icon, head, text, acts) => `<div class="big">${icon}</div><h3>${esc(head)}</h3><p>${esc(text)}</p>${acts ? '<div class="acts"><button id="l-again">' + I.again + 'Search again</button></div>' : ''}`;
const seekToMs = (ms) => doSeek(clamp(ms, 0, S.dur || 1e9));

function lyrPill() {
  const s = L.state, p = lpill;
  p.hidden = s === 'idle'; p.className = 'lpill';
  p.innerHTML = s === 'search' ? '<i></i>Searching…' : s === 'synced' ? '<i></i>Synced' + (L.off ? ' · ' + offText(L.off) : '') : s === 'plain' ? 'Unsynced' : s === 'instr' ? 'Instrumental' : s === 'error' ? 'Offline' : s === 'none' ? 'No lyrics' : '';
  if (s === 'search') p.classList.add('busy');
  if (s === 'synced') p.classList.add('ok');
  if (s !== 'synced') tmEl.hidden = true;
  $('#tab-lyrics').classList.toggle('has', s === 'synced' || s === 'plain');
  paintTrPill();
}
const mkWord = (txt) => { const w = document.createElement('span'); w.className = 'w'; w.textContent = txt; const f = document.createElement('span'); f.className = 'f'; f.textContent = txt; w.appendChild(f); return { el: w, f }; };
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
      const pause = j < parts.length - 1 && PAUSE.test(p), end = acc + (pause ? p.length + 0.6 : lens[j]);
      ws.push(w); wt.push({ s: t0 + span * acc / total, e: t0 + span * end / total }); acc += lens[j];
    });
  }
  L.ws[i] = ws; L.wt[i] = wt;
}
function setRowWords(i, full) {
  const ws = L.ws[i]; if (!ws) return;
  for (const w of ws) { w.f.style.width = full ? '100%' : '0'; w.el.classList.remove('on'); }
}
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
      const x = document.createElement('span'); x.className = 'x';
      const xl = document.createElement('span'); xl.className = 'xl'; xl.dir = 'auto';
      if (s === 'synced' && WM !== 'line' && text) buildWords(xl, rows, i); else xl.textContent = text || '♪';
      x.appendChild(xl);
      const trt = TR.on && TR.lines ? TR.lines[i] : '';
      if (trt && trt.trim() && trt !== text) { const td = document.createElement('span'); td.className = 'tr'; td.dir = 'rtl'; td.textContent = trt; x.appendChild(td); }
      if (t >= 0) row.append(tm, x); else row.append(x);
      row.style.setProperty('--d', 4);
      frag.appendChild(row); L.els.push(row);
    });
    lnEl.appendChild(frag);
    if (s === 'plain') lyEl.scrollTop = 0;
  } else if (s === 'search') {
    lmsg.innerHTML = '<div class="sker"><i style="width:86%"></i><i style="width:100%"></i><i style="width:62%"></i><i style="width:92%"></i><i style="width:48%"></i></div><p>Matching title, artist, album and length…</p>';
  } else if (s === 'none') lmsg.innerHTML = msgBox(I.nolyrics, 'No lyrics found', 'LRCLIB has nothing for this track yet.', true);
  else if (s === 'error') lmsg.innerHTML = msgBox(I.nolyrics, "Can't reach LRCLIB", 'Check the internet connection and try again.', true);
  else if (s === 'instr') lmsg.innerHTML = msgBox(I.note, 'Instrumental', 'This track has no lyrics.', false);
  else lmsg.innerHTML = msgBox(I.note, 'Nothing playing', 'Play a song to see its lyrics.', false);
}
function setLyr(state) { L.state = state; lyrPill(); lyrRender(); loopPos = -1; }
function applyLyr(r) {
  L.data = r;
  const rd = r && r.dur > 0 && S.dur > 0 ? (S.dur / 1000) / r.dur : 1;      // a slowed / sped-up copy of the song: stretch the
  if (r && r.synced && rd > 0.7 && rd < 1.45 && Math.abs(rd - 1) > 0.03)    // line stamps (and word stamps) by the same ratio
    L.data = { ...r, synced: r.synced.map(([t, x, w]) => [Math.round(t * rd), x, w ? w.map(([wt, wx]) => [Math.round(wt * rd), wx]) : w]) };
  if (r.instrumental) setLyr('instr');
  else if (r.synced && r.synced.length) setLyr('synced');
  else if (r.plain) { r.plain = Array.isArray(r.plain) ? r.plain : Lyr.parsePlain(r.plain); setLyr('plain'); }
  else setLyr('none');
  if (TR.on) trRun();
}
async function lyrSearch(tok) {
  try {
    const r = await Lyr.find(S.title, S.artist, S.dur / 1000);
    if (tok !== L.tok) return;
    if (r) { Lyr.store.put(L.key, r); applyLyr(r); } else setLyr('none');
  } catch { if (tok === L.tok) setLyr('error'); }
}
function lyrTrack(force) {
  const key = lyrKey();
  if (key === L.key && !force) return;
  L.key = key; L.tok++; TR.tok++; TR.lines = null; TR.failed = false; clearTimeout(L.timer); L.data = null; L.off = key ? Lyr.store.offset(key) : 0;
  if (!key) { setLyr('idle'); return; }
  const c = Lyr.store.get(key);
  if (c) { if (c.plain && !Array.isArray(c.plain)) c.plain = Lyr.parsePlain(c.plain); applyLyr(c); return; }
  setLyr('search');
  const tok = L.tok; L.timer = setTimeout(() => lyrSearch(tok), 450);
}
function lyrAgain() { Lyr.store.drop(L.key); lyrTrack(true); }
const LEAD = 90;
function lyrTick(pos) {
  if (!L || !L.on || L.state !== 'synced') return;
  const rows = L.data.synced, at = pos + LEAD - L.off;
  let lo = 0, hi = rows.length - 1, idx = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (rows[mid][0] <= at) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  if (L.manual && performance.now() - L.manualAt > 2600) { L.manual = 0; lyrScroll(); }
  if (idx !== L.active) lyrPick(idx); else lyrWords(idx, at);
}
function lyrWords(idx, at) {
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
let dragY = null, dragMoved = 0;
lyEl.addEventListener('pointerdown', (e) => { dragY = e.clientY; dragMoved = 0; });
lyEl.addEventListener('pointermove', (e) => {
  if (dragY === null || L.state !== 'synced') return;
  const dy = e.clientY - dragY; dragY = e.clientY; dragMoved += Math.abs(dy);
  L.manual = clamp(L.manual + dy, -lnEl.offsetHeight, lnEl.offsetHeight); L.manualAt = performance.now(); lyrScroll();
});
lyEl.addEventListener('pointerup', () => { dragY = null; });
lyEl.addEventListener('pointercancel', () => { dragY = null; });
lyEl.addEventListener('wheel', (e) => {
  if (L.state !== 'synced') return;
  e.preventDefault();
  L.manual = clamp(L.manual - e.deltaY, -lnEl.offsetHeight, lnEl.offsetHeight); L.manualAt = performance.now(); lyrScroll();
}, { passive: false });
lnEl.addEventListener('click', (e) => {
  if (dragMoved > 8) return;
  const row = e.target.closest('.ln'); if (!row || L.state !== 'synced') return;
  const ms = clamp(L.data.synced[Number(row.dataset.i)][0] + L.off, 0, S.dur || 1e9);
  seekToMs(ms); L.manual = 0;
});
lmsg.addEventListener('click', (e) => { if (e.target.closest('#l-again')) lyrAgain(); });
function nudge(ms) {
  L.off = clamp(Math.round((L.off + ms) / 100) * 100, -15000, 15000);
  Lyr.store.setOffset(L.key, L.off);
  $('#t-val').textContent = offText(L.off); lyrPill(); lpill.classList.toggle('on', !tmEl.hidden); L.active = -2;
}
lpill.addEventListener('click', () => {
  if (L.state !== 'synced') return;
  tmEl.hidden = !tmEl.hidden; $('#t-val').textContent = offText(L.off); lpill.classList.toggle('on', !tmEl.hidden);
});
$('#t-minus').addEventListener('click', () => nudge(-100));
$('#t-plus').addEventListener('click', () => nudge(100));
$('#t-reset').addEventListener('click', () => nudge(-L.off));
const wmBtns = [...document.querySelectorAll('#wmseg button')], paintWm = () => wmBtns.forEach((b) => b.classList.toggle('on', b.dataset.m === WM));
wmBtns.forEach((b) => b.addEventListener('click', () => {
  WM = b.dataset.m; try { localStorage.setItem('peeky.lyr.wm', WM); } catch { /* not remembered */ }
  paintWm(); lyrRender(); lyrScroll();
}));
paintWm();
document.addEventListener('pointerdown', (e) => { if (!tmEl.hidden && !e.target.closest('#timing, #lpill')) { tmEl.hidden = true; lpill.classList.remove('on'); } });

// ------------------------------------------------------------ Persian translation of the lyrics (on demand, this track only)
// Latin-script lines are sent to the free Google Translate endpoint in ≤1200-char chunks;
// each translation renders as a small dim RTL line under its original. Already-Persian/Arabic
// lyrics are left alone. Results are cached per track in localStorage.
const TR = { on: !!lsGet('peeky.mob.tr', false), lines: null, key: '', tok: 0, busy: false, failed: false, skipped: false };
const tpill = $('#tpill');
const trCache = (() => { try { return JSON.parse(localStorage.getItem('peeky.tr.v1') || '{}'); } catch { return {}; } })();
const hasFaScript = (s) => /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(s);
const hasLatin = (s) => /[A-Za-z]/.test(s);
function paintTrPill() {
  const usable = L.state === 'synced' || L.state === 'plain';
  tpill.hidden = !usable;
  tpill.classList.toggle('on', TR.on);
  tpill.classList.toggle('bad', TR.on && TR.failed);
  tpill.textContent = TR.busy ? 'ترجمه…' : 'ترجمه';
  tpill.title = TR.failed ? "Couldn't translate — tap to turn off" : 'Persian translation under each line';
}
function lyrTexts() {
  if (!L.data) return [];
  if (L.state === 'synced') return L.data.synced.map((r) => r[1] || '');
  if (L.state === 'plain') return (Array.isArray(L.data.plain) ? L.data.plain : []).map((t) => Array.isArray(t) ? (t[1] || '') : String(t || ''));
  return [];
}
async function trFetchChunk(lines) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=fa&dt=t&q=' + encodeURIComponent(lines.join('\n'));
  const r = await fetch(url);
  if (!r.ok) throw new Error('http ' + r.status);
  const j = await r.json();
  return (j[0] || []).map((seg) => (seg && seg[0]) || '').join('').split('\n');
}
async function trRun() {
  const guard = ++TR.tok;
  const texts = lyrTexts();
  const key = (S.title || '') + '\u0001' + (S.artist || '') + '\u0001' + Math.round((S.dur || 0) / 1000);
  if (!texts.length) return;
  if (key === TR.key && (TR.lines || TR.failed || TR.skipped)) return;
  if (texts.some((t) => hasFaScript(t)) || !texts.some((t) => hasLatin(t))) { TR.key = key; TR.skipped = true; TR.lines = null; paintTrPill(); return; }
  if (trCache[key]) { TR.key = key; TR.skipped = false; TR.failed = false; TR.lines = trCache[key]; paintTrPill(); lyrRender(); loopPos = -1; return; }
  TR.busy = true; TR.failed = false; paintTrPill();
  let requests = 0;
  try {
    const chunks = []; let cur = [], len = 0;
    for (const t of texts) { const l = t.length + 1; if (len + l > 1200 && cur.length) { chunks.push(cur); cur = []; len = 0; } cur.push(t); len += l; }
    if (cur.length) chunks.push(cur);
    const out = [];
    for (const chunk of chunks) {
      let got = null;
      if (requests < 60) { requests++; got = await trFetchChunk(chunk).catch(() => null); }
      if (guard !== TR.tok) return;
      if (!got || got.length !== chunk.length) {           // line count drifted: redo this chunk line by line
        got = [];
        for (const line of chunk) {
          if (!line.trim() || line === '♪') { got.push(''); continue; }
          if (requests >= 60) { got.push(''); continue; }
          requests++;
          const one = await trFetchChunk([line]).catch(() => null);
          if (guard !== TR.tok) return;
          got.push(one ? one.join(' ') : '');
        }
      }
      out.push(...got);
    }
    texts.forEach((t, i) => { if (!t.trim() || t === '♪') out[i] = ''; });
    TR.key = key; TR.skipped = false; TR.lines = out;
    trCache[key] = out;
    try { localStorage.setItem('peeky.tr.v1', JSON.stringify(trCache)); } catch { /* full or blocked */ }
  } catch { if (guard === TR.tok) { TR.key = key; TR.failed = true; TR.lines = null; } }
  if (guard !== TR.tok) return;
  TR.busy = false; paintTrPill();
  if (TR.lines) { lyrRender(); loopPos = -1; }
}
tpill.addEventListener('click', () => {
  TR.on = !TR.on; lsSet('peeky.mob.tr', TR.on);
  TR.failed = false;
  paintTrPill();
  if (TR.on) { TR.key = ''; trRun(); }
  else { TR.tok++; TR.lines = null; lyrRender(); loopPos = -1; }
});

// ------------------------------------------------------------ views (tabs)
const card = $('#card');
function setTab(name) {
  card.classList.toggle('lyr-on', name === 'lyrics');
  card.classList.toggle('list-on', name === 'list');
  $('#tab-player').classList.toggle('on', name === 'player');
  $('#tab-lyrics').classList.toggle('on', name === 'lyrics');
  $('#tab-list').classList.toggle('on', name === 'list');
  L.on = name === 'lyrics';
  if (L.on) {
    Lyr.store.flag('used', true);
    if (L.state === 'idle' && L.key) lyrTrack(true); else { lyrRender(); lyrPill(); }
    L.active = -2;
    requestAnimationFrame(lyrScroll);
  } else tmEl.hidden = true;
  if (name === 'list') markNow();
}
function showPlayer() { setTab('player'); }
$('#tab-player').addEventListener('click', () => setTab('player'));
$('#tab-lyrics').addEventListener('click', () => setTab('lyrics'));
$('#tab-list').addEventListener('click', () => setTab('list'));

// ------------------------------------------------------------ the frame loop
let loopPos = -1, loopSec = -1;
(function loop() {
  requestAnimationFrame(loop);
  if (document.hidden) return;                       // nothing visible to paint; rAF throttles anyway
  const dur = NP.durMs > 0 ? NP.durMs : (P.idx >= 0 && P.list[P.idx] ? P.list[P.idx].dur || 0 : 0);
  S.dur = dur;
  S.playing = P.on && NP.playing;
  const pos = scrubbing ? scrubR * dur : clamp(npPos(), 0, dur || 0);
  if (!S.playing && !scrubbing && pos === loopPos) return;   // paused and unmoved: skip all repaint work
  loopPos = pos;
  drawWave(dur > 0 ? pos / dur : 0);
  lyrTick(pos);
  const sec = Math.floor(pos / 1000);
  if (sec !== loopSec) { loopSec = sec; $('#t-now').textContent = fmt(pos); $('#t-all').textContent = fmt(dur); }
})();

// ------------------------------------------------------------ boot: cached library first, rescan behind it
paintState();
setLyr('idle');
paintSort();
paintSleep();
(async () => {
  const cueResume = () => {
    try {
      const r = lsGet('peeky.mob.resume', null);
      if (r && r.path) {
        const i = P.list.findIndex((t) => t.path === r.path);
        if (i >= 0) playTrack(i, false, r.pos || 0);
      }
    } catch { /* nothing to resume */ }
  };
  // the service may still be playing from before this UI existed (the app was
  // swiped away, the WebView died, the user came back): adopt its track —
  // position, lyrics and queue re-sync from it — instead of restarting anything
  const adoptFromService = async () => {
    try {
      const st = await mediaCall('state');
      if (st && st.path && P.list.some((t) => t.path === st.path)) { npSync(st); adoptByPath(st.path, st); return true; }
    } catch { /* service not running */ }
    return false;
  };
  if (loadLibCache()) { if (!(await adoptFromService())) cueResume(); scan(); }   // instant list from the cache; the rescan only diffs in the background
  else { await scan(); if (!(await adoptFromService())) cueResume(); }            // first launch ever: nothing cached yet
})();
})();
