// 設定ファイル (data/config.json) の読み書き
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULTS = {
  port: 8080,
  albums: [],   // { id, name, path, allowEdit }
  admin: null,  // { salt, hash }
};

let current = null;

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    current = { ...DEFAULTS, ...raw };
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('設定ファイルを読み込めませんでした。初期設定で起動します:', e.message);
    current = structuredClone(DEFAULTS);
  }
  if (!Array.isArray(current.albums)) current.albums = [];
  return current;
}

function get() {
  return current || load();
}

function save() {
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_FILE);
}

function findAlbum(id) {
  return get().albums.find((a) => a.id === id) || null;
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password) {
  const admin = get().admin;
  if (!admin) return false;
  const { hash } = hashPassword(password, admin.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(admin.hash, 'hex'));
}

function setPassword(password) {
  get().admin = hashPassword(password);
  save();
}

module.exports = { DATA_DIR, load, get, save, findAlbum, newId, verifyPassword, setPassword };
