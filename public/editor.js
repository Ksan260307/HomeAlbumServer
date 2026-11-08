// 画像編集: フィルター・調整・切り抜き/回転
const ADJUSTMENTS = [
  { key: 'brightness', label: '明るさ', min: -100 },
  { key: 'contrast', label: 'コントラスト', min: -100 },
  { key: 'saturation', label: '彩度', min: -100 },
  { key: 'warmth', label: '暖かさ', min: -100 },
  { key: 'tint', label: '色かぶり', min: -100 },
  { key: 'highlights', label: 'ハイライト', min: -100 },
  { key: 'shadows', label: 'シャドウ', min: -100 },
  { key: 'fade', label: 'フェード', min: 0 },
  { key: 'vignette', label: '周辺減光', min: 0 },
  { key: 'sharpen', label: 'シャープ', min: 0 },
  { key: 'grain', label: '粒子', min: 0 },
];

const FILTERS = [
  { id: 'original', name: 'オリジナル', p: {} },
  { id: 'vivid', name: 'ビビッド', p: { contrast: 20, saturation: 35, brightness: 3 } },
  { id: 'pop', name: 'ポップ', p: { brightness: 6, contrast: 15, saturation: 25, warmth: 6 } },
  { id: 'warm', name: 'ウォーム', p: { warmth: 35, saturation: 10, brightness: 3 } },
  { id: 'cool', name: 'クール', p: { warmth: -35, tint: -5, contrast: 5 } },
  { id: 'sunset', name: 'サンセット', p: { warmth: 45, tint: 12, saturation: 15, vignette: 25, highlights: -10 } },
  { id: 'vintage', name: 'ヴィンテージ', p: { fade: 30, warmth: 22, saturation: -25, contrast: -8, vignette: 35, sepia: 15 } },
  { id: 'film', name: 'フィルム', p: { fade: 18, grain: 30, contrast: 12, warmth: 8, saturation: -10 } },
  { id: 'fade', name: 'フェード', p: { fade: 45, contrast: -18, saturation: -15, brightness: 5 } },
  { id: 'soft', name: 'ソフト', p: { contrast: -15, brightness: 8, fade: 12, highlights: -15, saturation: -5 } },
  { id: 'drama', name: 'ドラマ', p: { contrast: 38, highlights: -25, shadows: -15, vignette: 40, saturation: -12 } },
  { id: 'sepia', name: 'セピア', p: { sepia: 100, contrast: 8, fade: 10, vignette: 20 } },
  { id: 'mono', name: 'モノクロ', p: { saturation: -100, contrast: 15 } },
  { id: 'noir', name: 'ノワール', p: { saturation: -100, contrast: 45, brightness: -6, vignette: 45, grain: 15 } },
];

