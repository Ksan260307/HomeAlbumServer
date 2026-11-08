// 閲覧画面
const $ = (id) => document.getElementById(id);
const els = {
  main: $('main'), title: $('title'), actions: $('actions'), back: $('backBtn'),
  selbar: $('selbar'), selcount: $('selcount'), selAll: $('selAll'), selDownload: $('selDownload'),
  selPrint: $('selPrint'), selGallery: $('selGallery'), selRename: $('selRename'), selDelete: $('selDelete'), selCancel: $('selCancel'),
  viewer: $('viewer'), vStage: $('vStage'), vName: $('vName'), vPos: $('vPos'),
  vClose: $('vClose'), vEdit: $('vEdit'), vDownload: $('vDownload'), vMore: $('vMore'), vPrev: $('vPrev'), vNext: $('vNext'),
  upload: $('uploadInput'),
};

const CHUNK = 240;
const state = {
  album: null, path: '', data: null, items: [],
  filter: 'all', sort: loadPref('sort', 'date-desc'),
  selecting: false, selected: new Set(), lastIndex: -1,
  rendered: 0, viewerIndex: -1, token: 0,
};

function loadPref(key, fallback) {
  try { return localStorage.getItem('homealbum.' + key) || fallback; } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem('homealbum.' + key, value); } catch { /* 保存できなくても動作に影響なし */ }
}

const joinPath = (...parts) => parts.filter(Boolean).join('/');
const qs = (o) => new URLSearchParams(o).toString();
const albumHash = (id, p = '') => '#/a/' + [id, ...p.split('/').filter(Boolean)].map(encodeURIComponent).join('/');
// 上書き保存などで中身が変わったら URL も変わるように、更新日時とサイズを付ける
// (編集した写真は更新日時を元のままにするため、サイズも使う)
const version = (f) => `${f.mtime}-${f.size}`;
const fileVersion = (name) => {
  const f = state.data?.files.find((x) => x.name === name);
  return f ? `&v=${version(f)}` : '';
};
const fileUrl = (name, dl) => `/api/file?${qs({ album: state.album.id, path: joinPath(state.path, name) })}${dl ? '&dl=1' : fileVersion(name)}`;
const thumbUrl = (f) => `/api/thumb?${qs({ album: state.album.id, path: joinPath(state.path, f.name), v: version(f) })}`;
const previewUrl = (f) => `/api/preview?${qs({ album: state.album.id, path: joinPath(state.path, f.name), v: version(f) })}`;
const extOf = (name) => (name.match(/\.([^.]+)$/) || [, ''])[1].toUpperCase();

