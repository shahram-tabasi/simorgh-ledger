// Electron desktop wrapper for the shop POS (Windows installer target).
// It starts the bundled Express server (serves the built app + the wireless-scanner relay) and opens
// it in a window — so the cashier uses the POS and a phone on the same Wi-Fi can act as the scanner.
import { app, BrowserWindow, Menu } from 'electron';

process.env.PORT = process.env.PORT || '8090';
// Start the same server used by `npm run serve` (static dist + /api/scan relay), bound to 0.0.0.0.
await import('../server/index.mjs');

const PORT = process.env.PORT;

function createWindow() {
  const win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 900, minHeight: 600,
    title: 'صندوقِ سیمرغ‌شاپ', backgroundColor: '#0f1830',
    webPreferences: { contextIsolation: true },
  });
  Menu.setApplicationMenu(null);
  // small retry in case the server is still binding
  const tryLoad = (n = 0) => win.loadURL(`http://localhost:${PORT}`).catch(() => { if (n < 20) setTimeout(() => tryLoad(n + 1), 200); });
  tryLoad();
}

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => app.quit());
