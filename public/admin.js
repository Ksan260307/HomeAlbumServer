// 管理画面
const main = document.getElementById('main');
const logoutBtn = document.getElementById('logoutBtn');
document.getElementById('homeBtn').innerHTML = icon('back');

logoutBtn.onclick = async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  location.reload();
};

async function init() {
  let s;
  try {
    s = await api('/api/admin/status');
  } catch (e) {
    main.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`;
    return;
  }
  if (!s.hasPassword) {
    if (s.isLocal) renderSetup();
    else main.innerHTML = '<div class="panel auth"><h2>はじめに</h2><p>最初の設定は、サーバーにしているPCで管理画面を開いて行ってください。</p></div>';
  } else if (!s.loggedIn) {
    renderLogin();
  } else {
    renderDashboard();
  }
}

function renderSetup() {
  main.innerHTML = `
    <div class="panel auth">
      <h2>はじめに、管理用パスワードを決めてください</h2>
      <p>このパスワードは、フォルダの登録や設定を変えるときに使います。</p>
      <form id="setupForm">
        <div class="field"><label for="pw1">パスワード（4文字以上）</label><input class="input" id="pw1" type="password" autocomplete="new-password" required minlength="4"></div>
        <div class="field"><label for="pw2">もう一度入力</label><input class="input" id="pw2" type="password" autocomplete="new-password" required minlength="4"></div>
        <button class="btn primary" type="submit">設定する</button>
      </form>
    </div>`;
  document.getElementById('setupForm').onsubmit = async (e) => {
    e.preventDefault();
    const pw1 = document.getElementById('pw1').value;
    if (pw1 !== document.getElementById('pw2').value) return toast('2つのパスワードが一致しません', { error: true });
    try {
      await api('/api/admin/setup', { method: 'POST', json: { password: pw1 } });
      renderDashboard();
    } catch (err) {
      toast(err.message, { error: true });
    }
  };
}

function renderLogin() {
  main.innerHTML = `
    <div class="panel auth">
      <h2>ログイン</h2>
      <p>管理用パスワードを入力してください。</p>
      <form id="loginForm">
        <input class="input" id="pw" type="password" autocomplete="current-password" required aria-label="パスワード">
        <button class="btn primary" type="submit">ログイン</button>
      </form>
    </div>`;
  document.getElementById('pw').focus();
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/login', { method: 'POST', json: { password: document.getElementById('pw').value } });
      renderDashboard();
    } catch (err) {
      toast(err.message, { error: true });
    }
  };
}

async function renderDashboard() {
  logoutBtn.hidden = false;
  let cfg;
  try {
    cfg = await api('/api/admin/config');
  } catch (e) {
    if (e.status === 401) return renderLogin();
    main.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`;
    return;
  }
  const url = cfg.urls[0];
  main.innerHTML = `
    <section class="panel">
      <h2>スマホや他のPCから見るには</h2>
      ${url ? `
        <p>同じWi-Fi（家のネットワーク）につないだスマホやPCで、次のアドレスを開いてください。スマホならカメラでQRコードを読み取るだけで開けます。</p>
        <div class="access">
          <div class="qr"><img alt="QRコード" src="/api/admin/qr?url=${encodeURIComponent(url)}"></div>
          <div class="urls">
            ${cfg.urls.map((u, i) => `<div class="url-row"><code>${esc(u)}</code>${i === 0 ? `<button class="btn" id="copyBtn">コピー</button><button class="btn" id="qrPrintBtn">${icon('print')}QRコードを印刷</button>` : ''}</div>`).join('')}
          </div>
        </div>` : '<p>このPCがネットワークにつながっていないようです。Wi-Fi や LAN ケーブルの接続を確認してください。</p>'}
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>表示するフォルダ</h2>
        <button class="btn primary" id="addBtn">${icon('plus')}フォルダを追加</button>
      </div>
      <p class="hint">ここに登録したフォルダの写真と動画が、アルバムとして表示されます。登録を外しても、フォルダやファイルは消えません。</p>
      <ul class="album-list" id="albumList"></ul>
    </section>

    <section class="panel">
      <h2>パスワードの変更</h2>
      <form id="pwForm" style="display:grid;grid-gap:10px;gap:10px;max-width:360px;margin-top:10px">
        <input class="input" id="curPw" type="password" placeholder="今のパスワード" autocomplete="current-password" required>
        <input class="input" id="newPw" type="password" placeholder="新しいパスワード（4文字以上）" autocomplete="new-password" required minlength="4">
        <button class="btn" type="submit">変更する</button>
      </form>
    </section>`;

  renderAlbums(cfg.albums);
  document.getElementById('addBtn').onclick = openPicker;
  const qrPrintBtn = document.getElementById('qrPrintBtn');
  if (qrPrintBtn) qrPrintBtn.onclick = () => openQrPrint(url);
  const copyBtn = document.getElementById('copyBtn');
  if (copyBtn) {
    copyBtn.onclick = async () => {
      if (await copyText(url)) toast('アドレスをコピーしました');
      else toast('コピーできませんでした。アドレスを手で入力してください', { error: true });
    };
  }
  document.getElementById('pwForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/password', {
        method: 'POST',
        json: { current: document.getElementById('curPw').value, password: document.getElementById('newPw').value },
      });
      e.target.reset();
      toast('パスワードを変更しました');
    } catch (err) {
      toast(err.message, { error: true });
    }
  };
}

