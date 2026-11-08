// ギャラリーモード: 写真を全画面で自動的に切り替えて表示する (スライドショー・フォトフレーム)
// 機能の一覧は docs/gallery-features.md を参照

const TRANSITIONS = [
  ['fade', 'フェード'], ['black', '黒を挟んでフェード'], ['white', '白を挟んでフェード'],
  ['slideL', 'スライド（左へ）'], ['slideR', 'スライド（右へ）'], ['slideU', 'スライド（上へ）'], ['slideD', 'スライド（下へ）'],
  ['zoomIn', 'ズームイン'], ['zoomOut', 'ズームアウト'], ['rotate', '回転しながら'], ['blur', 'ぼかしながら'],
  ['wipe', 'ワイプ'], ['circle', '円形に広がる'], ['curtain', 'カーテン（中央から開く）'], ['flip', 'フリップ（裏返る）'],
  ['none', '効果なし（すぐ切り替え）'], ['random', 'ランダム（毎回違う効果）'],
];
const RANDOM_TRANSITIONS = TRANSITIONS.map(([id]) => id).filter((id) => id !== 'none' && id !== 'random');
// 前に戻るときは、動きの向きを逆にする
const REVERSE_TRANSITION = { slideL: 'slideR', slideR: 'slideL', slideU: 'slideD', slideD: 'slideU', zoomIn: 'zoomOut', zoomOut: 'zoomIn' };
const INTERVALS = [3, 5, 8, 10, 15, 20, 30, 60, 120, 300];
const GALLERY_SCAN_LIMIT = 300; // 条件に合う写真を探すときに調べる最大枚数
const REFRESH_EVERY = 10 * 60 * 1000;

const GALLERY_DEFAULTS = {
  interval: 5, transition: 'fade', transitionSpeed: 1.2, motion: 'zoom', motionStrength: 'mid',
  layout: 'single', fit: 'contain', background: 'blur', frame: 'none', rounded: false, shadow: false,
  tone: 'none', vignette: false, grain: false,
  clock: false, clock24: true, clockLarge: false, today: false, photoDate: false, yearsAgo: false, fileName: false,
  folderName: false, counter: false, progress: true, nextPreview: false, strip: true, infoPos: 'bl', infoSize: 'm',
  order: 'folder', recursive: true, orientation: 'all', period: 'all', loop: true, randomStart: false,
  includeVideos: false, videoToEnd: true, videoSound: false, videoMax: 0,
  bgmVolume: 60, bgmPauseWithSlides: true,
  tapZones: true, wheel: true, uiHideDelay: 3,
  sleepMinutes: 0, nightDim: false, nightStart: 22, nightEnd: 6, brightness: 100, autoRefresh: false,
};

const GALLERY_PRESETS = [
  {
    id: 'frame', label: 'フォトフレーム', desc: 'ゆっくり切り替え・時計と日付・夜は暗く',
    s: { interval: 30, transition: 'fade', transitionSpeed: 2.5, motionStrength: 'low', order: 'shuffle', clock: true, today: true, photoDate: true, yearsAgo: true, infoPos: 'br', nightDim: true, autoRefresh: true, progress: false, strip: false },
  },
  {
    id: 'slideshow', label: 'スライドショー', desc: 'テンポよく・いろいろな切り替え効果',
    s: { interval: 5, transition: 'random', transitionSpeed: 1, motion: 'random', order: 'old', photoDate: true, counter: true },
  },
  {
    id: 'party', label: 'パーティー', desc: '4枚ずつ・ポラロイド風・鮮やか',
    s: { interval: 4, transition: 'random', transitionSpeed: 0.8, motion: 'random', layout: 'four', frame: 'polaroid', background: 'color', tone: 'vivid', order: 'shuffle' },
  },
  {
    id: 'clock', label: '置き時計', desc: '大きな時計と写真',
    s: { clockLarge: true, today: true, interval: 20, transitionSpeed: 2, order: 'shuffle', strip: false, progress: false },
  },
];

const intervalLabel = (sec) => (sec >= 60 ? `${sec / 60}分` : `${sec}秒`);
const hourOptions = () => Array.from({ length: 24 }, (_, h) => [h, `${h}時`]);
const G = (key, label, type, extra = {}) => ({ key, label, type, ...extra });

// 設定画面の項目
const GALLERY_SCHEMA = [
  { title: '切り替え', items: [
    G('interval', '切り替えの間隔', 'select', { options: INTERVALS.map((s) => [s, intervalLabel(s)]), num: true }),
    G('transition', '切り替え効果', 'select', { options: TRANSITIONS }),
    G('transitionSpeed', '切り替えの速さ', 'range', { min: 0.3, max: 3, step: 0.1, unit: '秒' }),
  ] },
  { title: '写真の動き', items: [
    G('motion', '動き', 'select', { options: [['zoom', 'ゆっくりズーム'], ['zoomout', 'ゆっくりズームアウト'], ['pan', 'ゆっくり横に流れる'], ['random', 'ランダム'], ['none', '動かさない']] }),
    G('motionStrength', '動きの強さ', 'seg', { options: [['low', '小'], ['mid', '中'], ['high', '大']] }),
  ] },
  { title: '表示のしかた', items: [
    G('layout', '並べ方', 'select', { options: [['single', '1枚ずつ'], ['pairPortrait', '縦長の写真は2枚並べる'], ['two', '2枚ずつ'], ['four', '4枚ずつ（コラージュ）']] }),
    G('fit', '写真の大きさ', 'seg', { options: [['contain', '全体を表示'], ['cover', '画面いっぱい'], ['auto', '自動']] }),
    G('background', '背景', 'seg', { options: [['blur', 'ぼかし'], ['color', '写真の色'], ['black', '黒'], ['white', '白']] }),
    G('frame', 'ふち', 'seg', { options: [['none', 'なし'], ['mat', '白いふち'], ['polaroid', 'ポラロイド風']] }),
    G('rounded', '角を丸くする', 'toggle'),
    G('shadow', '影を付ける', 'toggle'),
    G('tone', '色調', 'select', { options: [['none', 'そのまま'], ['mono', 'モノクロ'], ['sepia', 'セピア'], ['vintage', 'ヴィンテージ'], ['vivid', 'ビビッド'], ['soft', 'ソフト']] }),
    G('vignette', '周辺を暗くする（周辺減光）', 'toggle'),
    G('grain', 'フィルムの粒子', 'toggle'),
  ] },
  { title: '情報の表示', items: [
    G('clock', '時計', 'toggle'),
    G('clock24', '24時間表示', 'toggle'),
    G('clockLarge', '時計を大きく表示（置き時計）', 'toggle'),
    G('today', '今日の日付', 'toggle'),
    G('photoDate', '写真の日付', 'toggle'),
    G('yearsAgo', '「◯年前」の表示', 'toggle'),
    G('fileName', 'ファイル名', 'toggle'),
    G('folderName', 'フォルダ名を常に表示', 'toggle'),
    G('counter', '枚数（3 / 120）を常に表示', 'toggle'),
    G('progress', '進み具合のバー', 'toggle'),
    G('nextPreview', '次の写真を予告', 'toggle'),
    G('strip', 'サムネイルのバー', 'toggle'),
    G('infoPos', '文字を出す位置', 'select', { options: [['tl', '左上'], ['tr', '右上'], ['bl', '左下'], ['br', '右下'], ['bc', '下の中央']] }),
    G('infoSize', '文字の大きさ', 'seg', { options: [['s', '小'], ['m', '中'], ['l', '大']] }),
  ] },
  { title: '順番と選び方', items: [
    G('order', '順番', 'select', { options: [['folder', 'フォルダの順'], ['new', '新しい順'], ['old', '古い順'], ['name', '名前順'], ['shuffle', 'シャッフル']] }),
    G('recursive', 'サブフォルダの写真も', 'toggle'),
    G('orientation', '写真の向き', 'seg', { options: [['all', 'すべて'], ['landscape', '横長だけ'], ['portrait', '縦長だけ']] }),
    G('period', '期間', 'select', { options: () => periodOptions() }),
    G('loop', '最後まで行ったら最初から', 'toggle'),
    G('randomStart', 'ランダムな写真から始める', 'toggle'),
  ] },
  { title: '動画', items: [
    G('includeVideos', '動画も表示する', 'toggle'),
    G('videoToEnd', '動画は最後まで再生してから次へ', 'toggle'),
    G('videoSound', '動画の音を出す', 'toggle'),
    G('videoMax', '動画を再生する長さ', 'select', { options: [[0, '制限なし'], [10, '10秒まで'], [30, '30秒まで'], [60, '1分まで'], [180, '3分まで']], num: true }),
  ] },
  { title: '音楽（BGM）', custom: 'bgm', items: [
    G('bgmVolume', '音量', 'range', { min: 0, max: 100, step: 5, unit: '%' }),
    G('bgmPauseWithSlides', '一時停止で音楽も止める', 'toggle'),
  ] },
  { title: '操作', items: [
    G('tapZones', '画面の左右をタップして前後に移動', 'toggle'),
    G('wheel', 'マウスホイールで前後に移動', 'toggle'),
    G('uiHideDelay', 'ボタンを隠すまでの時間', 'select', { options: [[2, '2秒'], [3, '3秒'], [5, '5秒'], [10, '10秒'], [0, '隠さない']], num: true }),
  ] },
  { title: 'フォトフレーム', custom: 'frame', items: [
    G('sleepMinutes', 'おやすみタイマー', 'select', { options: [[0, '使わない'], [15, '15分後に終了'], [30, '30分後に終了'], [60, '1時間後に終了'], [120, '2時間後に終了'], [240, '4時間後に終了']], num: true }),
    G('nightDim', '夜は画面を暗くする', 'toggle'),
    G('nightStart', '暗くする時刻', 'select', { options: hourOptions, num: true, dep: 'nightDim' }),
    G('nightEnd', '元に戻す時刻', 'select', { options: hourOptions, num: true, dep: 'nightDim' }),
    G('brightness', '画面の明るさ', 'range', { min: 20, max: 100, step: 5, unit: '%' }),
    G('autoRefresh', '新しい写真を自動で取り込む（10分ごと）', 'toggle'),
  ] },
];