function formatDate(ms, withTime = true) {
  const d = new Date(ms);
  const date = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return withTime ? `${date} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : date;
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// ---- 画面の切り替え ----

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'a' && parts[1]) return { albumId: parts[1], path: parts.slice(2).join('/') };
  return null;
}

function route() {
  closeViewer(true);
  exitSelection();
  captureQueue.length = 0;
  const r = parseHash();
  window.scrollTo(0, 0);
  if (r) renderAlbum(r.albumId, r.path);
  else renderHome();
}

function setHeader({ title, back, actions = '' }) {
  if (title === null) {
    els.title.innerHTML = '<a class="brand" href="#/"><img src="icon.svg" width="28" height="28" alt=""> ホームアルバム</a>';
  } else {
    els.title.textContent = title;
  }
  els.back.hidden = !back;
  els.back.innerHTML = icon('back');
  els.back.onclick = () => { location.hash = back; };
  els.actions.innerHTML = actions;
  document.title = title ? `${title} - ホームアルバム` : 'ホームアルバム';
}

function showLoading() {
  els.main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
}

function showError(message) {
  els.main.innerHTML = `<div class="empty">${icon('image')}<p>${esc(message)}</p><a class="btn" href="#/">トップへ戻る</a></div>`;
}

// ---- トップ (アルバム一覧) ----

async function renderHome() {
  const token = ++state.token;
  state.album = null;
  setHeader({
    title: null,
    actions: `<a class="btn has-optional" href="/admin" title="管理画面">${icon('settings')}<span class="label-optional">管理</span></a>`,
  });
  showLoading();
  let albums;
  try {
    albums = await api('/api/albums');
  } catch (e) {
    if (token === state.token) showError(e.message);
    return;
  }
  if (token !== state.token) return;
  if (albums.length) {
    els.actions.insertAdjacentHTML('afterbegin', `<button class="btn has-optional" id="galleryBtn" title="すべてのアルバムをギャラリーで見る">${icon('gallery')}<span class="label-optional">ギャラリー</span></button>`);
    $('galleryBtn').onclick = () => openGallery({ album: 'all', path: '' });
  }
  if (!albums.length) {
    els.main.innerHTML = `
      <div class="empty">${icon('folder')}
        <p>まだフォルダが登録されていません。<br>管理画面から、見たい写真や動画のフォルダを追加してください。</p>
        <a class="btn primary" href="/admin">管理画面を開く</a>
      </div>`;
    return;
  }
  els.main.innerHTML = `<div class="cards">${albums.map((a) => `
    <a class="card" href="${albumHash(a.id)}">
      <div class="cover">${icon('folder')}<img alt="" loading="lazy" src="/api/cover?${qs({ album: a.id, path: '' })}" onerror="this.remove()"></div>
      <div class="name">${esc(a.name)}</div>
    </a>`).join('')}</div>`;
}

// ---- フォルダの中身 ----

async function renderAlbum(albumId, path, { keepScroll = false } = {}) {
  const token = ++state.token;
  const scrollY = window.scrollY;
  if (!keepScroll) showLoading();
  let data;
  try {
    data = await api(`/api/list?${qs({ album: albumId, path })}`);
  } catch (e) {
    if (token === state.token) {
      setHeader({ title: 'エラー', back: '#/' });
      showError(e.message);
    }
    return;
  }
  if (token !== state.token) return;

  state.album = data.album;
  state.path = path;
  state.data = data;
  const parts = path.split('/').filter(Boolean);
  const parentHash = parts.length ? albumHash(albumId, parts.slice(0, -1).join('/')) : '#/';
  const canUpload = data.album.allowUpload;
  setHeader({
    title: parts.length ? parts[parts.length - 1] : data.album.name,
    back: parentHash,
    actions: `
      ${canUpload ? `<button class="btn has-optional" id="mkdirBtn" title="フォルダを作成">${icon('folderPlus')}<span class="label-optional">フォルダ作成</span></button>` : ''}
      ${canUpload ? `<button class="btn primary has-optional" id="uploadBtn" title="写真・動画をアップロード">${icon('upload')}<span class="label-optional">アップロード</span></button>` : ''}
      ${data.dirs.length || data.files.some((f) => f.type === 'image') ? `<button class="btn has-optional" id="galleryBtn" title="ギャラリーで見る">${icon('gallery')}<span class="label-optional">ギャラリー</span></button>` : ''}
      ${data.files.length ? `<button class="btn has-optional" id="selectBtn" title="選択">${icon('select')}<span class="label-optional">選択</span></button>` : ''}`,
  });
  const galleryBtn = $('galleryBtn');
  if (galleryBtn) galleryBtn.onclick = () => openGallery({ album: albumId, path });
  const selectBtn = $('selectBtn');
  if (selectBtn) selectBtn.onclick = () => (state.selecting ? exitSelection() : enterSelection());
  if (canUpload) {
    $('uploadBtn').onclick = () => els.upload.click();
    $('mkdirBtn').onclick = createFolder;
  }

  const crumbs = [`<a href="#/">ホーム</a>`];
  const all = [{ name: data.album.name, p: '' }, ...parts.map((n, i) => ({ name: n, p: parts.slice(0, i + 1).join('/') }))];
  all.forEach((c, i) => {
    crumbs.push('<span class="sep">›</span>');
    crumbs.push(i === all.length - 1 ? `<span class="here">${esc(c.name)}</span>` : `<a href="${albumHash(albumId, c.p)}">${esc(c.name)}</a>`);
  });

  const hasImages = data.files.some((f) => f.type === 'image');
  const hasVideos = data.files.some((f) => f.type === 'video');
  if (!(hasImages && hasVideos)) state.filter = 'all';

  els.main.innerHTML = `
    <nav class="crumbs">${crumbs.join('')}</nav>
    ${data.dirs.length ? `
      <div class="section-title">フォルダ</div>
      <div class="cards small">${data.dirs.map((d) => `
        <a class="card" href="${albumHash(albumId, joinPath(path, d.name))}">
          <div class="cover">${icon('folder')}<img alt="" loading="lazy" src="/api/cover?${qs({ album: albumId, path: joinPath(path, d.name) })}" onerror="this.remove()"></div>
          <div class="name">${esc(d.name)}</div>
        </a>`).join('')}</div>` : ''}
    ${data.files.length ? `
      ${data.dirs.length ? '<div class="section-title">写真・動画</div>' : ''}
      <div class="toolbar">
        ${hasImages && hasVideos ? `<div class="seg" id="filterSeg">
          <button data-f="all">すべて</button><button data-f="image">写真</button><button data-f="video">動画</button>
        </div>` : ''}
        <select class="select" id="sortSel" aria-label="並び順">
          <option value="date-desc">新しい順</option>
          <option value="date-asc">古い順</option>
          <option value="name">名前順</option>
        </select>
        <span class="count" id="countLabel"></span>
      </div>
      <div class="grid" id="grid"></div>
      <div class="more-sentinel" id="sentinel"></div>` : ''}
    ${!data.files.length && !data.dirs.length ? `
      <div class="empty">${icon('image')}<p>このフォルダには写真や動画がありません。</p>
        ${canUpload ? `<button class="btn primary" onclick="document.getElementById('uploadInput').click()">${icon('upload')}写真・動画をアップロード</button>` : ''}
      </div>` : ''}`;

  if (data.files.length) {
    const seg = $('filterSeg');
    if (seg) {
      seg.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        state.filter = b.dataset.f;
        exitSelection();
        renderGrid();
      };
    }
    const sortSel = $('sortSel');
    sortSel.value = state.sort;
    sortSel.onchange = () => { state.sort = sortSel.value; savePref('sort', state.sort); renderGrid(); };
    renderGrid();
    setupGridEvents();
  }
  if (keepScroll) window.scrollTo(0, scrollY);
  if (state.pendingOpen) {
    // ギャラリーや QRコードから指定された写真を開く
    const name = state.pendingOpen;
    state.pendingOpen = null;
    const i = state.items.findIndex((f) => f.name === name);
    if (i >= 0) {
      while (state.rendered <= i) renderMore();
      openViewer(i);
    }
  }
}

function computeItems() {
  const collator = new Intl.Collator('ja', { numeric: true });
  let items = state.data.files.filter((f) => state.filter === 'all' || f.type === state.filter);
  if (state.sort === 'name') items.sort((a, b) => collator.compare(a.name, b.name));
  else if (state.sort === 'date-asc') items.sort((a, b) => a.mtime - b.mtime);
  else items.sort((a, b) => b.mtime - a.mtime);
  return items;
}

function renderGrid() {
  state.items = computeItems();
  state.rendered = 0;
  const seg = $('filterSeg');
  if (seg) seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.f === state.filter));
  const images = state.data.files.filter((f) => f.type === 'image').length;
  const videos = state.data.files.length - images;
  $('countLabel').textContent = [images && `写真 ${images}枚`, videos && `動画 ${videos}本`].filter(Boolean).join('・');
  $('grid').innerHTML = '';
  renderMore();
}

function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

function renderMore() {
  const grid = $('grid');
  if (!grid || state.rendered >= state.items.length) return;
  const frag = document.createDocumentFragment();
  const end = Math.min(state.items.length, state.rendered + CHUNK);
  const byDate = state.sort !== 'name';
  for (let i = state.rendered; i < end; i++) {
    const f = state.items[i];
    if (byDate && (i === 0 || monthKey(f.mtime) !== monthKey(state.items[i - 1].mtime))) {
      const h = document.createElement('div');
      h.className = 'month';
      h.textContent = monthKey(f.mtime);
      frag.append(h);
    }
    frag.append(createTile(f, i));
  }
  grid.append(frag);
  state.rendered = end;
}

function createTile(f, i) {
  const b = document.createElement('button');
  b.className = 'tile' + (state.selected.has(f.name) ? ' selected' : '');
  b.dataset.i = i;
  b.title = f.name;
  b.innerHTML = `
    <div class="ph">${icon(f.type)}</div>
    <img alt="" loading="lazy" decoding="async">
    ${f.type === 'video' ? `<span class="badge">${icon('play')}動画</span>` : ''}
    <span class="check">${icon('check')}</span>`;
  const img = b.querySelector('img');
  img.onload = () => { img.classList.add('loaded'); b.querySelector('.ph')?.remove(); };
  img.onerror = () => onThumbError(f, img, b);
  img.src = thumbUrl(f);
  return b;
}

function onThumbError(f, img, tile) {
  if (f.type === 'video' && f.viewable && !f.captureTried) {
    f.captureTried = true;
    captureQueue.push({ f, img, album: state.album.id, path: state.path });
    pumpCapture();
    return;
  }
  const ph = tile.querySelector('.ph');
  if (ph && !ph.querySelector('span')) ph.insertAdjacentHTML('beforeend', `<span>${esc(extOf(f.name))}</span>`);
}

// サーバーで動画のサムネイルを作れない場合は、ブラウザで1コマ切り出して保存する
const captureQueue = [];
let capturing = false;

async function pumpCapture() {
  if (capturing) return;
  const job = captureQueue.pop();
  if (!job) return;
  capturing = true;
  try {
    if (job.img.isConnected) {
      const url = `/api/file?${qs({ album: job.album, path: joinPath(job.path, job.f.name) })}`;
      const blob = await captureFrame(url);
      if (blob && job.img.isConnected) {
        job.img.src = URL.createObjectURL(blob);
        fetch(`/api/thumb?${qs({ album: job.album, path: joinPath(job.path, job.f.name) })}`, {
          method: 'POST', headers: { 'X-HomeAlbum': '1', 'Content-Type': 'image/jpeg' }, body: blob,
        }).catch(() => {});
      } else if (job.img.isConnected) {
        job.img.onerror = null;
      }
    }
  } finally {
    capturing = false;
    pumpCapture();
  }
}

function captureFrame(url) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let done = false;
    const finish = (blob) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      resolve(blob);
    };
    const timer = setTimeout(() => finish(null), 20000);
    v.addEventListener('loadedmetadata', () => { v.currentTime = Math.min(1, (v.duration || 2) / 4); });
    v.addEventListener('seeked', () => {
      const w = v.videoWidth, h = v.videoHeight;
      if (!w || !h) return finish(null);
      const s = Math.min(1, 480 / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.round(w * s);
      c.height = Math.round(h * s);
      try {
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => finish(b), 'image/jpeg', 0.8);
      } catch {
        finish(null);
      }
    });
    v.addEventListener('error', () => finish(null));
    v.src = url;
  });
}

// ---- タップ・長押し・選択 ----

let gridObserver = null;

function setupGridEvents() {
  const grid = $('grid');
  if (gridObserver) gridObserver.disconnect();
  gridObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) renderMore();
  }, { rootMargin: '1200px' });
  gridObserver.observe($('sentinel'));

  let pressTimer = null;
  let pressed = false;
  let startX = 0, startY = 0;
  grid.addEventListener('pointerdown', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile || e.button !== 0) return;
    pressed = false;
    startX = e.clientX; startY = e.clientY;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressed = true;
      if (!state.selecting) enterSelection();
      toggleSelect(Number(tile.dataset.i));
      if (navigator.vibrate) navigator.vibrate(15);
    }, 500);
  });
  const cancelPress = () => clearTimeout(pressTimer);
  grid.addEventListener('pointerup', cancelPress);
  grid.addEventListener('pointercancel', cancelPress);
  grid.addEventListener('pointermove', (e) => {
    if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) cancelPress();
  });
  grid.addEventListener('contextmenu', (e) => { if (e.target.closest('.tile') && e.pointerType !== 'mouse') e.preventDefault(); });
  grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    if (pressed) { pressed = false; return; }
    const i = Number(tile.dataset.i);
    if (state.selecting) {
      if (e.shiftKey && state.lastIndex >= 0) selectRange(state.lastIndex, i);
      else toggleSelect(i);
    } else {
      openViewer(i);
    }
  });
}

function tileAt(i) {
  return document.querySelector(`.tile[data-i="${i}"]`);
}

function toggleSelect(i) {
  const f = state.items[i];
  if (!f) return;
  if (state.selected.has(f.name)) state.selected.delete(f.name);
  else state.selected.add(f.name);
  tileAt(i)?.classList.toggle('selected', state.selected.has(f.name));
  state.lastIndex = i;
  updateSelbar();
}

function selectRange(a, b) {
  const [from, to] = a < b ? [a, b] : [b, a];
  for (let i = from; i <= to; i++) {
    state.selected.add(state.items[i].name);
    tileAt(i)?.classList.add('selected');
  }
  state.lastIndex = b;
  updateSelbar();
}

function enterSelection() {
  state.selecting = true;
  document.body.classList.add('selecting');
  els.selbar.hidden = false;
  const btn = $('selectBtn');
  if (btn) btn.classList.add('primary');
  updateSelbar();
}

function exitSelection() {
  state.selecting = false;
  state.selected.clear();
  state.lastIndex = -1;
  document.body.classList.remove('selecting');
  els.selbar.hidden = true;
  document.querySelectorAll('.tile.selected').forEach((t) => t.classList.remove('selected'));
  const btn = $('selectBtn');
  if (btn) btn.classList.remove('primary');
}

function updateSelbar() {
  const n = state.selected.size;
  const edit = state.album && state.album.allowEdit;
  els.selcount.textContent = n ? `${n}件を選択中` : '写真や動画をタップして選択';
  els.selDownload.innerHTML = `${icon('download')}${n > 1 ? 'まとめてダウンロード' : 'ダウンロード'}`;
  els.selDownload.disabled = n === 0;
  const allSelected = state.items.length > 0 && state.items.every((f) => state.selected.has(f.name));
  els.selAll.textContent = allSelected ? '選択を解除' : 'すべて選択';
  els.selPrint.innerHTML = `${icon('print')}印刷`;
  els.selPrint.disabled = !state.items.some((f) => f.type === 'image' && state.selected.has(f.name));
  els.selGallery.innerHTML = `${icon('gallery')}ギャラリー`;
  els.selGallery.disabled = n === 0;
  els.selRename.hidden = !edit || n !== 1;
  els.selDelete.hidden = !edit;
  els.selDelete.disabled = n === 0;
}

els.selCancel.onclick = exitSelection;
els.selAll.onclick = () => {
  const allSelected = state.items.every((f) => state.selected.has(f.name));
  if (allSelected) {
    state.selected.clear();
  } else {
    state.items.forEach((f) => state.selected.add(f.name));
  }
  document.querySelectorAll('.tile').forEach((t) => {
    t.classList.toggle('selected', state.selected.has(state.items[Number(t.dataset.i)]?.name));
  });
  updateSelbar();
};
els.selDownload.onclick = () => downloadFiles([...state.selected]);
els.selDelete.onclick = () => deleteFiles([...state.selected]);
els.selRename.onclick = () => renameFile([...state.selected][0]);
els.selPrint.onclick = () => printFiles([...state.selected]);
els.selGallery.onclick = () => {
  // 選んだ写真だけでギャラリーを始める
  const names = state.items.filter((f) => state.selected.has(f.name)).map((f) => f.name);
  exitSelection();
  openGallery({ album: state.album.id, path: state.path, names });
};

// 指定した写真をアルバムで開く (ギャラリーや QRコードから)
function openInAlbum(albumId, filePath) {
  const parts = filePath.split('/');
  state.pendingOpen = parts.pop();
  state.filter = 'all';
  const hash = albumHash(albumId, parts.join('/'));
  if (location.hash === hash) route();
  else location.hash = hash;
}

// ---- 印刷 ----

function printFiles(names) {
  const wanted = new Set(names);
  const items = state.items
    .filter((f) => wanted.has(f.name) && f.type === 'image')
    .map((f) => ({ url: f.viewable ? fileUrl(f.name) : previewUrl(f), name: f.name, mtime: f.mtime }));
  if (!items.length) {
    toast('印刷できるのは写真だけです', { error: true });
    return;
  }
  try {
    sessionStorage.setItem('homealbum.printJob', JSON.stringify({ items }));
  } catch {
    toast('印刷の準備ができませんでした', { error: true });
    return;
  }
  location.href = '/print.html';
}

// ---- ダウンロード ----

const isHeif = (name) => /\.(heic|heif)$/i.test(name);

function downloadFiles(names) {
  if (!names.length) return;
  // HEIC は iPhone 以外では開けないことが多いので、いつも JPEG に変換して保存する
  const toJpeg = names.some(isHeif);
  if (names.length === 1) {
    const convert = isHeif(names[0]);
    const a = document.createElement('a');
    a.href = fileUrl(names[0], true) + (convert ? '&format=jpg' : '');
    a.download = convert ? names[0].replace(/\.[^.]+$/, '.jpg') : names[0];
    if (convert) toast('JPEGに変換しています。まもなくダウンロードが始まります', { duration: 5000 });
    document.body.append(a);
    a.click();
    a.remove();
    return;
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/zip';
  const add = (name, value) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.append(input);
  };
  add('album', state.album.id);
  add('path', state.path);
  names.forEach((n) => add('names', n));
  if (toJpeg) add('convert', 'jpg');
  document.body.append(form);
  form.submit();
  form.remove();
  toast(`${names.length}件を1つのZIPファイルにまとめています。まもなくダウンロードが始まります`, { duration: 6000 });
}

// ---- 編集 ----

async function reloadAlbum() {
  await renderAlbum(state.album.id, state.path, { keepScroll: true });
}

async function deleteFiles(names) {
  if (!names.length) return;
  const ok = await showDialog({
    title: `${names.length}件を削除しますか？`,
    message: '削除したファイルは、サーバーにしているPCの「ごみ箱」に移動します。',
    okText: '削除する',
    danger: true,
  });
  if (!ok) return false;
  try {
    await api('/api/delete', { method: 'POST', json: { album: state.album.id, path: state.path, names } });
    toast(`${names.length}件を削除しました`);
    exitSelection();
    await reloadAlbum();
    return true;
  } catch (e) {
    toast(e.message, { error: true });
    return false;
  }
}

async function renameFile(name) {
  const dot = name.lastIndexOf('.');
  const value = await showDialog({
    title: '名前を変更', input: name, okText: '変更する', select: [0, dot > 0 ? dot : name.length],
  });
  if (!value || value === name) return;
  try {
    await api('/api/rename', { method: 'POST', json: { album: state.album.id, path: state.path, from: name, to: value } });
    toast('名前を変更しました');
    exitSelection();
    await reloadAlbum();
  } catch (e) {
    toast(e.message, { error: true });
  }
}

async function createFolder() {
  const name = await showDialog({ title: '新しいフォルダ', input: '', okText: '作成する' });
  if (!name) return;
  try {
    await api('/api/mkdir', { method: 'POST', json: { album: state.album.id, path: state.path, name } });
    toast('フォルダを作成しました');
    await reloadAlbum();
  } catch (e) {
    toast(e.message, { error: true });
  }
}

// 1件ずつ送る。サーバーが受け付けなかった場合 (4xx) はやり直さない
function sendUpload(file, album, path, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    // 名前のないファイル (Android の Google フォトなど) も送れるように仮の名前を付ける
    form.append('files', file, file.name || 'upload');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?${qs({ album, path })}`);
    xhr.setRequestHeader('X-HomeAlbum', '1');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    xhr.onload = () => {
      let res = {};
      try { res = JSON.parse(xhr.responseText); } catch { /* 下で処理 */ }
      if (xhr.status === 200) resolve(res);
      else reject(Object.assign(new Error(res.error || 'アップロードに失敗しました'), { fatal: xhr.status >= 400 && xhr.status < 500 }));
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.onabort = () => reject(new Error('abort'));
    xhr.send(form);
  });
}