function renderAlbums(albums) {
  const list = document.getElementById('albumList');
  if (!albums.length) {
    list.innerHTML = '<li class="empty" style="padding:24px">まだフォルダが登録されていません。「フォルダを追加」から登録してください。</li>';
    return;
  }
  list.innerHTML = albums.map((a, i) => `
    <li class="album-row" data-id="${esc(a.id)}">
      <div class="info">
        <div class="name">${esc(a.name)}</div>
        <div class="path">${esc(a.path)}</div>
        ${a.exists ? '' : '<div class="warn">このフォルダが見つかりません（移動・削除された可能性があります）</div>'}
      </div>
      <div style="display:grid;grid-gap:6px;gap:6px">
        <label class="switch" title="オンにすると、スマホなどから写真・動画をアップロードしたり、フォルダを作ったりできます">
          <input type="checkbox" data-act="allowUpload" ${a.allowUpload ? 'checked' : ''}>アップロードを許可
        </label>
        <label class="switch" title="オンにすると、スマホなどから名前の変更や削除ができます">
          <input type="checkbox" data-act="allowEdit" ${a.allowEdit ? 'checked' : ''}>削除・名前変更を許可
        </label>
      </div>
      <div class="row-actions">
        <button class="btn icon" data-act="up" title="上へ" aria-label="上へ" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
        <button class="btn icon" data-act="down" title="下へ" aria-label="下へ" ${i === albums.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
        <button class="btn icon" data-act="rename" title="表示名を変更" aria-label="表示名を変更">${icon('pencil')}</button>
        <button class="btn danger" data-act="remove">登録を外す</button>
      </div>
    </li>`).join('');

  list.onclick = async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const row = btn.closest('.album-row');
    const id = row.dataset.id;
    const album = albums.find((a) => a.id === id);
    try {
      if (btn.dataset.act === 'up' || btn.dataset.act === 'down') {
        renderAlbums((await api(`/api/admin/albums/${id}`, { method: 'PUT', json: { move: btn.dataset.act } })).albums);
      } else if (btn.dataset.act === 'rename') {
        const name = await showDialog({ title: '表示名を変更', message: 'アルバム一覧に表示される名前です。', input: album.name, okText: '変更する' });
        if (name) renderAlbums((await api(`/api/admin/albums/${id}`, { method: 'PUT', json: { name } })).albums);
      } else if (btn.dataset.act === 'remove') {
        const ok = await showDialog({
          title: `「${album.name}」の登録を外しますか？`,
          message: 'アルバムに表示されなくなります。フォルダや中の写真・動画は消えません。',
          okText: '登録を外す',
          danger: true,
        });
        if (ok) renderAlbums((await api(`/api/admin/albums/${id}`, { method: 'DELETE' })).albums);
      }
    } catch (err) {
      toast(err.message, { error: true });
    }
  };
  list.onchange = async (e) => {
    const key = e.target.dataset.act;
    if (key !== 'allowUpload' && key !== 'allowEdit') return;
    const id = e.target.closest('.album-row').dataset.id;
    const label = key === 'allowUpload' ? 'アップロード' : '削除・名前変更';
    try {
      renderAlbums((await api(`/api/admin/albums/${id}`, { method: 'PUT', json: { [key]: e.target.checked } })).albums);
      toast(e.target.checked ? `${label}を許可しました` : `${label}をできないようにしました`);
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(err.message, { error: true });
    }
  };
}