// 変えたときに、写真の選び直しが必要な設定・表示し直しが必要な設定
const REBUILD_KEYS = new Set(['order', 'period', 'includeVideos', 'orientation']);
const RESHOW_KEYS = new Set(['layout', 'fit', 'background', 'frame', 'rounded', 'shadow', 'motion', 'motionStrength']);

// ---- 状態 ----

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const gal = {
  el: $('gallery'), open: false, source: null, all: [], items: [], order: [],
  pos: 0, nextPos: 0, wrapped: false, history: [], current: [], failures: 0,
  playing: true, token: 0, front: 0, timer: null, idleTimer: null, tickTimer: null, cleanup: null, cleanupTimer: null,
  albums: {}, lanUrl: '', wakeLock: null, sleepAt: 0, lastRefresh: 0, autostarted: false, zoomed: null,
  s: loadGallerySettings(), excluded: loadExcluded(),
  bgm: { files: [], index: 0, audio: null, url: null, fadeTimer: null, ducked: false },
};
const metaCache = new Map();
const colorCache = new Map();

function loadGallerySettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('homealbum.gallerySettings')); } catch { /* 初期設定を使う */ }
  if (!saved) {
    // 以前のバージョンの設定を引き継ぐ
    saved = { interval: Number(loadPref('galleryInterval', '5')), recursive: loadPref('galleryRecursive', '1') === '1' };
    if (loadPref('galleryShuffle', '0') === '1') saved.order = 'shuffle';
  }
  return { ...GALLERY_DEFAULTS, ...saved };
}
function saveGallerySettings() {
  try { localStorage.setItem('homealbum.gallerySettings', JSON.stringify(gal.s)); } catch { /* 保存できなくても動作する */ }
}
function loadExcluded() {
  try { return new Set(JSON.parse(localStorage.getItem('homealbum.galleryExcluded')) || []); } catch { return new Set(); }
}
function saveExcluded() {
  try { localStorage.setItem('homealbum.galleryExcluded', JSON.stringify([...gal.excluded].slice(-5000))); } catch { /* 同上 */ }
}

// ---- 写真の URL・名前 ----

const itemKey = (it) => `${it.album}/${it.path}`;
const itemQs = (it) => qs({ album: it.album, path: it.path });
const itemVer = (it) => `${it.mtime}-${it.size}`;
const itemName = (it) => it.path.split('/').pop();
const itemFolder = (it) => it.path.split('/').slice(0, -1).join('/');
const isHeifName = (name) => /\.(heic|heif)$/i.test(name);
const gFileUrl = (it) => `/api/file?${itemQs(it)}&v=${itemVer(it)}`;
const gDisplayUrl = (it) => (it.type === 'video' || it.viewable ? gFileUrl(it) : `/api/preview?${itemQs(it)}&v=${itemVer(it)}`);
const gThumbUrl = (it) => `/api/thumb?${qs({ album: it.album, path: it.path, v: itemVer(it) })}`;
const currentItem = () => gal.current[0]?.item || null;

