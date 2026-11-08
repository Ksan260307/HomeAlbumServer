// ギャラリーモード: 写真を全画面で自動的に切り替えて表示する (スライドショー)
const g = {
  el: $('gallery'), layers: [$('gLayer0'), $('gLayer1')], loading: $('gLoading'),
  where: $('gWhere'), count: $('gCount'), progress: $('gProgress'),
  play: $('gPlay'), prev: $('gPrev'), next: $('gNext'), close: $('gClose'),
  interval: $('gInterval'), shuffle: $('gShuffle'), recursive: $('gRecursive'), full: $('gFull'),
};

const gallery = {
  source: null, albums: {}, items: [], order: [], pos: 0, front: 0,
  playing: true, timer: null, idleTimer: null, failures: 0, wakeLock: null, loadToken: 0,
  settings: {
    interval: Number(loadPref('galleryInterval', '5')),
    shuffle: loadPref('galleryShuffle', '0') === '1',
    recursive: loadPref('galleryRecursive', '1') === '1',
  },
};

const galleryUrl = (item) => `/api/${item.viewable ? 'file' : 'preview'}?${qs({ album: item.album, path: item.path })}`;
const galleryThumbUrl = (item) => `/api/thumb?${qs({ album: item.album, path: item.path })}`;

g.close.innerHTML = icon('close');
g.prev.innerHTML = icon('chevL');
g.next.innerHTML = icon('chevR');
g.full.innerHTML = icon('expand');
g.shuffle.innerHTML = `${icon('shuffle')}シャッフル`;
g.recursive.innerHTML = `${icon('layers')}サブフォルダも`;
if (!document.fullscreenEnabled) g.full.hidden = true;

function syncGalleryControls() {
  g.play.innerHTML = icon(gallery.playing ? 'pause' : 'play');
  g.interval.value = String(gallery.settings.interval);
  g.shuffle.setAttribute('aria-pressed', String(gallery.settings.shuffle));
  g.recursive.setAttribute('aria-pressed', String(gallery.settings.recursive));
  g.el.style.setProperty('--g-duration', `${gallery.settings.interval + 2}s`);
}

// source: { album: アルバムID または 'all', path, startAt: { album, path } }
async function openGallery(source, { reuseHistory = false } = {}) {
  gallery.source = source;
  gallery.playing = true;
  g.layers.forEach((l) => { l.classList.remove('on'); l.querySelector('img').removeAttribute('src'); });
  g.el.hidden = false;
  document.body.style.overflow = 'hidden';
  if (reuseHistory) history.replaceState({ gallery: true }, '');
  else history.pushState({ gallery: true }, '');
  syncGalleryControls();
  showGalleryUi();
  if (document.fullscreenEnabled && !document.fullscreenElement) g.el.requestFullscreen().catch(() => {});
  keepScreenOn();
  await loadGalleryItems(source.startAt);
}

async function loadGalleryItems(startAt) {
  const token = ++gallery.loadToken;
  clearTimeout(gallery.timer);
  g.loading.hidden = false;
  let data;
  try {
    data = await api(`/api/gallery?${qs({
      album: gallery.source.album, path: gallery.source.path || '', recursive: gallery.settings.recursive ? '1' : '0',
    })}`);
  } catch (e) {
    toast(e.message, { error: true });
    closeGallery();
    return;
  }
  if (token !== gallery.loadToken || g.el.hidden) return;
  if (!data.items.length) {
    g.loading.hidden = true;
    toast(gallery.settings.recursive ? '表示できる写真がありません' : 'このフォルダには写真がありません。「サブフォルダも」をオンにしてください', { error: true, duration: 5000 });
    gallery.items = [];
    gallery.order = [];
    updateGalleryCaption();
    return;
  }
  gallery.albums = data.albums;
  gallery.items = data.items;
  buildGalleryOrder(startAt);
  showGallerySlide();
}

function buildGalleryOrder(startAt) {
  const order = gallery.items.map((_, i) => i);
  if (gallery.settings.shuffle) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  gallery.order = order;
  gallery.pos = 0;
  if (startAt) {
    const idx = gallery.items.findIndex((it) => it.album === startAt.album && it.path === startAt.path);
    if (idx >= 0) {
      if (gallery.settings.shuffle) {
        order.splice(order.indexOf(idx), 1);
        order.unshift(idx);
      } else {
        gallery.pos = idx;
      }
    }
  }
}

function currentGalleryItem() {
  return gallery.items[gallery.order[gallery.pos]];
}

function updateGalleryCaption() {
  const item = currentGalleryItem();
  if (!item) {
    g.where.textContent = '';
    g.count.textContent = '';
    return;
  }
  const folders = item.path.split('/').slice(0, -1);
  g.where.textContent = [gallery.albums[item.album], ...folders].join(' › ');
  g.count.textContent = `${gallery.pos + 1} / ${gallery.order.length}`;
}

