// 古いブラウザ (Fire タブレットの Silk 3 = Chrome 37 相当 など) 向けの、見るだけのかんたん版
// どのブラウザでも動くよう、古い書き方 (var・function・XMLHttpRequest) だけで書いている
(function () {
  'use strict';

  var CHUNK = 60; // 一度に並べる写真の数

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function qs(o) {
    var out = [];
    for (var k in o) {
      if (Object.prototype.hasOwnProperty.call(o, k)) out.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k]));
    }
    return out.join('&');
  }

  function joinPath(a, b) { return a ? (b ? a + '/' + b : a) : (b || ''); }

  function getJSON(url, ok, ng) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.onload = function () {
      var data = null;
      try { data = JSON.parse(x.responseText); } catch (e) { /* 下でエラー */ }
      if (x.status >= 200 && x.status < 300 && data) ok(data);
      else ng((data && data.error) || '読み込めませんでした');
    };
    x.onerror = function () { ng('サーバーにつながりません。サーバーのPCが起動しているか確かめてください。'); };
    x.send();
  }

  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem('lite.' + key));
      localStorage.setItem('lite.' + key, JSON.stringify(value));
    } catch (e) { /* 保存できなくても動かす */ }
    return null;
  }

  function isHeic(name) { return /\.(heic|heif)$/i.test(name); }

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = list[i]; list[i] = list[j]; list[j] = t;
    }
    return list;
  }

  function formatDate(ms) {
    var d = new Date(ms);
    var m = d.getMinutes();
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + d.getHours() + ':' + (m < 10 ? '0' : '') + m;
  }

  // ---- URL ----
  function mediaUrl(kind, album, path, extra) {
    var o = { album: album, path: path };
    for (var k in extra || {}) o[k] = extra[k];
    return '/api/' + kind + '?' + qs(o);
  }
  function version(f) { return f.mtime + '-' + f.size; }

  // ---- 画面の切り替え (#/a/アルバム/フォルダ…) ----
  var state = { album: null, albumName: '', path: '', files: [], shown: 0 };

  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    if (h.indexOf('a/') !== 0) return null;
    var parts = h.slice(2).split('/').filter(function (p) { return p; }).map(function (p) {
      try { return decodeURIComponent(p); } catch (e) { return p; }
    });
    if (!parts.length) return null;
    return { album: parts[0], path: parts.slice(1).join('/') };
  }

  function folderHash(album, path) {
    var parts = [album].concat(path ? path.split('/') : []);
    return '#/a/' + parts.map(encodeURIComponent).join('/');
  }

  function route() {
    if (viewer.open) closeViewer(true);
    if (slide.open) stopSlide(true);
    var r = parseHash();
    if (r) showFolder(r.album, r.path);
    else showHome();
  }

  function setBar(title, backHref, canSlide) {
    $('title').textContent = title;
    document.title = title === 'ホームアルバム' ? title : title + ' - ホームアルバム';
    $('backBtn').hidden = !backHref;
    if (backHref) $('backBtn').setAttribute('href', backHref);
    $('slideBtn').hidden = !canSlide;
  }

  function showMessage(text) {
    $('main').innerHTML = '<p class="msg">' + esc(text) + '</p>';
  }

  // ---- アルバムの一覧 ----
  function showHome() {
    state.album = null;
    setBar('ホームアルバム', '', false);
    showMessage('読み込み中…');
    getJSON('/api/albums', function (albums) {
      if (!albums.length) return showMessage('まだアルバムがありません。サーバーのPCの管理画面でフォルダを登録してください。');
      var html = '<div class="cards">';
      for (var i = 0; i < albums.length; i++) {
        var a = albums[i];
        html += card(folderHash(a.id, ''), a.name, '/api/cover?' + qs({ album: a.id, path: '' }));
      }
      $('main').innerHTML = html + '</div>';
      window.scrollTo(0, 0);
    }, showMessage);
  }

  function card(href, name, coverUrl) {
    return '<a class="card" href="' + esc(href) + '"><div class="card-in">'
      + '<div class="cover"><div class="ph">📁</div><img alt="" src="' + esc(coverUrl) + '" onerror="this.style.display=\'none\'"></div>'
      + '<div class="card-name">' + esc(name) + '</div></div></a>';
  }

  // ---- フォルダの中身 ----
  function showFolder(album, path) {
    showMessage('読み込み中…');
    setBar('ホームアルバム', '#/', false);
    getJSON('/api/list?' + qs({ album: album, path: path }), function (data) {
      state.album = album;
      state.albumName = data.album ? data.album.name : '';
      state.path = path;
      state.files = data.files || [];
      var parent = path.indexOf('/') >= 0 ? path.slice(0, path.lastIndexOf('/')) : '';
      var title = path ? path.slice(path.lastIndexOf('/') + 1) : state.albumName;
      setBar(title, path ? folderHash(album, parent) : '#/', hasImages() || (data.dirs || []).length > 0);

      var html = '';
      var dirs = data.dirs || [];
      if (dirs.length) {
        html += '<div class="section">フォルダ</div><div class="cards">';
        for (var i = 0; i < dirs.length; i++) {
          var p = joinPath(path, dirs[i].name);
          html += card(folderHash(album, p), dirs[i].name, '/api/cover?' + qs({ album: album, path: p }));
        }
        html += '</div>';
      }
      if (state.files.length) {
        html += '<div class="section">写真・動画（' + state.files.length + '）</div><div class="tiles" id="tiles"></div><div class="more" id="more"></div>';
      }
      if (!dirs.length && !state.files.length) html = '<p class="msg">このフォルダには写真も動画もありません。</p>';
      $('main').innerHTML = html;
      state.shown = 0;
      renderMore();
      window.scrollTo(0, 0);
    }, function (msg) {
      setBar('ホームアルバム', '#/', false);
      showMessage(msg);
    });
  }

  function hasImages() {
    for (var i = 0; i < state.files.length; i++) if (state.files[i].type === 'image') return true;
    return false;
  }

  function renderMore() {
    var tiles = $('tiles');
    if (!tiles || state.shown >= state.files.length) return;
    var end = Math.min(state.files.length, state.shown + CHUNK);
    var html = '';
    for (var i = state.shown; i < end; i++) {
      var f = state.files[i];
      var thumb = mediaUrl('thumb', state.album, joinPath(state.path, f.name), { v: version(f) });
      html += '<div class="tile" data-i="' + i + '"><img alt="" src="' + esc(thumb) + '" onerror="this.style.display=\'none\'">'
        + (f.type === 'video' ? '<span class="play">▶ 動画</span>' : '') + '</div>';
    }
    tiles.insertAdjacentHTML('beforeend', html);
    state.shown = end;
    $('more').textContent = state.shown < state.files.length ? '下へ進むと続きが出ます' : '';
  }

  window.addEventListener('scroll', function () {
    if (viewer.open || slide.open) return;
    if (window.innerHeight + window.pageYOffset > document.body.scrollHeight - 1200) renderMore();
  });

  $('main').addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== this && !(el.className && /\btile\b/.test(el.className))) el = el.parentNode;
    if (!el || el === this) return;
    openViewer(Number(el.getAttribute('data-i')));
  });

  // ---- 1枚ずつ見る ----
  var viewer = { open: false, index: 0 };

  function openViewer(index) {
    viewer.open = true;
    $('viewer').hidden = false;
    $('viewer').className = 'viewer';
    history.pushState({ liteViewer: true }, '', location.href);
    showItem(index);
  }

  function closeViewer(fromHistory) {
    if (!viewer.open) return;
    viewer.open = false;
    $('vStage').innerHTML = '';
    $('viewer').hidden = true;
    if (!fromHistory && history.state && history.state.liteViewer) history.back();
  }

  function showItem(index) {
    var n = state.files.length;
    if (!n) return;
    viewer.index = (index + n) % n;
    var f = state.files[viewer.index];
    var path = joinPath(state.path, f.name);
    var stage = $('vStage');
    $('vName').textContent = f.name + '　' + formatDate(f.mtime);
    $('vCount').textContent = (viewer.index + 1) + ' / ' + n;
    $('vDl').setAttribute('href', mediaUrl('file', state.album, path, isHeic(f.name) ? { dl: 1, format: 'jpg' } : { dl: 1 }));
    $('vSlide').hidden = f.type !== 'image';
    $('viewer').className = 'viewer' + (f.type === 'video' ? ' is-video' : '');
    if (f.type === 'video') {
      stage.innerHTML = '<video controls preload="metadata" src="' + esc(mediaUrl('file', state.album, path, { v: version(f) })) + '"></video>';
      return;
    }
    // 古いタブレットでも軽いよう、縮小した JPEG を使う
    stage.innerHTML = '<div class="v-loading">読み込み中…</div>';
    var img = new Image();
    img.alt = '';
    img.onload = function () {
      if (viewer.open && state.files[viewer.index] === f) { stage.innerHTML = ''; stage.appendChild(img); }
    };
    img.onerror = function () {
      if (viewer.open && state.files[viewer.index] === f) stage.innerHTML = '<div class="v-loading">表示できませんでした</div>';
    };
    img.src = mediaUrl('preview', state.album, path, { v: version(f) });
    preload(viewer.index + 1);
  }

  function preload(index) {
    var f = state.files[index % state.files.length];
    if (f && f.type === 'image') new Image().src = mediaUrl('preview', state.album, joinPath(state.path, f.name), { v: version(f) });
  }

  $('vClose').onclick = function () { closeViewer(false); };
  $('vPrev').onclick = function (e) { e.stopPropagation(); showItem(viewer.index - 1); };
  $('vNext').onclick = function (e) { e.stopPropagation(); showItem(viewer.index + 1); };
  $('vSlide').onclick = function () { openSlideSetup(viewer.index); };

  // スワイプで前後へ、軽くタップでボタンを隠す・出す
  var touch = null;
  $('vStage').addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { touch = null; return; }
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  });
  $('vStage').addEventListener('touchend', function (e) {
    if (!touch) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - touch.x;
    var dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      showItem(viewer.index + (dx < 0 ? 1 : -1));
      e.preventDefault();
    }
  });
  $('vStage').addEventListener('click', function (e) {
    if (e.target.tagName === 'VIDEO') return;
    var v = $('viewer');
    v.className = /\bnoui\b/.test(v.className) ? v.className.replace(/\s*noui\b/, '') : v.className + ' noui';
  });

  document.addEventListener('keydown', function (e) {
    if (slide.open) {
      if (e.keyCode === 27) stopSlide(false);
      return;
    }
    if (!viewer.open) return;
    if (e.keyCode === 37) showItem(viewer.index - 1);
    else if (e.keyCode === 39) showItem(viewer.index + 1);
    else if (e.keyCode === 27) closeViewer(false);
  });

  window.addEventListener('popstate', function () {
    var s = history.state || {};
    if (slide.open && !s.liteSlide) stopSlide(true);
    if (viewer.open && !s.liteViewer && !s.liteSlide) closeViewer(true);
  });

  // ---- スライドショー ----
  var slide = { open: false, list: [], pos: 0, timer: null, paused: false, front: null, uiTimer: null, interval: 10 };
  var setupStart = 0;

  function openSlideSetup(startIndex) {
    setupStart = startIndex || 0;
    var saved = store('slide') || {};
    $('ssInterval').value = String(saved.interval || 10);
    $('ssOrder').value = saved.order || 'name';
    $('ssSub').checked = !!saved.sub;
    $('ssSub').parentNode.hidden = viewer.open; // 1枚表示からはこのフォルダだけ
    $('slideSetup').hidden = false;
  }

  $('slideBtn').onclick = function () { openSlideSetup(0); };
  $('ssCancel').onclick = function () { $('slideSetup').hidden = true; };
  $('ssStart').onclick = function () {
    var opts = { interval: Number($('ssInterval').value), order: $('ssOrder').value, sub: $('ssSub').checked && !viewer.open };
    store('slide', opts);
    $('slideSetup').hidden = true;
    if (opts.sub) {
      showMessageInSlide('写真を集めています…');
      getJSON('/api/gallery?' + qs({ album: state.album, path: state.path, recursive: 1 }), function (data) {
        var list = [];
        for (var i = 0; i < data.items.length; i++) {
          var it = data.items[i];
          if (it.type === 'image') list.push({ album: it.album, path: it.path, v: it.mtime + '-' + it.size, name: it.path });
        }
        startSlide(list, 0, opts);
      }, function (msg) { stopSlide(false); alert(msg); });
    } else {
      var list = [];
      var start = 0;
      for (var i = 0; i < state.files.length; i++) {
        var f = state.files[i];
        if (f.type !== 'image') continue;
        if (i === setupStart) start = list.length;
        list.push({ album: state.album, path: joinPath(state.path, f.name), v: version(f), name: f.name });
      }
      startSlide(list, start, opts);
    }
  };

  function showMessageInSlide(text) {
    openSlideLayer();
    $('sInfo').textContent = text;
  }

  function openSlideLayer() {
    if (slide.open) return;
    slide.open = true;
    $('slide').hidden = false;
    $('sA').className = 's-img';
    $('sB').className = 's-img';
    $('sA').removeAttribute('src');
    $('sB').removeAttribute('src');
    history.pushState({ liteSlide: true }, '', location.href);
  }

  function startSlide(list, start, opts) {
    if (!list.length) { stopSlide(false); alert('スライドショーで流せる写真がありません。'); return; }
    if (opts.order === 'shuffle') {
      var first = list.splice(start, 1)[0];
      list = [first].concat(shuffle(list));
      start = 0;
    }
    openSlideLayer();
    slide.list = list;
    slide.pos = start;
    slide.interval = opts.interval;
    slide.paused = false;
    $('sPause').textContent = 'Ⅱ 一時停止';
    slide.front = null;
    showSlide();
    flashUi();
  }

  function slideUrl(item) { return mediaUrl('preview', item.album, item.path, { v: item.v }); }

  function showSlide() {
    clearTimeout(slide.timer);
    if (!slide.open) return;
    var item = slide.list[slide.pos];
    var next = slide.front === $('sA') ? $('sB') : $('sA');
    var tries = 0;
    next.onload = function () {
      if (!slide.open) return;
      next.className = 's-img on';
      if (slide.front && slide.front !== next) slide.front.className = 's-img';
      slide.front = next;
      $('sInfo').textContent = (slide.pos + 1) + ' / ' + slide.list.length + '　' + item.name;
      // 次の写真を先に読み込んでおく
      new Image().src = slideUrl(slide.list[(slide.pos + 1) % slide.list.length]);
      schedule();
    };
    next.onerror = function () {
      // 表示できない写真は飛ばす
      if (++tries > slide.list.length) return;
      slide.pos = (slide.pos + 1) % slide.list.length;
      item = slide.list[slide.pos];
      next.src = slideUrl(item);
    };
    next.src = slideUrl(item);
  }

  function schedule() {
    clearTimeout(slide.timer);
    if (slide.paused) return;
    slide.timer = setTimeout(function () {
      slide.pos = (slide.pos + 1) % slide.list.length;
      showSlide();
    }, slide.interval * 1000);
  }

  function stopSlide(fromHistory) {
    if (!slide.open) return;
    slide.open = false;
    clearTimeout(slide.timer);
    clearTimeout(slide.uiTimer);
    $('slide').hidden = true;
    $('sA').removeAttribute('src');
    $('sB').removeAttribute('src');
    $('sInfo').textContent = '';
    exitFull();
    if (!fromHistory && history.state && history.state.liteSlide) history.back();
  }

  function flashUi() {
    var el = $('slide');
    el.className = 'slide';
    clearTimeout(slide.uiTimer);
    slide.uiTimer = setTimeout(function () { el.className = 'slide noui'; }, 4000);
  }

  $('slide').addEventListener('click', function (e) {
    if (e.target.tagName === 'BUTTON') return;
    if (/\bnoui\b/.test($('slide').className)) flashUi();
    else { clearTimeout(slide.uiTimer); $('slide').className = 'slide noui'; }
  });
  $('sClose').onclick = function () { stopSlide(false); };
  $('sPause').onclick = function () {
    slide.paused = !slide.paused;
    this.textContent = slide.paused ? '▶ 再生' : 'Ⅱ 一時停止';
    if (slide.paused) clearTimeout(slide.timer);
    else schedule();
    flashUi();
  };

  // ---- 全画面 (古いブラウザは webkit 付きの名前) ----
  function exitFull() {
    var d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      if (d.exitFullscreen) d.exitFullscreen();
      else if (d.webkitExitFullscreen) d.webkitExitFullscreen();
    }
  }
  $('sFull').onclick = function () {
    var el = $('slide');
    if (document.fullscreenElement || document.webkitFullscreenElement) exitFull();
    else if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    flashUi();
  };
  if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) $('sFull').hidden = true;

  window.addEventListener('hashchange', route);
  route();
})();