const ASPECTS = [
  { id: 'free', label: '自由', ratio: null },
  { id: 'orig', label: '元の比率', ratio: 'orig' },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

const PREVIEW_MAX = 1600;
const EXPORT_MAX_PIXELS = 16_000_000; // スマホのブラウザで扱えるキャンバスの上限に合わせる

const ed = {
  el: $('editor'), stage: $('eStage'), wrap: $('eWrap'), canvas: $('eCanvas'), crop: $('eCrop'),
  panel: $('ePanel'), tabs: $('eTabs'), loading: $('eLoading'), save: $('eSave'), cancel: $('eCancel'), reset: $('eReset'),
};

const E = {};

function defaultEdit() {
  return {
    filter: 'original', strength: 100, adj: Object.fromEntries(ADJUSTMENTS.map((a) => [a.key, 0])),
    rot: 0, flipX: false, flipY: false, angle: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, aspect: 'free',
    marks: [], // ペンの書き込み・スタンプ・文字
  };
}

function isDirty() {
  return JSON.stringify(E.edit) !== JSON.stringify(defaultEdit());
}

// ---- 画像処理 ----

function effectiveParams(edit, { withFilter = true } = {}) {
  const f = withFilter ? FILTERS.find((x) => x.id === edit.filter) : null;
  const k = edit.strength / 100;
  const out = { sepia: 0 };
  for (const a of ADJUSTMENTS) out[a.key] = edit.adj[a.key];
  if (f) {
    for (const [key, v] of Object.entries(f.p)) out[key] = (out[key] || 0) + v * k;
  }
  for (const a of ADJUSTMENTS) out[a.key] = Math.max(a.min, Math.min(100, out[a.key]));
  out.sepia = Math.min(100, out.sepia);
  return out;
}

function buildLut(p) {
  const lut = new Uint8ClampedArray(256);
  const b = p.brightness / 100, c = p.contrast / 100, f = p.fade / 100;
  const hi = p.highlights / 100, sh = p.shadows / 100;
  const gamma = 1 - b * 0.5;
  const cf = c >= 0 ? 1 + c : 1 + c * 0.7;
  for (let i = 0; i < 256; i++) {
    let x = Math.pow(i / 255, gamma);
    x += sh * 0.25 * (1 - x) * (1 - x);
    x += hi * 0.25 * x * x;
    x = (x - 0.5) * cf + 0.5;
    x = 0.1 * f + x * (1 - 0.18 * f);
    lut[i] = Math.round(Math.max(0, Math.min(1, x)) * 255);
  }
  return lut;
}

function applyAdjustments(ctx, w, h, p) {
  const neutral = Object.values(p).every((v) => !v);
  if (neutral) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const lut = buildLut(p);
  const sat = 1 + p.saturation / 100;
  const warm = (p.warmth / 100) * 28;
  const tint = (p.tint / 100) * 20;
  const sep = p.sepia / 100;
  const vig = (p.vignette / 100) * 0.8;
  const grain = (p.grain / 100) * 45;
  const cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) {
    const dy = (y - cy) / cy;
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      let r = lut[d[i]], g = lut[d[i + 1]], bl = lut[d[i + 2]];
      if (sat !== 1) {
        const l = 0.299 * r + 0.587 * g + 0.114 * bl;
        r = l + (r - l) * sat; g = l + (g - l) * sat; bl = l + (bl - l) * sat;
      }
      if (warm) { r += warm; bl -= warm; }
      if (tint) { g -= tint; r += tint * 0.3; bl += tint * 0.3; }
      if (sep) {
        const sr = 0.393 * r + 0.769 * g + 0.189 * bl;
        const sg = 0.349 * r + 0.686 * g + 0.168 * bl;
        const sb = 0.272 * r + 0.534 * g + 0.131 * bl;
        r += (sr - r) * sep; g += (sg - g) * sep; bl += (sb - bl) * sep;
      }
      if (vig) {
        const dx = (x - cx) / cx;
        const dist = (dx * dx + dy * dy) / 2;
        const m = 1 - vig * dist * dist * 1.6;
        r *= m; g *= m; bl *= m;
      }
      if (grain) {
        const n = (Math.random() - 0.5) * grain;
        r += n; g += n; bl += n;
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = bl;
    }
  }
  if (p.sharpen > 0) sharpen(d, w, h, (p.sharpen / 100) * 0.7);
  ctx.putImageData(img, 0, 0);
}

function sharpen(d, w, h, a) {
  const src = new Uint8ClampedArray(d);
  const k = 1 + 4 * a;
  const row = w * 4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * row + x * 4;
      for (let c = 0; c < 3; c++) {
        const j = i + c;
        d[j] = src[j] * k - a * (src[j - 4] + src[j + 4] + src[j - row] + src[j + row]);
      }
    }
  }
}

// 回転・反転・傾き・切り抜きを反映して canvas に描く
function drawGeometry(canvas, src, sw, sh, scale, edit, useCrop) {
  const swap = edit.rot % 180 !== 0;
  const W = (swap ? sh : sw) * scale;
  const H = (swap ? sw : sh) * scale;
  const a = Math.abs(edit.angle) * Math.PI / 180;
  const cover = Math.max((W * Math.cos(a) + H * Math.sin(a)) / W, (W * Math.sin(a) + H * Math.cos(a)) / H);
  const c = useCrop ? edit.crop : { x: 0, y: 0, w: 1, h: 1 };
  canvas.width = Math.max(1, Math.round(W * c.w));
  canvas.height = Math.max(1, Math.round(H * c.h));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.translate(-c.x * W, -c.y * H);
  ctx.translate(W / 2, H / 2);
  ctx.scale(edit.flipX ? -1 : 1, edit.flipY ? -1 : 1);
  // 反転していると回転の向きが逆に見えるので補正する
  const sign = edit.flipX !== edit.flipY ? -1 : 1;
  ctx.rotate(sign * (edit.rot + edit.angle) * Math.PI / 180);
  ctx.scale(cover * scale, cover * scale);
  ctx.drawImage(src, -sw / 2, -sh / 2);
  ctx.restore();
  return { ctx, W, H };
}

function frameSize() {
  const swap = E.edit.rot % 180 !== 0;
  return swap ? { W: E.small.height, H: E.small.width } : { W: E.small.width, H: E.small.height };
}