// ---- QRコードの印刷 ----

function loadQrPrefs() {
  try { return JSON.parse(localStorage.getItem('homealbum.qrPrint')) || {}; } catch { return {}; }
}

function openQrPrint(url) {
  const prefs = { layout: 'large', title: 'ホームアルバム', wifi: '', ...loadQrPrefs() };
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `
    <form method="dialog" style="display:grid;grid-gap:14px;gap:14px">
      <div><h2>QRコードを印刷</h2><p style="margin:0">冷蔵庫や棚に貼っておくと、家族や来た人がスマホで読み取るだけでアルバムを開けます。</p></div>
      <div class="field"><label>印刷のしかた</label>
        <div class="seg" style="width:100%">
          <button type="button" data-v="large" style="flex:1">大きく1枚（A4）</button>
          <button type="button" data-v="cards" style="flex:1">カード8枚（切り取り用）</button>
        </div>
      </div>
      <div class="field"><label for="qrTitle">見出し</label><input class="input" id="qrTitle" maxlength="30" value="${esc(prefs.title)}"></div>
      <div class="field"><label for="qrWifi">つなぐWi-Fiの名前（書かなくてもOK）</label><input class="input" id="qrWifi" maxlength="40" placeholder="例：MyHome-WiFi" value="${esc(prefs.wifi)}"></div>
      <div class="actions">
        <button class="btn" value="cancel">キャンセル</button>
        <button class="btn primary" value="ok">${icon('print')}印刷する</button>
      </div>
    </form>`;
  document.body.append(dlg);
  let layout = prefs.layout;
  const segBtns = dlg.querySelectorAll('.seg button');
  const syncSeg = () => segBtns.forEach((b) => b.classList.toggle('on', b.dataset.v === layout));
  segBtns.forEach((b) => { b.onclick = () => { layout = b.dataset.v; syncSeg(); }; });
  syncSeg();
  dlg.addEventListener('close', () => {
    const title = dlg.querySelector('#qrTitle').value.trim() || 'ホームアルバム';
    const wifi = dlg.querySelector('#qrWifi').value.trim();
    const ok = dlg.returnValue === 'ok';
    dlg.remove();
    if (!ok) return;
    try { localStorage.setItem('homealbum.qrPrint', JSON.stringify({ layout, title, wifi })); } catch { /* 保存できなくても印刷はできる */ }
    printQr({ url, layout, title, wifi });
  });
  dlg.showModal();
}

function printQr({ url, layout, title, wifi }) {
  document.getElementById('qrPrint')?.remove();
  const qr = `/api/admin/qr?url=${encodeURIComponent(url)}`;
  const steps = [
    wifi ? `スマホを Wi-Fi「${esc(wifi)}」につなぐ` : 'スマホを家の Wi-Fi につなぐ',
    'カメラアプリで QRコードを読み取る',
    '表示されたリンクを開く',
  ];
  const root = document.createElement('div');
  root.id = 'qrPrint';
  if (layout === 'cards') {
    const card = `
      <div class="qr-card">
        <img src="${qr}" alt="">
        <div class="qr-card-text">
          <div class="qr-card-title">${esc(title)}</div>
          <div class="qr-card-sub">スマホのカメラで読み取ってください</div>
          ${wifi ? `<div class="qr-card-wifi">Wi-Fi：${esc(wifi)}</div>` : ''}
          <div class="qr-card-url">${esc(url)}</div>
        </div>
      </div>`;
    root.innerHTML = `<div class="qr-sheet qr-cards">${card.repeat(8)}</div>`;
  } else {
    root.innerHTML = `
      <div class="qr-sheet qr-large">
        <div class="qr-title">${esc(title)}</div>
        <div class="qr-lead">家族の写真と動画が見られます</div>
        <img class="qr-img" src="${qr}" alt="">
        <ol class="qr-steps">${steps.map((t) => `<li>${t}</li>`).join('')}</ol>
        <div class="qr-url">QRコードが読み取れないときは、ブラウザに次のアドレスを入力してください<br><strong>${esc(url)}</strong></div>
        <div class="qr-note">※ 家の中（同じ Wi-Fi）でだけ見られます。パソコンでアプリが起動しているときに使えます。</div>
      </div>`;
  }
  document.body.append(root);
  let pageStyle = document.getElementById('qrPageStyle');
  if (!pageStyle) {
    pageStyle = document.createElement('style');
    pageStyle.id = 'qrPageStyle';
    document.head.append(pageStyle);
  }
  pageStyle.textContent = '@page { size: 210mm 297mm; margin: 0; }';
  const imgs = [...root.querySelectorAll('img')];
  Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; })))).then(() => {
    document.body.classList.add('printing-qr');
    window.print();
  });
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('printing-qr');
  document.getElementById('qrPrint')?.remove();
});

