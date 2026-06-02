// تولید همه‌ی آیکون‌ها از روی لوگوی اصلیِ کاربر (public/pwa-512-NEW.png)
// نیازمندِ sharp (فقط برای تولید آیکون، جزو وابستگی‌های برنامه نیست):
//   npm install --no-save sharp
// اجرا: node scripts/generate-icons.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, 'public/pwa-512-NEW.png');

function load() {
  return sharp(SRC, { limitInputPixels: false });
}

async function square(size, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  await load().resize(size, size, { fit: 'cover' }).png().toFile(outPath);
}

// چگالی‌های اندروید: legacy launcher و foreground آیکون تطبیقی
const densities = [
  { dir: 'mdpi', launcher: 48, foreground: 108 },
  { dir: 'hdpi', launcher: 72, foreground: 162 },
  { dir: 'xhdpi', launcher: 96, foreground: 216 },
  { dir: 'xxhdpi', launcher: 144, foreground: 324 },
  { dir: 'xxxhdpi', launcher: 192, foreground: 432 },
];

const androidRes = resolve(root, 'android/app/src/main/res');

for (const d of densities) {
  const base = `${androidRes}/mipmap-${d.dir}`;
  await square(d.launcher, `${base}/ic_launcher.png`);
  await square(d.launcher, `${base}/ic_launcher_round.png`);
  await square(d.foreground, `${base}/ic_launcher_foreground.png`);
}

// آیکون‌های وب / PWA
const pub = resolve(root, 'public');
await square(192, `${pub}/pwa-192.png`);
await square(512, `${pub}/pwa-512.png`);
await square(180, `${pub}/apple-touch-icon.png`);
await square(64, `${pub}/favicon.png`);

// لوگوی هدر برنامه (کوچک برای کاهش حجم باندل)
await square(128, resolve(root, 'src/assets/logo.png'));

console.log('✅ همه‌ی آیکون‌ها از روی pwa-512-NEW.png ساخته شدند');