// ---- 開く・閉じる ----

async function openEditor(item) {
  Object.assign(E, {
    item, edit: defaultEdit(), tab: 'filter', tool: 'brightness', comparing: false, src: null, small: null, thumbs: null, busy: false,
    base: null, baseKey: null, frame: null, selected: -1,
  });
  ed.el.hidden = false;
  ed.loading.hidden = false;
  ed.canvas.hidden = true;
  history.pushState({ editor: true }, '');
  renderPanel();
  const img = new Image();
  img.decoding = 'async';
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = item.url;
    });
  } catch {
    toast('この写真は編集できません', { error: true });
    closeEditor();
    return;
  }
  if (ed.el.hidden) return;
  E.src = img;
  const s = Math.min(1, PREVIEW_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  E.small = document.createElement('canvas');
  E.small.width = Math.round(img.naturalWidth * s);
  E.small.height = Math.round(img.naturalHeight * s);
  const sctx = E.small.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(img, 0, 0, E.small.width, E.small.height);
  ed.loading.hidden = true;
  ed.canvas.hidden = false;
  renderPanel();
  scheduleRender();
}

function closeEditor(fromHistory) {
  if (ed.el.hidden) return;
  ed.el.hidden = true;
  E.src = null;
  E.small = null;
  E.base = null;
  if (!fromHistory && history.state?.editor) history.back();
}

ed.cancel.onclick = async () => {
  if (isDirty()) {
    const ok = await showDialog({ title: '編集をやめますか？', message: '変更した内容は保存されません。', okText: 'やめる', danger: true });
    if (!ok) return;
  }
  closeEditor();
};
ed.reset.onclick = () => {
  const tab = E.tab;
  E.edit = defaultEdit();
  E.tab = tab;
  E.selected = -1;
  renderPanel();
  scheduleRender();
};
window.addEventListener('popstate', () => { if (!ed.el.hidden && !history.state?.editor) closeEditor(true); });
window.addEventListener('hashchange', () => closeEditor(true));

// ---- プレビュー描画 ----

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderPreview();
  });
}

function renderPreview() {
  if (!E.small) return;
  const cropMode = E.tab === 'crop';
  // 色の調整は重いので、書き込みだけ変わったときは前回の結果を使い回す
  const e = E.edit;
  const key = JSON.stringify([e.filter, e.strength, e.adj, e.rot, e.flipX, e.flipY, e.angle, cropMode ? null : e.crop, E.comparing]);
  if (key !== E.baseKey) {
    E.base = E.base || document.createElement('canvas');
    const { ctx, W, H } = drawGeometry(E.base, E.small, E.small.width, E.small.height, 1, e, !cropMode);
    if (!E.comparing) applyAdjustments(ctx, E.base.width, E.base.height, effectiveParams(e));
    E.baseKey = key;
    E.frame = { W, H };
  }
  if (ed.canvas.width !== E.base.width || ed.canvas.height !== E.base.height) {
    ed.canvas.width = E.base.width;
    ed.canvas.height = E.base.height;
  }
  const ctx = ed.canvas.getContext('2d');
  ctx.clearRect(0, 0, ed.canvas.width, ed.canvas.height);
  ctx.drawImage(E.base, 0, 0);
  if (!E.comparing) drawMarks(ctx, E.frame.W, E.frame.H, cropMode ? FULL_FRAME : e.crop, e.marks, E.tab === 'stamp' ? E.selected : -1);
  fitCanvas();
  ed.crop.hidden = !cropMode;
  if (cropMode) positionCropBox();
}

// 画面に収まる大きさで表示する
function fitCanvas() {
  const st = getComputedStyle(ed.stage);
  const aw = ed.stage.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
  const ah = ed.stage.clientHeight - parseFloat(st.paddingTop) - parseFloat(st.paddingBottom);
  const s = Math.min(aw / ed.canvas.width, ah / ed.canvas.height);
  ed.canvas.style.width = `${Math.max(1, Math.floor(ed.canvas.width * s))}px`;
  ed.canvas.style.height = `${Math.max(1, Math.floor(ed.canvas.height * s))}px`;
}
window.addEventListener('resize', () => { if (!ed.el.hidden && E.small) fitCanvas(); });