// ---- フォルダ選択ダイアログ ----
// チェックを入れたフォルダをまとめて追加できる。フォルダの場所を入力して開くこともできる
// すでに登録されているフォルダは選べない (サーバー側でも除く)

function openPicker() {
  const dlg = document.createElement('dialog');
  dlg.className = 'picker';
  dlg.innerHTML = `
    <form method="dialog">
      <div class="p-head"><h2>フォルダを選ぶ</h2><p style="margin:0">追加したいフォルダにチェックを入れてください（いくつでも選べます）。フォルダの名前を押すと中を開きます。</p></div>
      <div class="p-path">
        <button class="btn icon" type="button" id="pUp" title="ひとつ上へ" aria-label="ひとつ上へ">${icon('back')}</button>
        <input class="input p-input" id="pPathInput" placeholder="フォルダの場所を入力（例: D:\\写真）" spellcheck="false" autocomplete="off" aria-label="フォルダの場所">
        <button class="btn" type="button" id="pGo">開く</button>
      </div>
      <div class="p-here" id="pHere" hidden></div>
      <div class="p-list" id="pList"></div>
      <div class="p-foot">
        <div class="p-selected" id="pSelected"></div>
        <div class="field" id="pNameField" hidden><label for="pName">アルバムに表示する名前</label><input class="input" id="pName" autocomplete="off"></div>
        <label class="switch"><input type="checkbox" id="pUpload">スマホなどからのアップロードを許可する</label>
        <label class="switch"><input type="checkbox" id="pEdit">スマホなどからの削除・名前変更を許可する</label>
        <div class="actions">
          <button class="btn" value="cancel">キャンセル</button>
          <button class="btn primary" type="button" id="pAdd" disabled>追加する</button>
        </div>
      </div>
    </form>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  const $p = (id) => dlg.querySelector(`#${id}`);
  const pList = $p('pList');
  const pInput = $p('pPathInput');
  const pHere = $p('pHere');
  const pUp = $p('pUp');
  const pAdd = $p('pAdd');
  const pName = $p('pName');
  let current = { path: '', parent: null };
  // 選んだフォルダ: 場所 → アルバムに表示する名前
  const selected = new Map();
  const baseName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;

  const badge = '<span class="p-badge">登録済み</span>';
  const row = (iconName, label, target, { registered = false, checkable = true } = {}) => `
    <div class="p-row${registered ? ' is-registered' : ''}">
      ${checkable ? `<input type="checkbox" class="p-check" data-path="${esc(target)}" aria-label="${esc(label)} を選ぶ"${registered ? ' disabled' : ''}${selected.has(target) ? ' checked' : ''}>` : '<span class="p-check-space"></span>'}
      <button class="p-item" type="button" data-path="${esc(target)}">${icon(iconName)}<span>${esc(label)}</span></button>
      ${registered ? badge : ''}
    </div>`;

  function renderSelected() {
    const n = selected.size;
    pAdd.disabled = !n;
    pAdd.textContent = n ? `追加する（${n}件）` : '追加する';
    const sel = $p('pSelected');
    sel.innerHTML = n ? `<div class="p-group">選んだフォルダ（${n}）</div>` + [...selected.keys()].map((p) => `
      <div class="p-chip"><span title="${esc(p)}"><b>${esc(baseName(p))}</b><small>${esc(p)}</small></span><button type="button" class="btn icon" data-remove="${esc(p)}" title="選ぶのをやめる" aria-label="選ぶのをやめる">${icon('close')}</button></div>`).join('') : '';
    // 1件だけのときは、アルバムに表示する名前を変えられる
    $p('pNameField').hidden = n !== 1;
    if (n === 1) pName.value = [...selected.values()][0];
  }

  function toggle(target, on) {
    if (on) selected.set(target, baseName(target));
    else selected.delete(target);
    // 同じフォルダのチェック (一覧と「このフォルダを選ぶ」) をそろえる
    dlg.querySelectorAll('.p-check').forEach((c) => { if (c.dataset.path === target) c.checked = on; });
    renderSelected();
  }

  async function go(target) {
    try {
      const r = await api(`/api/admin/browse?path=${encodeURIComponent(target)}`);
      current = r;
      pInput.value = r.path;
      pUp.disabled = r.parent === null;
      if (!r.path) {
        pHere.hidden = true;
        pList.innerHTML = `
          <div class="p-group">よく使う場所</div>${r.shortcuts.map((s) => row('folder', s.label, s.path, { registered: s.registered })).join('')}
          <div class="p-group">ドライブ</div>${r.drives.map((d) => row('drive', d.label, d.path, { checkable: false })).join('')}`;
      } else {
        pHere.hidden = false;
        pHere.innerHTML = `<label class="p-here-label"><input type="checkbox" class="p-check" data-path="${esc(r.path)}"${r.registered ? ' disabled' : ''}${selected.has(r.path) ? ' checked' : ''}>このフォルダを選ぶ</label>${r.registered ? badge : ''}`;
        pList.innerHTML = r.dirs.length
          ? r.dirs.map((d) => row('folder', d.name, d.path, { registered: d.registered })).join('')
          : '<div class="p-empty">この中にフォルダはありません。</div>';
      }
      pList.scrollTop = 0;
    } catch (e) {
      toast(e.message, { error: true });
    }
  }

  const goTyped = () => {
    const v = pInput.value.trim().replace(/^"(.*)"$/, '$1');
    if (v) go(v);
  };
  // Enter で開く (フォームが送信されてダイアログが閉じないようにする)
  pInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); goTyped(); }
  });
  $p('pGo').onclick = goTyped;

  dlg.addEventListener('change', (e) => {
    if (e.target.classList.contains('p-check')) toggle(e.target.dataset.path, e.target.checked);
  });
  pList.onclick = (e) => {
    const b = e.target.closest('.p-item');
    if (b) go(b.dataset.path);
  };
  $p('pSelected').onclick = (e) => {
    const b = e.target.closest('[data-remove]');
    if (b) toggle(b.dataset.remove, false);
  };
  pName.oninput = () => {
    if (selected.size === 1) selected.set([...selected.keys()][0], pName.value);
  };
  pUp.onclick = () => { if (current.parent !== null) go(current.parent); };
  pAdd.onclick = async () => {
    try {
      const r = await api('/api/admin/albums', {
        method: 'POST',
        json: {
          items: [...selected].map(([p, name]) => ({ path: p, name: name.trim() })),
          allowUpload: $p('pUpload').checked,
          allowEdit: $p('pEdit').checked,
        },
      });
      dlg.close();
      renderAlbums(r.albums);
      const reg = r.skipped.filter((x) => x.reason === 'registered').length;
      const missing = r.skipped.length - reg;
      const notes = [reg && `${reg}件は登録済みのため除きました`, missing && `${missing}件は見つかりませんでした`].filter(Boolean);
      toast(`${r.added.length}件のフォルダを追加しました${notes.length ? `（${notes.join('、')}）` : ''}`, { duration: notes.length ? 5000 : undefined });
    } catch (e) {
      toast(e.message, { error: true });
    }
  };

  renderSelected();
  dlg.showModal();
  go('');
}

init();
window.__appOk = true;
