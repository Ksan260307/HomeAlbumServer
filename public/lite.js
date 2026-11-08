// 古いブラウザ (Fire タブレットの Silk 3 = Chrome 37 相当 など) 向けの、見るだけのかんたん版
// どのブラウザでも動くよう、古い書き方 (var・function・XMLHttpRequest) だけで書いている
(function () {
  'use strict';

  var CHUNK = 60; // 一度に並べる写真の数
  var PRELOAD = 3; // スライドショーで先に読み込んでおく枚数
  // 写真は画面に合った大きさに縮めたものをもらう (古いタブレットでも軽く、通信も少なくて済む)
  var SCREEN_PX = Math.round(Math.max(screen.width, screen.height) * Math.min(window.devicePixelRatio || 1, 2));

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
    state.path = '';
    state.files = [];
    setBar('ホームアルバム', '', false);
    showMessage('読み込み中…');
    getJSON('/api/albums', function (albums) {
      if (!albums.length) return showMessage('まだアルバムがありません。サーバーのPCの管理画面でフォルダを登録してください。');
      var html = '<div class="home-actions"><button class="btn primary" id="allSlide" type="button">▶ すべての写真でスライドショー</button></div>'
        + '<div class="cards">';
      for (var i = 0; i < albums.length; i++) {
        var a = albums[i];
        html += card(folderHash(a.id, ''), a.name, '/api/cover?' + qs({ album: a.id, path: '' }));
      }
      $('main').innerHTML = html + '</div>';
      $('allSlide').onclick = function () { openSlideSetup(0); };
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
    img.src = mediaUrl('preview', state.album, path, { w: SCREEN_PX, v: version(f) });
    preload(viewer.index + 1);
    preload(viewer.index + 2);
  }

  function preload(index) {
    var f = state.files[index % state.files.length];
    if (f && f.type === 'image') new Image().src = mediaUrl('preview', state.album, joinPath(state.path, f.name), { w: SCREEN_PX, v: version(f) });
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
  var slide = { open: false, list: [], pos: 0, timer: null, paused: false, front: null, uiTimer: null, interval: 10, sound: false, token: 0, fails: 0 };
  var setupStart = 0;
  var sV = $('sV');

  function openSlideSetup(startIndex) {
    setupStart = startIndex || 0;
    var saved = store('slide') || {};
    $('ssInterval').value = String(saved.interval || 10);
    $('ssOrder').value = saved.order || 'name';
    $('ssSub').checked = !!saved.sub;
    $('ssVideo').checked = !!saved.video;
    $('ssSound').checked = !!saved.sound;
    // 1枚表示からはこのフォルダだけ、トップ画面からは全アルバムの全フォルダ
    $('ssSub').parentNode.hidden = viewer.open || !state.album;
    $('ssTitle').textContent = state.album ? 'スライドショー' : 'すべての写真でスライドショー';
    updateSoundRow();
    $('slideSetup').hidden = false;
  }

  function updateSoundRow() { $('ssSound').parentNode.hidden = !$('ssVideo').checked; }
  $('ssVideo').onchange = updateSoundRow;

  function playVideo() {
    try {
      var p = sV.play();
      if (p && p.catch) p.catch(function () { /* 再生が止められた (下でタップを待つ) */ });
    } catch (e) { /* 同上 */ }
  }

  // 古いブラウザは、画面を触ったときでないと動画を再生させない。
  // 「はじめる」を押したときに一度再生しておくと、そのあとはこの動画の枠で自動再生できる
  function unlockVideo() {
    sV.muted = true;
    try { sV.load(); } catch (e) { /* 何もしない */ }
    playVideo();
  }

  $('slideBtn').onclick = function () { openSlideSetup(0); };
  $('ssCancel').onclick = function () { $('slideSetup').hidden = true; };
  $('ssStart').onclick = function () {
    var opts = {
      interval: Number($('ssInterval').value), order: $('ssOrder').value, sub: $('ssSub').checked,
      video: $('ssVideo').checked, sound: $('ssSound').checked,
    };
    store('slide', opts);
    $('slideSetup').hidden = true;
    if (opts.video) unlockVideo();
    var wanted = function (type) { return type === 'image' || (opts.video && type === 'video'); };
    var all = !state.album;
    var list = [];
    if (all || (opts.sub && !viewer.open)) {
      showMessageInSlide(opts.video ? '写真と動画を集めています…' : '写真を集めています…');
      var query = all ? { album: 'all', recursive: 1 } : { album: state.album, path: state.path, recursive: 1 };
      if (opts.video) query.videos = 1;
      getJSON('/api/gallery?' + qs(query), function (data) {
        var names = data.albums || {};
        for (var i = 0; i < data.items.length; i++) {
          var it = data.items[i];
          if (!wanted(it.type)) continue;
          list.push({
            album: it.album, path: it.path, type: it.type, v: it.mtime + '-' + it.size,
            name: all ? (names[it.album] || '') + ' / ' + it.path : it.path,
          });
        }
        startSlide(list, 0, opts);
      }, function (msg) { stopSlide(false); alert(msg); });
    } else {
      var start = 0;
      for (var i = 0; i < state.files.length; i++) {
        var f = state.files[i];
        if (!wanted(f.type)) continue;
        if (i === setupStart) start = list.length;
        list.push({ album: state.album, path: joinPath(state.path, f.name), type: f.type, v: version(f), name: f.name });
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
    if (!list.length) {
      stopSlide(false);
      alert(opts.video ? 'スライドショーで流せる写真や動画がありません。' : 'スライドショーで流せる写真がありません。');
      return;
    }
    if (opts.order === 'shuffle') {
      var first = list.splice(start, 1)[0];
      list = [first].concat(shuffle(list));
      start = 0;
    }
    openSlideLayer();
    slide.list = list;
    slide.pos = start;
    slide.interval = opts.interval;
    slide.sound = !!opts.sound;
    slide.paused = false;
    slide.fails = 0;
    $('sPause').textContent = 'Ⅱ 一時停止';
    slide.front = null;
    showSlide();
    flashUi();
  }

  function slideUrl(item) { return mediaUrl('preview', item.album, item.path, { w: SCREEN_PX, v: item.v }); }
  function videoUrl(item) { return mediaUrl('file', item.album, item.path, { v: item.v }); }
  function current() { return slide.list[slide.pos]; }

  function showInfo(item) {
    $('sInfo').textContent = (slide.pos + 1) + ' / ' + slide.list.length + '　' + item.name;
  }

  // 次の数枚の写真を先に読み込んでおく (サーバーでの縮小も先に済むので、切り替えで待たない)
  function preloadAhead() {
    for (var k = 1; k <= Math.min(PRELOAD, slide.list.length - 1); k++) {
      var it = slide.list[(slide.pos + k) % slide.list.length];
      if (it.type !== 'video') new Image().src = slideUrl(it);
    }
  }

  function advance() {
    slide.pos = (slide.pos + 1) % slide.list.length;
    showSlide();
  }

  // 表示・再生できないものは飛ばす (すべてだめなら止まる)
  function skip() {
    if (++slide.fails > slide.list.length) {
      $('sInfo').textContent = '表示できる写真や動画がありませんでした';
      flashUi();
      return;
    }
    advance();
  }

  function showSlide() {
    clearTimeout(slide.timer);
    if (!slide.open) return;
    var token = ++slide.token;
    var item = current();
    $('sHint').hidden = true;
    if (item.type === 'video') { showVideo(item, token); return; }
    hideVideo();
    var next = slide.front === $('sA') ? $('sB') : $('sA');
    next.onload = function () {
      if (!slide.open || token !== slide.token) return;
      slide.fails = 0;
      next.className = 's-img on';
      if (slide.front && slide.front !== next) slide.front.className = 's-img';
      slide.front = next;
      showInfo(item);
      preloadAhead();
      schedule();
    };
    next.onerror = function () { if (token === slide.token) skip(); };
    next.src = slideUrl(item);
  }

  function hideVideo() {
    if (!/\bon\b/.test(sV.className)) return;
    sV.pause();
    sV.className = 's-video';
  }

  function showVideo(item, token) {
    var started = false;
    if (slide.front) { slide.front.className = 's-img'; slide.front = null; }
    sV.onplaying = function () {
      if (token !== slide.token) return;
      started = true;
      slide.fails = 0;
      $('sHint').hidden = true;
      preloadAhead();
    };
    sV.onended = function () { if (token === slide.token && !slide.paused) advance(); };
    sV.onerror = function () { if (token === slide.token) skip(); };
    // 映像を再生できない形式 (最近の iPhone の HEVC など) は飛ばす
    sV.onloadedmetadata = function () { if (token === slide.token && !sV.videoWidth) skip(); };
    sV.muted = !slide.sound;
    sV.src = videoUrl(item);
    sV.className = 's-video on';
    showInfo(item);
    if (!slide.paused) playVideo();
    // 自動で再生が始まらないとき (古いブラウザの制限など) は、タップを案内して、しばらく待ってから飛ばす
    slide.timer = setTimeout(function () {
      if (token !== slide.token || started || slide.paused) return;
      $('sHint').hidden = false;
      slide.timer = setTimeout(function () {
        if (token === slide.token && !started && !slide.paused) skip();
      }, 15000);
    }, 5000);
  }

  function schedule() {
    clearTimeout(slide.timer);
    if (slide.paused) return;
    slide.timer = setTimeout(advance, slide.interval * 1000);
  }

  function stopSlide(fromHistory) {
    if (!slide.open) return;
    slide.open = false;
    slide.token++;
    clearTimeout(slide.timer);
    clearTimeout(slide.uiTimer);
    $('slide').hidden = true;
    $('sHint').hidden = true;
    $('sA').removeAttribute('src');
    $('sB').removeAttribute('src');
    sV.pause();
    sV.className = 's-video';
    sV.removeAttribute('src');
    try { sV.load(); } catch (e) { /* 読み込みを止めるだけなので失敗してもよい */ }
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
    // 動画の自動再生が止められていたら、このタップで再生する
    if (!$('sHint').hidden) {
      $('sHint').hidden = true;
      playVideo();
      return;
    }
    if (/\bnoui\b/.test($('slide').className)) flashUi();
    else { clearTimeout(slide.uiTimer); $('slide').className = 'slide noui'; }
  });
  $('sClose').onclick = function () { stopSlide(false); };
  $('sPause').onclick = function () {
    slide.paused = !slide.paused;
    this.textContent = slide.paused ? '▶ 再生' : 'Ⅱ 一時停止';
    var item = current();
    if (item && item.type === 'video') {
      if (slide.paused) sV.pause();
      else if (sV.ended) advance();
      else playVideo();
    } else if (slide.paused) {
      clearTimeout(slide.timer);
    } else {
      schedule();
    }
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