function folderText(it) {
  return [gal.albums[it.album], ...itemFolder(it).split('/').filter(Boolean)].filter(Boolean).join(' › ');
}
function countText() {
  return `${gal.pos + 1} / ${gal.order.length}`;
}
function photoDateText(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
function agoText(ms) {
  const days = (Date.now() - ms) / 864e5;
  if (days >= 365) return `${Math.floor(days / 365.25)}年前`;
  if (days >= 30) return `${Math.floor(days / 30.4)}か月前`;
  if (days >= 1) return `${Math.floor(days)}日前`;
  return '今日';
}
function clockText() {
  const d = new Date();
  const m = String(d.getMinutes()).padStart(2, '0');
  if (gal.s.clock24) return `${d.getHours()}:${m}`;
  const h = d.getHours() % 12 || 12;
  return `${d.getHours() < 12 ? '午前' : '午後'} ${h}:${m}`;
}
function todayText() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`;
}
function periodOptions() {
  const years = [...new Set(gal.all.map((it) => new Date(it.mtime).getFullYear()))].sort((a, b) => b - a);
  return [['all', 'すべて'], ['recent', '最近（30日以内）'], ['memories', '今日の思い出（同じ月日）'], ...years.map((y) => [`y${y}`, `${y}年`])];
}

// ---- 画面の部品 ----

gal.el.innerHTML = `
  <div class="g-layer"></div>
  <div class="g-layer"></div>
  <div class="g-flash"></div>
  <div class="g-vignette" hidden></div>
  <div class="g-grain" hidden></div>
  <div class="g-info" hidden></div>
  <div class="g-bigclock" hidden></div>
  <button class="g-next" type="button" hidden></button>
  <div class="g-empty" hidden></div>
  <div class="g-loading" hidden><div class="spinner"></div></div>
  <div class="g-dim"></div>
  <div class="g-top">
    <button class="btn icon" data-g="close" title="ギャラリーを終わる" aria-label="ギャラリーを終わる">${icon('close')}</button>
    <div class="g-caption"><div class="g-where"></div><small class="g-count"></small></div>
    <button class="btn icon" data-g="menu" title="この写真の操作" aria-label="この写真の操作">${icon('more')}</button>
  </div>
  <div class="g-bar">
    <div class="g-strip"></div>
    <div class="g-buttons">
      <div class="g-group">
        <button class="btn icon" data-g="prev" title="前へ" aria-label="前へ">${icon('chevL')}</button>
        <button class="btn icon g-play" data-g="play" title="再生／一時停止" aria-label="再生／一時停止"></button>
        <button class="btn icon" data-g="next" title="次へ" aria-label="次へ">${icon('chevR')}</button>
      </div>
      <div class="g-group g-speed">
        <button class="btn icon" data-g="slower" title="ゆっくりにする" aria-label="ゆっくりにする">−</button>
        <span class="g-speed-label"></span>
        <button class="btn icon" data-g="faster" title="速くする" aria-label="速くする">＋</button>
      </div>
      <div class="g-group">
        <button class="btn icon g-toggle" data-g="shuffle" title="シャッフル" aria-label="シャッフル">${icon('shuffle')}</button>
        <button class="btn icon" data-g="grid" title="一覧" aria-label="一覧">${icon('layers')}</button>
        <button class="btn icon" data-g="settings" title="設定" aria-label="設定">${icon('settings')}</button>
        <button class="btn icon" data-g="full" title="全画面" aria-label="全画面">${icon('expand')}</button>
      </div>
    </div>
  </div>
  <div class="g-progress"></div>
  <div class="g-gridview" hidden></div>
  <aside class="g-settings" hidden></aside>
  <input type="file" class="g-bgm-input" accept="audio/*" multiple hidden>`;

const gq = (sel) => gal.el.querySelector(sel);
gal.layers = [...gal.el.querySelectorAll('.g-layer')];
Object.assign(gal, {
  flash: gq('.g-flash'), vignette: gq('.g-vignette'), grain: gq('.g-grain'), info: gq('.g-info'), bigClock: gq('.g-bigclock'),
  nextEl: gq('.g-next'), emptyEl: gq('.g-empty'), loadingEl: gq('.g-loading'), dim: gq('.g-dim'),
  where: gq('.g-where'), count: gq('.g-count'), strip: gq('.g-strip'), progressEl: gq('.g-progress'),
  gridEl: gq('.g-gridview'), settingsEl: gq('.g-settings'), bgmInput: gq('.g-bgm-input'),
  playBtn: gq('[data-g="play"]'), shuffleBtn: gq('[data-g="shuffle"]'), speedLabel: gq('.g-speed-label'),
});
if (!document.fullscreenEnabled) gq('[data-g="full"]').hidden = true;

// ---- 開く・閉じる ----

// source: { album: アルバムID または 'all', path, startAt: { album, path }, names: [選んだ写真の名前] }
async function openGallery(source, { reuseHistory = false, autostart = false } = {}) {
  Object.assign(gal, { source, open: true, playing: true, history: [], current: [], failures: 0, autostarted: autostart, zoomed: null });
  gal.layers.forEach(resetLayer);
  gal.el.hidden = false;
  document.body.style.overflow = 'hidden';
  if (reuseHistory || autostart) history.replaceState({ gallery: true }, '');
  else history.pushState({ gallery: true }, '');
  if (!autostart && document.fullscreenEnabled && !document.fullscreenElement) gal.el.requestFullscreen().catch(() => {});
  gal.sleepAt = gal.s.sleepMinutes ? Date.now() + gal.s.sleepMinutes * 60000 : 0;
  gal.lastRefresh = Date.now();
  applyStaticSettings();
  syncControls();
  showUi();
  keepScreenOn();
  clearInterval(gal.tickTimer);
  gal.tickTimer = setInterval(tick, 1000);
  bgmResume();
  await loadGalleryItems(source.startAt);
}

function closeGallery(fromHistory) {
  if (!gal.open) return;
  gal.open = false;
  gal.token++;
  clearTimeout(gal.timer);
  clearTimeout(gal.idleTimer);
  clearInterval(gal.tickTimer);
  finishCleanup();
  gal.layers.forEach(resetLayer);
  gal.settingsEl.hidden = true;
  gal.gridEl.hidden = true;
  gal.el.hidden = true;
  gal.el.classList.remove('idle', 'settings-open');
  document.body.style.overflow = '';
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (gal.wakeLock) { gal.wakeLock.release().catch(() => {}); gal.wakeLock = null; }
  bgmFade(0, 800, () => gal.bgm.audio?.pause());
  if (gal.autostarted) {
    // フォトフレーム用のアドレスから始めたときは、アドレスの指定を消してアルバムに戻る
    gal.autostarted = false;
    history.replaceState(null, '', location.pathname + location.hash);
    return;
  }
  if (!fromHistory && history.state?.gallery) history.back();
}

function resetLayer(layer) {
  stopVideos(layer);
  layer.className = 'g-layer';
  layer.innerHTML = '';
}

async function keepScreenOn() {
  if (!('wakeLock' in navigator) || !gal.open) return;
  try { gal.wakeLock = await navigator.wakeLock.request('screen'); } catch { /* 対応していないブラウザ */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && gal.open) keepScreenOn();
});

// ---- 写真の一覧と順番 ----

async function loadGalleryItems(keep, { silent = false } = {}) {
  const src = gal.source;
  const token = silent ? gal.token : ++gal.token;
  if (!silent) showLoading(true);
  let data;
  try {
    data = await api(`/api/gallery?${qs({
      album: src.album, path: src.path || '', recursive: src.names ? '0' : gal.s.recursive ? '1' : '0', videos: '1',
    })}`);
  } catch (e) {
    if (silent) return;
    toast(e.message, { error: true });
    closeGallery();
    return;
  }
  if (token !== gal.token || !gal.open) return;
  gal.albums = data.albums;
  gal.lanUrl = data.lanUrl || '';
  let all = data.items;
  if (src.names) {
    const wanted = new Set(src.names);
    all = all.filter((it) => wanted.has(itemName(it)));
  }
  gal.all = all;
  rebuildItems(keep, { random: !keep && gal.s.randomStart, silent });
}

function passesFilters(it) {
  const s = gal.s;
  // 写真を選んで始めたときは、選んだものをそのまま表示する
  if (gal.source?.names) return it.type === 'image' || it.viewable;
  if (gal.excluded.has(itemKey(it))) return false;
  if (it.type === 'video' && !(s.includeVideos && it.viewable)) return false;
  const p = s.period;
  if (p === 'all') return true;
  const d = new Date(it.mtime);
  if (p === 'recent') return Date.now() - it.mtime <= 30 * 864e5;
  if (p === 'memories') {
    const t = new Date();
    return d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  }
  if (p.startsWith('y')) return d.getFullYear() === Number(p.slice(1));
  return true;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function rebuildItems(keep, { random = false, silent = false } = {}) {
  const s = gal.s;
  gal.items = gal.all.filter(passesFilters);
  const order = gal.items.map((_, i) => i);
  const collator = new Intl.Collator('ja', { numeric: true });
  if (s.order === 'new') order.sort((a, b) => gal.items[b].mtime - gal.items[a].mtime);
  else if (s.order === 'old') order.sort((a, b) => gal.items[a].mtime - gal.items[b].mtime);
  else if (s.order === 'name') order.sort((a, b) => collator.compare(itemName(gal.items[a]), itemName(gal.items[b])));
  else if (s.order === 'shuffle') shuffleInPlace(order);
  gal.order = order;
  gal.history = [];
  let pos = 0;
  const keepIdx = keep ? gal.items.findIndex((it) => itemKey(it) === itemKey(keep)) : -1;
  if (keepIdx >= 0) {
    if (s.order === 'shuffle') {
      order.splice(order.indexOf(keepIdx), 1);
      order.unshift(keepIdx);
    } else {
      pos = order.indexOf(keepIdx);
    }
  } else if (random && order.length) {
    pos = Math.floor(Math.random() * order.length);
  }
  if (silent) {
    // 表示中の写真はそのままで、順番だけ入れ替える
    gal.pos = pos;
    gal.nextPos = order.length ? (pos + Math.max(1, gal.current.length)) % order.length : 0;
    updateCaption();
    updateInfo();
    updateStrip();
    return;
  }
  showSlide(pos);
}

// ---- 1枚分 (または並べる分) の写真を選ぶ ----

// 写真の縦横の大きさだけを、小さなサムネイルで調べる
function loadMeta(item) {
  const key = itemKey(item);
  if (metaCache.has(key)) return metaCache.get(key);
  const p = new Promise((resolve) => {
    const img = new Image();
    let finished = false;
    const done = (v) => { if (!finished) { finished = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => done({ ok: false }), 15000);
    img.onload = () => done({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => (item.type === 'video' ? videoMeta(item).then(done) : done({ ok: false }));
    img.src = gThumbUrl(item);
  });
  metaCache.set(key, p);
  if (metaCache.size > 3000) metaCache.delete(metaCache.keys().next().value);
  return p;
}

function videoMeta(item) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const done = (r) => { clearTimeout(timer); v.removeAttribute('src'); v.load(); resolve(r); };
    const timer = setTimeout(() => done({ ok: false }), 10000);
    v.onloadedmetadata = () => done({ ok: !!v.videoWidth, w: v.videoWidth, h: v.videoHeight });
    v.onerror = () => done({ ok: false });
    v.src = gFileUrl(item);
  });
}

function orientationOk(meta) {
  const o = gal.source?.names ? 'all' : gal.s.orientation;
  if (o === 'landscape') return meta.w >= meta.h;
  if (o === 'portrait') return meta.h > meta.w;
  return true;
}

async function collectSlide(pos, token) {
  const n = gal.order.length;
  const layout = gal.s.layout;
  let want = layout === 'four' ? 4 : layout === 'two' ? 2 : 1;
  const picked = [];
  let p = pos;
  for (let scanned = 0; scanned < Math.min(n, GALLERY_SCAN_LIMIT) && picked.length < want; scanned++) {
    const item = gal.items[gal.order[p]];
    const meta = await loadMeta(item);
    if (token !== gal.token) return null;
    const next = (p + 1) % n;
    if (meta.ok && orientationOk(meta)) {
      if (item.type === 'video') {
        // 動画は1本ずつ表示する
        if (picked.length) break;
        picked.push({ item, meta });
        p = next;
        break;
      }
      if (layout === 'pairPortrait') {
        const portrait = meta.h > meta.w;
        if (!picked.length) {
          picked.push({ item, meta });
          p = next;
          if (portrait) { want = 2; continue; }
          break;
        }
        if (!portrait) break;
      }
      picked.push({ item, meta });
    }
    p = next;
  }
  return { picked, nextPos: p, wrapped: n > 0 && p <= pos };
}

// 表示用の大きな画像を読み込む (動画は表示するときに読み込む)
function loadDisplay(item) {
  if (item.type === 'video') return Promise.resolve({ video: true });
  return new Promise((resolve) => {
    const img = new Image();
    let finished = false;
    const done = (v) => { if (!finished) { finished = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => done(null), 30000);
    img.onload = () => (img.decode ? img.decode().catch(() => {}).then(() => done(img)) : done(img));
    img.onerror = () => done(null);
    img.src = gDisplayUrl(item);
  });
}

// ---- 表示 ----

async function showSlide(pos, { dir = 1, instant = false } = {}) {
  const token = ++gal.token;
  clearTimeout(gal.timer);
  resetProgress();
  if (!gal.order.length) { showEmpty(); return; }
  gal.emptyEl.hidden = true;
  const spinner = setTimeout(() => showLoading(true), 400);
  const slide = await collectSlide(pos, token);
  if (!slide || token !== gal.token || !gal.open) { clearTimeout(spinner); return; }
  if (!slide.picked.length) {
    clearTimeout(spinner);
    showLoading(false);
    showEmpty();
    return;
  }
  const media = await Promise.all(slide.picked.map((p) => loadDisplay(p.item)));
  clearTimeout(spinner);
  showLoading(false);
  if (token !== gal.token || !gal.open) return;
  const picked = slide.picked.map((p, i) => ({ ...p, media: media[i] })).filter((p) => p.media);
  if (!picked.length) {
    // 表示できない写真は飛ばす
    if (++gal.failures > 20) { showEmpty('写真を表示できませんでした'); return; }
    showSlide(slide.nextPos, { dir });
    return;
  }
  gal.failures = 0;
  if (gal.zoomed) {
    // 拡大したまま次の写真へ移ったときは、再生の状態を元に戻す
    gal.playing = gal.zoomed.wasPlaying;
    syncControls();
  }
  Object.assign(gal, { pos, nextPos: slide.nextPos, wrapped: slide.wrapped, current: picked, zoomed: null });
  renderSlide(picked, { dir, instant });
  updateCaption();
  updateInfo();
  updateStrip();
  updateNextPreview();
  schedule();
  preloadNext();
}

function preloadNext() {
  const it = gal.items[gal.order[gal.nextPos]];
  if (it && it.type === 'image') {
    loadMeta(it);
    new Image().src = gDisplayUrl(it);
  }
}

function computeCells(count) {
  const vw = gal.el.clientWidth || window.innerWidth;
  const vh = gal.el.clientHeight || window.innerHeight;
  const framed = gal.s.frame !== 'none' || count > 1;
  const m = framed ? Math.round(Math.min(vw, vh) * 0.04) : 0;
  const gap = count > 1 ? Math.round(Math.max(8, m * 0.8)) : 0;
  const W = vw - m * 2, H = vh - m * 2;
  if (count === 1) return [{ x: m, y: m, w: W, h: H }];
  if (count === 2) {
    if (vw >= vh) {
      const cw = (W - gap) / 2;
      return [{ x: m, y: m, w: cw, h: H }, { x: m + cw + gap, y: m, w: cw, h: H }];
    }
    const ch = (H - gap) / 2;
    return [{ x: m, y: m, w: W, h: ch }, { x: m, y: m + ch + gap, w: W, h: ch }];
  }
  const cw = (W - gap) / 2, ch = (H - gap) / 2;
  return Array.from({ length: count }, (_, i) => ({ x: m + (i % 2) * (cw + gap), y: m + Math.floor(i / 2) * (ch + gap), w: cw, h: ch }));
}

function applyMotion(el) {
  const s = gal.s;
  if (s.motion === 'none' || reducedMotion) return;
  const z = { low: 1.04, mid: 1.09, high: 1.16 }[s.motionStrength] || 1.09;
  const pan = { low: 2, mid: 4, high: 7 }[s.motionStrength] || 4;
  let m = s.motion;
  if (m === 'random') {
    m = ['zoom', 'zoomout', 'pan'][Math.floor(Math.random() * 3)];
    el.style.transformOrigin = `${20 + Math.random() * 60}% ${20 + Math.random() * 60}%`;
  }
  el.style.setProperty('--g-z', z);
  el.style.setProperty('--g-pan', `${pan}%`);
  el.style.setProperty('--g-dur', `${s.interval + s.transitionSpeed + 1}s`);
  if (m === 'pan') el.classList.add(Math.random() < 0.5 ? 'm-pan-l' : 'm-pan-r');
  else el.classList.add(m === 'zoomout' ? 'm-zoomout' : 'm-zoom');
}

function buildFigure({ item, meta, media }, cell) {
  const s = gal.s;
  const w = media.naturalWidth || meta.w || 16;
  const h = media.naturalHeight || meta.h || 9;
  const fit = s.fit === 'auto' ? ((w >= h) === (cell.w >= cell.h) ? 'cover' : 'contain') : s.fit;
  const base = Math.min(cell.w, cell.h);
  const pad = s.frame === 'mat' ? Math.round(base * 0.035) : s.frame === 'polaroid' ? Math.round(base * 0.03) : 0;
  const padB = s.frame === 'polaroid' ? Math.round(base * 0.13) : pad;
  const availW = Math.max(10, cell.w - pad * 2);
  const availH = Math.max(10, cell.h - pad - padB);
  let iw = availW, ih = availH;
  if (fit === 'contain') {
    const sc = Math.min(availW / w, availH / h);
    iw = w * sc;
    ih = h * sc;
  }
  const fw = iw + pad * 2, fh = ih + pad + padB;
  const fig = document.createElement('figure');
  fig.className = `g-photo frame-${s.frame}${s.rounded ? ' rounded' : ''}${s.shadow ? ' shadow' : ''}`;
  Object.assign(fig.style, {
    left: `${cell.x + (cell.w - fw) / 2}px`, top: `${cell.y + (cell.h - fh) / 2}px`,
    width: `${fw}px`, height: `${fh}px`, padding: `${pad}px ${pad}px ${padB}px`,
  });
  const clip = document.createElement('div');
  clip.className = 'g-clip';
  const motion = document.createElement('div');
  motion.className = 'g-motion';
  if (item.type === 'video') {
    const v = document.createElement('video');
    v.playsInline = true;
    v.muted = !s.videoSound;
    v.preload = 'auto';
    v.src = gFileUrl(item);
    v.addEventListener('ended', () => {
      if (gal.open && gal.s.videoToEnd && gal.current[0]?.item === item) goNext(true);
    });
    motion.append(v);
  } else {
    media.alt = '';
    motion.append(media);
    applyMotion(motion);
  }
  clip.append(motion);
  fig.append(clip);
  if (s.frame === 'polaroid') {
    const cap = document.createElement('figcaption');
    cap.textContent = photoDateText(item.mtime);
    cap.style.height = `${padB}px`;
    cap.style.fontSize = `${Math.max(11, padB * 0.32)}px`;
    fig.append(cap);
  }
  return fig;
}

function averageColor(item) {
  const key = itemKey(item);
  if (colorCache.has(key)) return colorCache.get(key);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 8;
        c.height = 8;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 8, 8);
        const d = ctx.getImageData(0, 0, 8, 8).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        resolve([r / 64, g / 64, b / 64].map(Math.round));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = gThumbUrl(item);
  });
  colorCache.set(key, p);
  return p;
}

function paintBackground(layer, item) {
  const bg = layer.querySelector('.g-bg');
  const mode = gal.s.background;
  bg.className = `g-bg bg-${mode}`;
  if (mode === 'blur') {
    bg.style.backgroundImage = `url("${gThumbUrl(item)}")`;
  } else if (mode === 'color') {
    averageColor(item).then((c) => {
      if (!c) return;
      const mix = (k) => c.map((v) => Math.round(Math.min(255, v * k))).join(',');
      bg.style.background = `radial-gradient(circle at 50% 40%, rgb(${mix(1.25)}) 0%, rgb(${mix(0.85)}) 55%, rgb(${mix(0.4)}) 100%)`;
    });
  }
}

function renderSlide(picked, { dir = 1, instant = false } = {}) {
  finishCleanup();
  const s = gal.s;
  const front = gal.layers[gal.front];
  const back = gal.layers[1 - gal.front];
  resetLayer(back);
  back.innerHTML = '<div class="g-bg"></div><div class="g-photos"></div>';
  paintBackground(back, picked[0].item);
  const cells = computeCells(picked.length);
  const photos = back.querySelector('.g-photos');
  picked.forEach((p, i) => photos.append(buildFigure(p, cells[i])));

  const hadFront = !!front.innerHTML;
  let t = s.transition === 'random' ? RANDOM_TRANSITIONS[Math.floor(Math.random() * RANDOM_TRANSITIONS.length)] : s.transition;
  if (dir < 0) t = REVERSE_TRANSITION[t] || t;
  if (reducedMotion && t !== 'none') t = 'fade';
  if (instant) t = 'none';
  if (!hadFront && t !== 'none') t = 'fade';
  void back.offsetWidth;
  back.className = `g-layer on in-${t}`;
  front.className = hadFront ? `g-layer out-${t}` : 'g-layer';
  if (t === 'white') {
    gal.flash.classList.remove('on');
    void gal.flash.offsetWidth;
    gal.flash.classList.add('on');
  }
  gal.front = 1 - gal.front;
  playVideos(back);
  const done = () => {
    clearTimeout(gal.cleanupTimer);
    gal.cleanup = null;
    resetLayer(front);
    back.className = 'g-layer on';
  };
  gal.cleanup = done;
  gal.cleanupTimer = setTimeout(done, t === 'none' ? 0 : s.transitionSpeed * 1000 + 80);
}

function finishCleanup() {
  if (gal.cleanup) gal.cleanup();
}

function playVideos(layer) {
  layer.querySelectorAll('video').forEach((v) => {
    v.play().catch(() => {
      // 音ありで自動再生できないブラウザでは、音を消して再生する
      v.muted = true;
      v.play().catch(() => {});
    });
    if (!v.muted) bgmDuck(true);
  });
}

function stopVideos(layer) {
  layer.querySelectorAll('video').forEach((v) => {
    v.pause();
    v.removeAttribute('src');
    v.load();
  });
  if (layer === gal.layers[gal.front] || !gal.open) bgmDuck(false);
}

// 設定を変えたときなどに、今の写真を表示し直す
function reshow() {
  if (gal.order.length) showSlide(gal.pos, { instant: true });
}

// ---- 進む・戻る ----

function schedule() {
  clearTimeout(gal.timer);
  resetProgress();
  if (!gal.playing || !gal.open || gal.order.length < 2 || gal.zoomed) return;
  const cur = gal.current;
  const video = cur.length === 1 && cur[0].item.type === 'video';
  let secs = gal.s.interval;
  if (video) {
    const max = gal.s.videoMax;
    if (gal.s.videoToEnd) {
      // 最後まで再生すると次へ進む (長さの上限があればそこで次へ)
      if (max) gal.timer = setTimeout(() => goNext(true), max * 1000);
      return;
    }
    if (max) secs = Math.min(secs, max);
  }
  startProgress(secs);
  gal.timer = setTimeout(() => goNext(true), secs * 1000);
}

function goNext(auto = false) {
  if (!gal.order.length) return;
  if (gal.wrapped) {
    if (auto && !gal.s.loop) {
      // 最後の写真で止める
      gal.playing = false;
      syncControls();
      showUi();
      toast('最後の写真です');
      return;
    }
    if (gal.s.order === 'shuffle' && gal.order.length > 2) {
      // 全部見せたら、並びを変えてもう一周 (同じ写真が続かないようにする)
      const last = gal.order[gal.pos];
      shuffleInPlace(gal.order);
      if (gal.order[0] === last) gal.order.push(gal.order.shift());
      gal.history = [];
      showSlide(0);
      return;
    }
  }
  gal.history.push(gal.pos);
  if (gal.history.length > 500) gal.history.shift();
  showSlide(gal.nextPos, { dir: 1 });
}

function goPrev() {
  if (!gal.order.length) return;
  const n = gal.order.length;
  const pos = gal.history.length ? gal.history.pop() : (gal.pos - Math.max(1, gal.current.length) + n) % n;
  showSlide(pos, { dir: -1 });
}

function jumpTo(pos) {
  gal.history.push(gal.pos);
  showSlide(pos);
}

function togglePlay(force) {
  gal.playing = typeof force === 'boolean' ? force : !gal.playing;
  if (gal.playing && gal.zoomed) unzoom();
  syncControls();
  schedule();
  if (gal.s.bgmPauseWithSlides && gal.bgm.files.length) {
    if (gal.playing) bgmResume();
    else bgmFade(0, 600, () => gal.bgm.audio?.pause());
  }
  showUi();
}

function changeSpeed(delta) {
  const i = INTERVALS.indexOf(gal.s.interval);
  const next = INTERVALS[Math.max(0, Math.min(INTERVALS.length - 1, (i < 0 ? 1 : i) + delta))];
  setSetting('interval', next);
  toast(`${intervalLabel(next)}ごとに切り替えます`, { duration: 1500 });
}

function resetProgress() {
  const bar = gal.progressEl;
  bar.style.transition = 'none';
  bar.style.width = '0';
}

function startProgress(secs) {
  const bar = gal.progressEl;
  if (!gal.s.progress) return;
  void bar.offsetWidth;
  bar.style.transition = `width ${secs}s linear`;
  bar.style.width = '100%';
}

// ---- 情報の表示 ----

function updateCaption() {
  const it = currentItem();
  gal.where.textContent = it ? folderText(it) : '';
  gal.count.textContent = it ? `${countText()}　${photoDateText(it.mtime)}` : '';
}

function updateInfo() {
  const s = gal.s;
  const it = currentItem();
  const lines = [];
  if (s.clock && !s.clockLarge) lines.push(`<div class="gi-clock">${clockText()}</div>`);
  if (s.today && !s.clockLarge) lines.push(`<div class="gi-today">${todayText()}</div>`);
  if (it) {
    if (s.folderName) lines.push(`<div>${esc(folderText(it))}</div>`);
    const when = [];
    if (s.photoDate) when.push(photoDateText(it.mtime));
    if (s.yearsAgo) when.push(agoText(it.mtime));
    if (when.length) lines.push(`<div>${esc(when.join('・'))}</div>`);
    if (s.fileName) lines.push(`<div class="gi-file">${esc(itemName(it))}</div>`);
    if (s.counter) lines.push(`<div class="gi-count">${countText()}</div>`);
  }
  gal.info.innerHTML = lines.join('');
  gal.info.hidden = !lines.length;
  gal.bigClock.hidden = !s.clockLarge;
  if (s.clockLarge) gal.bigClock.innerHTML = `<div class="gb-time">${clockText()}</div><div class="gb-date">${todayText()}</div>`;
}

function updateClock() {
  const t = clockText();
  const c = gal.info.querySelector('.gi-clock');
  if (c && c.textContent !== t) c.textContent = t;
  const big = gal.bigClock.querySelector('.gb-time');
  if (big && big.textContent !== t) {
    big.textContent = t;
    gal.bigClock.querySelector('.gb-date').textContent = todayText();
  }
}

function updateNextPreview() {
  const it = gal.items[gal.order[gal.nextPos]];
  const show = gal.s.nextPreview && it && gal.order.length > 1;
  gal.nextEl.hidden = !show;
  if (show) gal.nextEl.innerHTML = `<span>次</span><img alt="" src="${gThumbUrl(it)}">`;
}

function updateStrip() {
  const strip = gal.strip;
  strip.hidden = !gal.s.strip || gal.order.length < 2;
  if (strip.hidden) return;
  const n = gal.order.length;
  const start = Math.max(0, Math.min(gal.pos - 15, n - 40));
  const end = Math.min(n, start + 40);
  let html = '';
  for (let p = start; p < end; p++) {
    const it = gal.items[gal.order[p]];
    html += `<button type="button" class="g-thumb${p === gal.pos ? ' on' : ''}" data-pos="${p}" title="${esc(itemName(it))}">
      <img alt="" loading="lazy" src="${gThumbUrl(it)}">${it.type === 'video' ? icon('play') : ''}</button>`;
  }
  strip.innerHTML = html;
  const cur = strip.querySelector('.on');
  if (cur) strip.scrollLeft = cur.offsetLeft - strip.clientWidth / 2 + cur.offsetWidth / 2;
}

function showLoading(on) {
  gal.loadingEl.hidden = !on;
}

function showEmpty(message) {
  showLoading(false);
  gal.layers.forEach(resetLayer);
  gal.current = [];
  updateCaption();
  updateInfo();
  updateStrip();
  gal.nextEl.hidden = true;
  const msg = message || (gal.all.length
    ? '条件に合う写真がありません。設定の「期間」や「写真の向き」を見直してください。'
    : '表示できる写真がありません。');
  gal.emptyEl.innerHTML = `<p>${esc(msg)}</p><button class="btn" type="button" data-g="settings">${icon('settings')}設定を開く</button>`;
  gal.emptyEl.hidden = false;
  showUi();
}

// 設定のうち、写真を選び直さずにすぐ反映できるもの
function applyStaticSettings() {
  const s = gal.s;
  const el = gal.el;
  el.style.setProperty('--g-tr', `${s.transitionSpeed}s`);
  [...el.classList].filter((c) => /^(tone|info|size)-/.test(c)).forEach((c) => el.classList.remove(c));
  el.classList.add(`tone-${s.tone}`, `info-${s.infoPos}`, `size-${s.infoSize}`);
  el.classList.toggle('next-left', s.infoPos === 'tr');
  gal.vignette.hidden = !s.vignette;
  gal.grain.hidden = !s.grain;
  gal.progressEl.hidden = !s.progress;
  updateDim();
  bgmApplyVolume();
}

function syncControls() {
  gal.playBtn.innerHTML = icon(gal.playing ? 'pause' : 'play');
  gal.shuffleBtn.setAttribute('aria-pressed', String(gal.s.order === 'shuffle'));
  gal.speedLabel.textContent = intervalLabel(gal.s.interval);
}

// ---- 操作ボタンを隠す ----

function showUi() {
  gal.el.classList.remove('idle');
  // 下に出す文字が操作ボタンに重ならないよう、ボタンの高さを渡す
  gal.el.style.setProperty('--g-bar-h', `${gal.el.querySelector('.g-bar').offsetHeight}px`);
  clearTimeout(gal.idleTimer);
  const delay = gal.s.uiHideDelay;
  if (!delay) return;
  gal.idleTimer = setTimeout(() => {
    const busy = !gal.settingsEl.hidden || !gal.gridEl.hidden || !gal.emptyEl.hidden || document.querySelector('.menu-pop, dialog[open]');
    if (gal.open && gal.playing && !busy) gal.el.classList.add('idle');
  }, delay * 1000);
}

function hideUi() {
  clearTimeout(gal.idleTimer);
  gal.el.classList.add('idle');
}

// ---- 毎秒の処理 (時計・おやすみタイマー・夜の明るさ・自動取り込み) ----

function inNight(hour) {
  const { nightStart: a, nightEnd: b } = gal.s;
  return a > b ? hour >= a || hour < b : hour >= a && hour < b;
}

function updateDim() {
  const s = gal.s;
  const night = s.nightDim && inNight(new Date().getHours());
  gal.dim.style.opacity = String(Math.max(1 - s.brightness / 100, night ? 0.6 : 0));
}

function tick() {
  if (!gal.open) return;
  updateClock();
  const now = Date.now();
  if (now % 15000 < 1000) updateDim();
  if (gal.sleepAt && now >= gal.sleepAt) {
    closeGallery();
    toast('おやすみタイマーでギャラリーを終了しました', { duration: 6000 });
    return;
  }
  if (gal.s.autoRefresh && now - gal.lastRefresh > REFRESH_EVERY) {
    gal.lastRefresh = now;
    loadGalleryItems(currentItem(), { silent: true });
  }
}

// ---- この写真の操作 (メニュー) ----

function openMenu(anchor) {
  const it = currentItem();
  if (!it) return;
  showMenu(anchor, [
    { label: 'この写真をダウンロード', icon: 'download', onClick: () => downloadItem(it) },
    { label: 'アルバムで開く', icon: 'folder', onClick: () => { closeGallery(true); openInAlbum(it.album, it.path); } },
    ...(it.type === 'image' ? [{ label: 'この写真を印刷', icon: 'print', onClick: () => printItem(it) }] : []),
    { label: 'スマホで開く（QRコード）', icon: 'expand', onClick: () => showPhotoQr(it) },
    { label: 'この写真を今後表示しない', icon: 'close', danger: true, onClick: () => excludeItem(it) },
  ]);
}

function downloadItem(it) {
  const heif = isHeifName(it.path);
  const a = document.createElement('a');
  a.href = `/api/file?${itemQs(it)}&dl=1${heif ? '&format=jpg' : ''}`;
  a.download = heif ? itemName(it).replace(/\.[^.]+$/, '.jpg') : itemName(it);
  document.body.append(a);
  a.click();
  a.remove();
  toast('ダウンロードしています');
}

function printItem(it) {
  const job = { items: [{ url: gDisplayUrl(it), name: itemName(it), mtime: it.mtime }] };
  try {
    sessionStorage.setItem('homealbum.printJob', JSON.stringify(job));
  } catch {
    toast('印刷の準備ができませんでした', { error: true });
    return;
  }
  closeGallery(true);
  location.href = '/print.html';
}

function baseUrl() {
  return gal.lanUrl || `${location.origin}/`;
}

function showPhotoQr(it) {
  const hash = '#/a/' + [it.album, ...itemFolder(it).split('/').filter(Boolean)].map(encodeURIComponent).join('/');
  const url = `${baseUrl()}?${qs({ open: itemName(it) })}${hash}`;
  showQrDialog({ title: 'スマホでこの写真を開く', message: 'スマホのカメラで読み取ると、この写真がスマホで開きます（同じ Wi-Fi につないでください）。', url });
}

function showFrameUrl() {
  const src = gal.source;
  const params = { gallery: src.album };
  if (src.path) params.path = src.path;
  const url = `${baseUrl()}?${qs(params)}`;
  showQrDialog({
    title: 'フォトフレーム用のアドレス',
    message: 'このアドレスをタブレットなどで開くと、すぐにギャラリーが始まります。ブラウザの「ホーム画面に追加」をしておくと便利です。',
    url,
  });
}

function showQrDialog({ title, message, url }) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `
    <form method="dialog">
      <h2>${esc(title)}</h2>
      <p>${esc(message)}</p>
      <div class="g-qr"><img alt="QRコード" src="/api/qr?text=${encodeURIComponent(url)}"></div>
      <input class="input" readonly value="${esc(url)}">
      <div class="actions">
        <button class="btn" type="button" data-copy>コピー</button>
        <button class="btn primary" value="ok">閉じる</button>
      </div>
    </form>`;
  document.body.append(dlg);
  const input = dlg.querySelector('input');
  dlg.querySelector('[data-copy]').onclick = async () => {
    if (await copyText(url)) {
      toast('コピーしました');
    } else {
      input.select();
      toast('選んだ文字をコピーしてください');
    }
  };
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

function excludeItem(it) {
  gal.excluded.add(itemKey(it));
  saveExcluded();
  toast('この写真は今後ギャラリーに表示されません（設定から元に戻せます）', { duration: 4000 });
  const next = gal.items[gal.order[gal.nextPos]];
  rebuildItems(next && next !== it ? next : null);
}

// ---- 一覧 ----

function openGrid() {
  const wasPlaying = gal.playing;
  togglePlay(false);
  const el = gal.gridEl;
  el.innerHTML = `
    <div class="gg-head">
      <strong>一覧（${gal.order.length}枚）</strong>
      <button class="btn icon" type="button" data-gg="close" title="閉じる" aria-label="閉じる">${icon('close')}</button>
    </div>
    <div class="gg-grid"></div>
    <div class="gg-more"></div>`;
  el.hidden = false;
  const grid = el.querySelector('.gg-grid');
  let rendered = 0;
  const more = () => {
    const end = Math.min(gal.order.length, rendered + 240);
    let html = '';
    for (let p = rendered; p < end; p++) {
      const it = gal.items[gal.order[p]];
      html += `<button type="button" class="gg-item${p === gal.pos ? ' on' : ''}" data-pos="${p}"><img alt="" loading="lazy" src="${gThumbUrl(it)}">${it.type === 'video' ? icon('play') : ''}</button>`;
    }
    grid.insertAdjacentHTML('beforeend', html);
    rendered = end;
  };
  while (rendered <= gal.pos) more();
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && rendered < gal.order.length) more();
  }, { root: el, rootMargin: '600px' });
  observer.observe(el.querySelector('.gg-more'));
  el.querySelector('.gg-item.on')?.scrollIntoView({ block: 'center' });
  const close = (pos) => {
    observer.disconnect();
    el.hidden = true;
    el.innerHTML = '';
    if (pos !== undefined) jumpTo(pos);
    if (wasPlaying) togglePlay(true);
  };
  el.onclick = (e) => {
    e.stopPropagation();
    const item = e.target.closest('.gg-item');
    if (item) close(Number(item.dataset.pos));
    else if (e.target.closest('[data-gg="close"]')) close();
  };
}

// ---- ダブルタップで拡大 ----

function toggleZoom(e) {
  if (gal.zoomed) { unzoom(); return; }
  const fig = e.target.closest?.('.g-layer.on .g-photo') || gal.layers[gal.front].querySelector('.g-photo');
  const motion = fig?.querySelector('.g-motion');
  if (!motion || fig.querySelector('video')) return;
  const r = fig.getBoundingClientRect();
  const ox = ((e.clientX - r.left) / r.width) * 100;
  const oy = ((e.clientY - r.top) / r.height) * 100;
  motion.classList.add('zoomed');
  motion.style.transformOrigin = `${ox}% ${oy}%`;
  gal.zoomed = { motion, wasPlaying: gal.playing };
  gal.playing = false;
  clearTimeout(gal.timer);
  resetProgress();
  syncControls();
}

function unzoom() {
  const z = gal.zoomed;
  if (!z) return;
  gal.zoomed = null;
  z.motion.classList.remove('zoomed');
  gal.playing = z.wasPlaying;
  syncControls();
  schedule();
}

// ---- 設定画面 ----

function optionsOf(item) {
  return typeof item.options === 'function' ? item.options() : item.options;
}

function renderControl(item) {
  const s = gal.s;
  const v = s[item.key];
  if (item.type === 'toggle') {
    return `<label class="switch gs-row"><input type="checkbox" data-key="${item.key}" ${v ? 'checked' : ''}>${esc(item.label)}</label>`;
  }
  if (item.type === 'range') {
    return `<div class="gs-row gs-field">
      <div class="gs-label"><span>${esc(item.label)}</span><output>${v}${item.unit}</output></div>
      <input type="range" data-key="${item.key}" min="${item.min}" max="${item.max}" step="${item.step}" value="${v}">
    </div>`;
  }
  if (item.type === 'seg') {
    return `<div class="gs-row gs-field"><div class="gs-label">${esc(item.label)}</div>
      <div class="seg" data-key="${item.key}">${optionsOf(item).map(([ov, ol]) =>
        `<button type="button" data-v="${ov}" class="${String(v) === String(ov) ? 'on' : ''}">${esc(ol)}</button>`).join('')}</div></div>`;
  }
  return `<div class="gs-row gs-field"><label class="gs-label">${esc(item.label)}</label>
    <select class="select" data-key="${item.key}" ${item.num ? 'data-num="1"' : ''}>${optionsOf(item).map(([ov, ol]) =>
      `<option value="${ov}" ${String(v) === String(ov) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select></div>`;
}

function renderSettings() {
  const el = gal.settingsEl;
  const scroll = el.querySelector('.gs-body')?.scrollTop || 0;
  const bgm = gal.bgm;
  const sections = GALLERY_SCHEMA.map((sec) => {
    const items = sec.items.filter((it) => !it.dep || gal.s[it.dep]).map(renderControl).join('');
    let extra = '';
    if (sec.custom === 'bgm') {
      extra = `
        <div class="gs-row">
          <button class="btn" type="button" data-act="bgm-pick">${icon('plus')}音楽ファイルを選ぶ</button>
          ${bgm.files.length ? `<button class="btn" type="button" data-act="bgm-next">次の曲</button><button class="btn" type="button" data-act="bgm-clear">音楽をやめる</button>` : ''}
        </div>
        <p class="gs-note">${bgm.files.length
          ? `再生中：${esc(bgm.files[bgm.index]?.name || '')}（全${bgm.files.length}曲を順番に流します）`
          : 'この端末に入っている音楽ファイルを選ぶと、写真と一緒に流せます。複数選ぶと順番に流します。ページを閉じると選び直しになります。'}</p>`;
    } else if (sec.custom === 'frame') {
      extra = `
        <div class="gs-row gs-buttons">
          <button class="btn" type="button" data-act="frame-url">フォトフレーム用のアドレス</button>
          <button class="btn" type="button" data-act="unexclude" ${gal.excluded.size ? '' : 'disabled'}>表示しない写真を元に戻す（${gal.excluded.size}枚）</button>
        </div>`;
    }
    return `<section class="gs-sec"><h3>${esc(sec.title)}</h3>${items}${extra}</section>`;
  }).join('');
  el.innerHTML = `
    <div class="gs-head">
      <strong>ギャラリーの設定</strong>
      <button class="btn icon" type="button" data-act="close-settings" title="閉じる" aria-label="閉じる">${icon('close')}</button>
    </div>
    <div class="gs-body">
      <section class="gs-sec">
        <h3>おすすめの設定</h3>
        <div class="gs-presets">${GALLERY_PRESETS.map((p) => `
          <button class="gs-preset" type="button" data-preset="${p.id}"><strong>${esc(p.label)}</strong><span>${esc(p.desc)}</span></button>`).join('')}
        </div>
      </section>
      ${sections}
      <section class="gs-sec">
        <button class="btn danger" type="button" data-act="reset">設定をすべて最初に戻す</button>
        <p class="gs-note">キーボード：← → 前後　スペース 一時停止　F 全画面　G 一覧　S シャッフル　I 情報　＋／− 速さ　Esc 終わる</p>
      </section>
    </div>`;
  el.querySelector('.gs-body').scrollTop = scroll;
}

function toggleSettings(open = gal.settingsEl.hidden) {
  gal.settingsEl.hidden = !open;
  gal.el.classList.toggle('settings-open', open);
  if (open) renderSettings();
  showUi();
}

function setSetting(key, value, { rerender = false } = {}) {
  gal.s[key] = value;
  saveGallerySettings();
  afterSettingsChange([key]);
  if (rerender && !gal.settingsEl.hidden) renderSettings();
}

function afterSettingsChange(keys) {
  applyStaticSettings();
  syncControls();
  if (keys.includes('sleepMinutes')) gal.sleepAt = gal.s.sleepMinutes ? Date.now() + gal.s.sleepMinutes * 60000 : 0;
  if (keys.includes('recursive')) {
    loadGalleryItems(currentItem());
    return;
  }
  if (keys.some((k) => REBUILD_KEYS.has(k))) {
    rebuildItems(currentItem());
    return;
  }
  if (keys.some((k) => RESHOW_KEYS.has(k))) {
    reshow();
    return;
  }
  updateInfo();
  updateStrip();
  updateNextPreview();
  if (keys.includes('interval') || keys.includes('progress') || keys.includes('videoToEnd') || keys.includes('videoMax')) schedule();
  if (keys.includes('videoSound')) {
    gal.layers[gal.front].querySelectorAll('video').forEach((v) => { v.muted = !gal.s.videoSound; });
    bgmDuck(gal.s.videoSound && !!gal.layers[gal.front].querySelector('video'));
  }
}

function applyPreset(id) {
  const preset = GALLERY_PRESETS.find((p) => p.id === id);
  if (!preset) return;
  gal.s = { ...GALLERY_DEFAULTS, ...preset.s };
  saveGallerySettings();
  afterSettingsChange(Object.keys(GALLERY_DEFAULTS));
  renderSettings();
  toast(`「${preset.label}」の設定にしました`);
}

gal.settingsEl.addEventListener('input', (e) => {
  const key = e.target.dataset.key;
  if (!key) return;
  if (e.target.type === 'checkbox') {
    // 関連する項目の表示を切り替えるため、設定画面を描き直す
    setSetting(key, e.target.checked, { rerender: GALLERY_SCHEMA.some((sec) => sec.items.some((it) => it.dep === key)) });
  } else if (e.target.type === 'range') {
    const v = Number(e.target.value);
    const item = GALLERY_SCHEMA.flatMap((sec) => sec.items).find((it) => it.key === key);
    e.target.previousElementSibling.querySelector('output').textContent = `${v}${item.unit}`;
    setSetting(key, v);
  } else if (e.target.tagName === 'SELECT') {
    setSetting(key, e.target.dataset.num ? Number(e.target.value) : e.target.value);
  }
});

gal.settingsEl.addEventListener('click', async (e) => {
  const segBtn = e.target.closest('.seg button');
  if (segBtn) {
    const seg = segBtn.closest('.seg');
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === segBtn));
    setSetting(seg.dataset.key, segBtn.dataset.v);
    return;
  }
  const preset = e.target.closest('[data-preset]');
  if (preset) { applyPreset(preset.dataset.preset); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'close-settings') toggleSettings(false);
  else if (act === 'bgm-pick') gal.bgmInput.click();
  else if (act === 'bgm-next') bgmPlay(gal.bgm.index + 1);
  else if (act === 'bgm-clear') bgmClear();
  else if (act === 'frame-url') showFrameUrl();
  else if (act === 'unexclude') {
    gal.excluded.clear();
    saveExcluded();
    toast('表示しないようにした写真を元に戻しました');
    renderSettings();
    rebuildItems(currentItem());
  } else if (act === 'reset') {
    const ok = await showDialog({ title: '設定を最初に戻しますか？', message: 'ギャラリーの設定がすべて最初の状態に戻ります。', okText: '最初に戻す', danger: true });
    if (!ok) return;
    gal.s = { ...GALLERY_DEFAULTS };
    saveGallerySettings();
    afterSettingsChange(Object.keys(GALLERY_DEFAULTS));
    renderSettings();
  }
});

