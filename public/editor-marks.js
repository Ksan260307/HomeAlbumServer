// 画像編集: ペンの書き込み・スタンプ・文字の描画
// 位置や大きさは、切り抜く前の写真全体を 0〜1 とした値で持つ (切り抜きを変えても写真に付いてくる)
const PEN_COLORS = ['#ffffff', '#111111', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#af52de', '#ff2d92'];
const STAMPS = ['❤️', '💕', '⭐', '✨', '🎉', '🎂', '🎁', '🎈', '🌸', '🌈', '☀️', '🍀', '😀', '😂', '😍', '🥰', '😎', '😴', '👍', '✌️', '👑', '💯', '🐶', '🐱', '🍰', '📷', '🏠', '🚗'];
const TEXT_STYLES = [
  { id: 'outline', label: '縁取り' },
  { id: 'box', label: '背景付き' },
  { id: 'plain', label: 'シンプル' },
];
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const TEXT_FONT = 'system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif';
const FULL_FRAME = { x: 0, y: 0, w: 1, h: 1 };

function markFont(mk, m) {
  return mk.type === 'stamp' ? `${mk.size * m}px ${EMOJI_FONT}` : `700 ${mk.size * m}px ${TEXT_FONT}`;
}

// スタンプ・文字の枠の大きさ (px)
function markBox(ctx, mk, m) {
  ctx.save();
  ctx.font = markFont(mk, m);
  const w = mk.type === 'stamp' ? mk.size * m * 1.25 : ctx.measureText(mk.text).width + mk.size * m * 0.7;
  ctx.restore();
  return { w, h: mk.size * m * (mk.type === 'stamp' ? 1.25 : 1.45) };
}

function tracePath(ctx, pts, W, H) {
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0] * W, pts[0][1] * H, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
  // 点と点の間を曲線でつないで、なめらかな線にする
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = ((pts[i][0] + pts[i + 1][0]) / 2) * W;
    const my = ((pts[i][1] + pts[i + 1][1]) / 2) * H;
    ctx.quadraticCurveTo(pts[i][0] * W, pts[i][1] * H, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0] * W, last[1] * H);
  ctx.stroke();
}

function drawStroke(ctx, mk, W, H, m) {
  const lw = mk.width * m;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = mk.color;
  ctx.fillStyle = mk.color;
  ctx.lineWidth = lw;
  if (mk.tool === 'marker') ctx.globalAlpha = 0.45;
  if (mk.tool === 'neon') {
    ctx.shadowColor = mk.color;
    ctx.shadowBlur = lw * 1.6;
  }
  tracePath(ctx, mk.points, W, H);
  if (mk.tool === 'neon') {
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = lw * 0.35;
    tracePath(ctx, mk.points, W, H);
  }
  ctx.restore();
}

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 160;
}

function drawText(ctx, mk, m) {
  const size = mk.size * m;
  if (mk.style === 'box') {
    const { w, h } = markBox(ctx, mk, m);
    const r = h * 0.25;
    ctx.fillStyle = mk.color;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, r);
    ctx.fill();
    ctx.fillStyle = isLight(mk.color) ? '#111' : '#fff';
    ctx.fillText(mk.text, 0, size * 0.05);
    return;
  }
  if (mk.style === 'outline') {
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = isLight(mk.color) ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,.95)';
    ctx.strokeText(mk.text, 0, size * 0.05);
  } else {
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = size * 0.12;
  }
  ctx.fillStyle = mk.color;
  ctx.fillText(mk.text, 0, size * 0.05);
}

// W, H は切り抜く前の写真全体の大きさ (px)。selected の番号のものには選択枠を付ける
function drawMarks(ctx, W, H, crop, marks, selected = -1) {
  if (!marks.length) return;
  const m = Math.min(W, H);
  ctx.save();
  ctx.translate(-crop.x * W, -crop.y * H);
  marks.forEach((mk, i) => {
    if (mk.type === 'stroke') {
      drawStroke(ctx, mk, W, H, m);
      return;
    }
    ctx.save();
    ctx.translate(mk.x * W, mk.y * H);
    ctx.rotate((mk.angle * Math.PI) / 180);
    ctx.font = markFont(mk, m);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (mk.type === 'stamp') ctx.fillText(mk.emoji, 0, mk.size * m * 0.06);
    else drawText(ctx, mk, m);
    if (i === selected) {
      const { w, h } = markBox(ctx, mk, m);
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(2, m / 400);
      ctx.setLineDash([m / 80, m / 120]);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.lineDashOffset = m / 80;
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(-w / 2, -h / 2, w, h);
    }
    ctx.restore();
  });
  ctx.restore();
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// (fx, fy) の位置にある一番上の書き込みの番号。なければ -1
// filter で対象を絞れる。tol は当たり判定の余裕 (px)
function hitMark(ctx, marks, fx, fy, W, H, tol, filter = () => true) {
  const m = Math.min(W, H);
  const px = fx * W, py = fy * H;
  for (let i = marks.length - 1; i >= 0; i--) {
    const mk = marks[i];
    if (!filter(mk)) continue;
    if (mk.type === 'stroke') {
      const r = (mk.width * m) / 2 + tol;
      const pts = mk.points.map(([x, y]) => [x * W, y * H]);
      if (pts.length === 1 && Math.hypot(px - pts[0][0], py - pts[0][1]) <= r) return i;
      for (let k = 1; k < pts.length; k++) {
        if (distToSegment(px, py, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]) <= r) return i;
      }
    } else {
      const a = (-mk.angle * Math.PI) / 180;
      const dx = px - mk.x * W, dy = py - mk.y * H;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      const { w, h } = markBox(ctx, mk, m);
      if (Math.abs(lx) <= w / 2 + tol && Math.abs(ly) <= h / 2 + tol) return i;
    }
  }
  return -1;
}

// 写真を90度回転・反転したときに、書き込みも一緒に動かす
function transformMarks(marks, op) {
  const map = {
    rotR: ([x, y]) => [1 - y, x],
    rotL: ([x, y]) => [y, 1 - x],
    flipH: ([x, y]) => [1 - x, y],
    flipV: ([x, y]) => [x, 1 - y],
  }[op];
  for (const mk of marks) {
    if (mk.type === 'stroke') {
      mk.points = mk.points.map(map);
    } else {
      [mk.x, mk.y] = map([mk.x, mk.y]);
      if (op === 'rotR') mk.angle += 90;
      else if (op === 'rotL') mk.angle -= 90;
      else mk.angle = -mk.angle;
      mk.angle = ((mk.angle + 540) % 360) - 180;
    }
  }
}
