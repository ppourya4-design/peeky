/* The page's only door to the Rust side: window.qazi */
(() => {
'use strict';
const { invoke } = window.__TAURI__.core, { listen } = window.__TAURI__.event;
const on = (ev) => (cb) => { listen(ev, (e) => cb(e.payload)); };
const quiet = (p) => p.catch(() => {});

// dropped files come without paths; the host turns the file objects back into paths
let dropSeq = 0;
const dropWait = new Map();
listen('drop-paths', (e) => { const done = dropWait.get(e.payload.token); if (done) { dropWait.delete(e.payload.token); done(e.payload.paths || []); } });

window.qazi = {
  onCursor: on('cursor'), onHelper: on('helper'), onSettings: on('settings'), onClip: on('clip'), onDownload: on('download'),
  onShelf: on('shelf'), onShelfDragging: on('shelf-dragging'), onClips: on('clips'), onLevels: on('levels'),
  onPress: on('press'), onRelease: on('release'), onOpen: on('open'), onHotkey: on('hotkey'), onNotes: on('notes'), onVault: on('vault'), onOcr: on('ocr'), onOcrRead: on('ocr-read'), onSpeedo: on('speedo'), onPlayer: on('player'), onPlayerCmd: on('player-cmd'),

  setInteractive: (v) => quiet(invoke('set_interactive', { on: !!v })),
  setTyping: (v, restore) => invoke('set_typing', { on: !!v, restore: !!restore }).catch(() => ({})),
  lostClick: (info) => quiet(invoke('lost_click', { info: String(info) })),

  media: (cmd) => quiet(invoke('media', { cmd })),
  seek: (ms) => quiet(invoke('seek', { ms })),
  setVolume: (v) => quiet(invoke('set_volume', { v })),
  toggleMute: () => quiet(invoke('toggle_mute')),
  setViz: (v) => quiet(invoke('set_viz', { on: !!v })),

  activate: (id, aumid) => quiet(invoke('notif_act', { id: String(id), aumid: aumid || '' })),
  dismiss: (id) => quiet(invoke('notif_dismiss', { id: String(id) })),
  clearNotifs: () => quiet(invoke('notif_clear')),
  hintShown: () => quiet(invoke('settings_set', { key: 'dndHint', value: true })),

  pathsFor(files) {
    return new Promise((resolve) => {
      const list = [...files];
      if (!list.length || !(window.chrome && chrome.webview && chrome.webview.postMessageWithAdditionalObjects)) { resolve(list.map(() => '')); return; }
      const token = 'd' + (++dropSeq);
      dropWait.set(token, resolve);
      setTimeout(() => { if (dropWait.delete(token)) resolve(list.map(() => '')); }, 1500);
      try { chrome.webview.postMessageWithAdditionalObjects('island-drop:' + token, list); } catch { dropWait.delete(token); resolve(list.map(() => '')); }
    });
  },
  shelfAdd: (paths) => invoke('shelf_add', { paths }),
  shelfAddData: (name, type, buf) => invoke('shelf_add_data', new Uint8Array(buf), { headers: { 'x-name': encodeURIComponent(name || ''), 'x-type': encodeURIComponent(type || '') } }),
  shelfAddUrl: (url) => invoke('shelf_add_url', { url }),
  shelfGet: () => invoke('shelf_get'),
  shelfRemove: (path) => quiet(invoke('shelf_remove', { path })),
  shelfClear: () => quiet(invoke('shelf_clear')),
  shelfReveal: (path) => quiet(invoke('shelf_reveal', { path })),
  shelfDrag: (paths) => quiet(invoke('shelf_drag', { paths })),
  openDownload: (path) => quiet(invoke('open_download', { path })),

  clipsGet: () => invoke('clips_get'),
  clipCopy: (id) => quiet(invoke('clip_copy', { id })),
  clipPin: (id) => quiet(invoke('clip_pin', { id })),
  clipRemove: (id) => quiet(invoke('clip_remove', { id })),
  clipsClear: () => quiet(invoke('clips_clear')),
  copy: (text) => quiet(invoke('copy_text', { text })),

  getSettings: () => invoke('settings_get'),
  monitorsGet: () => invoke('monitors_get').catch(() => []),
  setSetting: (key, value) => quiet(invoke('settings_set', { key, value })),
  setCalendar: (value) => quiet(invoke('settings_set', { key: 'calendar', value })),
  action: (name) => quiet(invoke('action', { name })),
  ocrDone: (text, conf) => quiet(invoke('ocr_done', { text: String(text || ''), conf: Number(conf) || 0 })),
  speedo: (cmd, more) => invoke('speedo_cmd', { cmd, ...(more || {}) }).catch(() => ({ ok: false })),
  updateCheck: () => invoke('update_check').catch(() => 'failed'),
  updateInstall: () => invoke('update_install').catch(() => false),
  openUrl: (url) => quiet(invoke('open_url', { url })),

  notesGet: () => invoke('notes_get'),
  noteSave: (id, text, remind) => invoke('note_save', { id: id || null, text, remind: remind || 0 }),
  notePin: (id) => invoke('note_pin', { id }),
  noteFired: (id) => invoke('note_fired', { id }),
  noteRemove: (id) => invoke('note_remove', { id }),

  vaultList: () => invoke('vault_list'),
  vaultGenerate: (len, symbols) => invoke('vault_generate', { len, symbols: !!symbols }),
  vaultSave: (site, user, pass) => invoke('vault_save', { site, user, pass }),
  vaultCopy: (id, what) => invoke('vault_copy', { id, what }),
  copySecret: (text) => invoke('copy_secret', { text }),
  vaultReveal: (id) => invoke('vault_reveal', { id }),
  vaultRemove: (id) => invoke('vault_remove', { id }),

  musicPick: () => invoke('music_pick').catch(() => null),
  musicScan: () => invoke('music_scan').catch(() => []),
  musicRead: (path) => invoke('music_read', { path }),
  musicHead: (path) => invoke('music_head', { path }),
  playerOpen: () => quiet(invoke('player_open')),
  playerKill: () => quiet(invoke('player_kill')),
  playerSend: (name, payload) => quiet(window.__TAURI__.event.emit(name, payload)),
};
window.addEventListener('error', (e) => quiet(invoke('debug_out', { text: '[page error] ' + e.message + ' @' + e.lineno })));
})();