// 長押しで編集前と比べる
let compareTimer = null;
ed.stage.addEventListener('pointerdown', (e) => {
  if (E.tab === 'crop' || E.tab === 'pen' || E.tab === 'stamp' || e.target.closest('.e-crop')) return;
  compareTimer = setTimeout(() => { E.comparing = true; scheduleRender(); }, 250);
});
const endCompare = () => {
  clearTimeout(compareTimer);
  if (E.comparing) { E.comparing = false; scheduleRender(); }
};
['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => ed.stage.addEventListener(t, endCompare));
ed.stage.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- 下のパネル ----

ed.tabs.onclick = (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  E.tab = b.dataset.tab;
  E.selected = -1;
  renderPanel();
  scheduleRender();
};

function renderPanel() {
  ed.tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === E.tab));
  if (E.tab === 'filter') renderFilterPanel();
  else if (E.tab === 'adjust') renderAdjustPanel();
  else if (E.tab === 'pen') renderPenPanel();
  else if (E.tab === 'stamp') renderStampPanel();
  else renderCropPanel();
  ed.canvas.classList.toggle('drawing', E.tab === 'pen' || E.tab === 'stamp');
}

function sliderRow(label, value, min, max, onInput, onReset) {
  const row = document.createElement('div');
  row.className = 'e-slider';
  row.innerHTML = `
    <span class="e-slabel">${esc(label)}</span>
    <input type="range" min="${min}" max="${max}" step="1" value="${Math.round(value)}" aria-label="${esc(label)}">
    <button class="e-value" type="button" title="ダブルクリックで0に戻す">${Math.round(value)}</button>`;
  const input = row.querySelector('input');
  const val = row.querySelector('.e-value');
  input.oninput = () => { val.textContent = input.value; onInput(Number(input.value)); };
  const reset = () => { input.value = onReset; val.textContent = onReset; onInput(onReset); };
  val.ondblclick = reset;
  input.ondblclick = reset;
  return row;
}

function renderFilterPanel() {
  ed.panel.innerHTML = '';
  if (E.edit.filter !== 'original') {
    ed.panel.append(sliderRow('強さ', E.edit.strength, 0, 100, (v) => { E.edit.strength = v; scheduleRender(); }, 100));
  }
  const strip = document.createElement('div');
  strip.className = 'e-strip';
  const thumbs = filterThumbnails();
  strip.innerHTML = FILTERS.map((f) => `
    <button class="e-filter${E.edit.filter === f.id ? ' on' : ''}" data-id="${f.id}" type="button">
      <span class="e-fthumb">${thumbs ? `<img alt="" src="${thumbs[f.id]}">` : ''}</span>
      <span>${esc(f.name)}</span>
    </button>`).join('');
  strip.onclick = (e) => {
    const b = e.target.closest('.e-filter');
    if (!b) return;
    const scroll = strip.scrollLeft;
    if (E.edit.filter !== b.dataset.id) E.edit.strength = 100;
    E.edit.filter = b.dataset.id;
    renderFilterPanel();
    ed.panel.querySelector('.e-strip').scrollLeft = scroll;
    scheduleRender();
  };
  ed.panel.append(strip);
}

// フィルター見本の小さな画像 (写真を開いたときに一度だけ作る)
function filterThumbnails() {
  if (!E.small) return null;
  if (E.thumbs) return E.thumbs;
  const size = 120;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const s = Math.min(E.small.width, E.small.height);
  const base = document.createElement('canvas');
  base.width = size;
  base.height = size;
  base.getContext('2d').drawImage(E.small, (E.small.width - s) / 2, (E.small.height - s) / 2, s, s, 0, 0, size, size);
  E.thumbs = {};
  for (const f of FILTERS) {
    ctx.drawImage(base, 0, 0);
    applyAdjustments(ctx, size, size, effectiveParams({ ...defaultEdit(), filter: f.id }));
    E.thumbs[f.id] = c.toDataURL('image/jpeg', 0.8);
  }
  return E.thumbs;
}

function renderAdjustPanel() {
  ed.panel.innerHTML = '';
  const tool = ADJUSTMENTS.find((a) => a.key === E.tool);
  ed.panel.append(sliderRow(tool.label, E.edit.adj[tool.key], tool.min, 100, (v) => {
    E.edit.adj[tool.key] = v;
    ed.panel.querySelector(`.e-chip[data-key="${tool.key}"]`)?.classList.toggle('changed', v !== 0);
    scheduleRender();
  }, 0));
  const chips = document.createElement('div');
  chips.className = 'e-strip e-chips';
  chips.innerHTML = ADJUSTMENTS.map((a) => `
    <button class="e-chip${a.key === E.tool ? ' on' : ''}${E.edit.adj[a.key] ? ' changed' : ''}" data-key="${a.key}" type="button">${esc(a.label)}</button>`).join('');
  chips.onclick = (e) => {
    const b = e.target.closest('.e-chip');
    if (!b) return;
    const scroll = chips.scrollLeft;
    E.tool = b.dataset.key;
    renderAdjustPanel();
    ed.panel.querySelector('.e-chips').scrollLeft = scroll;
  };
  ed.panel.append(chips);
}

