// 管理画面用 API (/api/admin/*)
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const config = require('./config');
const { isLoopback, lanAddresses, normalizeIp } = require('./network');

const SESSION_COOKIE = 'homealbum_admin';
const SESSION_TTL = 12 * 60 * 60 * 1000;
const sessions = new Map(); // token -> expiresAt
const failures = new Map(); // ip -> { count, until }

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isLoggedIn(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const exp = token && sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}

function startSession(res) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`);
}

function requireLogin(req, res, next) {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'ログインしてください' });
  next();
}

function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 4 && pw.length <= 200;
}

// 登録済みのフォルダかどうかを調べるためのキー (Windows は大文字・小文字を区別しない)
const pathKey = (p) => path.resolve(p).toLowerCase();
const registeredKeys = () => new Set(config.get().albums.map((a) => pathKey(a.path)));

function homeShortcuts() {
  const home = os.homedir();
  const candidates = [
    ['ピクチャ', path.join(home, 'Pictures')],
    ['ピクチャ (OneDrive)', path.join(home, 'OneDrive', 'Pictures')],
    ['ビデオ', path.join(home, 'Videos')],
    ['デスクトップ', path.join(home, 'Desktop')],
    ['ダウンロード', path.join(home, 'Downloads')],
    ['ドキュメント', path.join(home, 'Documents')],
  ];
  return candidates.filter(([, p]) => fs.existsSync(p)).map(([label, p]) => ({ label, path: p }));
}

function drives() {
  if (process.platform !== 'win32') return [{ label: '/', path: '/' }];
  const out = [];
  for (let c = 65; c <= 90; c++) {
    const d = `${String.fromCharCode(c)}:\\`;
    try { fs.accessSync(d); out.push({ label: `${String.fromCharCode(c)}: ドライブ`, path: d }); } catch { /* なし */ }
  }
  return out;
}

function albumView(a) {
  return { ...a, exists: fs.existsSync(a.path) };
}

function createAdminRouter(getPort) {
  const r = express.Router();

  r.get('/status', (req, res) => {
    res.json({
      hasPassword: !!config.get().admin,
      loggedIn: isLoggedIn(req),
      isLocal: isLoopback(req.socket.remoteAddress),
    });
  });

  r.post('/setup', (req, res) => {
    if (config.get().admin) return res.status(400).json({ error: 'パスワードはすでに設定されています' });
    if (!isLoopback(req.socket.remoteAddress)) {
      return res.status(403).json({ error: '最初のパスワード設定は、サーバーにしているPCから行ってください' });
    }
    if (!validPassword(req.body.password)) return res.status(400).json({ error: 'パスワードは4文字以上にしてください' });
    config.setPassword(req.body.password);
    startSession(res);
    res.json({ ok: true });
  });

  r.post('/login', (req, res) => {
    const ip = normalizeIp(req.socket.remoteAddress);
    const f = failures.get(ip);
    if (f && f.until > Date.now()) {
      return res.status(429).json({ error: 'しばらく待ってからもう一度お試しください' });
    }
    if (!config.verifyPassword(String(req.body.password || ''))) {
      const count = (f?.count || 0) + 1;
      failures.set(ip, { count: count >= 5 ? 0 : count, until: count >= 5 ? Date.now() + 60000 : 0 });
      return res.status(401).json({ error: 'パスワードが違います' });
    }
    failures.delete(ip);
    startSession(res);
    res.json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    sessions.delete(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  r.use(requireLogin);

  r.get('/config', (req, res) => {
    const port = getPort();
    res.json({
      albums: config.get().albums.map(albumView),
      urls: lanAddresses().map((ip) => `http://${ip}:${port}/`),
      computerName: os.hostname(),
    });
  });

  r.get('/qr', async (req, res) => {
    const url = String(req.query.url || '');
    if (!/^http:\/\/[\w.\-:[\]]+\/$/.test(url)) return res.status(400).end();
    res.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', margin: 1, width: 200 }));
  });

  r.get('/browse', async (req, res) => {
    const target = String(req.query.path || '');
    const reg = registeredKeys();
    if (!target) {
      const shortcuts = homeShortcuts().map((sc) => ({ ...sc, registered: reg.has(pathKey(sc.path)) }));
      return res.json({ path: '', parent: null, dirs: [], shortcuts, drives: drives() });
    }
    // エクスプローラーの「パスのコピー」で付く前後の " は外す
    const abs = path.resolve(target.trim().replace(/^"(.*)"$/, '$1'));
    try {
      const entries = await fsp.readdir(abs, { withFileTypes: true });
      const collator = new Intl.Collator('ja', { numeric: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('$') && e.name !== 'System Volume Information')
        .map((e) => e.name)
        .sort(collator.compare)
        .map((name) => ({ name, path: path.join(abs, name), registered: reg.has(pathKey(path.join(abs, name))) }));
      const parent = path.dirname(abs);
      res.json({ path: abs, parent: parent === abs ? '' : parent, registered: reg.has(pathKey(abs)), dirs });
    } catch {
      res.status(400).json({ error: 'このフォルダは開けません' });
    }
  });

  // フォルダをまとめて追加する。すでに登録されているもの・見つからないものは除いて、残りを追加する
  // body: { items: [{ path, name }], allowUpload, allowEdit } (古い形の { path, name } も受け付ける)
  r.post('/albums', async (req, res) => {
    const items = Array.isArray(req.body.items) ? req.body.items : [{ path: req.body.path, name: req.body.name }];
    if (!items.length || items.length > 500) return res.status(400).json({ error: 'フォルダを選んでください' });
    const cfg = config.get();
    const reg = registeredKeys();
    const added = [];
    const skipped = [];
    for (const it of items) {
      const raw = String((it && it.path) || '').trim().replace(/^"(.*)"$/, '$1');
      if (!raw) continue;
      const abs = path.resolve(raw);
      if (reg.has(pathKey(abs))) { skipped.push({ path: abs, reason: 'registered' }); continue; }
      const st = await fsp.stat(abs).catch(() => null);
      if (!st || !st.isDirectory()) { skipped.push({ path: abs, reason: 'missing' }); continue; }
      const name = String((it && it.name) || '').trim() || path.basename(abs) || abs;
      cfg.albums.push({ id: config.newId(), name: name.slice(0, 100), path: abs, allowUpload: !!req.body.allowUpload, allowEdit: !!req.body.allowEdit });
      reg.add(pathKey(abs));
      added.push(abs);
    }
    if (!added.length) {
      const allRegistered = skipped.length && skipped.every((x) => x.reason === 'registered');
      return res.status(400).json({ error: allRegistered ? 'すでに登録されているフォルダです' : 'フォルダが見つかりません', skipped });
    }
    config.save();
    res.json({ albums: cfg.albums.map(albumView), added, skipped });
  });

  r.put('/albums/:id', (req, res) => {
    const cfg = config.get();
    const album = config.findAlbum(req.params.id);
    if (!album) return res.status(404).json({ error: 'フォルダが見つかりません' });
    if (typeof req.body.name === 'string' && req.body.name.trim()) album.name = req.body.name.trim().slice(0, 100);
    if (typeof req.body.allowUpload === 'boolean') album.allowUpload = req.body.allowUpload;
    if (typeof req.body.allowEdit === 'boolean') album.allowEdit = req.body.allowEdit;
    if (req.body.move === 'up' || req.body.move === 'down') {
      const i = cfg.albums.indexOf(album);
      const j = req.body.move === 'up' ? i - 1 : i + 1;
      if (j >= 0 && j < cfg.albums.length) [cfg.albums[i], cfg.albums[j]] = [cfg.albums[j], cfg.albums[i]];
    }
    config.save();
    res.json({ albums: cfg.albums.map(albumView) });
  });

  r.delete('/albums/:id', (req, res) => {
    const cfg = config.get();
    cfg.albums = cfg.albums.filter((a) => a.id !== req.params.id);
    config.save();
    res.json({ albums: cfg.albums.map(albumView) });
  });

  r.post('/password', (req, res) => {
    if (!config.verifyPassword(String(req.body.current || ''))) return res.status(400).json({ error: '現在のパスワードが違います' });
    if (!validPassword(req.body.password)) return res.status(400).json({ error: '新しいパスワードは4文字以上にしてください' });
    config.setPassword(req.body.password);
    sessions.clear();
    startSession(res);
    res.json({ ok: true });
  });

  return r;
}

module.exports = { createAdminRouter };