function showGallerySlide() {
  const item = currentGalleryItem();
  if (!item) return;
  const token = ++gallery.loadToken;
  clearTimeout(gallery.timer);
  updateGalleryCaption();
  const back = g.layers[1 - gallery.front];
  const img = back.querySelector('img');
  const loader = new Image();
  loader.onload = () => {
    if (token !== gallery.loadToken || g.el.hidden) return;
    gallery.failures = 0;
    g.loading.hidden = true;
    img.src = loader.src;
    back.querySelector('.g-bg').style.backgroundImage = `url("${galleryThumbUrl(item)}")`;
    // アニメーションを最初からやり直す
    back.classList.remove('on');
    void back.offsetWidth;
    back.classList.add('on');
    g.layers[gallery.front].classList.remove('on');
    gallery.front = 1 - gallery.front;
    scheduleGalleryNext();
    // 次の写真を先読み
    const nextItem = gallery.items[gallery.order[(gallery.pos + 1) % gallery.order.length]];
    if (nextItem) new Image().src = galleryUrl(nextItem);
  };
  loader.onerror = () => {
    if (token !== gallery.loadToken || g.el.hidden) return;
    // 表示できない写真は飛ばす (すべて失敗したら止める)
    if (++gallery.failures >= gallery.order.length) {
      g.loading.hidden = true;
      toast('写真を表示できませんでした', { error: true });
      return;
    }
    gallery.pos = (gallery.pos + 1) % gallery.order.length;
    showGallerySlide();
  };
  loader.src = galleryUrl(item);
}

function scheduleGalleryNext() {
  clearTimeout(gallery.timer);
  const bar = g.progress;
  bar.style.transition = 'none';
  bar.style.width = '0';
  if (!gallery.playing || gallery.order.length < 2) return;
  void bar.offsetWidth;
  bar.style.transition = `width ${gallery.settings.interval}s linear`;
  bar.style.width = '100%';
  gallery.timer = setTimeout(() => galleryStep(1), gallery.settings.interval * 1000);
}

function galleryStep(delta) {
  if (!gallery.order.length) return;
  gallery.pos = (gallery.pos + delta + gallery.order.length) % gallery.order.length;
  showGallerySlide();
}

function closeGallery(fromHistory) {
  if (g.el.hidden) return;
  gallery.loadToken++;
  clearTimeout(gallery.timer);
  clearTimeout(gallery.idleTimer);
  g.el.hidden = true;
  g.el.classList.remove('idle');
  document.body.style.overflow = '';
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (gallery.wakeLock) { gallery.wakeLock.release().catch(() => {}); gallery.wakeLock = null; }
  if (!fromHistory && history.state?.gallery) history.back();
}

// 表示中は画面が暗くならないようにする (対応しているブラウザのみ)
async function keepScreenOn() {
  if (!('wakeLock' in navigator) || g.el.hidden) return;
  try { gallery.wakeLock = await navigator.wakeLock.request('screen'); } catch { /* 非対応 */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !g.el.hidden) keepScreenOn();
});

// しばらく操作しないとボタンを隠す
function showGalleryUi() {
  g.el.classList.remove('idle');
  clearTimeout(gallery.idleTimer);
  gallery.idleTimer = setTimeout(() => {
    if (gallery.playing && !g.el.hidden) g.el.classList.add('idle');
  }, 3000);
}

g.el.addEventListener('mousemove', showGalleryUi);
g.el.addEventListener('click', (e) => {
  if (e.target.closest('.btn, select')) { showGalleryUi(); return; }
  if (g.el.classList.contains('idle')) showGalleryUi();
  else { clearTimeout(gallery.idleTimer); g.el.classList.add('idle'); }
});

let gTouch = null;
g.el.addEventListener('touchstart', (e) => {
  gTouch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
g.el.addEventListener('touchend', (e) => {
  if (!gTouch) return;
  const dx = e.changedTouches[0].clientX - gTouch.x;
  const dy = e.changedTouches[0].clientY - gTouch.y;
  gTouch = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) galleryStep(dx < 0 ? 1 : -1);
});

g.close.onclick = () => closeGallery();
g.prev.onclick = () => galleryStep(-1);
g.next.onclick = () => galleryStep(1);
g.play.onclick = () => togglePlay();
g.full.onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else g.el.requestFullscreen().catch(() => {});
};
g.interval.onchange = () => {
  gallery.settings.interval = Number(g.interval.value);
  savePref('galleryInterval', String(gallery.settings.interval));
  syncGalleryControls();
  scheduleGalleryNext();
};
g.shuffle.onclick = () => {
  gallery.settings.shuffle = !gallery.settings.shuffle;
  savePref('galleryShuffle', gallery.settings.shuffle ? '1' : '0');
  syncGalleryControls();
  const cur = currentGalleryItem();
  buildGalleryOrder(cur);
  updateGalleryCaption();
  scheduleGalleryNext();
};
g.recursive.onclick = () => {
  gallery.settings.recursive = !gallery.settings.recursive;
  savePref('galleryRecursive', gallery.settings.recursive ? '1' : '0');
  syncGalleryControls();
  loadGalleryItems(currentGalleryItem());
};

function togglePlay() {
  gallery.playing = !gallery.playing;
  syncGalleryControls();
  scheduleGalleryNext();
  showGalleryUi();
}

document.addEventListener('keydown', (e) => {
  if (g.el.hidden) return;
  if (e.key === 'ArrowLeft') galleryStep(-1);
  else if (e.key === 'ArrowRight') galleryStep(1);
  else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'Escape') closeGallery();
  else return;
  showGalleryUi();
});

window.addEventListener('popstate', () => { if (!g.el.hidden && !history.state?.gallery) closeGallery(true); });
window.addEventListener('hashchange', () => closeGallery(true));
