// HEIC/HEIF (iPhone などの写真形式) の読み込み
// 画像処理ライブラリ (sharp) が HEIC に対応していないため、ワーカースレッドで画素データに変換する
const path = require('path');
const { Worker } = require('worker_threads');

const POOL_SIZE = 2;
const workers = [];
const queue = [];
const pending = new Map(); // id -> { resolve, reject, worker }
let nextId = 1;

function isHeif(file) {
  return /\.(heic|heif)$/i.test(file);
}

function spawn() {
  const worker = new Worker(path.join(__dirname, 'heic-worker.js'));
  worker.busy = false;
  worker.on('message', (msg) => {
    const job = pending.get(msg.id);
    pending.delete(msg.id);
    worker.busy = false;
    if (job) {
      if (msg.error) job.reject(new Error(msg.error));
      else job.resolve({ width: msg.width, height: msg.height, data: Buffer.from(msg.data.buffer, msg.data.byteOffset, msg.data.byteLength) });
    }
    pump();
  });
  // ワーカーが落ちたら、処理中の依頼を失敗にして作り直す
  worker.on('error', () => {});
  worker.on('exit', () => {
    workers.splice(workers.indexOf(worker), 1);
    for (const [id, job] of pending) {
      if (job.worker === worker) {
        pending.delete(id);
        job.reject(new Error('HEIC の変換に失敗しました'));
      }
    }
    pump();
  });
  workers.push(worker);
  return worker;
}

function pump() {
  while (queue.length) {
    let worker = workers.find((w) => !w.busy);
    if (!worker && workers.length < POOL_SIZE) worker = spawn();
    if (!worker) return;
    const job = queue.shift();
    worker.busy = true;
    job.worker = worker;
    pending.set(job.id, job);
    worker.postMessage({ id: job.id, file: job.file });
  }
}

// { width, height, data (RGBA の Buffer) } を返す
function decodeHeic(file) {
  return new Promise((resolve, reject) => {
    queue.push({ id: nextId++, file, resolve, reject });
    pump();
  });
}

module.exports = { isHeif, decodeHeic };
