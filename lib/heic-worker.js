// HEIC/HEIF を画素データに変換するワーカー (重い処理なので本体とは別のスレッドで動かす)
const fs = require('fs');
const { parentPort } = require('worker_threads');
const decode = require('heic-decode');

parentPort.on('message', async ({ id, file }) => {
  try {
    const buffer = await fs.promises.readFile(file);
    const { width, height, data } = await decode({ buffer });
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    parentPort.postMessage({ id, width, height, data: bytes }, [bytes.buffer]);
  } catch (e) {
    parentPort.postMessage({ id, error: e.message || String(e) });
  }
});
