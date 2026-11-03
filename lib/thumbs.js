// サムネイルと表示用画像の作成・キャッシュ
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { DATA_DIR } = require('./config');

const THUMB_DIR = path.join(DATA_DIR, 'thumbs');
const THUMB_SIZE = 480;
const PREVIEW_SIZE = 2560;

let sharp = null;
try {
  sharp = require('sharp');
  sharp.cache(false);
  sharp.concurrency(2);
} catch (e) {
  console.warn('画像処理ライブラリを読み込めませんでした。サムネイルは元画像で代用します:', e.message);
}

let ffmpegAvailable = false;
execFile('ffmpeg', ['-version'], { windowsHide: true }, (err) => { ffmpegAvailable = !err; });

// 後から要求されたもの (= いま画面に見えているもの) を優先して処理する
function createLifoLimiter(limit) {
  let active = 0;
  const stack = [];
  const next = () => {
    if (active >= limit || !stack.length) return;
    const job = stack.pop();
    if (job.cancelled && job.cancelled()) {
      job.reject(new Error('cancelled'));
      return next();
    }
    active++;
    job.fn().then(job.resolve, job.reject).finally(() => { active--; next(); });
  };
  return (fn, cancelled) => new Promise((resolve, reject) => {
    stack.push({ fn, cancelled, resolve, reject });
    next();
  });
}

const limit = createLifoLimiter(3);
const inflight = new Map();

function cacheFile(abs, st, kind, ext) {
  const key = crypto.createHash('sha1').update(`${kind}|${abs}|${st.size}|${st.mtimeMs}`).digest('hex');
  return path.join(THUMB_DIR, key.slice(0, 2), key + ext);
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function produce(out, cancelled, build) {
  if (await exists(out)) return out;
  if (inflight.has(out)) return inflight.get(out);
  const p = limit(async () => {
    if (await exists(out)) return out;
    await fsp.mkdir(path.dirname(out), { recursive: true });
    const tmp = `${out}.${process.pid}.${Date.now()}.tmp`;
    try {
      await build(tmp);
      await fsp.rename(tmp, out);
    } catch (e) {
      fsp.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
    return out;
  }, cancelled).finally(() => inflight.delete(out));
  inflight.set(out, p);
  return p;
}

function imageThumb(abs, st, cancelled) {
  if (!sharp) return Promise.resolve(null);
  const out = cacheFile(abs, st, 'thumb', '.webp');
  return produce(out, cancelled, (tmp) => sharp(abs, { failOn: 'none' })
    .rotate()
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72 })
    .toFile(tmp));
}

function runFfmpeg(abs, seconds, tmp) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-y', '-ss', String(seconds), '-i', abs, '-frames:v', '1',
      '-vf', `scale=${THUMB_SIZE}:-2`, '-f', 'image2', '-c:v', 'mjpeg', tmp],
    { windowsHide: true, timeout: 30000 }, async (err) => {
      if (err) return reject(err);
      const st = await fsp.stat(tmp).catch(() => null);
      if (!st || st.size === 0) return reject(new Error('no frame'));
      resolve();
    });
  });
}

// 動画のサムネイル: キャッシュ済み、または ffmpeg がある場合のみサーバーで作成
async function videoThumb(abs, st, cancelled) {
  const out = cacheFile(abs, st, 'thumb', '.webp');
  if (await exists(out)) return out;
  if (!ffmpegAvailable || !sharp) return null;
  return produce(out, cancelled, async (tmp) => {
    const jpg = tmp + '.jpg';
    try {
      await runFfmpeg(abs, 1, jpg).catch(() => runFfmpeg(abs, 0, jpg));
      await sharp(jpg).webp({ quality: 72 }).toFile(tmp);
    } finally {
      fsp.rm(jpg, { force: true }).catch(() => {});
    }
  });
}

// ブラウザ側で作った動画サムネイルを保存する
async function saveClientThumb(abs, st, buffer) {
  if (!sharp) return;
  const out = cacheFile(abs, st, 'thumb', '.webp');
  if (await exists(out)) return;
  await produce(out, null, (tmp) => sharp(buffer, { failOn: 'none' })
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72 })
    .toFile(tmp));
}

// ブラウザで直接表示できない画像 (TIFF など) を JPEG に変換
function previewImage(abs, st, cancelled) {
  if (!sharp) return Promise.resolve(null);
  const out = cacheFile(abs, st, 'preview', '.jpg');
  return produce(out, cancelled, (tmp) => sharp(abs, { failOn: 'none' })
    .rotate()
    .resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(tmp));
}

module.exports = { imageThumb, videoThumb, saveClientThumb, previewImage };