// ---- 音楽 (BGM) ----

function bgmAudio() {
  if (!gal.bgm.audio) {
    const a = new Audio();
    a.addEventListener('ended', () => bgmPlay(gal.bgm.index + 1));
    gal.bgm.audio = a;
  }
  return gal.bgm.audio;
}

function bgmTarget() {
  return (gal.s.bgmVolume / 100) * (gal.bgm.ducked ? 0.25 : 1);
}

function bgmFade(target, ms, then) {
  const a = gal.bgm.audio;
  clearInterval(gal.bgm.fadeTimer);
  if (!a) { if (then) then(); return; }
  const from = a.volume;
  const steps = Math.max(1, Math.round(ms / 50));
  let i = 0;
  gal.bgm.fadeTimer = setInterval(() => {
    i++;
    a.volume = Math.max(0, Math.min(1, from + ((target - from) * i) / steps));
    if (i >= steps) {
      clearInterval(gal.bgm.fadeTimer);
      if (then) then();
    }
  }, 50);
}

function bgmPlay(index) {
  const files = gal.bgm.files;
  if (!files.length) return;
  gal.bgm.index = ((index % files.length) + files.length) % files.length;
  const a = bgmAudio();
  if (gal.bgm.url) URL.revokeObjectURL(gal.bgm.url);
  gal.bgm.url = URL.createObjectURL(files[gal.bgm.index]);
  a.src = gal.bgm.url;
  a.volume = 0;
  a.play().then(() => bgmFade(bgmTarget(), 1500)).catch(() => toast('この音楽ファイルは再生できません', { error: true }));
  if (!gal.settingsEl.hidden) renderSettings();
}