let uploading = false;

async function uploadFiles(fileList) {
  const list = [...fileList];
  if (!list.length || !state.album?.allowUpload) return;
  if (uploading) {
    toast('アップロード中です。終わってからもう一度お試しください', { error: true });
    return;
  }
  uploading = true;
  const album = state.album.id;
  const path = state.path;
  const total = list.reduce((sum, f) => sum + f.size, 0) || 1;
  const result = { saved: [], skipped: [], failed: [] };
  let sent = 0;
  let fatalError = null;
  const progress = (i, loaded) => {
    const pct = Math.min(99, Math.floor(((sent + loaded) / total) * 100));
    toast(`アップロード中… ${i + 1} / ${list.length}件（${pct}%）`, { duration: 0 });
  };
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    const label = file.name || '(名前なし)';
    progress(i, 0);
    if (file.size === 0) {
      // Google フォトでスマホに保存されていない写真などは、中身が空で渡されることがある
      result.failed.push(label);
      continue;
    }
    // 通信が途切れたときなどに備えて、1回だけやり直す
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await sendUpload(file, album, path, (loaded) => progress(i, loaded));
        result.saved.push(...(res.saved || []));
        result.skipped.push(...(res.skipped || []));
        result.failed.push(...(res.failed || []));
        break;
      } catch (e) {
        if (e.fatal) { fatalError = e.message; break; }
        if (attempt === 2) result.failed.push(label);
      }
    }
    if (fatalError) break;
    sent += file.size;
  }
  uploading = false;
  if (fatalError) {
    toast(fatalError, { error: true, duration: 6000 });
  } else if (!result.skipped.length && !result.failed.length) {
    toast(`${result.saved.length}件を追加しました`, { duration: 5000 });
  } else {
    const toastEl = document.getElementById('toast');
    if (toastEl) toastEl.hidden = true;
    const lines = [`追加できたもの：${result.saved.length}件`];
    if (result.skipped.length) lines.push(`写真・動画ではないため追加しなかったもの：${result.skipped.length}件`);
    if (result.failed.length) {
      lines.push(`読み込めなかったもの：${result.failed.length}件（${result.failed.slice(0, 3).join('、')}${result.failed.length > 3 ? ' など' : ''}）`);
      lines.push('Google フォトの写真の場合は、Google フォトで写真を開いて「ダウンロード」してスマホに保存してから、もう一度選んでください。');
    }
    await showDialog({ title: 'アップロードの結果', message: lines.join('\n'), okText: 'OK', cancelText: '' });
  }
  if (result.saved.length && state.album?.id === album && state.path === path) await reloadAlbum();
}

