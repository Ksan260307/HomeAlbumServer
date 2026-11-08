// 閲覧画面と管理画面で共通の部品
const ICON_PATHS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  download: '<path d="M12 3v12m0 0l-5-5m5 5l5-5M5 21h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14"/>',
  check: '<path d="M5 12l5 5L20 7" stroke-width="3"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  video: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="M16 10l6-3v10l-6-3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
  upload: '<path d="M12 21V9m0 0l-5 5m5-5l5 5M5 3h14"/>',
  select: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  chevL: '<path d="M15 18l-6-6 6-6"/>',
  chevR: '<path d="M9 18l6-6-6-6"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  gallery: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M10 8.5v5l4-2.5z" fill="currentColor"/><path d="M8 21h8"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  drive: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13l2-8h10l2 8M7 16.5h.01"/>',
  wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4M12.2 6.2l-1.4-1.4M3 21l9-9"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  rotateL: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  rotateR: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  flipH: '<path d="M12 3v18"/><path d="M8 7l-5 5 5 5z"/><path d="M16 7l5 5-5 5z"/>',
  flipV: '<path d="M3 12h18"/><path d="M7 8l5-5 5 5z"/><path d="M7 16l5 5 5-5z"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(url, { method = 'GET', json, body, headers = {} } = {}) {
  const opts = { method, headers: { 'X-HomeAlbum': '1', ...headers } };
  if (json !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(json);
  } else if (body !== undefined) {
    opts.body = body;
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new Error('サーバーにつながりません。サーバーのPCでアプリが起動しているか確認してください');
  }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    const err = new Error((data && data.error) || `エラーが発生しました (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer = null;
function toast(message, { error = false, duration = 3000 } = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.className = 'toast' + (error ? ' error' : '');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  if (duration > 0) toastTimer = setTimeout(() => { el.hidden = true; }, duration);
}

// 確認・入力ダイアログ。OK なら true (入力ありなら文字列)、キャンセルなら null
function showDialog({ title, message = '', input = null, okText = 'OK', cancelText = 'キャンセル', danger = false, select = null }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `
      <form method="dialog">
        <h2>${esc(title)}</h2>
        ${message ? `<p>${esc(message)}</p>` : ''}
        ${input !== null ? `<input class="input" name="value" autocomplete="off" value="${esc(input)}">` : ''}
        <div class="actions">
          ${cancelText ? `<button class="btn" value="cancel" type="submit">${esc(cancelText)}</button>` : ''}
          <button class="btn ${danger ? 'danger' : 'primary'}" value="ok" type="submit">${esc(okText)}</button>
        </div>
      </form>`;
    document.body.append(dlg);
    const field = dlg.querySelector('input');
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      const value = field ? field.value.trim() : true;
      dlg.remove();
      resolve(ok && value ? value : null);
    });
    dlg.showModal();
    if (field) {
      field.focus();
      if (select) field.setSelectionRange(select[0], select[1]);
      else field.select();
    }
  });
}

// 選択肢ダイアログ。選んだ value を返す (キャンセルなら null)
// choices: [{ value, label, description, primary, danger }]
function showChoices({ title, message = '', choices }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `
      <form method="dialog">
        <h2>${esc(title)}</h2>
        ${message ? `<p>${esc(message)}</p>` : ''}
        <div class="choices">
          ${choices.map((c) => `
            <button class="choice${c.primary ? ' primary' : ''}${c.danger ? ' danger' : ''}" value="${esc(c.value)}" type="submit">
              <span class="c-label">${esc(c.label)}</span>
              ${c.description ? `<span class="c-desc">${esc(c.description)}</span>` : ''}
            </button>`).join('')}
        </div>
        <div class="actions"><button class="btn" value="" type="submit">キャンセル</button></div>
      </form>`;
    document.body.append(dlg);
    dlg.addEventListener('close', () => {
      const v = dlg.returnValue;
      dlg.remove();
      resolve(v || null);
    });
    dlg.showModal();
  });
}

// ボタンの近くに出るメニュー。items: [{ label, icon, danger, onClick }]
function showMenu(anchor, items) {
  document.querySelector('.menu-pop')?.remove();
  const menu = document.createElement('div');
  menu.className = 'menu-pop';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map((it, i) => `
    <button role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span></button>`).join('');
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  menu.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    close();
    items[Number(b.dataset.i)].onClick();
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
  });
  menu.querySelector('button')?.focus();
}
