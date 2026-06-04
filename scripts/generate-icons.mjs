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
const ORIGINAL = resolve(root, 'public/1.jpg');
const NAVY = { r: 22, g: 31, b: 45 }; // سرمه‌ایِ همتراز با زمینه‌ی لوگو

// ۱) منبعِ تمیز: سیمرغِ کامل وسطِ مربع، با گسترشِ لبه‌های سرمه‌ای (بدون خط/درز)
const CANVAS = 1024;
const resized = await sharp(ORIGINAL, { limitInputPixels: false })
  .resize({ height: Math.round(CANVAS * 0.84), fit: 'inside' })
  .toBuffer();
const rm = await sharp(resized).metadata();
const top = Math.floor((CANVAS - rm.height) / 2);
const bottom = CANVAS - rm.height - top;
const left = Math.floor((CANVAS - rm.width) / 2);
const right = CANVAS - rm.width - left;
const SRC = await sharp(resized)
  .extend({ top, bottom, left, right, extendWith: 'copy' })
  .png()
  .toBuffer();
void NAVY;

// منبعِ آیکونِ تطبیقی (foreground): سیمرغ کوچک‌تر و با حاشیه‌ی بیشتر تا ماسکِ لانچر
// پایین/لبه‌ها را نبُرد (داخلِ ناحیه‌ی امن بماند)
const fgInner = await sharp(SRC).resize({ width: Math.round(CANVAS * 0.62), height: Math.round(CANVAS * 0.62), fit: 'inside' }).toBuffer();
const fim = await sharp(fgInner).metadata();
const ft = Math.floor((CANVAS - fim.height) / 2);
const fb = CANVAS - fim.height - ft;
const fl = Math.floor((CANVAS - fim.width) / 2);
const fr = CANVAS - fim.width - fl;
const SRC_FG = await sharp(fgInner).extend({ top: ft, bottom: fb, left: fl, right: fr, extendWith: 'copy' }).png().toBuffer();

function load() {
  return sharp(SRC, { limitInputPixels: false });
}

async function squareFrom(buf, size, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(buf, { limitInputPixels: false }).resize(size, size, { fit: 'cover' }).png().toFile(outPath);
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
  await squareFrom(SRC_FG, d.foreground, `${base}/ic_launcher_foreground.png`);
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
