// 印刷画面: 用紙・向き・レイアウト・余白・位置などを調整して印刷する
const PAPERS = [
  { id: 'A4', label: 'A4（210×297mm）', w: 210, h: 297 },
  { id: 'L', label: 'L判（89×127mm）', w: 89, h: 127 },
  { id: '2L', label: '2L判（127×178mm）', w: 127, h: 178 },
  { id: 'KG', label: 'KG（102×152mm）', w: 102, h: 152 },
  { id: 'hagaki', label: 'はがき（100×148mm）', w: 100, h: 148 },
  { id: 'A5', label: 'A5（148×210mm）', w: 148, h: 210 },
  { id: 'B5', label: 'B5（182×257mm）', w: 182, h: 257 },
  { id: 'A3', label: 'A3（297×420mm）', w: 297, h: 420 },
  { id: 'letter', label: 'レター（216×279mm）', w: 215.9, h: 279.4 },
];

// 縦向きのときの [列, 行]。横向きでは入れ替える
const LAYOUTS = [
  { n: 1, c: 1, r: 1 }, { n: 2, c: 1, r: 2 }, { n: 4, c: 2, r: 2 }, { n: 6, c: 2, r: 3 },
  { n: 8, c: 2, r: 4 }, { n: 9, c: 3, r: 3 }, { n: 12, c: 3, r: 4 }, { n: 20, c: 4, r: 5 }, { n: 30, c: 5, r: 6 },
];

const DEFAULTS = {
  paper: 'A4', orientation: 'portrait', perPage: 1, fit: 'fit', autoRotate: true,
  margin: 10, gap: 4, alignV: 'center', alignH: 'center', offsetX: 0, offsetY: 0,
  copies: 1, caption: 'none', cutLines: false,
};
const MM = 96 / 25.4; // 1mm あたりの画面上のピクセル数

const $ = (id) => document.getElementById(id);
const job = loadJob();
const settings = { ...DEFAULTS, ...loadSettings() };
const photos = []; // { url, name, mtime, img, w, h, rot }

function loadJob() {
  try { return JSON.parse(sessionStorage.getItem('homealbum.printJob')) || null; } catch { return null; }
}
function loadSettings() {
  try { return JSON.parse(localStorage.getItem('homealbum.printSettings')) || {}; } catch { return {}; }
}
function saveSettings() {
  try { localStorage.setItem('homealbum.printSettings', JSON.stringify(settings)); } catch { /* 保存できなくても印刷はできる */ }
}

$('backBtn').innerHTML = icon('back');
$('backBtn').onclick = () => {
  if (history.length > 1) history.back();
  else location.href = '/';
};
$('printBtn').innerHTML = `${icon('print')}印刷する`;
$('printBtn').onclick = () => window.print();

// ---- 設定パネル ----

function seg(name, options) {
  return `<div class="seg" data-name="${name}">${options.map(([v, label]) =>
    `<button type="button" data-v="${v}" class="${String(settings[name]) === String(v) ? 'on' : ''}">${esc(label)}</button>`).join('')}</div>`;
}

function range(name, label, min, max, step, unit) {
  return `<div class="p-field">
    <div class="p-label"><span>${esc(label)}</span><output id="out-${name}"></output></div>
    <input type="range" data-name="${name}" min="${min}" max="${max}" step="${step}" value="${settings[name]}" data-unit="${unit}">
  </div>`;
}

function layoutIcon(l) {
  const portrait = settings.orientation === 'portrait';
  const c = portrait ? l.c : l.r;
  const r = portrait ? l.r : l.c;
  return `<span class="l-icon ${portrait ? 'portrait' : 'landscape'}" style="grid-template-columns:repeat(${c},1fr);grid-template-rows:repeat(${r},1fr)">${'<i></i>'.repeat(l.n)}</span>`;
}

