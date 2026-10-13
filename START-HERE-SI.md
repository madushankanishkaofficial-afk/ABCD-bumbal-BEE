# EXORA — මුලින්ම මෙතැනින් පටන් ගන්න

මෙම project එක VS Code තුළ run කරලා Exora Store සහ Admin Panel එක බලන්න මේ පියවර අනුගමනය කරන්න.

## 1. ZIP එක Extract කරන්න

`EXORA-ADVANCED-SOURCE.zip` එක Download කර Windows හි **Extract All** තෝරන්න. උදාහරණයක්: `C:\Projects\exora-store`.

## 2. VS Code එකෙන් Open කරන්න

VS Code → **File → Open Folder…** → Extract කළ `exora-store` folder එක තෝරන්න. `package.json` file එක project root එකේ තිබිය යුතුයි. `index.html` එක double-click කිරීමෙන් පමණක් backend එක run වෙන්නේ නැහැ.

## 3. Node.js දාගන්න

https://nodejs.org/en/download/ වෙතින් **Node.js 24 LTS** ස්ථාපනය කරන්න. VS Code සම්පූර්ණයෙන් වසා නැවත Open කර **Terminal → New Terminal** තෝරන්න. මෙවා ධාවනය කරන්න:

```powershell
node -v
npm -v
```

Version numbers පෙන්වනවාද බලන්න.

## 4. සැකසුම් ගොනුව සාදන්න

```powershell
Copy-Item .env.example .env
```

`.env` file එක විවෘත කර `JWT_SECRET` අගය අලුත් රහස් අගයකින් වෙනස් කරන්න. එකක් සාදාගන්න:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

ලැබෙන දිගු අගය `JWT_SECRET=` පසුපස paste කරන්න. `.env` හෝ Firebase service-account JSON file එක GitHub එකට upload කරන්න එපා.

## 5. Website එක Run කරන්න

Terminal එක project folder එකේ තිබියදී commands දෙක වෙන වෙනම run කරන්න:

```powershell
npm install
```

install එක සාර්ථකව අවසන් වූ පසු:

```powershell
npm run dev
```

Terminal එකේ server එක ක්‍රියාත්මකව තබන්න. ඉන්පසු Chrome එකෙන්:

- **EXORA Store:** http://localhost:3000
- **Admin Panel:** http://localhost:3000/admin
- **Server පරීක්ෂාව:** http://localhost:3000/api/health

Server එක නවත්වන්න `Ctrl + C` ඔබන්න.

## 6. Admin Panel එකට Login වීම

පළමු වතාවේ `.env` example details භාවිත කර database එක සෑදුණා නම් local test credentials:

- Email: `admin@example.com`
- Password: `ChangeMe_12345!_before_deploy`

මේවා **local testing සඳහා පමණයි**. Website එක public VPS එකක දමන්න කලින් වෙනස් කරන්න. Database එක දැනටමත් නිර්මාණය වී ඇත්නම් `.env` හි password එක වෙනස් කිරීමෙන් පැරණි admin password එක වෙනස් වෙන්නේ නැහැ.

## 7. Admin Panel එකේ තියෙන්නේ

- **Overview:** total orders, recognised sales, pending payments, low-stock alerts.
- **Orders:** customer order details, delivery date range, order/payment status සහ bank receipt download.
- **Products:** අලුත් items සාදන්න, edit/hide කරන්න, product photos හයක් දක්වා upload කරන්න, price, stock, variants, flash deals, seller සහ delivery estimate දාන්න.
- **Customers:** customer accounts සහ order totals. Passwords පෙන්වන්නේ නැහැ. Login වූ විට cart එකත් account database එකට sync වෙනවා.
- **Business revenue:** EXORA හරහා ලැබුණු seller sales, estimate commission සහ Exora Direct revenue.
- **Sellers:** seller/business accounts සහ status කළමනාකරණය.
- **Coupons / Banners:** discount codes සහ home page promotion banners කළමනාකරණය.

Multi-vendor revenue dashboard එකේ sample demo sellers පෙන්වන්නේ test කිරීමටයි. වෙනත් businesses වල පිටස්තර websites වල sales මුදල් ලබාගන්න ඔවුන්ගේ අවසරය/API හෝ accounting integration අවශ්‍යයි.

