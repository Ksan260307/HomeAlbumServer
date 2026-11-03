// 削除したファイルはごみ箱へ移動する (完全には消さない)
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
$paths = $env:HOMEALBUM_PATHS | ConvertFrom-Json
foreach ($p in $paths) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
}
`;

function runPowerShell(paths) {
  const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      timeout: 120000,
      // 環境変数経由なら日本語のファイル名も文字化けしない
      env: { ...process.env, HOMEALBUM_PATHS: JSON.stringify(paths) },
    }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()));
  });
}

async function moveToTrash(paths, albumRoot) {
  if (process.platform === 'win32') {
    for (let i = 0; i < paths.length; i += 40) {
      await runPowerShell(paths.slice(i, i + 40));
    }
    return;
  }
  // Windows 以外: アルバム内の .homealbum-trash フォルダへ移動
  const trash = path.join(albumRoot, '.homealbum-trash');
  await fsp.mkdir(trash, { recursive: true });
  for (const p of paths) {
    await fsp.rename(p, path.join(trash, `${Date.now()}_${path.basename(p)}`));
  }
}

module.exports = { moveToTrash };