function renderSettings() {
  $('settings').innerHTML = `
    <section class="p-sec">
      <h2>用紙</h2>
      <div class="p-field">
        <label class="p-label" for="paperSel">用紙サイズ</label>
        <select class="select" id="paperSel" data-name="paper">
          ${PAPERS.map((p) => `<option value="${p.id}" ${p.id === settings.paper ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
        </select>
      </div>
      <div class="p-field"><div class="p-label">用紙の向き</div>${seg('orientation', [['portrait', '縦'], ['landscape', '横']])}</div>
      <p class="p-note">写真用紙・普通紙などの「用紙の種類」は、このあと開く印刷画面（プリンターの設定）で選んでください。</p>
    </section>

    <section class="p-sec">
      <h2>レイアウト</h2>
      <div class="p-field">
        <div class="p-label">1枚の用紙に印刷する写真の数</div>
        <div class="layouts">
          ${LAYOUTS.map((l) => `<button type="button" class="layout-btn ${l.n === settings.perPage ? 'on' : ''}" data-n="${l.n}">${layoutIcon(l)}<span>${l.n}枚</span></button>`).join('')}
        </div>
      </div>
      <div class="p-field">
        <div class="p-label">同じ写真を印刷する枚数</div>
        <div class="stepper">
          <button type="button" class="btn icon" data-step="-1" aria-label="減らす">−</button>
          <span id="copiesVal">${settings.copies}枚ずつ</span>
          <button type="button" class="btn icon" data-step="1" aria-label="増やす">＋</button>
        </div>
      </div>
      ${range('margin', '用紙のふちの余白', 0, 30, 1, 'mm')}
      ${range('gap', '写真と写真の間隔', 0, 20, 1, 'mm')}
    </section>

    <section class="p-sec">
      <h2>写真の向きと大きさ</h2>
      <div class="p-field"><div class="p-label">枠への合わせ方</div>${seg('fit', [['fit', '写真全体を表示'], ['fill', '枠いっぱい']])}</div>
      <p class="p-note" id="fitNote"></p>
      <label class="switch"><input type="checkbox" data-name="autoRotate" ${settings.autoRotate ? 'checked' : ''}>写真の向きを枠に合わせて自動で回転</label>
      <p class="p-note">プレビューの写真をクリック（タップ）すると、その写真だけ90°ずつ回転できます。</p>
    </section>

    <section class="p-sec">
      <h2>印刷位置</h2>
      <div class="p-field"><div class="p-label">縦の位置</div>${seg('alignV', [['top', '上'], ['center', '中央'], ['bottom', '下']])}</div>
      <div class="p-field"><div class="p-label">横の位置</div>${seg('alignH', [['left', '左'], ['center', '中央'], ['right', '右']])}</div>
      ${range('offsetX', '左右の微調整', -15, 15, 0.5, 'mm')}
      ${range('offsetY', '上下の微調整', -15, 15, 0.5, 'mm')}
      <p class="p-note">印刷すると位置がずれる場合に、全体を少しずつ動かして調整できます。</p>
    </section>

    <section class="p-sec">
      <h2>その他</h2>
      <div class="p-field">
        <label class="p-label" for="captionSel">写真の下に文字を入れる</label>
        <select class="select" id="captionSel" data-name="caption">
          ${[['none', '入れない'], ['date', '日付'], ['name', 'ファイル名'], ['both', '日付とファイル名']].map(([v, l]) =>
            `<option value="${v}" ${v === settings.caption ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <label class="switch"><input type="checkbox" data-name="cutLines" ${settings.cutLines ? 'checked' : ''}>切り取り線を入れる</label>
      <button type="button" class="btn" id="resetBtn" style="margin-top:6px">設定を最初に戻す</button>
    </section>`;
  updateOutputs();
}

function updateOutputs() {
  document.querySelectorAll('#settings input[type="range"]').forEach((input) => {
    const v = Number(input.value);
    let text = `${v}${input.dataset.unit}`;
    if (input.dataset.name === 'margin' && v === 0) text = 'なし（ふちなし）';
    if (input.dataset.name === 'offsetX') text = v === 0 ? '0mm' : `${v < 0 ? '左へ' : '右へ'} ${Math.abs(v)}mm`;
    if (input.dataset.name === 'offsetY') text = v === 0 ? '0mm' : `${v < 0 ? '上へ' : '下へ'} ${Math.abs(v)}mm`;
    $(`out-${input.dataset.name}`).textContent = text;
  });
  $('fitNote').textContent = settings.fit === 'fit'
    ? '写真が欠けないように枠の中に収めます（余白ができることがあります）。'
    : '枠いっぱいに印刷します（はみ出した部分は切れます）。';
}

function changed({ rerenderSettings = false } = {}) {
  saveSettings();
  if (rerenderSettings) renderSettings();
  else updateOutputs();
  renderSheets();
}

$('settings').addEventListener('click', (e) => {
  const segBtn = e.target.closest('.seg button');
  if (segBtn) {
    const name = segBtn.closest('.seg').dataset.name;
    settings[name] = segBtn.dataset.v;
    changed({ rerenderSettings: true });
    return;
  }
  const layout = e.target.closest('.layout-btn');
  if (layout) {
    settings.perPage = Number(layout.dataset.n);
    changed({ rerenderSettings: true });
    return;
  }
  const step = e.target.closest('[data-step]');
  if (step) {
    settings.copies = Math.max(1, Math.min(30, settings.copies + Number(step.dataset.step)));
    $('copiesVal').textContent = `${settings.copies}枚ずつ`;
    changed();
    return;
  }
  if (e.target.id === 'resetBtn') {
    Object.assign(settings, DEFAULTS);
    photos.forEach((p) => { p.rot = 0; });
    changed({ rerenderSettings: true });
  }
});
$('settings').addEventListener('input', (e) => {
  const name = e.target.dataset.name;
  if (!name) return;
  if (e.target.type === 'range') settings[name] = Number(e.target.value);
  else if (e.target.type === 'checkbox') settings[name] = e.target.checked;
  else settings[name] = e.target.value;
  changed();
});

// ---- プレビュー (このまま印刷される) ----

function pageSize() {
  const p = PAPERS.find((x) => x.id === settings.paper) || PAPERS[0];
  return settings.orientation === 'landscape' ? { W: p.h, H: p.w } : { W: p.w, H: p.h };
}

function gridSize() {
  const l = LAYOUTS.find((x) => x.n === settings.perPage) || LAYOUTS[0];
  return settings.orientation === 'landscape' ? { cols: l.r, rows: l.c } : { cols: l.c, rows: l.r };
}

function formatDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function captionText(p) {
  if (settings.caption === 'date') return formatDate(p.mtime);
  if (settings.caption === 'name') return p.name;
  if (settings.caption === 'both') return `${formatDate(p.mtime)}  ${p.name}`;
  return '';
}

function placePhoto(p, aw, ah) {
  // 回転後の写真の縦横
  let rot = p.rot;
  if (settings.autoRotate && p.w && p.h) {
    const landscapePhoto = p.w > p.h;
    const landscapeCell = aw > ah;
    if (p.w !== p.h && landscapePhoto !== landscapeCell) rot += 90;
  }
  rot %= 360;
  const turned = rot % 180 !== 0;
  const ew = turned ? p.h : p.w;
  const eh = turned ? p.w : p.h;
  const scale = settings.fit === 'fill' ? Math.max(aw / ew, ah / eh) : Math.min(aw / ew, ah / eh);
  const dw = ew * scale, dh = eh * scale;
  const kx = { left: 0, center: 0.5, right: 1 }[settings.alignH];
  const ky = { top: 0, center: 0.5, bottom: 1 }[settings.alignV];
  const cx = (aw - dw) * kx + dw / 2;
  const cy = (ah - dh) * ky + dh / 2;
  // img 要素は回転前の大きさで置き、中心を軸に回す
  const bw = turned ? dh : dw, bh = turned ? dw : dh;
  return { left: cx - bw / 2, top: cy - bh / 2, width: bw, height: bh, rot };
}

function renderSheets() {
  const { W, H } = pageSize();
  const { cols, rows } = gridSize();
  $('pageStyle').textContent = `@page { size: ${W}mm ${H}mm; margin: 0; }`;

  const slots = [];
  photos.forEach((p, i) => { for (let k = 0; k < settings.copies; k++) slots.push(i); });
  const perPage = cols * rows;
  const pages = Math.max(1, Math.ceil(slots.length / perPage));

  const m = Math.min(settings.margin, W / 2 - 5, H / 2 - 5);
  const gap = settings.gap;
  const cellW = (W - m * 2 - gap * (cols - 1)) / cols;
  const cellH = (H - m * 2 - gap * (rows - 1)) / rows;
  const capH = settings.caption === 'none' ? 0 : Math.min(6, cellH * 0.15);
  const ah = cellH - capH;

  const holderW = $('sheets').clientWidth || 600;
  const scale = Math.min(1, (holderW - 8) / (W * MM));

  let html = '';
  for (let pg = 0; pg < pages; pg++) {
    let cells = '';
    for (let k = 0; k < perPage; k++) {
      const idx = slots[pg * perPage + k];
      if (idx === undefined) break;
      const p = photos[idx];
      const col = k % cols, row = Math.floor(k / cols);
      const x = m + col * (cellW + gap), y = m + row * (cellH + gap);
      let img = '';
      if (p.w) {
        const pl = placePhoto(p, cellW, ah);
        img = `<img src="${esc(p.url)}" alt="" data-i="${idx}" title="クリックで回転"
          style="left:${pl.left}mm;top:${pl.top}mm;width:${pl.width}mm;height:${pl.height}mm;transform:rotate(${pl.rot}deg)">`;
      } else if (p.failed) {
        img = '<div class="cell-msg">表示できない写真です</div>';
      }
      const cap = capH ? `<div class="cell-cap" style="top:${ah}mm;height:${capH}mm;font-size:${Math.min(3, capH * 0.55)}mm">${esc(captionText(p))}</div>` : '';
      cells += `<div class="cell${settings.cutLines ? ' cut' : ''}" style="left:${x}mm;top:${y}mm;width:${cellW}mm;height:${cellH}mm">
        <div class="cell-img" style="height:${ah}mm">${img}</div>${cap}</div>`;
    }
    html += `<div class="sheet-holder" style="width:${W * MM * scale}px;height:${H * MM * scale}px">
      <div class="sheet" style="width:${W}mm;height:${H}mm;transform:scale(${scale})">
        <div class="sheet-inner" style="transform:translate(${settings.offsetX}mm,${settings.offsetY}mm)">${cells}</div>
      </div></div>`;
  }
  $('sheets').innerHTML = html;

  const paper = PAPERS.find((x) => x.id === settings.paper) || PAPERS[0];
  $('info').innerHTML = `
    <strong>用紙 ${pages}枚</strong>（写真 ${photos.length}枚${settings.copies > 1 ? ` × ${settings.copies}枚ずつ` : ''}）
    <span class="p-hint">印刷画面では、用紙サイズを「${esc(paper.label.replace(/（.*/, ''))}」、余白を「なし」、倍率を「100%（実際のサイズ）」にしてください。</span>`;
}

$('sheets').addEventListener('click', (e) => {
  const img = e.target.closest('img[data-i]');
  if (!img) return;
  const p = photos[Number(img.dataset.i)];
  p.rot = (p.rot + 90) % 360;
  renderSheets();
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderSheets, 150);
});

// ---- 開始 ----

function start() {
  if (!job || !job.items?.length) {
    document.querySelector('.print-layout').innerHTML = `<div class="empty">${icon('print')}<p>印刷する写真が選ばれていません。<br>アルバムで写真を選んでから「印刷」を押してください。</p><a class="btn primary" href="/">アルバムへ戻る</a></div>`;
    return;
  }
  document.title = `印刷（${job.items.length}枚） - ホームアルバム`;
  renderSettings();
  let pending = job.items.length;
  const done = () => {
    pending--;
    renderSheets();
    $('printBtn').disabled = pending > 0;
    $('printBtn').innerHTML = pending > 0 ? `準備中… (${job.items.length - pending}/${job.items.length})` : `${icon('print')}印刷する`;
  };
  for (const it of job.items) {
    const p = { ...it, w: 0, h: 0, rot: 0, failed: false };
    photos.push(p);
    const img = new Image();
    img.onload = () => { p.w = img.naturalWidth; p.h = img.naturalHeight; done(); };
    img.onerror = () => { p.failed = true; done(); };
    img.src = p.url;
  }
  $('printBtn').innerHTML = `準備中… (0/${job.items.length})`;
  renderSheets();
}

start();
