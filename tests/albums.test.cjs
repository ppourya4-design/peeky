const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('ui/app.js', 'utf8');
const parsers = source.slice(source.indexOf('function id3Text('), source.indexOf('// --- the list learns the real names'));
const context = { TextDecoder, Uint8Array, DataView, ArrayBuffer, btoa, window: {} };
vm.createContext(context);
vm.runInContext(parsers + '\nwindow.tagsOf = tagsOf;', context);
vm.runInContext(fs.readFileSync('ui/albums.js', 'utf8'), context);
const bytes = b => Uint8Array.from(b).buffer;
const be = n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
const le = n => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255];
const chars = s => [...Buffer.from(s, 'latin1')];
const utf = s => [...Buffer.from(s, 'utf8')];
const atom = (name, body) => [...be(body.length + 8), ...chars(name), ...body];

test('reads album and album artist from ID3v2, MP4, and FLAC', () => {
  const frame = (id, text) => { const body = [3, ...utf(text)]; return [...chars(id), ...be(body.length), 0, 0, ...body]; };
  const frames = [...frame('TALB', 'Record'), ...frame('TPE1', 'Singer'), ...frame('TPE2', 'Band')];
  const id3 = [...chars('ID3'), 3, 0, 0, 0, 0, 0, frames.length, ...frames];
  const mp4text = (name, value) => atom(name, atom('data', [...be(1), ...be(0), ...utf(value)]));
  const mp4 = atom('moov', atom('udta', atom('meta', [0, 0, 0, 0, ...atom('ilst', [...mp4text('©alb', 'Record'), ...mp4text('©ART', 'Singer'), ...mp4text('aART', 'Band')])] )));
  const comments = ['ALBUM=Record', 'ARTIST=Singer', 'ALBUMARTIST=Band'];
  const body = [...le(0), ...le(comments.length), ...comments.flatMap(s => [...le(utf(s).length), ...utf(s)])];
  const flac = [...chars('fLaC'), 0x84, body.length >> 16, body.length >> 8 & 255, body.length & 255, ...body];
  for (const [ext, data] of [['mp3', id3], ['m4a', mp4], ['flac', flac]]) {
    const tags = context.window.tagsOf(bytes(data), ext);
    assert.equal(tags.album, 'Record', ext); assert.equal(tags.artist, 'Singer', ext); assert.equal(tags.albumArtist, 'Band', ext);
  }
});

test('groups by album and album artist, preserving original indices and loose tracks', () => {
  const tracks = [{album:'A', albumArtist:'Band', tagArtist:'One'}, {album:'A', tagArtist:'Other'}, {}, {album:'A', albumArtist:'Band', tagArtist:'Two'}, {album:'B'}];
  const groups = context.window.albumGroups(tracks, [0, 1, 2, 3, 4]);
  assert.deepEqual(JSON.parse(JSON.stringify(groups.map(g => g.indices))), [[0, 3], [1], [2], [4]]);
  assert.equal(groups[2].key, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.albumGroups(tracks, [3, 4]).map(g => g.indices))), [[3], [4]]);
});
