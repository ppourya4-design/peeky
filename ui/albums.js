/* Presentation-only album grouping. Track indices continue to refer to the flat playback queue. */
window.albumGroups = (tracks, indices) => {
  const groups = [], byKey = new Map();
  for (const i of indices) {
    const tr = tracks[i], album = (tr.album || '').trim();
    if (!album) { groups.push({ indices: [i] }); continue; }
    const key = JSON.stringify([album, (tr.albumArtist || tr.tagArtist || '').trim()]);
    let group = byKey.get(key);
    if (!group) { group = { key, album, indices: [] }; byKey.set(key, group); groups.push(group); }
    group.indices.push(i);
  }
  return groups;
};
