// تولید همه‌ی آیکون‌ها از روی لوگوی برند (src/assets/logo.svg)
// نیازمندِ sharp (فقط برای تولید آیکون، جزو وابستگی‌های برنامه نیست):
//   npm install --no-save sharp
// اجرا: node scripts/generate-icons.mjs
// خروجی‌ها از قبل ساخته و کامیت شده‌اند؛ این اسکریپت فقط برای بازتولید است.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, 'src/assets/logo.svg');

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

function load() {
  return sharp(SRC, { density: 220, limitInputPixels: false });
}

async function squareOnWhite(size, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  const buf = await load().resize(size, size, { fit: 'contain', background: WHITE }).png().toBuffer();
  await sharp(buf).flatten({ background: WHITE }).png().toFile(outPath);
}

async function transparent(size, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  await load()
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);
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
  await squareOnWhite(d.launcher, `${base}/ic_launcher.png`);
  await squareOnWhite(d.launcher, `${base}/ic_launcher_round.png`);
  await transparent(d.foreground, `${base}/ic_launcher_foreground.png`);
}

// آیکون‌های وب / PWA
const pub = resolve(root, 'public');
await squareOnWhite(192, `${pub}/pwa-192.png`);
await squareOnWhite(512, `${pub}/pwa-512.png`);
await squareOnWhite(180, `${pub}/apple-touch-icon.png`);

console.log('✅ همه‌ی آیکون‌ها از روی logo.svg ساخته شدند');
