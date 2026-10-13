# EXORA — Advanced Sri Lankan Marketplace Starter

A multi-page, mobile-first online-shopping starter built with Node.js, Express, SQLite, and vanilla HTML/CSS/JavaScript. It is designed for local development in VS Code and can later be deployed behind HTTPS on an Oracle Cloud VPS. It includes an advanced marketplace storefront and a protected admin dashboard.

## Main features in this source build

### Storefront and customer experience
- Responsive, app-like mobile bottom navigation; responsive desktop navigation; cookie preference banner.
- Home page inspired by marketplace storefronts: announcement bar, hero/offer banner, flash-deal countdown, categories, trending/sold items, new arrivals and promo code strip.
- Separate Shop, Categories, Deals, Product, Account, My Orders, Wishlist, Marketplace Sellers and Help/Policy pages.
- Product search autocomplete; keyword/category/seller/description matching; sorting by newest, price or sold count.
- Product cards and detail pages with LKR prices, original price, discount, sold count, ratings, seller name, stock, up to six product photos, options/variants, delivery estimate and related products.
- Product image upload in admin; verified-purchase review form with optional JPG/PNG/WEBP/AVIF photo.
- Cart stored locally for guests and synchronised to the account database after sign-in, saved account profile/address, database-backed order history and wishlist, expected arrival-date range, coupon validation and confirmation screen.
- Cash on Delivery and manual bank transfer receipt upload. Transfer receipts remain private and can only be downloaded by an authenticated administrator.

### Admin / marketplace operations
- `GET /admin` admin login protected by server-side role verification.
- Dashboard metrics: recognised revenue, total orders, pending orders/payments, active products, low stock, customers and sellers.
- Order details, expected delivery dates, order/payment status controls and private bank-slip download.
- Product create/edit/hide, up to six image uploads, price/original price, stock, variants, seller assignment, featured/flash sale and delivery-day range.
- Customer list and order totals (never passwords); seller registration and active/pending/suspended status.
- Marketplace revenue by seller, estimated platform commission, Exora Direct sales, coupon management and home-promotion banner management.
- Optional Telegram order alerts. Alerts omit customer address, phone number and email; use the authenticated admin panel for customer details.

### Data and security basics
- SQLite backend database at `data/exora.sqlite`; data persists across server restarts and the user can retrieve account/order details when signing in again from another device.
- Server-side total, coupon, stock and order checks (cancelled pre-shipment orders restore stock once); bcrypt password hashing for local fallback accounts; JWT held in an HttpOnly, SameSite session cookie; admin role checks on protected APIs; security headers and API rate limits.
- Firebase Authentication can be configured for Google, Apple and email/password. Firebase tokens are verified by the server with Firebase Admin SDK before syncing a customer account. When Firebase is not configured, local email/password accounts are available for development; they do not perform email verification.
- SEO metadata, Open Graph fields, Store structured data, `robots.txt`, and `sitemap.xml` template.

## What is not live until configured

- **Real card payments:** not implemented/enabled. Integrate a payment gateway supported for your registered business, verify signed callbacks/webhooks on the server, and test in sandbox before launch. Never store full card numbers or CVV.
- **Firebase OAuth:** browser buttons are implemented, but providers work only after adding the right Firebase web config to `.env`, enabling providers in Firebase Console, and configuring server-side Firebase Admin verification. Apple sign-in also needs Apple's provider credentials/settings.
- **Not yet implemented as live integrations:** email/SMS order updates, courier APIs/tracking numbers, automated return/refund workflow, automatic bank verification, production backups/monitoring, multi-currency, and tax/accounting integrations. Category management and basic store settings are included.
- The multi-vendor/revenue dashboard includes demo sellers so it can be explored locally. Revenue reflects orders recorded by EXORA only. It cannot show unrelated external companies' sales unless those businesses authorise an API/accounting integration and provide the data.
- This is a functional starter, not a security-audited production marketplace. Complete a security review, legal/privacy review, load/concurrency tests, payment review, and backups/restore drill before accepting real orders.

## Requirements

- Node.js **24 LTS** recommended (Node.js 22+ declared in `package.json`). Install from https://nodejs.org/en/download/.
- VS Code and an internet connection to install packages and load sample product photography/fonts.

## Run in VS Code on Windows

1. Extract this ZIP into a folder such as `C:\Projects\exora-store`.
2. VS Code → **File → Open Folder…** → choose `exora-store`.
3. Open **Terminal → New Terminal**. Make sure the terminal is in the project folder.
4. Create the private environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

