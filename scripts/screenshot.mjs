// اسکرین‌شات از برنامه برای بررسی ظاهر (نیازمند puppeteer و vite preview روی پورت 4173)
import puppeteer from 'puppeteer';

const URL = 'http://localhost:4173/';

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 920, deviceScaleFactor: 2 });

// تزریق چند تراکنش نمونه تا بج‌ها و آمار دیده شوند
await page.evaluateOnNewDocument(() => {
  const now = new Date();
  const k = (d) => `${now.getFullYear()}-${now.getMonth() + 1}-${d}`;
  const data = {
    [k(5)]: { transactions: [{ id: '1', title: 'قبض برق', amount: 1850000, isPaid: false }] },
    [k(12)]: { transactions: [{ id: '2', title: 'قسط وام', amount: 10250000, isPaid: false }] },
    [k(18)]: { transactions: [{ id: '3', title: 'اجاره', amount: 25000000, isPaid: true }] },
    [k(23)]: { transactions: [{ id: '4', title: 'اینترنت', amount: 430000, isPaid: false }] },
  };
  localStorage.setItem('calendarData', JSON.stringify(data));
  localStorage.setItem('calendarSystem', 'jalali');
});

await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForSelector('.calendar');
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: '/tmp/shot-main.png' });
console.log('saved /tmp/shot-main.png');

// باز کردن پنل ابزارها و بخش وام
await page.click('.menu-btn');
await page.waitForSelector('.accordion');
await new Promise((r) => setTimeout(r, 300));
const opened = await page.evaluate(() => {
  const heads = [...document.querySelectorAll('.acc-head')];
  const loan = heads.find((h) => h.textContent.includes('وام'));
  if (loan) { loan.click(); return true; }
  return false;
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: '/tmp/shot-tools.png' });
console.log('saved /tmp/shot-tools.png, loanOpened=', opened);

await browser.close();
