// تولید همه‌ی آیکون‌ها از روی لوگوی اصلیِ کاربر (public/pwa-512-NEW.png)
// متنِ SIMORGH/LEDGER از تصویر حذف و فقط سیمرغ وسطِ یک مربعِ سرمه‌ای قرار می‌گیرد
// تا آیکون کامل و تمیز دیده شود.
// نیازمندِ sharp:  npm install --no-save sharp
// اجرا: node scripts/generate-icons.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGINAL = resolve(root, 'public/pwa-512-NEW.png');
const NAVY = { r: 22, g: 29, b: 45 }; // #161D2D

// ۱) منبعِ تمیز: یک برشِ مربعی که فقط سیمرغِ کامل را دارد (متنِ SIMORGH/LEDGER حذف می‌شود)
// این برش مستقیم از کارتِ سرمه‌ایِ اصلی است؛ بدون ترکیب و بدون خطِ لبه.
const CANVAS = 1024;
const SRC = await sharp(ORIGINAL, { limitInputPixels: false })
  .extract({ left: 218, top: 118, width: 760, height: 760 })
  .resize(CANVAS, CANVAS)
  .png()
  .toBuffer();
void NAVY;

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

// لوگوی هدر/خوش‌آمد (کوچک برای کاهش حجم باندل)
await square(160, resolve(root, 'src/assets/logo.png'));

console.log('✅ آیکون‌ها (فقط سیمرغ، بدون متن) از روی لوگوی اصلی ساخته شدند');