function bgmResume() {
  const a = gal.bgm.audio;
  if (!a || !gal.bgm.files.length) return;
  a.volume = 0;
  a.play().then(() => bgmFade(bgmTarget(), 1500)).catch(() => {});
}

function bgmClear() {
  bgmFade(0, 500, () => {
    gal.bgm.audio?.pause();
    if (gal.bgm.url) URL.revokeObjectURL(gal.bgm.url);
    gal.bgm.url = null;
    gal.bgm.files = [];
    if (!gal.settingsEl.hidden) renderSettings();
  });
}

function bgmApplyVolume() {
  const a = gal.bgm.audio;
  if (a && !a.paused) {
    clearInterval(gal.bgm.fadeTimer);
    a.volume = bgmTarget();
  }
}

// 音ありの動画を流している間は、音楽を小さくする
function bgmDuck(on) {
  if (gal.bgm.ducked === on) return;
  gal.bgm.ducked = on;
  const a = gal.bgm.audio;
  if (a && !a.paused) bgmFade(bgmTarget(), 400);
}

gal.bgmInput.addEventListener('change', () => {
  const files = [...gal.bgmInput.files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(f.name));
  gal.bgmInput.value = '';
  if (!files.length) return;
  gal.bgm.files = files;
  bgmPlay(0);
});

