/* Lyrics from LRCLIB (https://lrclib.net): lookup, .lrc parsing, and a small cache.
   Nothing is sent but the title, the artist and the length of the song that is playing. */
(() => {
'use strict';
const API = 'https://lrclib.net/api';

// ---- parsing
// "[01:23.45] some words"  (several stamps per line allowed, [offset:±ms] honoured, [ar:..] style tags ignored)
function parseLRC(text) {
  const out = []; let offset = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    let line = raw.trim(); if (!line) continue;
    const om = line.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
    if (om) { offset = parseInt(om[1], 10) || 0; continue; }
    const stamps = []; let m;
    while ((m = line.match(/^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/))) {
      stamps.push(parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000 + (m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) : 0));
      line = line.slice(m[0].length);
    }
    if (!stamps.length) continue;
    // "enhanced" LRC carries a stamp before every word: <00:12.40>word <00:12.90>next. Keep those; plain LRC gets estimated word timing in the player.
    let words = null;
    if (/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/.test(line)) {
      words = []; const re = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>([^<]*)/g; let wm;
      while ((wm = re.exec(line))) {
        if (!wm[4].trim()) continue;
        words.push([Math.max(0, parseInt(wm[1], 10) * 60000 + parseInt(wm[2], 10) * 1000 + (wm[3] ? parseInt(wm[3].padEnd(3, '0').slice(0, 3), 10) : 0) - offset), wm[4]]);
      }
      if (!words.length) words = null;
    }
    const txt = line.replace(/<\d+:\d+(?:[.:]\d+)?>/g, '').trim();
    for (const t of stamps) out.push(words ? [Math.max(0, t - offset), txt, words] : [Math.max(0, t - offset), txt]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
const parsePlain = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).join('\n').replace(/^\n+|\n+$/g, '').split('\n');

// ---- lookup
const clean = (s) => String(s || '')
  .replace(/\.(mp3|m4a|flac|wav|ogg|opus|aac|wma)$/i, '')
  .replace(/^\s*\d{1,3}\s*[-._)]\s*/, '')
  .replace(/[(\[][^)\]]*(feat|ft\.|official|lyrics?|audio|video|remaster|live|hd|hq|visuali[sz]er|slowed|reverb|sped|nightcore|remix|bass\s*boosted|\d{4})[^)\]]*[)\]]/gi, '')
  .replace(/\s*[-–—]\s*(slowed|sped up|nightcore|reverb).*$/i, '')
  .replace(/\s+/g, ' ').trim();
async function jget(url) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}
const usable = (r) => r && (r.syncedLyrics || r.plainLyrics || r.instrumental);
function pick(list, dur) {                    // the right song, not just a song with the same name: closest length first, synced first.
  const cands = (Array.isArray(list) ? list : []).filter(usable);   // Community uploads (Persian tracks especially) often carry a
  for (const gate of [6, 20, Infinity]) {                            // very different length, so a hard gate finds nothing at all:
    let best = null, bs = -1e9;                                       // widen it, and only as a last resort take the best name match.
    for (const r of cands) {
      const known = dur > 0 && r.duration > 0, dd = known ? Math.abs(r.duration - dur) : 0;
      if (known && dd > gate) continue;
      const sc = (r.syncedLyrics ? 100 : 0) - Math.min(dd, 120) * 2;
      if (sc > bs) { bs = sc; best = r; }
    }
    if (best) return best;
  }
  return null;
}
async function find(title, artist, dur) {     // dur in seconds (0 = unknown)
  const t = clean(title), a = clean(artist);
  if (!t) return null;
  let hit = null;
  if (a) {                                    // 1. the exact lookup — without the length first: LRCLIB 404s the whole lookup
    hit = await jget(`${API}/get?${new URLSearchParams({ track_name: t, artist_name: a })}`);   // when the length is off, and
    if (!usable(hit)) hit = null;             // community lengths are often off by a lot
    if (!hit && dur >= 1 && dur <= 3600) {
      hit = await jget(`${API}/get?${new URLSearchParams({ track_name: t, artist_name: a, duration: String(Math.round(dur)) })}`);
      if (!usable(hit)) hit = null;
    }
  }
  if (!hit) {                                 // 2. a search by name, picked by length
    const u = new URLSearchParams({ track_name: t }); if (a) u.set('artist_name', a);
    hit = pick(await jget(`${API}/search?${u}`), dur);
  }
  if (!hit) hit = pick(await jget(`${API}/search?${new URLSearchParams({ q: (a + ' ' + t).trim() })}`), dur);      // 3. loosest
  if (!hit) return null;
  const synced = hit.syncedLyrics ? parseLRC(hit.syncedLyrics) : [];
  return { src: 'lrclib', synced: synced.length ? synced : null, plain: hit.plainLyrics || null, dur: hit.duration || 0, instrumental: !!hit.instrumental && !synced.length && !hit.plainLyrics };
}

// ---- cache (this window's own storage; the newest 150 songs are kept)
const P = 'peeky.lyr.';
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(P + 'd.' + key)); } catch { return null; } },
  put(key, val) {
    try {
      localStorage.setItem(P + 'd.' + key, JSON.stringify(val));
      let idx = JSON.parse(localStorage.getItem(P + 'idx') || '[]').filter((k) => k !== key); idx.push(key);
      while (idx.length > 150) localStorage.removeItem(P + 'd.' + idx.shift());
      localStorage.setItem(P + 'idx', JSON.stringify(idx));
    } catch { /* storage full or blocked: lyrics just are not remembered */ }
  },
  drop(key) { try { localStorage.removeItem(P + 'd.' + key); } catch { /* ignore */ } },
  offset(key) { try { return parseInt(localStorage.getItem(P + 'o.' + key), 10) || 0; } catch { return 0; } },
  setOffset(key, ms) { try { if (ms) localStorage.setItem(P + 'o.' + key, String(ms)); else localStorage.removeItem(P + 'o.' + key); } catch { /* ignore */ } },
  flag(name, set) { try { if (set) localStorage.setItem(P + 'f.' + name, '1'); return localStorage.getItem(P + 'f.' + name) === '1'; } catch { return false; } },
};
window.Lyr = { parseLRC, parsePlain, find, store };
})();