## 8. Firebase Google / Email / Apple Login

Firebase Authentication optional ලෙස connect කළ හැකියි. Google, Email/Password සහ Apple provider නිසි ලෙස ක්‍රියාත්මක වීමට:

1. Firebase Console තුළ project එකක් සහ Web App එකක් හදන්න.
2. **Authentication → Sign-in method** තුළ Email/Password සහ Google enable කරන්න. Apple enable කිරීමට Apple provider credentials අවශ්‍යයි.
3. `.env` තුළ Firebase web settings දාන්න: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, `FIREBASE_MESSAGING_SENDER_ID`.
4. Firebase Project Settings → Service Accounts වෙතින් server verification සඳහා key එකක් හදා project folder එකෙන් පිටත ආරක්ෂිතව තබා, `.env` හි `FIREBASE_SERVICE_ACCOUNT_PATH=C:/secure/exora-firebase-admin.json` වැනි path එකක් දෙන්න.
5. `localhost` සහ production domain එක Firebase authorised domains වලට එක් කර server restart කරන්න.

Service account JSON එක public code/GitHub එකට දාන්න එපා. Firebase සකස් කළ විට email registration එකේ verification link එකක් යනවා. Firebase configure කර නැත්නම් local email/password fallback එක development testing සඳහා පමණයි; email verification එහි නැහැ. Production එකේ customer accounts සඳහා Firebase Auth අවශ්‍යයි; admin login එක වෙනම server-side role එකෙන් ආරක්ෂා කරලා තියෙනවා.

මෙම starter එකේ account details, saved address, orders, wishlist සහ reviews SQLite database එකේ තබාගන්නවා; Firebase Authentication login කළමනාකරණයට භාවිත කරනවා. Firestore මේ build එකේ primary shop database එක ලෙස සම්බන්ධ කරලා නැහැ.

## 9. Telegram order alerts (optional)

Telegram BotFather හරහා bot එකක් සාදා token/chat ID ලබාගෙන `.env` හි `TELEGRAM_BOT_TOKEN` සහ `TELEGRAM_CHAT_ID` values දාන්න. Server restart කරන්න. Telegram alert එකේ order number, total, payment method සහ status පමණක් යනවා; customer address/phone/email යවන්නේ නැහැ.

## 10. Payments සහ production පිළිබඳ වැදගත් දේ

- COD සහ bank-transfer receipt upload දැනට තියෙනවා.
- Bank slip එකක් upload කළ පමණින් මුදල් ගෙවා ඇති බව තහවුරු වෙන්නේ නැහැ. බැංකුවේ transaction එක පරීක්ෂා කරලා Admin Panel එකෙන් `Paid` කරන්න.
- Card payments/PayHere gateway එක live කරලා නැහැ. Gateway integration, server-side signed webhook verification සහ sandbox tests කිරීමෙන් පසුව පමණක් සක්‍රිය කළ යුතුයි. Card number/CVV database එකේ save කරන්න එපා.
- Email/SMS notifications, courier API, automated refund/returns, backups, tax/accounting සහ production security audit තවම සම්පූර්ණ කරලා නැහැ.
- Public launch එකට HTTPS, `.store` DNS, Nginx reverse proxy, unique admin password, strong `JWT_SECRET`, backups සහ server monitoring අවශ්‍යයි.

## 11. SEO

`.env` තුළ `PUBLIC_BASE_URL=https://ඔයාගේ-සැබෑ-domain.store` දාන්න. Server එකෙන් `robots.txt` සහ active product URLs ඇතුළත් `sitemap.xml` ස්වයංක්‍රීයව ජනනය කරනවා. HTML files වල canonical `YOUR-DOMAIN.store` placeholders සැබෑ domain එකට වෙනස් කරන්න. HTTPS live කළාට පසුව Google Search Console තුළ sitemap submit කරන්න. SEO tags search engines ට site එක තේරුම් ගන්න උදව් කරනවා; Google rankings සහ “trending” status එකක් සහතික කරන්නේ නැහැ.
