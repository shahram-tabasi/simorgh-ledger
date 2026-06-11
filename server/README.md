# بک‌اندِ simorgh-ledger (ورود + همگام‌سازی)

استک: **Node.js + Express + PostgreSQL**. احراز با شماره‌موبایل/رمز و توکنِ JWT.
داده‌های هر کاربر به‌صورتِ یک «بسته» (blob) ذخیره و بینِ دستگاه‌ها سینک می‌شود.

دامنه‌ی هدف: **ledger.simorghai.com** — همین یک دامنه هم API را می‌دهد هم نسخه‌ی وب را.

---

## ۱) نصبِ پیش‌نیازها روی Ubuntu
```bash
sudo apt update
sudo apt install -y nodejs npm postgresql nginx
sudo npm install -g pm2
```
> اگر نسخه‌ی Node قدیمی بود، از NodeSource نسخه‌ی ۲۰/۲۲ نصب کنید.

## ۲) ساختِ پایگاه‌داده
```bash
sudo -u postgres psql <<'SQL'
CREATE USER simorgh WITH PASSWORD 'STRONG_PASSWORD';
CREATE DATABASE simorgh OWNER simorgh;
SQL
```

## ۳) آماده‌سازیِ سرور
```bash
# پوشه‌ی server را روی سرور بگذارید (مثلاً در /var/www/ledger/server)
cd /var/www/ledger/server
cp .env.example .env
nano .env     # DATABASE_URL و JWT_SECRET را پر کنید
npm install
```

### کپیِ نسخه‌ی وب کنارِ سرور (تک‌دامنه)
آرتیفکتِ `simorgh-web` را از GitHub Actions بگیرید و محتوایش را در `server/public_web` بگذارید:
```bash
mkdir -p public_web
# محتوای dist (آرتیفکتِ simorgh-web) را اینجا کپی کنید
```
حالا سرور هم `/api/...` را می‌دهد، هم خودِ برنامه‌ی وب را.

## ۴) اجرا با pm2
```bash
pm2 start index.js --name ledger
pm2 save
pm2 startup     # دستوری که چاپ می‌کند را اجرا کنید تا بعدِ ریبوت هم بالا بیاید
```
تست: `curl http://localhost:8080/api/health`  →  باید `{"ok":true}` بدهد.

## ۵) Nginx + SSL برای ledger.simorghai.com
رکوردِ DNS از `ledger.simorghai.com` به IP سرور را بزنید، بعد:
```bash
sudo nano /etc/nginx/sites-available/ledger
```
```nginx
server {
    server_name ledger.simorghai.com;
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/ledger /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ledger.simorghai.com     # SSL رایگانِ Let's Encrypt
```
حالا `https://ledger.simorghai.com` هم برنامه‌ی وب را می‌دهد، هم API را (روی `/api`).
> HTTPS برای PWA و سرویس‌ورکر **الزامی** است؛ certbot همین را حل می‌کند.

## ۶) به‌روزرسانی در آینده
```bash
# نسخه‌ی وبِ جدید:
# آرتیفکتِ simorgh-web را در public_web جایگزین کنید
# تغییرِ کدِ سرور:
cd /var/www/ledger/server && git pull && npm install && pm2 restart ledger
```

---

## API (خلاصه)
### احراز و دادهٔ شخصی
- `POST /api/register` `{phone, password}` → `{token, phone}`
- `POST /api/login` `{phone, password}` → `{token, phone}`
- `GET  /api/data` (هدر: `Authorization: Bearer <token>`) → `{blob, version, updatedAt}`
- `PUT  /api/data` (با توکن) `{blob}` → `{version, updatedAt}`

### نسخه‌ی شرکتی (سرنخِ فروش)
- `POST /api/quote` `{company, phone, usersCount, modules[], notes}` → `{ok, id}`

### سازمان / نقش‌ها (پایه‌ی SaaS چندکاربره)
- `POST /api/org` `{name}` (با توکن) → سازنده، **owner** می‌شود.
- `GET  /api/org` (با توکن) → `{org, role, perms, empId}`
- `POST /api/org/member` `{phone, role, perms[], empId?}` (owner/admin) → افزودن/به‌روزرسانیِ عضو (کاربر باید قبلاً ثبت‌نام کرده باشد).
- `GET  /api/org/members` (عضو) → فهرستِ اعضا.
- `GET  /api/org/data` (عضو) → `{blob, version}` — همه‌ی اعضا می‌خوانند.
- `PUT  /api/org/data` (نقش‌های owner/admin/manager) → نوشتن؛ **worker → 403**. اعمالِ نقش **روی سرور**.

### دستگاه‌های حضور و غیاب (چهره/اثرانگشت/کارت)
- `POST /api/att/:channel` `{code, time?, dir?}` → دستگاه (یا اسکریپتِ پلِ کنارش) هر تردد را می‌فرستد؛ `code` = کدِ پرسنلی، `dir` = `in|out` (اختیاری)، `time` = «HH:MM» (اختیاری؛ نبود = زمانِ دریافت).
- `GET  /api/att/:channel?after=N` → برنامه لاگ‌های جدیدتر از N را می‌گیرد: `{logs:[{id,code,time,dir}], last}`.

در حافظه است؛ کانال بعد از ۳۰ دقیقه بی‌استفادگی پاک می‌شود. کانال را تبِ «ساعت‌زنی» می‌سازد و تا وقتی باز است لاگ‌ها را در کاردکس ثبت می‌کند.

### اسکنرِ بی‌سیم (رله‌ی گوشی → رایانه)
- `POST /api/scan/:channel` `{code}` → گوشی هر بارکدِ اسکن‌شده را به کانال می‌فرستد.
- `GET  /api/scan/:channel?after=N` → رایانه اسکن‌های جدیدتر از N را می‌گیرد: `{scans:[{id,code}], last}`.

کاملاً در حافظه است (نیازی به دیتابیس ندارد)؛ کانال‌ها بعد از ۱۰ دقیقه بی‌استفادگی پاک می‌شوند.
جفت‌سازی = دانستنِ کدِ ۶رقمی که رایانه نمایش می‌دهد (روی فاکتور: «📡 اسکنرِ همراه»؛ روی گوشی: انبار ← «📡 اسکنرِ بی‌سیم»).

نقش‌ها: `owner | admin | manager | worker`. در این نسخه دادهٔ مشترک هنوز blob است؛
گامِ بعدی: ذخیره‌ی **رابطه‌ای** تا سرور بتواند per-record بر اساسِ نقش فیلتر کند، و اتصالِ
`quote_requests` به فعال‌سازیِ org پس از پرداخت.

داده‌ها رمزنگاریِ سمتِ سرور ندارند؛ امنیت از طریقِ HTTPS + رمزِ کاربر + توکن است.
برای نسخه‌های بعدی: OTP پیامکی، رمزنگاریِ سمتِ کاربر، و مدلِ دادهٔ رابطه‌ای/حساب‌داریِ دوطرفه.
