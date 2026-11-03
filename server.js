// ホームアルバム サーバー本体
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const busboy = require('busboy');

const config = require('./lib/config');
const files = require('./lib/files');
const thumbs = require('./lib/thumbs');
const { writeZip } = require('./lib/zip');
const { moveToTrash } = require('./lib/trash');
const { isPrivate, isAllowedHost, lanAddresses } = require('./lib/network');
const { createAdminRouter } = require('./lib/admin');

config.load();

const app = express();
let listeningPort = config.get().port;

app.disable('x-powered-by');
app.set('etag', 'strong');

// ローカルネットワーク以外からのアクセスは拒否
app.use((req, res, next) => {
  if (!isPrivate(req.socket.remoteAddress) || !isAllowedHost(req.headers.host)) {
    return res.status(403).type('text/plain; charset=utf-8').send('このサイトは家庭内ネットワークからのみ利用できます。');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// 変更系の操作は、このアプリの画面からの要求だけ受け付ける (他サイトからの不正な送信対策)
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.path === '/zip') return next();
  if (req.get('X-HomeAlbum') !== '1') return res.status(403).json({ error: '不正な要求です' });
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use('/api/admin', createAdminRouter(() => listeningPort));

// ---- アルバム閲覧 ----

function publicAlbum(a) {
  return { id: a.id, name: a.name, allowUpload: !!a.allowUpload, allowEdit: !!a.allowEdit };
}

// album と path クエリから対象を解決する
function target(req, res, { requireEdit = false, requireUpload = false } = {}) {
  const src = req.method === 'GET' ? req.query : { ...req.query, ...req.body };
  const album = config.findAlbum(String(src.album || ''));
  if (!album) { res.status(404).json({ error: 'アルバムが見つかりません' }); return null; }
  if (requireEdit && !album.allowEdit) { res.status(403).json({ error: 'このフォルダは閲覧専用です' }); return null; }
  if (requireUpload && !album.allowUpload) { res.status(403).json({ error: 'このフォルダにはアップロードできません' }); return null; }
  const rel = String(src.path || '');
  const abs = files.resolveInAlbum(album, rel);
  if (!abs) { res.status(400).json({ error: '場所が正しくありません' }); return null; }
  return { album, rel, abs };
}

async function statFile(abs) {
  const st = await fsp.stat(abs).catch(() => null);
  return st && st.isFile() ? st : null;
}

app.get('/api/albums', (req, res) => {
  res.json(config.get().albums.map(publicAlbum));
});

app.get('/api/list', async (req, res) => {
  const t = target(req, res);
  if (!t) return;
  try {
    const { dirs, files: list } = await files.listDir(t.abs);
    res.json({ album: publicAlbum(t.album), path: t.rel, dirs, files: list });
  } catch (e) {
    const msg = e.code === 'ENOENT' ? 'フォルダが見つかりません' : 'フォルダを開けません';
    res.status(e.code === 'ENOENT' ? 404 : 500).json({ error: msg });
  }
});

function sendCached(res, file) {
  res.setHeader('Cache-Control', 'private, max-age=604800');
  res.sendFile(file, { dotfiles: 'allow' });
}

app.get('/api/thumb', async (req, res) => {
  const t = target(req, res);
  if (!t) return;
  const st = await statFile(t.abs);
  const type = st && files.mediaType(t.abs);
  if (!type) return res.status(404).end();
  const cancelled = () => req.destroyed;
  try {
    const out = type === 'image'
      ? await thumbs.imageThumb(t.abs, st, cancelled)
      : await thumbs.videoThumb(t.abs, st, cancelled);
    if (out) return sendCached(res, out);
    if (type === 'image' && files.isNativeImage(t.abs)) return sendCached(res, t.abs);
    res.status(404).end();
  } catch {
    if (!res.headersSent) res.status(404).end();
  }
});

// ブラウザで作成した動画のサムネイルを受け取る
app.post('/api/thumb', express.raw({ type: 'image/*', limit: '3mb' }), async (req, res) => {
  const t = target(req, res);
  if (!t) return;
  const st = await statFile(t.abs);
  if (!st || files.mediaType(t.abs) !== 'video' || !Buffer.isBuffer(req.body)) return res.status(400).end();
  try {
    await thumbs.saveClientThumb(t.abs, st, req.body);
    res.json({ ok: true });
  } catch {
    res.status(400).end();
  }
});

// ギャラリー (スライドショー) で表示する写真の一覧。album=all ですべてのアルバム
app.get('/api/gallery', async (req, res) => {
  const recursive = req.query.recursive !== '0';
  let sources;
  if (req.query.album === 'all') {
    sources = config.get().albums.map((a) => ({ album: a, rel: '', abs: path.resolve(a.path) }));
  } else {
    const t = target(req, res);
    if (!t) return;
    sources = [{ ...t, rel: t.rel.split(/[\\/]+/).filter(Boolean).join('/') }];
  }
  const LIMIT = 50000;
  const items = [];
  for (const s of sources) {
    const list = [];
    await files.collectImages(s.abs, s.rel, list, { recursive, limit: LIMIT - items.length });
    for (const item of list) items.push({ album: s.album.id, ...item });
  }
  res.json({ albums: Object.fromEntries(sources.map((s) => [s.album.id, s.album.name])), items });
});

// フォルダの表紙
const coverCache = new Map();
app.get('/api/cover', async (req, res) => {
  const t = target(req, res);
  if (!t) return;
  const dirStat = await fsp.stat(t.abs).catch(() => null);
  if (!dirStat || !dirStat.isDirectory()) return res.status(404).end();
  const key = `${t.abs}|${dirStat.mtimeMs}`;
  let img = coverCache.get(key);
  if (img === undefined) {
    img = await files.findCoverImage(t.abs);
    coverCache.set(key, img);
    if (coverCache.size > 2000) coverCache.delete(coverCache.keys().next().value);
  }
  const st = img && await statFile(img);
  if (!st) return res.status(404).end();
  try {
    const out = await thumbs.imageThumb(img, st, () => req.destroyed);
    if (out) return sendCached(res, out);
    if (files.isNativeImage(img)) return sendCached(res, img);
  } catch { /* 下で 404 */ }
  if (!res.headersSent) res.status(404).end();
});

app.get('/api/file', async (req, res) => {
  const t = target(req, res);
  if (!t) return;
  const st = await statFile(t.abs);
  if (!st || !files.mediaType(t.abs)) return res.status(404).json({ error: 'ファイルが見つかりません' });
  if (req.query.dl === '1') {
    return res.download(t.abs, path.basename(t.abs), { dotfiles: 'allow' });
  }
  // .mov (H.264) は video/mp4 として渡すと多くのブラウザで再生できる
  if (/\.(mov|m4v)$/i.test(t.abs)) res.type('video/mp4');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(t.abs, { dotfiles: 'allow' });
});

// ブラウザで表示できない画像形式を JPEG に変換して表示
app.get('/api/preview', async (req, res) => {
  const t = target(req, res);
  if (!t) return;
  const st = await statFile(t.abs);
  if (!st || files.mediaType(t.abs) !== 'image') return res.status(404).end();
  try {
    const out = await thumbs.previewImage(t.abs, st, () => req.destroyed);
    if (out) return sendCached(res, out);
  } catch { /* 下で 415 */ }
  if (!res.headersSent) res.status(415).end();
});

// 複数ファイルを ZIP でダウンロード (フォーム送信)
app.post('/api/zip', express.urlencoded({ extended: false, limit: '5mb' }), async (req, res) => {
  const t = target(req, res);
  if (!t) return;
  const names = [].concat(req.body.names || []).map(String);
  const entries = [];
  const used = new Set();
  for (const name of names) {
    const abs = files.resolveInAlbum(t.album, path.posix.join(t.rel.replace(/\\/g, '/'), name));
    const st = abs && await statFile(abs);
    if (!st || !files.mediaType(abs) || used.has(abs)) continue;
    used.add(abs);
    entries.push({ abs, name: path.basename(abs), size: st.size, mtime: st.mtimeMs });
  }
  if (!entries.length) return res.status(400).type('text/plain; charset=utf-8').send('ダウンロードするファイルがありません。');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const folderName = t.rel ? path.basename(t.abs) : t.album.name;
  res.attachment(`${files.cleanName(folderName) || 'album'}_${stamp}.zip`);
  res.type('application/zip');
  try {
    await writeZip(res, entries);
  } catch {
    res.destroy();
  }
});

// ---- アップロード・編集 (管理画面で許可したフォルダのみ) ----

app.post('/api/upload', (req, res) => {
  const t = target(req, res, { requireUpload: true });
  if (!t) return;
  let bb;
  try {
    bb = busboy({ headers: req.headers, defParamCharset: 'utf8' });
  } catch {
    return res.status(400).json({ error: 'アップロードの形式が正しくありません' });
  }
  const jobs = [];
  const saved = [];
  const skipped = [];
  bb.on('file', (field, stream, info) => {
    const name = files.cleanName(info.filename);
    if (!name || !files.mediaType(name)) {
      skipped.push(info.filename);
      stream.resume();
      return;
    }
    jobs.push((async () => {
      const dest = await files.uniquePath(t.abs, name);
      const tmp = path.join(t.abs, `.uploading-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      try {
        await new Promise((resolve, reject) => {
          const ws = fs.createWriteStream(tmp);
          stream.on('error', reject);
          ws.on('error', reject);
          ws.on('finish', resolve);
          stream.pipe(ws);
        });
        if (stream.truncated) throw new Error('truncated');
        const finalDest = await files.uniquePath(t.abs, path.basename(dest));
        await fsp.rename(tmp, finalDest);
        saved.push(path.basename(finalDest));
      } catch {
        stream.resume();
        await fsp.rm(tmp, { force: true }).catch(() => {});
        skipped.push(info.filename);
      }
    })());
  });
  bb.on('close', async () => {
    await Promise.all(jobs);
    res.json({ saved, skipped });
  });
  bb.on('error', () => {
    if (!res.headersSent) res.status(400).json({ error: 'アップロードに失敗しました' });
  });
  req.on('aborted', () => bb.destroy());
  req.pipe(bb);
});

app.post('/api/mkdir', async (req, res) => {
  const t = target(req, res, { requireUpload: true });
  if (!t) return;
  const name = files.cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'フォルダ名が正しくありません' });
  try {
    await fsp.mkdir(path.join(t.abs, name));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.code === 'EEXIST' ? '同じ名前のフォルダがすでにあります' : 'フォルダを作成できませんでした' });
  }
});

app.post('/api/rename', async (req, res) => {
  const t = target(req, res, { requireEdit: true });
  if (!t) return;
  const from = files.cleanName(req.body.from);
  const to = files.cleanName(req.body.to);
  if (!from || !to || !files.mediaType(from)) return res.status(400).json({ error: '名前が正しくありません' });
  if (files.mediaType(to) !== files.mediaType(from)) return res.status(400).json({ error: '拡張子（.jpg など）は変えずに入力してください' });
  const src = path.join(t.abs, from);
  const dest = path.join(t.abs, to);
  if (!await statFile(src)) return res.status(404).json({ error: 'ファイルが見つかりません' });
  if (src.toLowerCase() !== dest.toLowerCase() && await fsp.stat(dest).catch(() => null)) {
    return res.status(400).json({ error: '同じ名前のファイルがすでにあります' });
  }
  try {
    await fsp.rename(src, dest);
    res.json({ ok: true, name: to });
  } catch {
    res.status(500).json({ error: '名前を変更できませんでした' });
  }
});

app.post('/api/delete', async (req, res) => {
  const t = target(req, res, { requireEdit: true });
  if (!t) return;
  const names = Array.isArray(req.body.names) ? req.body.names : [];
  const paths = [];
  for (const n of names) {
    const name = files.cleanName(n);
    const abs = name && path.join(t.abs, name);
    if (abs && files.mediaType(abs) && await statFile(abs)) paths.push(abs);
  }
  if (!paths.length) return res.status(400).json({ error: '削除するファイルがありません' });
  try {
    await moveToTrash(paths, path.resolve(t.album.path));
    res.json({ ok: true, count: paths.length });
  } catch {
    res.status(500).json({ error: '削除できませんでした' });
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: '見つかりません' }));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], index: 'index.html' }));

// ---- 起動 ----

function printBanner(port) {
  const ips = lanAddresses();
  const line = '='.repeat(56);
  console.log(`\n${line}`);
  console.log('  ホームアルバム を起動しました');
  console.log('');
  console.log(`  このPCから        : http://localhost:${port}/`);
  if (ips.length) {
    console.log(`  スマホ・他のPCから : http://${ips[0]}:${port}/`);
    for (const ip of ips.slice(1)) console.log(`                      http://${ip}:${port}/`);
  } else {
    console.log('  ※ ネットワークに接続されていないようです');
  }
  console.log(`  管理画面          : http://localhost:${port}/admin`);
  console.log('');
  console.log('  終了するときは、この画面を閉じてください。');
  console.log(`${line}\n`);
}

function openBrowser(url) {
  if (process.platform !== 'win32') return;
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

function listen(port, attemptsLeft = 10) {
  const server = app.listen(port);
  server.on('listening', () => {
    listeningPort = port;
    printBanner(port);
    if (process.argv.includes('--open')) {
      const hasAlbums = config.get().albums.length > 0;
      openBrowser(`http://localhost:${port}/${hasAlbums ? '' : 'admin'}`);
    }
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`ポート ${port} は使用中のため、${port + 1} で起動します…`);
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error('起動できませんでした:', e.message);
      process.exitCode = 1;
    }
  });
}

listen(Number(process.env.PORT) || config.get().port);
