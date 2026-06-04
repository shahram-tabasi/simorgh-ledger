// اسکرین‌شاتِ صندوقِ خانوادگی برای فروشگاه
import puppeteer from 'puppeteer';
import { resolve } from 'node:path';

const SHOTS = resolve('store/screenshots');
const URL = 'http://localhost:4173/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 920, deviceScaleFactor: 2 });

await page.evaluateOnNewDocument(() => {
  const fund = {
    id: 'f1', name: 'صندوقِ فامیلی', monthlyAmount: 2000000, payoutsPerMonth: 2,
    members: [
      { name: 'علی رضایی', phone: '09131234567', shares: 2 },
      { name: 'مریم احمدی', phone: '09351112233', shares: 1 },
      { name: 'حسن کریمی', shares: 1 },
      { name: 'زهرا موسوی', phone: '09121234567', shares: 1 },
      { name: 'رضا تهرانی', shares: 1 },
    ],
    rounds: [
      { paid: { 'علی رضایی': true, 'مریم احمدی': true, 'حسن کریمی': true, 'زهرا موسوی': true, 'رضا تهرانی': true }, winners: ['علی رضایی', 'زهرا موسوی'] },
      { paid: { 'علی رضایی': true, 'مریم احمدی': true, 'حسن کریمی': false, 'زهرا موسوی': true, 'رضا تهرانی': false }, winners: [] },
    ],
  };
  localStorage.setItem('funds', JSON.stringify([fund]));
  localStorage.setItem('onboardedVersion', '1.0.28');
  localStorage.setItem('lastSeenVersion', '1.0.28');
  localStorage.setItem('tourSeen', '1');
  localStorage.setItem('fundGuideSeen', '1');
  localStorage.setItem('calendarSystem', 'jalali');
});

await page.goto(URL, { waitUntil: 'networkidle0' });
await wait(500);
await page.waitForFunction(() => !document.querySelector('.welcome'), { timeout: 9000 }).catch(() => {});
await wait(400);

// منوی امکانات → صندوق خانوادگی
await page.click('.icon-btn[aria-label="امکانات"]');
await wait(500);
await page.evaluate(() => { const b = [...document.querySelectorAll('.drawer-item')].find((x) => x.textContent.includes('صندوق خانوادگی')); b && b.click(); });
await wait(500);
// واردِ صندوق
await page.evaluate(() => { const c = document.querySelector('.loan-card'); c && c.click(); });
await wait(500);
await page.screenshot({ path: resolve(SHOTS, '05-fund.png') });
console.log('✅ 05-fund.png');

// تبِ گزارشِ کامل
await page.evaluate(() => { const b = [...document.querySelectorAll('.fund-tabs .mini-toggle-btn')].find((x) => x.textContent.includes('گزارش')); b && b.click(); });
await wait(500);
await page.screenshot({ path: resolve(SHOTS, '06-fund-report.png') });
console.log('✅ 06-fund-report.png');

await browser.close();
console.log('🎉 اسکرین‌شات‌های صندوق ساخته شد');