function renderCropPanel() {
  ed.panel.innerHTML = '';
  ed.panel.append(sliderRow('傾き', E.edit.angle, -45, 45, (v) => { E.edit.angle = v; scheduleRender(); }, 0));
  const row = document.createElement('div');
  row.className = 'e-strip e-chips';
  row.innerHTML = `
    <button class="e-chip e-icon" data-act="rotL" type="button" title="左に回転">${icon('rotateL')}左に回転</button>
    <button class="e-chip e-icon" data-act="rotR" type="button" title="右に回転">${icon('rotateR')}右に回転</button>
    <button class="e-chip e-icon" data-act="flipH" type="button" title="左右反転">${icon('flipH')}左右反転</button>
    <button class="e-chip e-icon" data-act="flipV" type="button" title="上下反転">${icon('flipV')}上下反転</button>
    <span class="e-sep"></span>
    ${ASPECTS.map((a) => `<button class="e-chip${E.edit.aspect === a.id ? ' on' : ''}" data-aspect="${a.id}" type="button">${a.label}</button>`).join('')}`;
  row.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const ed2 = E.edit;
    const scroll = row.scrollLeft;
    if (b.dataset.act === 'rotL' || b.dataset.act === 'rotR') {
      ed2.rot = (ed2.rot + (b.dataset.act === 'rotR' ? 90 : 270)) % 360;
      transformMarks(ed2.marks, b.dataset.act);
      applyAspect(ed2.aspect);
    } else if (b.dataset.act === 'flipH' || b.dataset.act === 'flipV') {
      transformMarks(ed2.marks, b.dataset.act);
      // 画面上の向きで反転させる (90度回転しているときは縦横が入れ替わる)
      const horizontal = (b.dataset.act === 'flipH') === (ed2.rot % 180 === 0);
      if (horizontal) ed2.flipX = !ed2.flipX;
      else ed2.flipY = !ed2.flipY;
    } else if (b.dataset.aspect) {
      applyAspect(b.dataset.aspect);
    }
    renderCropPanel();
    ed.panel.querySelector('.e-chips').scrollLeft = scroll;
    scheduleRender();
  };
  ed.panel.append(row);
}

function aspectRatio(id) {
  const a = ASPECTS.find((x) => x.id === id);
  if (!a || !a.ratio) return null;
  if (a.ratio === 'orig') { const { W, H } = frameSize(); return W / H; }
  return a.ratio;
}