// ---- ボタン・タップ・キーボード ----

gal.el.addEventListener('click', (e) => {
  // 一覧や設定を描き直してクリックした要素が消えた場合は、画面のタップとして扱わない
  if (!gal.el.contains(e.target)) return;
  const b = e.target.closest('[data-g]');
  if (b) {
    const act = b.dataset.g;
    if (act === 'close') closeGallery();
    else if (act === 'prev') goPrev();
    else if (act === 'next') goNext();
    else if (act === 'play') togglePlay();
    else if (act === 'slower') changeSpeed(1);
    else if (act === 'faster') changeSpeed(-1);
    else if (act === 'shuffle') setSetting('order', gal.s.order === 'shuffle' ? 'folder' : 'shuffle', { rerender: true });
    else if (act === 'grid') openGrid();
    else if (act === 'settings') toggleSettings();
    else if (act === 'full') toggleFullscreen();
    else if (act === 'menu') openMenu(b);
    showUi();
    return;
  }
  const thumb = e.target.closest('.g-thumb');
  if (thumb) { jumpTo(Number(thumb.dataset.pos)); showUi(); return; }
  if (e.target.closest('.g-next')) { goNext(); return; }
  if (e.target.closest('.g-top, .g-bar, .g-settings, .g-gridview, .g-empty')) { showUi(); return; }
  onStageTap(e);
});

