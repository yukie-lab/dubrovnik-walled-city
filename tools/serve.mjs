// ローカル配信。**キャッシュを一切効かせない。**
//   node tools/serve.mjs [ポート=8765]
//
// python3 -m http.server は Cache-Control を送らないので、ブラウザが
// src/*.js を握ったままになる。index.html に ?v= を付けてもモジュールは
// 別 URL なので切れない。実際、直した buildings.js が届かず「まだ黒い板が
// 残っている」を数往復した(公開版では消えていた)。配る側で断つ。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.argv[2] || 8765);
const TYPE = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    // 上へ抜けさせない
    const path = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!path.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const st = await stat(path);
    if (st.isDirectory()) { res.writeHead(404).end('not found'); return; }
    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': TYPE[extname(path)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}/index.html  (キャッシュ無効で配信)`));
