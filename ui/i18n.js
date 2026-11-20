/* Interface language: English (the strings the code is written in) and Persian.
 *
 * The page keeps writing English. This file turns it into Persian after the fact: `t(text)` for strings that are
 * about to be shown, and a MutationObserver that translates whatever text / title / placeholder lands in the DOM.
 * Switching back to English restores the original text. A string that is not in the table is left as it is, so a
 * missing translation never breaks anything — add it to FA below.
 *
 * Loaded by both windows (the pill and the player). It reads the "lang" setting by itself and follows changes.
 */
(() => {
'use strict';

// ------------------------------------------------------------ the Persian table (English -> Persian)
const FA = {
  // ---- tray / buttons (index.html)
  'Another one': 'یکی دیگر',
  'More tools': 'ابزارهای بیشتر',
  'Fold extra tools behind an arrow': 'جمع کردن ابزارهای اضافه پشت فلش',
  'Clipboard': 'کلیپ‌بورد',
  'Notes': 'یادداشت‌ها',
  'Back to now playing': 'بازگشت به پخش فعلی',
  'Cancel (Esc)': 'لغو (Esc)',
  'Click to mute': 'برای بی‌صدا کردن کلیک کن',
  'Click to switch calendar': 'برای عوض کردن تقویم کلیک کن',
  'Open the calendar': 'باز کردن تقویم',
  'Today': 'امروز',
  'Reminder for this day…  “18:30 gym”': 'یادآور برای این روز…  «۱۸:۳۰ باشگاه»',
  'Add a reminder': 'افزودن یادآور',
  'That time has passed': 'این ساعت گذشته است',
  'Reminder set': 'یادآور ثبت شد',
  'Clipboard history': 'تاریخچهٔ کلیپ‌بورد',
  'File shelf — click to see the files, drag this button to take them all': 'قفسهٔ فایل — برای دیدن فایل‌ها کلیک کن، این دکمه را بکش تا همه را برداری',
  'Grab text from the screen: drag a box around it (Ctrl+Alt+T)': 'خواندن متن از صفحه: دورش کادر بکش (Ctrl+Alt+T)',
  'Keep (Enter)': 'نگه دار (Enter)',
  'Less': 'کمتر',
  'Longer': 'بلندتر',
  'Main menu': 'منوی اصلی',
  'Menu': 'منو',
  'More': 'بیشتر',
  'Next': 'بعدی',
  'Notifications': 'اعلان‌ها',
  'Passwords': 'رمزها',
  'Play / Pause': 'پخش / توقف',
  'Previous': 'قبلی',
  'Quick note (Ctrl+Alt+N)': 'یادداشت سریع (Ctrl+Alt+N)',
  'Reset': 'بازنشانی',
  'Screenshot': 'اسکرین‌شات',
  'Settings': 'تنظیمات',
  'Shorter': 'کوتاه‌تر',
  'Show all the files': 'نمایش همهٔ فایل‌ها',
  'Speedo VPN': 'Speedo VPN',
  'Start / Pause': 'شروع / توقف',
  'Stop and clear the music': 'توقف و پاک کردن موزیک',
  'Symbols on / off': 'نمادها روشن / خاموش',
  'Timer': 'تایمر',
  'Use it: copies it, then asks where it is for': 'استفاده: کپی می‌کند و می‌پرسد برای کجاست',
  'Volume': 'صدا',
  'Your music: pick a folder and play it here': 'موزیک تو: یک پوشه انتخاب کن و همین‌جا پخش کن',
  'Nothing playing': 'چیزی پخش نمی‌شود',
  'Drop to hold': 'رها کن تا نگه دارم',

  // ---- status lines, notifications
  'Back online': 'دوباره آنلاین شد',
  'No connection': 'اتصالی نیست',
  'No internet': 'اینترنت نیست',
  'Offline': 'آفلاین',
  'Internet': 'اینترنت',
  'Proxy': 'پراکسی',
  'VPN': 'VPN',
  'On': 'روشن',
  'Off': 'خاموش',
  'A system proxy is on': 'پراکسی سیستم روشن است',
  'Camera': 'دوربین',
  'Microphone': 'میکروفون',
  'Battery': 'باتری',
  'Low battery': 'باتری کم است',
  'Charging': 'در حال شارژ',
  'On battery': 'روی باتری',
  'Download finished': 'دانلود تمام شد',
  'Copied': 'کپی شد',
  'Copied — paste with Ctrl+V': 'کپی شد — با Ctrl+V بچسبان',
  'Text copied': 'متن کپی شد',
  'Text grab': 'خواندن متن',
  'Nothing found': 'چیزی پیدا نشد',
  'Reading…': 'در حال خواندن…',
  'One moment…': 'یک لحظه…',
  'Could not copy': 'کپی نشد',
  'Could not do that': 'انجامش ندادم',
  'Could not save': 'ذخیره نشد',
  'Could not check': 'بررسی نشد',
  'Could not connect': 'وصل نشد',
  'Can\'t hold that': 'این را نمی‌شود نگه داشت',
  'only files and pictures': 'فقط فایل و عکس',
  'Time is up': 'وقت تمام شد',
  'Noted': 'یادداشت شد',
  'Reminded': 'یادآوری شد',
  'Reminder': 'یادآور',
  'Saved': 'ذخیره شد',
  'Not saved': 'ذخیره نشد',
  'New password': 'رمز جدید',
  'Password copied — clears in 30s': 'رمز کپی شد — ۳۰ ثانیه دیگر پاک می‌شود',
  'Username copied': 'نام کاربری کپی شد',
  'the password is still on your clipboard': 'رمز هنوز روی کلیپ‌بورد است',
  'Saved passwords could not be opened on this account': 'رمزهای ذخیره‌شده با این حساب باز نشدند',
  'Welcome': 'خوش آمدی',
  "Hi, I'm Poyzen": 'سلام، من Poyzen هستم',
  'Click to see what I can do': 'برای دیدن کارهایی که بلدم کلیک کن',
  'Tip': 'نکته',
  'Banners only here?': 'اعلان‌ها فقط همین‌جا؟',
  'Click, then switch on "Do not disturb"': 'کلیک کن و «مزاحم نشوید» را روشن کن',
  'Update': 'به‌روزرسانی',
  'click to install and restart': 'برای نصب و راه‌اندازی دوباره کلیک کن',
  'Holding': 'نگه داشته شد',
  'drag them out from here': 'از همین‌جا بیرونشان بکش',
  'Drop files on the pill to hold them': 'فایل‌ها را روی جزیره رها کن تا نگه داشته شوند',
  'No notifications': 'اعلانی نیست',
  'Nothing noted yet — type and press Enter': 'هنوز چیزی ننوشته‌ای — بنویس و Enter بزن',
  'Whatever you copy shows up here': 'هر چیزی که کپی کنی اینجا می‌آید',
  'Jot it down…  “call Ali in 20m” reminds you': 'بنویس…  «۱۰ دقیقه دیگه چای» یادآوری می‌شود',
  'What is it for?  (site or app)': 'برای چیست؟ (سایت یا برنامه)',
  'Email or username': 'ایمیل یا نام کاربری',
  'Type or paste the password': 'رمز را بنویس یا بچسبان',
  'Enter': 'Enter',
  'Escape': 'Esc',

  // ---- lists and row tooltips
  'Add existing': 'افزودن از قبلی‌ها',
  'Clear all': 'پاک کردن همه',
  'Clear history': 'پاک کردن تاریخچه',
  'Clear shelf': 'خالی کردن قفسه',
  'Click again to delete': 'برای حذف دوباره کلیک کن',
  'Click to copy it again': 'برای کپی دوباره کلیک کن',
  'Click to copy the password (it leaves the clipboard after 30 seconds)': 'برای کپی رمز کلیک کن (بعد از ۳۰ ثانیه از کلیپ‌بورد پاک می‌شود)',
  'Click to copy — double-click to edit': 'برای کپی کلیک کن — برای ویرایش دوبار کلیک کن',
  'Copy the email / username': 'کپی ایمیل / نام کاربری',
  'Show the password for a moment': 'نمایش لحظه‌ای رمز',
  'Delete': 'حذف',
  'Dismiss': 'بستن',
  'Remove': 'برداشتن',
  'Let go of it (the file itself is not touched)': 'رهایش کن (خود فایل دست‌نخورده می‌ماند)',
  'Take off the shelf (the file itself is not touched)': 'از قفسه بردار (خود فایل دست‌نخورده می‌ماند)',
  'Drag this out to drop the file somewhere — click to show it in its folder': 'برای انداختن فایل جای دیگر بیرون بکش — برای نمایش در پوشه کلیک کن',
  ' — drag it out to drop it somewhere, click to show it in its folder': ' — بیرون بکش تا جایی بیندازی، کلیک کن تا در پوشه‌اش دیده شود',
  'Pin (kept on top, and after a restart)': 'سنجاق (بالا می‌ماند و بعد از ریستارت هم هست)',
  'Pin on top': 'سنجاق در بالا',
  'Unpin': 'برداشتن سنجاق',
  'Files': 'فایل‌ها',
  'Holding ': 'نگه داشته شد ',
  'Open': 'باز کن',
  'Open the player window': 'باز کردن پنجرهٔ پلیر',
  'Connect': 'اتصال',
  'Disconnect': 'قطع اتصال',
  'Connected': 'متصل',
  'Connected here': 'همین‌جا متصل است',
  'Connecting…': 'در حال اتصال…',
  'Disconnected': 'قطع شد',
  'Not connected': 'متصل نیست',
  'Sign in inside Speedo first': 'اول داخل Speedo وارد شو',
  'Firewall (block traffic outside the VPN)': 'فایروال (بستن ترافیک بیرون از VPN)',
  'Speedo': 'Speedo',
  'click to copy': 'برای کپی کلیک کن',
  'click to open': 'برای باز کردن کلیک کن',
  'Unknown title': 'عنوان نامشخص',
  'Untitled': 'بدون عنوان',
  'Try it': 'امتحانش کن',
  'Show me': 'نشانم بده',

  // ---- local music
  'No music folder yet': 'هنوز پوشهٔ موزیکی انتخاب نشده',
  'No music found in this folder': 'در این پوشه موزیکی پیدا نشد',
  'Pick the folder your music lives in': 'پوشه‌ای که موزیک‌هایت در آن است را انتخاب کن',
  'Choose folder': 'انتخاب پوشه',
  'Choosing…': 'در حال انتخاب…',
  'Change': 'تغییر',
  'Shuffle is on': 'پخش تصادفی روشن است',
  'Shuffle is off': 'پخش تصادفی خاموش است',
  'Repeat is off': 'تکرار خاموش است',
  'Repeat all': 'تکرار همه',
  'Repeat one': 'تکرار یکی',
  'Drag to change the volume · click the speaker to mute': 'برای تغییر صدا بکش · برای بی‌صدا کردن روی بلندگو کلیک کن',
  'Music': 'موزیک',
  'Music player': 'پخش‌کنندهٔ موزیک',
  'Local music': 'موزیک لوکال',

  // ---- settings
  'What Poyzen can do': 'Poyzen چه کارهایی می‌کند',
  'Start with Windows': 'اجرا با ویندوز',
  'Update automatically': 'به‌روزرسانی خودکار',
  'Resting pill shows': 'جزیرهٔ آرام نشان می‌دهد',
  'Eyes': 'چشم‌ها',
  'Clock': 'ساعت',
  'Date': 'تاریخ',
  'Greg.': 'میلادی',
  'Shamsi': 'شمسی (لاتین)',
  'Both': 'هر دو',
  'Hide while a window is underneath': 'وقتی پنجره‌ای زیرش است مخفی شو',
  'Stay out of the way for videos': 'با ویدیو و بازی کنار برو',
  'Eye style': 'شکل چشم‌ها',
  'Theme': 'تم',
  'Black': 'مشکی',
  'Plain black': 'مشکی ساده',
  'Cover colours': 'رنگ‌های کاور',
  'Night sky in the colours of the cover': 'آسمان شب به رنگ‌های کاور',
  'Theme reacts to music': 'تم به موزیک واکنش نشان بدهد',
  'Night sky with music (black theme)': 'آسمان شب با موزیک (تم مشکی)',
  'Player window wears the theme': 'پنجرهٔ پلیر هم تم را بپوشد',
  'Notification stays for': 'ماندن اعلان',
  "Hide Windows' own banners": 'مخفی کردن بنر اعلان‌های ویندوز',
  'Show what was copied': 'نمایش چیزی که کپی شد',
  'Charger and Bluetooth': 'شارژر و بلوتوث',
  'Finished downloads': 'دانلودهای تمام‌شده',
  'File shelf': 'قفسهٔ فایل',
  'Internet and VPN changes': 'تغییرات اینترنت و VPN',
  'Microphone / camera in use': 'میکروفون / دوربین در حال استفاده',
  'Smart copy': 'کپی هوشمند',
  'Smart copy: links, sums, dates': 'کپی هوشمند: لینک، جمع، تاریخ',
  'Ctrl+Alt+N note · Ctrl+Alt+T text grab': 'Ctrl+Alt+N یادداشت · Ctrl+Alt+T خواندن متن',
  'Language': 'زبان',
  'Screen': 'نمایشگر',
  'Island size': 'اندازهٔ جزیره',
  'Double-click for 100%': 'دابل‌کلیک برای ۱۰۰٪',
  'Primary': 'اصلی',
  'The screen the island sits on': 'نمایشگری که جزیره روی آن است',
  'Check for updates': 'بررسی به‌روزرسانی',
  'Checking…': 'در حال بررسی…',
  'Up to date': 'به‌روز است',

  // ---- the tour
  'Hover the pill to open its menu': 'موس را روی جزیره ببر تا منو باز شود',
  'Now playing': 'در حال پخش',
  'Play something: cover, title and controls appear here': 'چیزی پخش کن: کاور، نام و دکمه‌ها اینجا می‌آیند',
  'One line on the pill. Click it to open that chat': 'در یک خط روی جزیره. کلیک کن تا همان چت باز شود',
  'Copy a link, a sum or a date, then click the line': 'یک لینک، یک حساب یا یک تاریخ کپی کن و روی خط کلیک کن',
  'Drop files on the pill. Drag them out when you need them': 'فایل‌ها را روی جزیره رها کن. هر وقت لازم شد بیرونشان بکش',
  'Drag a box on the screen, the text is copied': 'روی صفحه کادر بکش، متن کپی می‌شود',
  'Quick note': 'یادداشت سریع',
  'One line. "call Ali in 20m" becomes a reminder': 'یک خط. «۱۰ دقیقه دیگه چای» می‌شود یادآور',
  'Pick a folder, play it right here': 'یک پوشه انتخاب کن و همین‌جا پخش کن',
  'Everything you copied, with images and pins': 'هر چیزی که کپی کردی، با عکس و سنجاق',
  'Makes one, asks what it is for, keeps it encrypted': 'رمز می‌سازد، می‌پرسد برای چیست و رمزنگاری‌شده نگه می‌دارد',
  'Stays in sight while it runs': 'تا وقتی کار می‌کند جلوی چشم می‌ماند',
  'Themes and settings': 'تم‌ها و تنظیمات',
  'Liquid skins, Venom, and every switch': 'پوسته‌های مایع، ونوم و همهٔ کلیدها',

  // ---- the player window
  'Back 10 seconds': '۱۰ ثانیه عقب',
  'Back to the default look': 'بازگشت به ظاهر پیش‌فرض',
  'Close the player': 'بستن پلیر',
  'Each word fills as it is sung': 'هر کلمه با خوانده شدن پر می‌شود',
  'Earlier by 0.1s': '۰٫۱ ثانیه زودتر',
  'Forward 10 seconds': '۱۰ ثانیه جلو',
  'Highlight the whole line': 'هایلایت کل خط',
  'Later by 0.1s': '۰٫۱ ثانیه دیرتر',
  'Minimize': 'کوچک کردن',
  'Mute': 'بی‌صدا',
  'Repeat': 'تکرار',
  'Search': 'جستجو',
  'Show the lyrics': 'نمایش متن آهنگ',
  'Show the music list': 'نمایش فهرست آهنگ‌ها',
  'Hide the music list': 'پنهان کردن فهرست آهنگ‌ها',
  'Back to the player': 'بازگشت به پلیر',
  'Shuffle': 'تصادفی',
  'Soft moving colours taken from the cover': 'رنگ‌های نرم و متحرک از روی کاور',
  'The word being sung lifts and lights up': 'کلمه‌ای که خوانده می‌شود بالا می‌آید و روشن می‌شود',
  'Instrumental': 'بی‌کلام',
  'No lyrics': 'متنی نیست',
  'No lyrics found': 'متنی پیدا نشد',
  'Play a song to see its lyrics.': 'یک آهنگ پخش کن تا متنش را ببینی.',
  'This track has no lyrics.': 'این آهنگ متن ندارد.',
  'LRCLIB has nothing for this track yet.': 'LRCLIB هنوز چیزی برای این آهنگ ندارد.',
  "Can't reach LRCLIB": 'به LRCLIB وصل نشد',
  'Check the internet connection and try again.': 'اینترنت را بررسی کن و دوباره امتحان کن.',
  'Synced': 'همگام',
  'Translate': 'ترجمه',
  'Translating…': 'در حال ترجمه…',
  'Translate the lyrics to Persian': 'ترجمهٔ متن آهنگ به فارسی',
  'Unsynced': 'ناهمگام',
  'Repeat: all': 'تکرار: همه',
  'Repeat: off': 'تکرار: خاموش',
  'Repeat: one': 'تکرار: یکی',
  'Timing and word animation': 'زمان‌بندی و انیمیشن کلمه',
};

// theme names stay as they are (they are names); these few are descriptions
// ------------------------------------------------------------ patterns for strings with a value inside
const digits = (v) => String(v).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const PAT = [
  [/^Holding (\d+) files$/, (m) => digits(m[1]) + ' فایل نگه داشته شد'],
  [/^(\d+) characters$/, (m) => digits(m[1]) + ' نویسه'],
  [/^Reading (.+)…$/, (m) => 'در حال خواندن ' + m[1] + '…'],
  [/^Install (.+)$/, (m) => 'نصب ' + m[1]],
  [/^Version (.+) is ready$/, (m) => 'نسخهٔ ' + m[1] + ' آماده است'],
  [/^Connect to (.+)$/, (m) => 'اتصال به ' + m[1]],
  [/^Reminder at (.+)$/, (m) => 'یادآوری در ' + m[1]],
  [/^Reminder (.+)$/, (m) => 'یادآور ' + m[1]],
  [/^(\d+)% left — plug in your charger$/, (m) => digits(m[1]) + '٪ مانده — شارژر را بزن'],
  [/^in use · (.+)$/, (m) => 'در حال استفاده · ' + m[1]],
  [/^Camera: (.+)$/, (m) => 'دوربین: ' + m[1]],
  [/^Microphone: (.+)$/, (m) => 'میکروفون: ' + m[1]],
  [/^VPN: (.+)$/, (m) => 'VPN: ' + m[1]],
  [/^Can't play (.+)$/, (m) => 'پخش نشد: ' + m[1]],
  [/^(.+) · click to copy$/, (m) => m[1] + ' · برای کپی کلیک کن'],
  [/^(.+) · click to open$/, (m) => m[1] + ' · برای باز کردن کلیک کن'],
  [/^(.+) · click to show in folder$/, (m) => m[1] + ' · برای نمایش در پوشه کلیک کن'],
  [/^(.+) · password is on your clipboard$/, (m) => m[1] + ' · رمز روی کلیپ‌بورد است'],
  [/^(\d+)s$/, (m) => digits(m[1]) + ' ث'],
];

// ------------------------------------------------------------ translating one string
let lang = 'en';
function core(s) {
  if (Object.prototype.hasOwnProperty.call(FA, s)) return FA[s];
  for (const [re, fn] of PAT) { const m = re.exec(s); if (m) return fn(m); }
  // "a · b": translate the parts that are known
  if (s.includes(' · ')) {
    const parts = s.split(' · '); let hit = false;
    const out = parts.map((p) => { const r = Object.prototype.hasOwnProperty.call(FA, p) ? FA[p] : null; if (r !== null) hit = true; return r === null ? p : r; });
    if (hit) return out.join(' · ');
  }
  return null;
}
function tr(s) {
  if (lang !== 'fa' || typeof s !== 'string' || !s) return s;
  const lead = /^\s*/.exec(s)[0], trail = /\s*$/.exec(s)[0];
  const exact = Object.prototype.hasOwnProperty.call(FA, s) ? FA[s] : null;     // keeps keys that carry their own spaces
  if (exact !== null) return exact;
  const body = s.slice(lead.length, s.length - trail.length);
  if (!body) return s;
  const r = core(body);
  return r === null ? s : lead + r + trail;
}
window.t = tr;
window.i18n = { get lang() { return lang; }, t: tr, isFa: () => lang === 'fa' };

// ------------------------------------------------------------ walking the DOM
const textMemo = new WeakMap();      // text node -> { en, fa }
const attrMemo = new WeakMap();      // element -> { attr: { en, fa } }
const ATTRS = ['title', 'placeholder', 'aria-label'];
// the user's own words (clipboard, notes, file names, track names) are never translated
const USER_TEXT = '.row.clip, .row.file, .row.trk, .row.vault, #hd-files, #m-title, #m-artist, input, textarea, script, style, [data-no-i18n]';

function doText(node) {
  const d = node.data, memo = textMemo.get(node);
  if (lang === 'fa') {
    if (memo && d === memo.fa) return;
    const p = node.parentElement;
    if (!d.trim() || (p && p.closest(USER_TEXT))) return;
    const r = tr(d);
    if (r !== d) { textMemo.set(node, { en: d, fa: r }); node.data = r; } else textMemo.delete(node);
  } else if (memo) {
    textMemo.delete(node);
    if (d === memo.fa) node.data = memo.en;
  }
}
function doAttrs(el) {
  let rec = attrMemo.get(el);
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const v = el.getAttribute(a), m = rec && rec[a];
    if (lang === 'fa') {
      if (m && v === m.fa) continue;
      const r = tr(v);
      if (r !== v) { if (!rec) { rec = {}; attrMemo.set(el, rec); } rec[a] = { en: v, fa: r }; el.setAttribute(a, r); } else if (m) delete rec[a];
    } else if (m) {
      delete rec[a];
      if (v === m.fa) el.setAttribute(a, m.en);
    }
  }
}
function sweep(root) {
  if (!root) return;
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1) return;
  const tag = root.tagName;
  if (tag === 'SCRIPT' || tag === 'STYLE') return;
  doAttrs(root);
  const w = document.createTreeWalker(root, 1 | 4);       // elements and text
  let n;
  while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else if (n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE') doAttrs(n); }
}
let obs = null;
function startObserver() {
  if (obs || !document.body) return;
  obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttrs(m.target);
      else m.addedNodes.forEach(sweep);
    }
  });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

// ------------------------------------------------------------ switching
function setLang(next) {
  next = next === 'fa' ? 'fa' : 'en';
  if (next === lang && document.documentElement.dataset.lang) return;
  lang = next;
  const de = document.documentElement;
  de.dataset.lang = lang; de.lang = lang;
  document.body.classList.toggle('fa', lang === 'fa');
  if (obs) obs.disconnect();
  sweep(document.body);
  obs = null; startObserver();
  document.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
}
window.i18n.set = setLang;

function boot() {
  startObserver();
  const T = window.__TAURI__;
  if (!T) return;
  T.core.invoke('settings_get').then((s) => { if (s && s.lang) setLang(s.lang); }).catch(() => {});
  T.event.listen('settings', (e) => { if (e.payload && e.payload.lang) setLang(e.payload.lang); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