let lastTap = 0;
let tapTimer = null;
function onStageTap(e) {
  const now = Date.now();
  if (now - lastTap < 300) {
    // ダブルタップ (ダブルクリック) で拡大・元に戻す
    clearTimeout(tapTimer);
    lastTap = 0;
    toggleZoom(e);
    return;
  }
  lastTap = now;
  const x = e.clientX / gal.el.clientWidth;
  tapTimer = setTimeout(() => {
    if (gal.zoomed) { unzoom(); return; }
    if (!gal.settingsEl.hidden) { toggleSettings(false); return; }
    if (gal.s.tapZones && x < 0.22) { goPrev(); showUi(); } else if (gal.s.tapZones && x > 0.78) { goNext(); showUi(); } else if (gal.el.classList.contains('idle')) showUi();
    else hideUi();
  }, 260);
}

function toggleFullscreen() {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else gal.el.requestFullscreen().catch(() => {});
}

gal.el.addEventListener('mousemove', () => showUi());

let lastWheel = 0;
gal.el.addEventListener('wheel', (e) => {
  if (!gal.s.wheel || e.target.closest('.g-settings, .g-gridview, .g-strip')) return;
  e.preventDefault();
  const now = Date.now();
  if (now - lastWheel < 450 || Math.abs(e.deltaY) < 4) return;
  lastWheel = now;
  if (e.deltaY > 0) goNext(); else goPrev();
}, { passive: false });

