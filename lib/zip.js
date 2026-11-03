// 無圧縮 ZIP をストリームで書き出す (写真・動画は圧縮しても小さくならないため)
// 4GB を超えるファイルや大量のファイルに対応するため、必要に応じて ZIP64 を使う
const fs = require('fs');
const zlib = require('zlib');
const { once } = require('events');

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;

async function crcOf(file) {
  let crc = 0;
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) {
    crc = zlib.crc32(chunk, crc);
  }
  return crc >>> 0;
}

function dosDateTime(ms) {
  const d = new Date(ms);
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// entries: [{ abs, name, size, mtime }]
async function writeZip(out, entries) {
  let offset = 0;
  const central = [];

  async function write(buf) {
    if (out.destroyed) throw new Error('client closed');
    offset += buf.length;
    if (!out.write(buf)) {
      await Promise.race([once(out, 'drain'), once(out, 'close')]);
    }
  }

  for (const entry of entries) {
    const crc = await crcOf(entry.abs);
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const { time, date } = dosDateTime(entry.mtime);
    const big = entry.size >= MAX32;
    const localOffset = offset;

    const extra = big ? Buffer.alloc(20) : Buffer.alloc(0);
    if (big) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(16, 2);
      extra.writeBigUInt64LE(BigInt(entry.size), 4);
      extra.writeBigUInt64LE(BigInt(entry.size), 12);
    }
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(big ? 45 : 20, 4);
    header.writeUInt16LE(0x0800, 6); // ファイル名は UTF-8
    header.writeUInt16LE(0, 8);      // 無圧縮
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(big ? MAX32 : entry.size, 18);
    header.writeUInt32LE(big ? MAX32 : entry.size, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(extra.length, 28);
    await write(Buffer.concat([header, nameBuf, extra]));

    for await (const chunk of fs.createReadStream(entry.abs, { highWaterMark: 1 << 20 })) {
      await write(chunk);
    }
    central.push({ nameBuf, crc, size: entry.size, offset: localOffset, time, date });
  }

  const cdStart = offset;
  for (const c of central) {
    const fields = [];
    if (c.size >= MAX32) fields.push(c.size, c.size);
    if (c.offset >= MAX32) fields.push(c.offset);
    const extra = Buffer.alloc(fields.length ? 4 + fields.length * 8 : 0);
    if (fields.length) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(fields.length * 8, 2);
      fields.forEach((v, i) => extra.writeBigUInt64LE(BigInt(v), 4 + i * 8));
    }
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(45, 4);
    h.writeUInt16LE(fields.length ? 45 : 20, 6);
    h.writeUInt16LE(0x0800, 8);
    h.writeUInt16LE(0, 10);
    h.writeUInt16LE(c.time, 12);
    h.writeUInt16LE(c.date, 14);
    h.writeUInt32LE(c.crc, 16);
    h.writeUInt32LE(Math.min(c.size, MAX32), 20);
    h.writeUInt32LE(Math.min(c.size, MAX32), 24);
    h.writeUInt16LE(c.nameBuf.length, 28);
    h.writeUInt16LE(extra.length, 30);
    h.writeUInt32LE(Math.min(c.offset, MAX32), 42);
    await write(Buffer.concat([h, c.nameBuf, extra]));
  }
  const cdSize = offset - cdStart;

  const needZip64 = central.length >= MAX16 || cdStart >= MAX32 || cdSize >= MAX32;
  if (needZip64) {
    const z64Offset = offset;
    const rec = Buffer.alloc(56);
    rec.writeUInt32LE(0x06064b50, 0);
    rec.writeBigUInt64LE(44n, 4);
    rec.writeUInt16LE(45, 12);
    rec.writeUInt16LE(45, 14);
    rec.writeBigUInt64LE(BigInt(central.length), 24);
    rec.writeBigUInt64LE(BigInt(central.length), 32);
    rec.writeBigUInt64LE(BigInt(cdSize), 40);
    rec.writeBigUInt64LE(BigInt(cdStart), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeBigUInt64LE(BigInt(z64Offset), 8);
    loc.writeUInt32LE(1, 16);
    await write(Buffer.concat([rec, loc]));
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(central.length, MAX16), 8);
  end.writeUInt16LE(Math.min(central.length, MAX16), 10);
  end.writeUInt32LE(Math.min(cdSize, MAX32), 12);
  end.writeUInt32LE(Math.min(cdStart, MAX32), 16);
  await write(end);
  out.end();
}

module.exports = { writeZip };
