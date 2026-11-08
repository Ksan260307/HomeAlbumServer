// アルバム内のファイル操作 (パス検証・一覧・名前の整形)
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.heic', '.heif', '.tif', '.tiff']);
const NATIVE_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.mpg', '.mpeg', '.3gp', '.mts', '.m2ts', '.ogv']);
const PLAYABLE_VIDEO_EXT = new Set(['.mp4', '.m4v', '.mov', '.webm', '.ogv', '.3gp']);
const SKIP_NAMES = new Set(['$recycle.bin', 'system volume information', 'thumbs.db', 'desktop.ini']);

function mediaType(name) {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

function isViewable(name) {
  const ext = path.extname(name).toLowerCase();
  return NATIVE_IMAGE_EXT.has(ext) || PLAYABLE_VIDEO_EXT.has(ext);
}

function isNativeImage(name) {
  return NATIVE_IMAGE_EXT.has(path.extname(name).toLowerCase());
}

function isHidden(name) {
  return name.startsWith('.') || SKIP_NAMES.has(name.toLowerCase());
}

// アルバムのルートからの相対パスを絶対パスに変換。ルート外を指す場合は null
function resolveInAlbum(album, rel = '') {
  const root = path.resolve(album.path);
  const parts = String(rel).split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => p === '..' || p === '.' || p.includes(':') || isHidden(p))) return null;
  const abs = path.resolve(root, ...parts);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(prefix)) return null;
  return abs;
}

// Windows で使えない文字を取り除いたファイル名。使えない場合は null
function cleanName(name) {
  const base = path.basename(String(name || '').replace(/\\/g, '/'));
  const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..' || isHidden(cleaned)) return null;
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned)) return null;
  return cleaned.slice(0, 200);
}

// 同名ファイルがあれば「名前 (1).jpg」のように重複しない名前を返す
async function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 1; ; i++) {
    try {
      await fsp.access(candidate);
      candidate = path.join(dir, `${stem} (${i})${ext}`);
    } catch {
      return candidate;
    }
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function listDir(abs) {
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  const dirs = [];
  const candidates = [];
  for (const e of entries) {
    if (isHidden(e.name)) continue;
    if (e.isDirectory()) dirs.push({ name: e.name });
    else if (e.isFile() && mediaType(e.name)) candidates.push(e.name);
  }
  const files = (await mapLimit(candidates, 32, async (name) => {
    try {
      const st = await fsp.stat(path.join(abs, name));
      return {
        name,
        type: mediaType(name),
        size: st.size,
        mtime: Math.round(st.mtimeMs),
        viewable: isViewable(name),
      };
    } catch {
      return null;
    }
  })).filter(Boolean);
  const collator = new Intl.Collator('ja', { numeric: true });
  dirs.sort((a, b) => collator.compare(a.name, b.name));
  return { dirs, files };
}

// フォルダの表紙にする画像を探す (直下 → 1階層下)
async function findCoverImage(abs, depth = 1) {
  let entries;
  try {
    entries = await fsp.readdir(abs, { withFileTypes: true });
  } catch {
    return null;
  }
  const collator = new Intl.Collator('ja', { numeric: true });
  entries = entries.filter((e) => !isHidden(e.name)).sort((a, b) => collator.compare(a.name, b.name));
  const img = entries.find((e) => e.isFile() && mediaType(e.name) === 'image');
  if (img) return path.join(abs, img.name);
  if (depth > 0) {
    for (const e of entries.filter((d) => d.isDirectory()).slice(0, 10)) {
      const found = await findCoverImage(path.join(abs, e.name), depth - 1);
      if (found) return found;
    }
  }
  return null;
}

// ギャラリー用: フォルダ内の写真 (videos が true なら動画も) を、必要ならサブフォルダも含めて名前順に集める
async function collectMedia(abs, rel, out, { recursive, limit, videos = false, depth = 0 }) {
  if (out.length >= limit || depth > 30) return;
  let entries;
  try {
    entries = await fsp.readdir(abs, { withFileTypes: true });
  } catch {
    return;
  }
  const collator = new Intl.Collator('ja', { numeric: true });
  entries = entries.filter((e) => !isHidden(e.name)).sort((a, b) => collator.compare(a.name, b.name));
  const wanted = entries.filter((e) => {
    const type = e.isFile() && mediaType(e.name);
    return type === 'image' || (videos && type === 'video');
  }).slice(0, limit - out.length);
  const found = await mapLimit(wanted, 32, async (e) => {
    const st = await fsp.stat(path.join(abs, e.name)).catch(() => null);
    if (!st) return null;
    return {
      path: rel ? `${rel}/${e.name}` : e.name,
      type: mediaType(e.name),
      viewable: isViewable(e.name),
      mtime: Math.round(st.mtimeMs),
      size: st.size,
    };
  });
  out.push(...found.filter(Boolean));
  if (!recursive) return;
  for (const e of entries) {
    if (out.length >= limit) return;
    if (e.isDirectory()) {
      await collectMedia(path.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name, out, { recursive, limit, videos, depth: depth + 1 });
    }
  }
}

module.exports = {
  mediaType, isViewable, isNativeImage, isHidden, resolveInAlbum, cleanName, uniquePath,
  listDir, findCoverImage, collectMedia, PLAYABLE_VIDEO_EXT,
};
