// Minimal static file server for the installer smoke test: node tests/install/serve.mjs <dir> <port>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const [dir, port] = [path.resolve(process.argv[2] ?? '.'), Number(process.argv[3] ?? 8765)];
http
  .createServer((req, res) => {
    const file = path.join(dir, decodeURIComponent((req.url ?? '/').split('?')[0]));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () => console.log(`serving ${dir} on http://127.0.0.1:${port}`));
