// تولیدِ تصاویرِ فروشگاه (کاور + اسکرین‌شات‌ها) برای کافه‌بازار/مایکت
// نیازمند puppeteer و vite preview روی پورت 4173
import puppeteer from 'puppeteer';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve('.');
const OUT = resolve(ROOT, 'store');
const SHOTS = resolve(OUT, 'screenshots');
mkdirSync(SHOTS, { recursive: true });

const b64 = (p) => readFileSync(p).toString('base64');
const logo = b64(resolve(ROOT, 'public/pwa-512.png'));
const fontHeavy = b64(resolve(ROOT, 'node_modules/@fontsource/vazirmatn/files/vazirmatn-arabic-800-normal.woff2'));
const fontReg = b64(resolve(ROOT, 'node_modules/@fontsource/vazirmatn/files/vazirmatn-arabic-400-normal.woff2'));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });

// ---------- ۱) کاورِ فروشگاه (Feature graphic) 1024×500 ----------
const fg = await browser.newPage();
await fg.setViewport({ width: 1024, height: 500, deviceScaleFactor: 2 });
const fgHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Vaz';src:url(data:font/woff2;base64,${fontHeavy}) format('woff2');font-weight:800}
@font-face{font-family:'Vaz';src:url(data:font/woff2;base64,${fontReg}) format('woff2');font-weight:400}
*{margin:0;box-sizing:border-box}
.fg{width:1024px;height:500px;background:radial-gradient(circle at 78% 30%,#243355,#161f2d 70%);
 display:flex;align-items:center;justify-content:space-between;padding:0 80px;direction:rtl;font-family:'Vaz'}
.txt{color:#fff}
.title{font-size:84px;font-weight:800;color:#f0c75e;line-height:1.1}
.sub{font-size:34px;font-weight:400;color:#e6ecf7;margin-top:18px}
.feat{font-size:24px;font-weight:400;color:#9fb3d6;margin-top:26px;letter-spacing:.5px}
.logo{width:320px;height:320px;border-radius:72px;box-shadow:0 24px 60px rgba(0,0,0,.45)}
</style></head><body>
<div class="fg">
  <div class="txt">
    <div class="title">سیمرغ</div>
    <div class="sub">دفترکل و تقویمِ هوشمند</div>
    <div class="feat">شمسی · میلادی · قمری — وام · صندوق · اوقات شرعی</div>
  </div>
  <img class="logo" src="data:image/png;base64,${logo}"/>
</div></body></html>`;
await fg.setContent(fgHtml, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 400));
await fg.screenshot({ path: resolve(OUT, 'feature-graphic.png') });
console.log('✅ feature-graphic.png');

// آیکونِ ۵۱۲ را هم در پوشه‌ی فروشگاه کپی می‌کنیم
writeFileSync(resolve(OUT, 'icon-512.png'), readFileSync(resolve(ROOT, 'public/pwa-512.png')));
console.log('✅ icon-512.png');

// ---------- ۲) اسکرین‌شات‌های برنامه ----------
const URL = 'http://localhost:4173/';
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 920, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => {
  const now = new Date();
  const k = (d) => `${now.getFullYear()}-${now.getMonth() + 1}-${d}`;
  localStorage.setItem('calendarData', JSON.stringify({
    [k(5)]: { transactions: [{ id: '1', title: 'قبض برق', amount: 1850000, isPaid: false }] },
    [k(12)]: { transactions: [{ id: '2', title: 'قسط وامِ خرید خانه', amount: 10250000, isPaid: false }] },
    [k(18)]: { transactions: [{ id: '3', title: 'اجاره', amount: 25000000, isPaid: true }] },
  }));
  localStorage.setItem('onboardedVersion', '1.0.28');
  localStorage.setItem('lastSeenVersion', '1.0.28');
  localStorage.setItem('tourSeen', '1');
  localStorage.setItem('fundGuideSeen', '1');
  localStorage.setItem('calendarSystem', 'jalali');
  localStorage.setItem('prayerProvince', 'یزد');
  localStorage.setItem('prayerCity', 'یزد');
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { await page.screenshot({ path: resolve(SHOTS, name) }); console.log('✅', name); };

await page.goto(URL, { waitUntil: 'networkidle0' });
await wait(500);
await page.waitForFunction(() => !document.querySelector('.welcome'), { timeout: 9000 }).catch(() => {});
await wait(400);
await shot('01-calendar.png');

// روزِ دارای تراکنش → مودالِ روز
await page.evaluate(() => { const d = [...document.querySelectorAll('.day:not(.empty)')].find((x) => x.querySelector('.day-dot,.has-debt') ) || [...document.querySelectorAll('.day:not(.empty)')][11]; d && d.click(); });
await wait(500);
await shot('02-day.png');

// اوقات شرعی
await page.evaluate(() => { const b = document.querySelector('.prayer-btn-modal'); b && b.click(); });
await wait(700);
await shot('03-prayer.png');
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const x = document.querySelector('.prayer-box .close-modal'); x && x.click(); const d = document.querySelector('.modal .close-modal'); d && d.click(); });
await wait(400);

// پوسته‌ی تیره
await page.evaluate(() => document.body.classList.add('dark'));
await wait(300);
await shot('04-calendar-dark.png');

await browser.close();
console.log('\n🎉 همه‌ی تصاویرِ فروشگاه در پوشه‌ی store/ ساخته شدند');
