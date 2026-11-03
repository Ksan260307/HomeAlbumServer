// ローカルネットワーク判定
const net = require('net');
const os = require('os');

function normalizeIp(ip) {
  if (!ip) return '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function isLoopback(ip) {
  ip = normalizeIp(ip);
  return ip === '::1' || ip.startsWith('127.');
}

function isPrivate(ip) {
  ip = normalizeIp(ip);
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::1' || l.startsWith('fe80:') || l.startsWith('fc') || l.startsWith('fd');
  }
  return false;
}

// DNS リバインディング対策: Host ヘッダーが IP / localhost / このPCの名前 の場合のみ許可
function isAllowedHost(hostHeader) {
  if (!hostHeader) return false;
  let h = hostHeader.toLowerCase();
  if (h.startsWith('[')) h = h.slice(1, h.indexOf(']'));
  else h = h.replace(/:\d+$/, '');
  if (net.isIP(h) || h === 'localhost') return true;
  const name = os.hostname().toLowerCase();
  return h === name || h.startsWith(name + '.');
}

// このPCのLAN内アドレス (家庭用ルーターで一般的な 192.168.* を優先)
function lanAddresses() {
  const list = [];
  for (const [ifname, addrs] of Object.entries(os.networkInterfaces())) {
    if (/vEthernet|VMware|VirtualBox|WSL|Hyper-V|Loopback|Bluetooth/i.test(ifname)) continue;
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && isPrivate(a.address) && !a.address.startsWith('169.254.')) {
        list.push(a.address);
      }
    }
  }
  return list.sort((x, y) => (y.startsWith('192.168.') - x.startsWith('192.168.')));
}

module.exports = { normalizeIp, isLoopback, isPrivate, isAllowedHost, lanAddresses };