let touch = null;
gal.el.addEventListener('touchstart', (e) => {
  touch = e.touches.length === 1 && !e.target.closest('.g-settings, .g-gridview, .g-bar')
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
gal.el.addEventListener('touchend', (e) => {
  if (!touch || gal.zoomed) return;
  const dx = e.changedTouches[0].clientX - touch.x;
  const dy = e.changedTouches[0].clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    if (dx < 0) goNext(); else goPrev();
  } else if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) {
    // 上にスワイプで設定、下にスワイプで終わる
    if (dy < 0) toggleSettings(true); else closeGallery();
  }
});

document.addEventListener('keydown', (e) => {
  if (!gal.open || document.querySelector('dialog[open]')) return;
  if (e.target.closest?.('.g-settings') && /INPUT|SELECT/.test(e.target.tagName) && e.key !== 'Escape') return;
  const k = e.key;
  if (k === 'ArrowLeft') goPrev();
  else if (k === 'ArrowRight') goNext();
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'Escape') {
    if (!gal.gridEl.hidden) gal.gridEl.querySelector('[data-gg="close"]').click();
    else if (!gal.settingsEl.hidden) toggleSettings(false);
    else if (gal.zoomed) unzoom();
    else closeGallery();
  } else if (k === 'f' || k === 'F') toggleFullscreen();
  else if (k === 'g' || k === 'G') (gal.gridEl.hidden ? openGrid() : gal.gridEl.querySelector('[data-gg="close"]').click());
  else if (k === 's' || k === 'S') setSetting('order', gal.s.order === 'shuffle' ? 'folder' : 'shuffle', { rerender: true });
  else if (k === 'i' || k === 'I') { gal.info.classList.toggle('hidden-by-key'); gal.bigClock.classList.toggle('hidden-by-key'); }
  else if (k === '+' || k === ';') changeSpeed(-1);
  else if (k === '-') changeSpeed(1);
  else return;
  showUi();
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  if (!gal.open) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (gal.current.length) renderSlide(gal.current.map((p) => ({ ...p, media: p.media.cloneNode ? p.media.cloneNode() : p.media })), { instant: true });
  }, 200);
});

window.addEventListener('popstate', () => { if (gal.open && !history.state?.gallery) closeGallery(true); });
window.addEventListener('hashchange', () => closeGallery(true));

// アドレスに ?gallery= が付いていたら、すぐにギャラリーを始める (フォトフレーム用)
(() => {
  const params = new URLSearchParams(location.search);
  const album = params.get('gallery');
  if (album) setTimeout(() => openGallery({ album, path: params.get('path') || '' }, { autostart: true }), 0);
})();
