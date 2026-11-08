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

// 送られてきたファイルの種類から付ける拡張子
const MIME_EXT = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/pjpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif', 'image/heic-sequence': '.heic',
  'image/heif-sequence': '.heif', 'image/avif': '.avif', 'image/bmp': '.bmp', 'image/tiff': '.tif',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/3gpp': '.3gp',
  'video/x-matroska': '.mkv', 'video/x-msvideo': '.avi', 'video/mpeg': '.mpg', 'video/x-m4v': '.m4v',
};

// ファイルの先頭のデータから、写真・動画の拡張子を調べる
async function sniffMediaExt(file) {
  let head;
  try {
    const fh = await fsp.open(file, 'r');
    try {
      head = Buffer.alloc(64);
      const { bytesRead } = await fh.read(head, 0, 64, 0);
      head = head.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
  const str = (a, b) => head.subarray(a, b).toString('latin1');
  if (head.length < 12) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return '.jpg';
  if (str(0, 4) === '\x89PNG') return '.png';
  if (str(0, 4) === 'GIF8') return '.gif';
  if (str(0, 4) === 'RIFF' && str(8, 12) === 'WEBP') return '.webp';
  if (str(0, 4) === 'RIFF' && str(8, 12) === 'AVI ') return '.avi';
  if (str(0, 4) === 'II*\0' || str(0, 4) === 'MM\0*') return '.tif';
  if (str(4, 8) === 'ftyp') {
    const brand = str(8, 12);
    if (/^(heic|heix|hevc|hevx|heim|heis)$/.test(brand)) return '.heic';
    if (/^(mif1|msf1)$/.test(brand)) return '.heif';
    if (/^(avif|avis)$/.test(brand)) return '.avif';
    if (brand === 'qt  ') return '.mov';
    if (brand.startsWith('3g')) return '.3gp';
    return '.mp4';
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return head.includes('webm') ? '.webm' : '.mkv';
  }
  return null;
}

// アップロードされたファイルの保存名を決める。写真・動画でなければ null
// (Android の Google フォトなどは、拡張子のない名前や空の名前で送ってくることがある)
async function uploadName(originalName, mimeType, tmpFile) {
  const name = cleanName(originalName);
  if (name && mediaType(name)) return name;
  const ext = MIME_EXT[String(mimeType || '').toLowerCase()] || await sniffMediaExt(tmpFile);
  if (!ext) return null;
  // 写真・動画ではない拡張子 (.tmp など) が付いていたら付け替える
  let stem = name ? name.replace(/\.[A-Za-z0-9]{1,5}$/, '') : '';
  if (!stem) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    stem = `upload_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
  return `${stem}${ext}`;
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
  listDir, findCoverImage, collectMedia, uploadName, PLAYABLE_VIDEO_EXT,
};
