import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8000);
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8' };
http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff' });
    res.end(body);
  } catch { res.writeHead(404,{'Content-Type':'text/plain'}).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Van Allen Mission Explorer: http://127.0.0.1:${port}`));