5. Generate a random JWT secret:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
   ```

   Replace `JWT_SECRET` in `.env` with the generated value. Never upload `.env` or Firebase service-account JSON to GitHub.

6. Check `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`. Example credentials are for local-only testing.
7. Install dependencies and start the app:

   ```powershell
   npm install
   npm run dev
   ```

8. Open:
   - Store: http://localhost:3000
   - Admin: http://localhost:3000/admin
   - API health: http://localhost:3000/api/health

Use `Ctrl+C` in the terminal to stop the server. Keep the terminal running while browsing the site. Do not open `index.html` directly as a file.

### Local admin credentials

If the database was created using the untouched example `.env`, the local-only credentials are:

- Email: `admin@example.com`
- Password: `ChangeMe_12345!_before_deploy`

Change them before any public deployment. The initial admin is created when the database is first initialised. Changing `ADMIN_PASSWORD` after a database already exists does not re-hash/update the old admin password. For a disposable local test only, stop the server and delete `data/exora.sqlite` to rebuild the database; this deletes all local test users, orders, product changes and seller data.

## Enable Firebase Authentication (optional)

1. Create a Firebase project and register a Web app in Firebase Console.
2. In **Authentication → Sign-in method**, enable Email/Password and Google. Enable Apple only after its provider credentials are configured.
3. Add the Firebase Web app values to the project's private `.env`:

   ```dotenv
   FIREBASE_API_KEY=your_web_api_key
   FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_APP_ID=your_web_app_id
   FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   ```

4. In Firebase Project Settings → Service Accounts, create a service-account key for server-side verification. Store the JSON **outside this repository** (e.g. `C:/secure/exora-firebase-admin.json`) and set:

   ```dotenv
   FIREBASE_SERVICE_ACCOUNT_PATH=C:/secure/exora-firebase-admin.json
   ```

   Alternatively set `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` to its base64-encoded JSON in the server environment, never in frontend JavaScript.

5. Add `localhost` and your production domain to Firebase Authentication's authorised domains, restart Exora, then test account creation, the email verification link, login and password reset. Firebase's browser SDK uses the public web config; the service account is a private server credential.

In production, customer accounts must use Firebase Authentication; local fallback registration is disabled. With Firebase configured, email/password registration requests email verification; Google/Apple are handled by Firebase and ID tokens are verified server-side. Without it, the local fallback is for development only. Database records, orders and addresses remain in Exora's SQLite database; this starter does **not** use Firestore as its primary store database.

## Optional Telegram alerts

1. Create a bot using Telegram's official BotFather and obtain a bot token.
2. Start the bot/chat and get the intended chat ID.
3. Put the token and chat ID in the private server `.env`:

   ```dotenv
   TELEGRAM_BOT_TOKEN=your_bot_token
   TELEGRAM_CHAT_ID=your_private_chat_id
   ```

4. Restart Exora and place a test order. Alert messages include order code, total, payment method and status only—not the customer's contact/address details. Never put the bot token in browser code.

## Payment behaviour

- **Cash on Delivery:** available in the starter; order status and payment status are controlled in Admin.
- **Bank transfer:** customer may upload a JPG/PNG/WEBP/PDF receipt up to 5 MB. The upload is not automatic proof of payment. Verify the actual transaction through the bank before marking paid.
- **Card / online wallet:** not activated. Integrate a supported local gateway and verify the signed server callback/webhook, amount, currency and order reference before marking paid. Never save full card numbers or CVV in Exora.

## Files and data

- Database: `data/exora.sqlite`.
- Private bank-transfer receipts: files under `uploads/`; they are not served as public static files.
- Product and review photos: `public/uploads/products/` and `public/uploads/reviews/`.
- Back up the SQLite database and private receipts together with a tested, secure backup/restore process.
- Guest cart/preferences live in browser local storage; after sign-in the cart and wishlist synchronise to the database, which also stores user profiles, saved shipping address, orders and reviews. The server sets an HttpOnly cookie containing a signed session token; the frontend never stores user passwords or the session token in a readable cookie/localStorage.

## SEO and domain setup

Set `PUBLIC_BASE_URL=https://your-real-domain.store` in `.env` after registering the `.store` domain. The server generates `robots.txt` and a sitemap with active product URLs dynamically. Replace the `YOUR-DOMAIN.store` placeholder canonical URLs in the HTML files with the real domain before launch. Product pages set their own canonical, Open Graph and Product JSON-LD metadata when loaded. Submit the sitemap to Google Search Console after HTTPS is live. SEO tags help search engines understand the pages but cannot guarantee rankings or trends.

## GitHub / Oracle VPS outline

- Keep code in a GitHub repository, but **do not use GitHub Pages as the hosting for this dynamic store/API**. Host the app on the Oracle VPS (or another Node-capable service).
- On the Ubuntu VPS, update OS packages, deploy as a non-root user, install Node 24 LTS, add the private `.env`, run `npm install`, and use a process manager (PM2/systemd).
- Put Nginx in front of the Node process; use HTTPS/TLS, firewall rules, a registered `.store` domain, least-privilege file permissions, backup/monitoring and a tested restore procedure. Keep the Node port private behind Nginx.
- Configure `NODE_ENV=production`, long random `JWT_SECRET`, a unique admin credential, trusted Firebase service account path and optional Telegram bot. Do not commit `.env`, customer database, receipts or service-account credentials.

## Basic verification checklist

1. Open the storefront and check mobile layout, product cards, autocomplete search, categories and flash deals.
2. Sign up a local test customer, log out, sign in again and verify saved profile/address/order history persists.
3. Add a product to cart, test `WELCOME5`, submit a test COD order, then view it in Admin.
4. Use Admin to add/edit a product, upload multiple images, set seller and delivery-day range, and configure a flash offer.
5. Add a seller and banner, then refresh the home page and revenue dashboard.
6. Place a bank-transfer test order, upload a dummy receipt, and download it from Admin.
7. Test review photo upload after creating a non-cancelled order for that product.
8. Confirm stock is reduced only when an order is successfully created and over-stock orders are rejected.