els.upload.onchange = () => {
  uploadFiles(els.upload.files);
  els.upload.value = '';
};
// Android では拡張子 (.heic など) を指定すると、Google フォトを選べる写真選択画面ではなく
// ファイル選択画面が開く機種があるため、種類だけを指定する (HEIC も image/* に含まれる)
if (/Android/i.test(navigator.userAgent)) els.upload.accept = 'image/*,video/*';

// PC ではファイルをドラッグ＆ドロップして追加できる
window.addEventListener('dragover', (e) => {
  if (state.album?.allowUpload && e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (!state.album?.allowUpload || !e.dataTransfer?.files.length) return;
  e.preventDefault();
  uploadFiles(e.dataTransfer.files);
});

// ---- ビューアー ----

function openViewer(i) {
  state.viewerIndex = i;
  els.viewer.hidden = false;
  els.viewer.classList.remove('hide-ui');
  document.body.style.overflow = 'hidden';
  history.pushState({ viewer: true }, '');
  showItem();
}

function closeViewer(fromHistory) {
  if (els.viewer.hidden) return;
  els.viewer.hidden = true;
  els.vStage.innerHTML = '';
  document.body.style.overflow = '';
  const tile = tileAt(state.viewerIndex);
  if (tile) tile.scrollIntoView({ block: 'nearest' });
  if (!fromHistory && history.state?.viewer) history.back();
}

function showItem() {
  const i = state.viewerIndex;
  const f = state.items[i];
  if (!f) { closeViewer(); return; }
  els.vName.textContent = f.name;
  els.vPos.textContent = `${i + 1} / ${state.items.length}　${formatDate(f.mtime)}　${formatSize(f.size)}`;
  els.vPrev.style.visibility = i > 0 ? '' : 'hidden';
  els.vNext.style.visibility = i < state.items.length - 1 ? '' : 'hidden';
  els.vEdit.hidden = f.type !== 'image';
  els.vStage.innerHTML = '<div class="spinner"></div>';

  const unsupported = (msg) => {
    els.vStage.innerHTML = `<div class="v-msg">${icon(f.type)}<p>${esc(msg)}</p>
      <a class="btn" href="${fileUrl(f.name, true)}" download>${icon('download')}ダウンロード</a></div>`;
  };

  if (f.type === 'image') {
    const img = new Image();
    img.alt = f.name;
    img.onload = () => { if (state.viewerIndex === i) { els.vStage.innerHTML = ''; els.vStage.append(img); } };
    img.onerror = () => { if (state.viewerIndex === i) unsupported('この形式の写真はブラウザで表示できません。ダウンロードしてご覧ください。'); };
    img.src = f.viewable ? fileUrl(f.name) : previewUrl(f);
    // 前後の写真を先読み
    [state.items[i + 1], state.items[i - 1]].forEach((n) => {
      if (n && n.type === 'image' && n.viewable) new Image().src = fileUrl(n.name);
    });
  } else if (!f.viewable) {
    unsupported('この形式の動画はブラウザで再生できません。ダウンロードしてご覧ください。');
  } else {
    const v = document.createElement('video');
    v.controls = true;
    v.playsInline = true;
    v.autoplay = true;
    v.preload = 'metadata';
    v.onerror = () => { if (state.viewerIndex === i) unsupported('この動画はこのブラウザで再生できません。ダウンロードしてご覧ください。'); };
    v.src = fileUrl(f.name);
    els.vStage.innerHTML = '';
    els.vStage.append(v);
  }
}

function step(delta) {
  const next = state.viewerIndex + delta;
  if (next < 0 || next >= state.items.length) return;
  state.viewerIndex = next;
  while (state.rendered <= next) renderMore();
  showItem();
}

els.vClose.innerHTML = icon('close');
els.vEdit.innerHTML = `${icon('wand')}<span class="label-optional">編集</span>`;
els.vMore.innerHTML = icon('more');
els.vDownload.innerHTML = `${icon('download')}<span class="label-optional">ダウンロード</span>`;
els.vPrev.innerHTML = icon('chevL');
els.vNext.innerHTML = icon('chevR');
els.vClose.onclick = () => closeViewer();
els.vPrev.onclick = () => step(-1);
els.vNext.onclick = () => step(1);
els.vDownload.onclick = () => downloadFiles([state.items[state.viewerIndex].name]);
els.vEdit.onclick = () => {
  const f = state.items[state.viewerIndex];
  openEditor({
    album: state.album.id, path: joinPath(state.path, f.name), name: f.name,
    // HEIC は元の大きさの JPEG に変換したものを編集する
    url: isHeif(f.name) ? `${fileUrl(f.name)}&format=jpg` : f.viewable ? fileUrl(f.name) : previewUrl(f),
    allowUpload: state.album.allowUpload, allowEdit: state.album.allowEdit,
  });
};
els.vMore.onclick = () => {
  const f = state.items[state.viewerIndex];
  const items = [{
    label: 'ここからギャラリーで見る', icon: 'gallery', onClick: () => {
      const startAt = { album: state.album.id, path: joinPath(state.path, f.name) };
      closeViewer(true);
      openGallery({ album: state.album.id, path: state.path, startAt }, { reuseHistory: true });
    },
  }];
  if (f.type === 'image') items.push({ label: '印刷', icon: 'print', onClick: () => printFiles([f.name]) });
  if (state.album.allowEdit) items.push({ label: '削除', icon: 'trash', danger: true, onClick: deleteCurrent });
  showMenu(els.vMore, items);
};

// 編集画面で保存したら一覧を更新して、保存した写真を表示する
async function onEditorSaved(name) {
  await reloadAlbum();
  const i = state.items.findIndex((f) => f.name === name);
  if (els.viewer.hidden || i < 0) return;
  state.viewerIndex = i;
  while (state.rendered <= i) renderMore();
  showItem();
}

async function deleteCurrent() {
  const i = state.viewerIndex;
  const name = state.items[i].name;
  if (await deleteFiles([name])) {
    if (!state.items.length) { closeViewer(); return; }
    state.viewerIndex = Math.min(i, state.items.length - 1);
    showItem();
  }
}

document.addEventListener('keydown', (e) => {
  if (!document.getElementById('editor').hidden) return;
  if (els.viewer.hidden || document.querySelector('dialog[open]')) {
    if (e.key === 'Escape' && state.selecting && !document.querySelector('dialog[open]')) exitSelection();
    return;
  }
  if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'Escape') closeViewer();
});

// スワイプで前後へ、タップで操作ボタンの表示切り替え
let touchStart = null;
els.vStage.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  else touchStart = null;
}, { passive: true });
els.vStage.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  const zoomed = window.visualViewport && window.visualViewport.scale > 1.01;
  if (!zoomed && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
});
els.vStage.addEventListener('click', (e) => {
  if (e.target.tagName === 'VIDEO' || e.target.closest('.btn')) return;
  els.viewer.classList.toggle('hide-ui');
});

window.addEventListener('popstate', () => {
  // 編集画面を閉じて戻ってきたときは、ビューアーは開いたままにする
  if (!els.viewer.hidden && !history.state?.viewer) closeViewer(true);
});
window.addEventListener('hashchange', route);
// スマホで読み取った QRコードなどから ?open=写真の名前 で開かれたら、その写真を表示する
const startParams = new URLSearchParams(location.search);
if (startParams.get('open')) {
  state.pendingOpen = startParams.get('open');
  history.replaceState(null, '', location.pathname + location.hash);
}
route();
