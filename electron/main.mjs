// Electron desktop wrapper for simorgh-ledger (Windows installer target).
// Serves the built SPA from a tiny zero-dependency localhost HTTP server (so the service worker and the
// camera/getUserMedia scanner work on a real http origin), grants camera permission, and opens it.
import { app, BrowserWindow, Menu, session } from 'electron';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, '..', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(dist, p);
  if (!fp.startsWith(dist)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { // SPA fallback
      fs.readFile(path.join(dist, 'index.html'), (e2, d2) => { if (e2) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d2); });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
});

const startServer = () => new Promise((resolve) => { server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)); });

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 900, minHeight: 600,
    title: 'سیمرغ', backgroundColor: '#0f1830', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });
  Menu.setApplicationMenu(null);
  win.loadURL(url);
}

app.whenReady().then(async () => {
  // grant camera/clipboard for the local trusted app (barcode scanner needs camera)
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));
  const url = await startServer();
  createWindow(url);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(url); });
});
app.on('window-all-closed', () => app.quit());
