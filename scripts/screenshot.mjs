// اسکرین‌شات از برنامه برای بررسی ظاهر (نیازمند puppeteer و vite preview روی پورت 4173)
import puppeteer from 'puppeteer';

const URL = 'http://localhost:4173/';

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 920, deviceScaleFactor: 2 });

await page.evaluateOnNewDocument(() => {
  const now = new Date();
  const k = (d) => `${now.getFullYear()}-${now.getMonth() + 1}-${d}`;
  const data = {
    [k(5)]: { transactions: [{ id: '1', title: 'قبض برق', amount: 1850000, isPaid: false }] },
    [k(12)]: { transactions: [{ id: '2', title: 'قسط وام', amount: 10250000, isPaid: false }] },
    [k(18)]: { transactions: [{ id: '3', title: 'اجاره', amount: 25000000, isPaid: true }] },
  };
  localStorage.setItem('calendarData', JSON.stringify(data));
  localStorage.setItem('calendarSystem', 'jalali');
});

await page.goto(URL, { waitUntil: 'networkidle0' });

// 1) صفحه‌ی خوش‌آمد
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: '/tmp/shot-welcome.png' });
console.log('saved welcome');

// صبر تا welcome کاملاً برود
await page.waitForFunction(() => !document.querySelector('.welcome'), { timeout: 8000 });
await new Promise((r) => setTimeout(r, 300));

// 2) منوی راست (امکانات)
await page.click('.icon-btn[aria-label="امکانات"]');
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: '/tmp/shot-right.png' });
console.log('saved right drawer');
await page.click('.drawer-overlay', { offset: { x: 5, y: 400 } }).catch(() => {});
await new Promise((r) => setTimeout(r, 300));

// 3) منوی چپ + درباره
await page.click('.icon-btn[aria-label="درباره ما"]');
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.drawer-item')].find((x) => x.textContent.includes('طراحان'));
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: '/tmp/shot-about.png' });
console.log('saved about');

await browser.close();