// 選んだ比率で、できるだけ大きく中央に切り抜く
function applyAspect(id) {
  E.edit.aspect = id;
  const r = aspectRatio(id);
  if (!r) { E.edit.crop = { x: 0, y: 0, w: 1, h: 1 }; return; }
  const { W, H } = frameSize();
  let w = 1, h = (W / r) / H;
  if (h > 1) { h = 1; w = (H * r) / W; }
  E.edit.crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

// ---- 切り抜き枠の操作 ----

function positionCropBox() {
  const c = E.edit.crop;
  Object.assign(ed.crop.style, {
    left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%`,
  });
}

let drag = null;
ed.crop.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try { ed.crop.setPointerCapture(e.pointerId); } catch { /* 取れなくても操作はできる */ }
  const rect = ed.canvas.getBoundingClientRect();
  drag = { mode: e.target.dataset.h || 'move', x: e.clientX, y: e.clientY, start: { ...E.edit.crop }, rw: rect.width, rh: rect.height };
});
ed.crop.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = (e.clientX - drag.x) / drag.rw;
  const dy = (e.clientY - drag.y) / drag.rh;
  const s = drag.start;
  const MIN = 0.06;
  let c;
  if (drag.mode === 'move') {
    c = { ...s, x: Math.min(1 - s.w, Math.max(0, s.x + dx)), y: Math.min(1 - s.h, Math.max(0, s.y + dy)) };
  } else {
    // 動かしている角の反対側を固定する
    const left = drag.mode.includes('w'), top = drag.mode.includes('n');
    const ax = left ? s.x + s.w : s.x;
    const ay = top ? s.y + s.h : s.y;
    const maxW = left ? ax : 1 - ax;
    const maxH = top ? ay : 1 - ay;
    let w = Math.min(maxW, Math.max(MIN, left ? s.w - dx : s.w + dx));
    let h = Math.min(maxH, Math.max(MIN, top ? s.h - dy : s.h + dy));
    const r = aspectRatio(E.edit.aspect);
    if (r) {
      // 比率を固定するときは横幅に合わせて高さを決め、はみ出す場合は縮める
      const { W, H } = frameSize();
      h = (w * W) / r / H;
      if (h > maxH) { h = maxH; w = (h * H * r) / W; }
    }
    c = { x: left ? ax - w : ax, y: top ? ay - h : ay, w, h };
  }
  E.edit.crop = c;
  positionCropBox();
});
const endDrag = () => { drag = null; };
ed.crop.addEventListener('pointerup', endDrag);
ed.crop.addEventListener('pointercancel', endDrag);

// ---- 保存 ----

function outputType(name) {
  const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

async function renderFull(type) {
  const src = E.src;
  const sw = src.naturalWidth, sh = src.naturalHeight;
  const c = E.edit.crop;
  const pixels = sw * sh * c.w * c.h;
  const scale = Math.min(1, Math.sqrt(EXPORT_MAX_PIXELS / pixels));
  const canvas = document.createElement('canvas');
  const { ctx, W, H } = drawGeometry(canvas, src, sw, sh, scale, E.edit, true);
  applyAdjustments(ctx, canvas.width, canvas.height, effectiveParams(E.edit));
  drawMarks(ctx, W, H, E.edit.crop, E.edit.marks);
  let blob = await new Promise((r) => canvas.toBlob(r, type, 0.92));
  // WebP で書き出せないブラウザでは JPEG にする
  if (!blob || blob.type !== type) {
    type = 'image/jpeg';
    blob = await new Promise((r) => canvas.toBlob(r, type, 0.92));
  }
  return blob;
}

ed.save.onclick = async () => {
  if (!E.src || E.busy) return;
  const item = E.item;
  const type = outputType(item.name);
  const canOverwrite = item.allowEdit && /\.(jpe?g|png|webp)$/i.test(item.name);
  const choices = [];
  if (item.allowUpload) choices.push({ value: 'copy', label: '別の写真として保存', description: '元の写真はそのまま残ります', primary: true });
  if (canOverwrite) choices.push({ value: 'overwrite', label: '元の写真を上書き', description: '元の写真はサーバーのPCのごみ箱に移ります' });
  choices.push({ value: 'download', label: 'この端末にダウンロード', description: 'アルバムには保存しません', primary: !choices.length });
  const mode = await showChoices({ title: '編集した写真を保存', choices });
  if (!mode) return;

  E.busy = true;
  ed.loading.hidden = false;
  try {
    const blob = await renderFull(type);
    if (!blob) throw new Error('画像を作れませんでした');
    if (mode === 'download') {
      const ext = blob.type === 'image/png' ? '.png' : blob.type === 'image/webp' ? '.webp' : '.jpg';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = item.name.replace(/\.[^.]+$/, '') + '_編集' + ext;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      toast('ダウンロードしました');
      return;
    }
    if (mode === 'overwrite' && blob.type !== type) throw new Error('このブラウザではこの形式で保存できません。別の写真として保存してください');
    const res = await fetch(`/api/save-edit?${qs({ album: item.album, path: item.path, mode })}`, {
      method: 'POST', headers: { 'X-HomeAlbum': '1', 'Content-Type': blob.type }, body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '保存できませんでした');
    toast(mode === 'overwrite' ? '上書き保存しました' : `「${data.name}」として保存しました`);
    closeEditor();
    if (typeof onEditorSaved === 'function') onEditorSaved(data.name);
  } catch (e) {
    toast(e.message, { error: true });
  } finally {
    E.busy = false;
    ed.loading.hidden = true;
  }
};

document.addEventListener('keydown', (e) => {
  if (ed.el.hidden || document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape') ed.cancel.click();
});

// ---- ペン・スタンプ・文字 ----

const pen = { tool: 'pen', color: '#ff3b30', width: 8 };
const PEN_TOOLS = [
  { id: 'pen', label: 'ペン' },
  { id: 'marker', label: 'マーカー' },
  { id: 'neon', label: 'ネオン' },
  { id: 'eraser', label: '消しゴム' },
];

function swatches(current, onPick) {
  const row = document.createElement('div');
  row.className = 'e-strip e-swatches';
  row.innerHTML = PEN_COLORS.map((c) => `<button class="e-swatch${c === current ? ' on' : ''}" data-c="${c}" type="button" style="background:${c}" aria-label="色 ${c}"></button>`).join('');
  row.onclick = (e) => {
    const b = e.target.closest('.e-swatch');
    if (!b) return;
    row.querySelectorAll('.e-swatch').forEach((x) => x.classList.toggle('on', x === b));
    onPick(b.dataset.c);
  };
  return row;
}

function renderPenPanel() {
  ed.panel.innerHTML = '';
  ed.panel.append(sliderRow('太さ', pen.width, 1, 40, (v) => { pen.width = v; }, 8));
  ed.panel.append(swatches(pen.color, (c) => {
    pen.color = c;
    // 消しゴムのまま色を選んだら、ペンに戻す
    if (pen.tool === 'eraser') { pen.tool = 'pen'; renderPenPanel(); }
  }));
  const tools = document.createElement('div');
  tools.className = 'e-strip e-chips';
  tools.innerHTML = `
    ${PEN_TOOLS.map((t) => `<button class="e-chip${pen.tool === t.id ? ' on' : ''}" data-tool="${t.id}" type="button">${t.label}</button>`).join('')}
    <span class="e-sep"></span>
    <button class="e-chip" data-act="undo" type="button" ${E.edit.marks.length ? '' : 'disabled'}>${icon('rotateL')}ひとつ戻す</button>
    <button class="e-chip" data-act="clear" type="button" ${E.edit.marks.length ? '' : 'disabled'}>すべて消す</button>`;
  tools.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.tool) {
      pen.tool = b.dataset.tool;
    } else if (b.dataset.act === 'undo') {
      E.edit.marks.pop();
    } else if (b.dataset.act === 'clear') {
      const ok = await showDialog({ title: '書き込みをすべて消しますか？', message: 'ペン・スタンプ・文字がすべて消えます。', okText: 'すべて消す', danger: true });
      if (!ok) return;
      E.edit.marks = [];
    }
    const scroll = tools.scrollLeft;
    renderPenPanel();
    ed.panel.querySelector('.e-chips').scrollLeft = scroll;
    scheduleRender();
  };
  ed.panel.append(tools);
}

function renderStampPanel() {
  ed.panel.innerHTML = '';
  const sel = E.edit.marks[E.selected];
  if (sel && sel.type !== 'stroke') {
    ed.panel.append(sliderRow('大きさ', Math.round(sel.size * 200), 4, 100, (v) => { sel.size = v / 200; scheduleRender(); }, sel.type === 'stamp' ? 36 : 16));
    ed.panel.append(sliderRow('角度', sel.angle, -180, 180, (v) => { sel.angle = v; scheduleRender(); }, 0));
    const row = document.createElement('div');
    row.className = 'e-strip e-chips';
    row.innerHTML = `
      <button class="e-chip on" data-act="done" type="button">完了</button>
      ${sel.type === 'text' ? '<button class="e-chip" data-act="edit" type="button">文字を変える</button>' : ''}
      <button class="e-chip" data-act="dup" type="button">複製</button>
      <button class="e-chip" data-act="delete" type="button">${icon('trash')}削除</button>
      ${sel.type === 'text' ? `<span class="e-sep"></span>${TEXT_STYLES.map((t) => `<button class="e-chip${sel.style === t.id ? ' on' : ''}" data-style="${t.id}" type="button">${t.label}</button>`).join('')}` : ''}`;
    row.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'done') {
        E.selected = -1;
      } else if (b.dataset.act === 'delete') {
        E.edit.marks.splice(E.selected, 1);
        E.selected = -1;
      } else if (b.dataset.act === 'dup') {
        E.edit.marks.push({ ...sel, x: Math.min(0.95, sel.x + 0.04), y: Math.min(0.95, sel.y + 0.04) });
        E.selected = E.edit.marks.length - 1;
      } else if (b.dataset.act === 'edit') {
        const text = await showDialog({ title: '文字を変える', input: sel.text, okText: '変える' });
        if (text) sel.text = text.slice(0, 60);
      } else if (b.dataset.style) {
        sel.style = b.dataset.style;
      }
      renderStampPanel();
      scheduleRender();
    };
    ed.panel.append(row);
    if (sel.type === 'text') {
      ed.panel.append(swatches(sel.color, (c) => { sel.color = c; scheduleRender(); }));
    }
    return;
  }
  const hint = document.createElement('div');
  hint.className = 'e-hint';
  hint.textContent = '選ぶと写真の真ん中に置かれます。置いたものはドラッグで動かせます。';
  ed.panel.append(hint);
  const strip = document.createElement('div');
  strip.className = 'e-strip e-stamps';
  strip.innerHTML = `<button class="e-chip e-addtext" data-act="text" type="button">Aa 文字を入れる</button>${STAMPS.map((st) => `<button class="e-stamp" data-s="${st}" type="button">${st}</button>`).join('')}`;
  strip.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const c = E.edit.crop;
    const center = { x: c.x + c.w / 2, y: c.y + c.h / 2, angle: 0 };
    if (b.dataset.act === 'text') {
      const text = await showDialog({ title: '文字を入れる', input: '', okText: '入れる' });
      if (!text) return;
      E.edit.marks.push({ type: 'text', text: text.slice(0, 60), size: 0.08, color: '#ffffff', style: 'outline', ...center });
    } else {
      E.edit.marks.push({ type: 'stamp', emoji: b.dataset.s, size: 0.18, ...center });
    }
    E.selected = E.edit.marks.length - 1;
    renderStampPanel();
    scheduleRender();
  };
  ed.panel.append(strip);
}

// 画面上の位置 → 写真全体を 0〜1 とした位置
function framePoint(e) {
  const r = ed.canvas.getBoundingClientRect();
  const c = E.tab === 'crop' ? FULL_FRAME : E.edit.crop;
  return [c.x + ((e.clientX - r.left) / r.width) * c.w, c.y + ((e.clientY - r.top) / r.height) * c.h];
}

// 当たり判定の余裕 (写真のピクセル単位で、画面上の 10px 分)
function hitTolerance() {
  return (10 * ed.canvas.width) / ed.canvas.getBoundingClientRect().width;
}

let pointerAction = null;

function eraseAt(p) {
  const i = hitMark(ed.canvas.getContext('2d'), E.edit.marks, p[0], p[1], E.frame.W, E.frame.H, hitTolerance());
  if (i >= 0) {
    E.edit.marks.splice(i, 1);
    scheduleRender();
  }
}

ed.canvas.addEventListener('pointerdown', (e) => {
  if ((E.tab !== 'pen' && E.tab !== 'stamp') || !E.frame) return;
  e.preventDefault();
  try { ed.canvas.setPointerCapture(e.pointerId); } catch { /* 取れなくても操作はできる */ }
  const p = framePoint(e);
  if (E.tab === 'pen') {
    if (pen.tool === 'eraser') {
      pointerAction = { mode: 'erase' };
      eraseAt(p);
    } else {
      const mk = { type: 'stroke', tool: pen.tool, color: pen.color, width: (pen.width / 400) * (pen.tool === 'marker' ? 2.5 : 1), points: [p] };
      E.edit.marks.push(mk);
      pointerAction = { mode: 'draw', mk };
      scheduleRender();
    }
    return;
  }
  const i = hitMark(ed.canvas.getContext('2d'), E.edit.marks, p[0], p[1], E.frame.W, E.frame.H, hitTolerance(), (mk) => mk.type !== 'stroke');
  if (i !== E.selected) {
    E.selected = i;
    renderStampPanel();
  }
  if (i >= 0) {
    const mk = E.edit.marks[i];
    pointerAction = { mode: 'move', mk, dx: p[0] - mk.x, dy: p[1] - mk.y };
  }
  scheduleRender();
});

ed.canvas.addEventListener('pointermove', (e) => {
  if (!pointerAction) return;
  const p = framePoint(e);
  if (pointerAction.mode === 'draw') {
    const pts = pointerAction.mk.points;
    const last = pts[pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.002) {
      pts.push(p);
      scheduleRender();
    }
  } else if (pointerAction.mode === 'erase') {
    eraseAt(p);
  } else if (pointerAction.mode === 'move') {
    const { mk, dx, dy } = pointerAction;
    mk.x = Math.max(0, Math.min(1, p[0] - dx));
    mk.y = Math.max(0, Math.min(1, p[1] - dy));
    scheduleRender();
  }
});

const endPointer = () => {
  if (!pointerAction) return;
  const mode = pointerAction.mode;
  pointerAction = null;
  // 「ひとつ戻す」などのボタンの状態を更新する
  if (mode !== 'move' && E.tab === 'pen') {
    const scroll = ed.panel.querySelector('.e-chips')?.scrollLeft || 0;
    renderPenPanel();
    ed.panel.querySelector('.e-chips').scrollLeft = scroll;
  }
};
ed.canvas.addEventListener('pointerup', endPointer);
ed.canvas.addEventListener('pointercancel', endPointer);
