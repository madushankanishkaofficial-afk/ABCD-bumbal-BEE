import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { createToken, requireAuth, requireAdmin } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const PRIVATE_UPLOADS = path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'));
const PRODUCT_UPLOADS = path.join(PUBLIC, 'uploads', 'products');
const REVIEW_UPLOADS = path.join(PUBLIC, 'uploads', 'reviews');
fs.mkdirSync(PRIVATE_UPLOADS, { recursive: true });
fs.mkdirSync(PRODUCT_UPLOADS, { recursive: true });
fs.mkdirSync(REVIEW_UPLOADS, { recursive: true });
const app = express();
const PORT = Number(process.env.PORT || 3000);
const storeName = process.env.STORE_NAME || 'Exora';
const COOKIE_NAME = 'exora_session';
const COOKIE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
function uploadExtension(file) {
  const extensionByMime = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif', 'application/pdf': '.pdf' };
  return extensionByMime[file.mimetype] || '.bin';
}

app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://www.gstatic.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc: ["'self'", 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://firebaseinstallations.googleapis.com', 'https://www.googleapis.com', 'https://oauth2.googleapis.com', 'https://accounts.google.com', 'https://appleid.apple.com'],
      frameSrc: ["'self'", 'https://*.firebaseapp.com', 'https://accounts.google.com', 'https://appleid.apple.com'],
      objectSrc: ["'none'"], frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  }
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/auth/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }));
const getPublicBaseUrl = () => String(process.env.PUBLIC_BASE_URL || 'https://YOUR-DOMAIN.store').trim().replace(/\/+$/, '');
const xmlEscape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
app.get('/robots.txt', (_req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /account.html\nDisallow: /orders.html\nDisallow: /wishlist.html\nSitemap: ${getPublicBaseUrl()}/sitemap.xml\n`));
app.get('/sitemap.xml', (_req, res) => {
  const base = getPublicBaseUrl();
  const paths = ['/', '/shop.html', '/categories.html', '/deals.html', '/businesses.html', '/info.html?section=faq', '/info.html?section=shipping', '/info.html?section=returns', '/info.html?section=privacy', '/info.html?section=terms'];
  const productIds = db.prepare('SELECT id FROM products WHERE active=1 ORDER BY id DESC LIMIT 5000').all();
  const urls = [...paths.map((item) => `${base}${item}`), ...productIds.map((item) => `${base}/product.html?id=${item.id}`)];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join('\n')}\n</urlset>\n`;
  res.type('application/xml').send(body);
});
app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

const privateUpload = multer({
  storage: multer.diskStorage({ destination: (_req, _file, cb) => cb(null, PRIVATE_UPLOADS), filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${uploadExtension(file)}`) }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype) ? cb(null, true) : cb(new Error('Upload a JPG, PNG, WEBP or PDF file only.'))
});
const imageUpload = multer({
  storage: multer.diskStorage({ destination: (_req, _file, cb) => cb(null, PRODUCT_UPLOADS), filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${uploadExtension(file)}`) }),
  limits: { fileSize: 4 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.mimetype) ? cb(null, true) : cb(new Error('Product images must be JPG, PNG, WEBP or AVIF files.'))
});

function safeUser(user) { return { id: user.id, name: user.name, email: user.email, role: user.role }; }
function moneyLkr(amount) { return `LKR ${Number(amount || 0).toLocaleString('en-LK')}`; }
function setSession(res, user) {
  const token = createToken(user);
  res.cookie(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: COOKIE_AGE_MS });
  return token;
}
function clearSession(res) { res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' }); }
function numberOr(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function getSetting(key, fallback='') { const row=db.prepare('SELECT setting_value FROM store_settings WHERE setting_key=?').get(key); return row ? row.setting_value : (process.env[key] ?? fallback); }
function jsonArray(value) { try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function firebaseClientConfigured() { return Boolean(process.env.FIREBASE_API_KEY && process.env.FIREBASE_AUTH_DOMAIN && process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_APP_ID); }
function publicProduct(row) {
  const avg = db.prepare('SELECT ROUND(AVG(rating),1) AS rating, COUNT(*) AS count FROM reviews WHERE product_id = ?').get(row.id);
  const sold = db.prepare("SELECT COALESCE(SUM(oi.quantity),0) AS n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=? AND o.order_status!='cancelled' AND (o.payment_status='paid' OR (o.payment_method='cash_on_delivery' AND o.order_status='delivered'))").get(row.id).n;
  const seller = row.seller_id ? db.prepare('SELECT business_name FROM sellers WHERE id=?').get(row.seller_id) : null;
  const endTimestamp = row.flash_ends_at ? new Date(String(row.flash_ends_at).replace(' ', 'T')).getTime() : Infinity;
  const flashSaleActive = Boolean(row.flash_sale) && Number.isFinite(endTimestamp) ? endTimestamp > Date.now() : Boolean(row.flash_sale) && !row.flash_ends_at;
  return { ...row, featured: Boolean(row.featured), active: Boolean(row.active), flash_sale: flashSaleActive, image_urls: jsonArray(row.image_urls).length ? jsonArray(row.image_urls) : (row.image_url ? [row.image_url] : []), variants: jsonArray(row.variants_json), rating: avg.rating || 0, review_count: avg.count || 0, sold_count: sold, seller_name: seller?.business_name || 'Exora Direct' };
}
function safeExternalImage(url) {
  if (!url) return '';
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href.slice(0, 1500) : ''; } catch { return url.startsWith('/uploads/products/') ? url.slice(0, 1500) : ''; }
}
function readProduct(body) {
  const name = String(body.name || '').trim().slice(0, 140);
  const description = String(body.description || '').trim().slice(0, 2000);
  const category = String(body.category || 'General').trim().slice(0, 60);
  const imageUrl = safeExternalImage(String(body.imageUrl || '').trim());
  const imageUrls = jsonArray(body.imageUrls).map((url) => safeExternalImage(String(url || '').trim())).filter(Boolean).slice(0, 6);
  if (imageUrl && !imageUrls.includes(imageUrl)) imageUrls.unshift(imageUrl);
  const price = Number(body.price); const compareAtPrice = body.compareAtPrice === null || body.compareAtPrice === '' ? null : Number(body.compareAtPrice);
  const stock = Number(body.stock); const deliveryMinDays = Number(body.deliveryMinDays ?? 2); const deliveryMaxDays = Number(body.deliveryMaxDays ?? 5);
  const variants = jsonArray(body.variants).map((v) => String(v).trim().slice(0, 40)).filter(Boolean).slice(0, 30);
  const flashSale = Boolean(body.flashSale);
  const flashEndInput = String(body.flashEndsAt || '').trim();
  let flashEndsAt = null;
  if (flashEndInput) {
    const flashEndDate = new Date(flashEndInput);
    if (!Number.isFinite(flashEndDate.getTime())) return { error: 'Enter a valid flash-offer end time.' };
    if (flashSale && flashEndDate.getTime() <= Date.now()) return { error: 'Flash-offer end time must be in the future.' };
    flashEndsAt = flashEndDate.toISOString();
  }
  const sellerId = body.sellerId === '' || body.sellerId == null ? null : Number(body.sellerId);
  if (name.length < 2) return { error: 'Product name must contain at least 2 characters.' };
  if (!category) return { error: 'Choose a product category.' };
  if (!db.prepare('SELECT id FROM categories WHERE name=? AND active=1').get(category)) return { error: 'Choose an active category from the category manager.' };
  if (!Number.isSafeInteger(price) || price < 0 || price > 100000000) return { error: 'Enter a valid whole-number price in LKR.' };
  if (compareAtPrice !== null && (!Number.isSafeInteger(compareAtPrice) || compareAtPrice < price)) return { error: 'Original price must be greater than or equal to current price.' };
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000) return { error: 'Enter a valid stock quantity.' };
  if (!Number.isSafeInteger(deliveryMinDays) || !Number.isSafeInteger(deliveryMaxDays) || deliveryMinDays < 1 || deliveryMaxDays < deliveryMinDays || deliveryMaxDays > 60) return { error: 'Delivery estimate must be 1–60 days and the maximum must not be lower than the minimum.' };
  if (sellerId !== null && (!Number.isSafeInteger(sellerId) || !db.prepare('SELECT id FROM sellers WHERE id=? AND status=\'active\'').get(sellerId))) return { error: 'Choose an active seller/business.' };
  return { name, description, category, price, compareAtPrice, imageUrl: imageUrl || imageUrls[0] || '', imageUrls, variants, stock, deliveryMinDays, deliveryMaxDays, flashSale, flashEndsAt, featured: Boolean(body.featured), active: body.active !== false, sellerId };
}
async function sendTelegramAlert(order) {
  const token = process.env.TELEGRAM_BOT_TOKEN; const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const safeText = `🛍️ EXORA — New order\nOrder: ${order.order_code}\nTotal: ${moneyLkr(order.total)}\nPayment: ${order.payment_method}\nStatus: ${order.order_status}\nOpen the authenticated Exora dashboard to view customer details.`;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: safeText, disable_web_page_preview: true }), signal: AbortSignal.timeout(5000) });
  } catch (error) { console.error('Telegram alert failed:', error.message); }
}
let firebaseAuthPromise;
async function verifyFirebaseIdToken(idToken) {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  const accountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!encoded && !accountPath) throw new Error('Firebase server verification is not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON_BASE64.');
  if (!firebaseAuthPromise) firebaseAuthPromise = (async () => {
    const jsonText = encoded ? Buffer.from(encoded, 'base64').toString('utf8') : fs.readFileSync(path.resolve(accountPath), 'utf8');
    const serviceAccount = JSON.parse(jsonText);
    const [{ cert, getApps, initializeApp }, { getAuth }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/auth')]);
    const appInstance = getApps().find((entry) => entry.name === 'exora-firebase-admin') || initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID }, 'exora-firebase-admin');
    return getAuth(appInstance);
  })();
  return (await firebaseAuthPromise).verifyIdToken(idToken, true);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'Exora Store API', time: new Date().toISOString() }));
app.get('/api/config', (_req, res) => {
  const firebase = process.env.FIREBASE_API_KEY && process.env.FIREBASE_AUTH_DOMAIN && process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_APP_ID ? {
    apiKey: process.env.FIREBASE_API_KEY, authDomain: process.env.FIREBASE_AUTH_DOMAIN, projectId: process.env.FIREBASE_PROJECT_ID, appId: process.env.FIREBASE_APP_ID, messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || ''
  } : null;
  res.json({ storeName:getSetting('store_name',process.env.STORE_NAME||'Exora'), currency:getSetting('store_currency',process.env.STORE_CURRENCY||'LKR'), supportEmail:getSetting('support_email',process.env.STORE_SUPPORT_EMAIL||''), firebase, freeShippingThreshold:Number(getSetting('free_shipping_threshold',process.env.FREE_SHIPPING_THRESHOLD||15000)), defaultDeliveryFee:Number(getSetting('default_delivery_fee',process.env.DEFAULT_DELIVERY_FEE||450)), defaultDeliveryMinDays:2, defaultDeliveryMaxDays:5 });
});

app.get('/api/products', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100); const category = String(req.query.category || '').trim().slice(0, 60); const sort = String(req.query.sort || 'featured');
  let sql = 'SELECT p.* FROM products p WHERE p.active = 1'; const params = [];
  if (q) { sql += ' AND (p.name LIKE ? OR p.description LIKE ? OR p.category LIKE ? OR EXISTS (SELECT 1 FROM sellers s WHERE s.id=p.seller_id AND s.business_name LIKE ?))'; params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (category && category !== 'All') { sql += ' AND p.category = ?'; params.push(category); }
  if (req.query.flash === '1') sql += " AND p.flash_sale=1 AND (p.flash_ends_at IS NULL OR datetime(p.flash_ends_at) > datetime('now'))";
  const total = db.prepare(sql.replace('SELECT p.* FROM products p', 'SELECT COUNT(*) AS count FROM products p')).get(...params).count;
  const requestedLimit = Number(req.query.limit ?? 120); const limit = Number.isSafeInteger(requestedLimit) ? Math.min(120, Math.max(1, requestedLimit)) : 120;
  const requestedOffset = Number(req.query.offset ?? 0); const offset = Number.isSafeInteger(requestedOffset) ? Math.min(10000000, Math.max(0, requestedOffset)) : 0;
  if (sort === 'price-low') sql += ' ORDER BY p.price ASC'; else if (sort === 'price-high') sql += ' ORDER BY p.price DESC'; else if (sort === 'newest') sql += ' ORDER BY p.id DESC'; else if (sort === 'bestselling') sql += ' ORDER BY (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi WHERE oi.product_id=p.id) DESC, p.featured DESC'; else sql += ' ORDER BY p.flash_sale DESC,p.featured DESC,p.id DESC';
  sql += ' LIMIT ? OFFSET ?';
  const products = db.prepare(sql).all(...params, limit, offset).map(publicProduct);
  res.json({ products, total, limit, offset, hasMore: offset + products.length < total });
});
app.get('/api/public/categories', (_req,res) => res.json({categories:db.prepare('SELECT id,name,icon,color,description,sort_order FROM categories WHERE active=1 ORDER BY sort_order,name').all()}));
app.get('/api/public/sellers', (_req,res) => { const sellers=db.prepare("SELECT s.id,s.business_name,s.region,s.status,COUNT(DISTINCT p.id) AS product_count FROM sellers s LEFT JOIN products p ON p.seller_id=s.id AND p.active=1 WHERE s.status='active' GROUP BY s.id ORDER BY product_count DESC,s.business_name LIMIT 100").all(); res.json({sellers}); });
app.get('/api/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(req.params.id));
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  const reviews = db.prepare('SELECT r.id, r.rating, r.comment, r.image_url, r.created_at, u.name FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.product_id = ? ORDER BY r.id DESC LIMIT 30').all(product.id);
  res.json({ product: publicProduct(product), reviews });
});

app.post('/api/auth/register', async (req, res) => {
  if (process.env.NODE_ENV === 'production' || firebaseClientConfigured()) return res.status(403).json({ error: 'Customer registration must use the configured Firebase Authentication flow.' });
  const name = String(req.body.name || '').trim(); const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Name must be 2–80 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: 'Password must contain at least 10 characters.' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
  try {
    const hash = await bcrypt.hash(password, 12); const result = db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)').run(name, email, hash);
    const user = db.prepare('SELECT id,name,email,role FROM users WHERE id = ?').get(result.lastInsertRowid); setSession(res, user);
    res.status(201).json({ user: safeUser(user), sessionCookie: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Could not create your account.' }); }
});
app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Incorrect email or password.' });
  if (user.role !== 'admin' && (process.env.NODE_ENV === 'production' || firebaseClientConfigured())) return res.status(403).json({ error: 'Customer accounts must sign in through Firebase Authentication.' });
  setSession(res, user); res.json({ user: safeUser(user), sessionCookie: true });
});
app.post('/api/auth/firebase', async (req, res) => {
  const idToken = String(req.body.idToken || '');
  if (idToken.length < 100 || idToken.length > 10000) return res.status(400).json({ error: 'A valid Firebase ID token is required.' });
  try {
    const decoded = await verifyFirebaseIdToken(idToken);
    const uid = String(decoded.uid || '').slice(0, 150); const email = String(decoded.email || '').trim().toLowerCase(); const name = String(decoded.name || email.split('@')[0] || 'Exora Customer').slice(0, 80);
    if (!uid || !email || !decoded.email_verified) return res.status(403).json({ error: 'Verify your email address with your sign-in provider, then sign in again.' });
    let user = db.prepare('SELECT id,name,email,role,firebase_uid FROM users WHERE firebase_uid=?').get(uid);
    if (!user) {
      const matching = db.prepare('SELECT id,name,email,role,firebase_uid FROM users WHERE email=?').get(email);
      if (matching?.role === 'admin') return res.status(403).json({ error: 'Admin accounts must use the dedicated administrator sign-in.' });
      if (matching) {
        if (matching.firebase_uid && matching.firebase_uid !== uid) return res.status(409).json({ error: 'This email is already linked to another sign-in identity.' });
        db.prepare('UPDATE users SET firebase_uid=?,name=CASE WHEN name=\'\' THEN ? ELSE name END WHERE id=?').run(uid, name, matching.id);
        user = db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(matching.id);
      } else {
        const dummyPassword = await bcrypt.hash(crypto.randomBytes(48).toString('hex'), 12);
        const result = db.prepare('INSERT INTO users (name,email,password_hash,firebase_uid,role) VALUES (?,?,?,?,\'customer\')').run(name,email,dummyPassword,uid);
        user = db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(result.lastInsertRowid);
      }
    }
    if (user.role === 'admin') return res.status(403).json({ error: 'Admin accounts must use the dedicated administrator sign-in.' });
    setSession(res, user); res.json({ user: safeUser(user), sessionCookie: true });
  } catch (error) {
    const message = error.message.includes('not configured') ? error.message : 'Firebase sign-in verification failed. Check your Firebase server configuration.';
    const status = error.message.includes('not configured') ? 503 : 401; res.status(status).json({ error: message });
  }
});
app.post('/api/auth/logout', (_req, res) => { clearSession(res); res.json({ message: 'Signed out.' }); });
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));
app.put('/api/account/profile', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ error: 'Admin profile is managed separately.' });
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (name.length < 2) return res.status(400).json({ error: 'Name must contain at least 2 characters.' });
  db.prepare('UPDATE users SET name=? WHERE id=?').run(name, req.user.id); res.json({ user: db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(req.user.id) });
});
app.get('/api/account/orders', requireAuth, (req, res) => {
  const orders = db.prepare('SELECT id,order_code,payment_method,payment_status,order_status,subtotal,discount,delivery_fee,total,created_at,expected_delivery_min,expected_delivery_max FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  for (const order of orders) order.items = db.prepare('SELECT product_name,unit_price,quantity,variant FROM order_items WHERE order_id=?').all(order.id);
  res.json({ orders });
});
app.get('/api/account/wishlist', requireAuth, (req,res) => { const rows=db.prepare('SELECT product_id FROM user_wishlist WHERE user_id=? ORDER BY created_at DESC').all(req.user.id); res.json({productIds:rows.map((row)=>row.product_id)}); });
app.put('/api/account/wishlist', requireAuth, (req,res) => {
  const incoming=Array.isArray(req.body.productIds)?req.body.productIds.slice(0,100):[]; const ids=[...new Set(incoming.map(Number).filter((id)=>Number.isSafeInteger(id)&&id>0))];
  const insert=db.prepare('INSERT OR IGNORE INTO user_wishlist (user_id,product_id) SELECT ?,id FROM products WHERE id=? AND active=1');
  const update=db.transaction(()=>{db.prepare('DELETE FROM user_wishlist WHERE user_id=?').run(req.user.id);for(const id of ids)insert.run(req.user.id,id);}); update(); res.json({productIds:db.prepare('SELECT product_id FROM user_wishlist WHERE user_id=? ORDER BY created_at DESC').all(req.user.id).map((row)=>row.product_id)});
});
app.get('/api/account/cart', requireAuth, (req,res) => {
  const rows=db.prepare('SELECT ci.product_id AS id,ci.quantity,ci.variant,p.name,p.price,p.image_url,p.stock,p.variants_json FROM user_cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.user_id=? AND p.active=1 ORDER BY ci.updated_at DESC').all(req.user.id);
  res.json({items:rows.map((row)=>({...row,variants:jsonArray(row.variants_json)}))});
});
app.put('/api/account/cart', requireAuth, (req,res) => {
  const incoming=Array.isArray(req.body.items)?req.body.items.slice(0,100):[];const lines=new Map();
  for(const item of incoming){const id=Number(item.id),quantity=Number(item.quantity),requestedVariant=String(item.variant||'').trim().slice(0,80);if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(quantity)||quantity<1||quantity>20)return res.status(400).json({error:'Invalid cart product or quantity.'});const product=db.prepare('SELECT id,stock,active,variants_json FROM products WHERE id=?').get(id);if(!product||!product.active)return res.status(409).json({error:'A cart item is no longer available. Refresh your cart.'});const options=jsonArray(product.variants_json);let variant=requestedVariant;if(variant){const match=options.find((option)=>String(option).toLowerCase()===variant.toLowerCase());if(!match)return res.status(400).json({error:'Choose a valid product option.'});variant=match;}const key=`${id}::${variant.toLowerCase()}`;const previous=lines.get(key);const total=(previous?.quantity||0)+quantity;if(total>20)return res.status(400).json({error:'A maximum of 20 units per product option can be saved in the cart.'});lines.set(key,{id,quantity:total,variant,stock:product.stock});}
  for(const line of lines.values())if(line.quantity>line.stock)return res.status(409).json({error:`A cart item has only ${line.stock} unit(s) in stock.`});
  const replace=db.transaction(()=>{db.prepare('DELETE FROM user_cart_items WHERE user_id=?').run(req.user.id);const insert=db.prepare('INSERT INTO user_cart_items(user_id,product_id,variant,quantity,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)');for(const line of lines.values())insert.run(req.user.id,line.id,line.variant,line.quantity);});replace();
  res.json({items:[...lines.values()].map(({id,quantity,variant})=>({id,quantity,variant}))});
});
app.get('/api/account/address', requireAuth, (req, res) => { const address = db.prepare('SELECT recipient_name,phone,address,city,postal_code,updated_at FROM user_addresses WHERE user_id = ?').get(req.user.id) || null; res.json({ address }); });
app.put('/api/account/address', requireAuth, (req, res) => {
  const recipientName = String(req.body.recipientName || '').trim().slice(0, 100); const phone = String(req.body.phone || '').trim().slice(0, 30); const address = String(req.body.address || '').trim().slice(0, 300); const city = String(req.body.city || '').trim().slice(0, 100); const postalCode = String(req.body.postalCode || '').trim().slice(0, 20);
  if (recipientName.length < 2 || phone.length < 7 || address.length < 5 || city.length < 2) return res.status(400).json({ error: 'Enter a valid recipient name, phone, street address and city.' });
  db.prepare(`INSERT INTO user_addresses (user_id,recipient_name,phone,address,city,postal_code) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET recipient_name=excluded.recipient_name, phone=excluded.phone, address=excluded.address, city=excluded.city, postal_code=excluded.postal_code, updated_at=CURRENT_TIMESTAMP`).run(req.user.id,recipientName,phone,address,city,postalCode);
  res.json({ message: 'Default shipping address saved.' });
});
app.post('/api/coupons/validate', (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const coupon = db.prepare("SELECT code,percent_off FROM coupons WHERE code = ? AND active = 1 AND (expires_at IS NULL OR expires_at >= date('now'))").get(code);
  if (!coupon) return res.status(400).json({ error: 'That coupon is invalid or expired.' }); res.json({ coupon });
});
app.post('/api/orders', requireAuth, async (req, res) => {
  const customerName = String(req.body.customerName || '').trim().slice(0, 100); const phone = String(req.body.phone || '').trim().slice(0, 30); const address = String(req.body.address || '').trim().slice(0, 300); const city = String(req.body.city || '').trim().slice(0, 100); const postalCode = String(req.body.postalCode || '').trim().slice(0, 20);
  const paymentMethod = String(req.body.paymentMethod || 'cash_on_delivery'); const couponCode = String(req.body.couponCode || '').trim().toUpperCase().slice(0, 32); const incoming = Array.isArray(req.body.items) ? req.body.items : [];
  if (customerName.length < 2 || phone.length < 7 || address.length < 5 || city.length < 2) return res.status(400).json({ error: 'Complete your name, phone number, street address and city.' });
  if (!['bank_transfer', 'cash_on_delivery'].includes(paymentMethod)) return res.status(400).json({ error: 'Choose bank transfer or cash on delivery. Card gateway is not yet configured.' });
  if (!incoming.length || incoming.length > 30) return res.status(400).json({ error: 'Your cart is empty or contains too many different products.' });
  const lineMap = new Map();
  for (const item of incoming) {
    const id = Number(item.id); const qty = Number(item.quantity); const variant = String(item.variant || '').trim().slice(0,80);
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(qty) || qty < 1 || qty > 20) return res.status(400).json({ error: 'Invalid product or quantity.' });
    const key = `${id}::${variant.toLowerCase()}`; const existing = lineMap.get(key); if (existing) existing.quantity += qty; else lineMap.set(key,{id,quantity:qty,variant});
  }
  const lines=[...lineMap.values()]; const productTotals=new Map(); for(const line of lines)productTotals.set(line.id,(productTotals.get(line.id)||0)+line.quantity);
  const productById=new Map(); let subtotal=0; let minDays=1; let maxDays=1;
  for (const [id, quantity] of productTotals) {
    const product = db.prepare('SELECT id,name,price,stock,active,delivery_min_days,delivery_max_days,seller_id,variants_json FROM products WHERE id = ?').get(id);
    if (!product || !product.active) return res.status(400).json({ error: 'One of the products is no longer available. Refresh your cart.' });
    if (quantity > product.stock) return res.status(409).json({ error: `${product.name} has only ${product.stock} item(s) in stock.` });
    productById.set(id,product); subtotal+=product.price*quantity; minDays=Math.max(minDays,product.delivery_min_days||2); maxDays=Math.max(maxDays,product.delivery_max_days||5);
  }
  for(const line of lines){const options=jsonArray(productById.get(line.id)?.variants_json);if(line.variant&&!options.some((option)=>String(option).toLowerCase()===line.variant.toLowerCase()))return res.status(400).json({error:'Choose a valid option for each product.'});}
  if (!Number.isSafeInteger(subtotal) || subtotal <= 0 || subtotal > 100000000) return res.status(400).json({ error: 'Order total is invalid.' });
  let discount=0; let validCoupon=null;
  if(couponCode){validCoupon=db.prepare("SELECT code,percent_off FROM coupons WHERE code = ? AND active = 1 AND (expires_at IS NULL OR expires_at >= date('now'))").get(couponCode);if(!validCoupon)return res.status(400).json({error:'Coupon invalid or expired. Remove it and try again.'});discount=Math.floor(subtotal*validCoupon.percent_off/100);}
  const shippingThreshold=Number(getSetting('free_shipping_threshold',process.env.FREE_SHIPPING_THRESHOLD||15000));const deliveryFee=subtotal>=shippingThreshold?0:Number(getSetting('default_delivery_fee',process.env.DEFAULT_DELIVERY_FEE||450));const total=subtotal+deliveryFee-discount;
  const orderCode=`EX-${new Date().toISOString().slice(2,10).replaceAll('-','')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const deliveryMin=new Date();deliveryMin.setDate(deliveryMin.getDate()+minDays);const deliveryMax=new Date();deliveryMax.setDate(deliveryMax.getDate()+maxDays);const isoDate=(d)=>d.toISOString().slice(0,10);
  try {
    const createOrder=db.transaction(()=>{
      const result=db.prepare('INSERT INTO orders (order_code,user_id,customer_name,phone,address,city,postal_code,payment_method,subtotal,discount,delivery_fee,total,coupon_code,expected_delivery_min,expected_delivery_max) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(orderCode,req.user.id,customerName,phone,address,city,postalCode,paymentMethod,subtotal,discount,deliveryFee,total,validCoupon?.code||null,isoDate(deliveryMin),isoDate(deliveryMax));
      const orderId=Number(result.lastInsertRowid);const addItem=db.prepare('INSERT INTO order_items (order_id,product_id,product_name,unit_price,quantity,seller_id,variant) VALUES (?,?,?,?,?,?,?)');const reduceStock=db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?');
      for(const [id,quantity] of productTotals){const changed=reduceStock.run(quantity,id,quantity);if(changed.changes!==1)throw new Error(`Stock changed for ${productById.get(id)?.name||'a product'}. Please try again.`);}
      for(const line of lines){const product=productById.get(line.id);addItem.run(orderId,product.id,product.name,product.price,line.quantity,product.seller_id||null,line.variant);}
      db.prepare('INSERT INTO user_addresses (user_id,recipient_name,phone,address,city,postal_code) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET recipient_name=excluded.recipient_name,phone=excluded.phone,address=excluded.address,city=excluded.city,postal_code=excluded.postal_code,updated_at=CURRENT_TIMESTAMP').run(req.user.id,customerName,phone,address,city,postalCode);
      return orderId;
    });
    const id=createOrder();const order=db.prepare('SELECT order_code,total,payment_method,order_status,expected_delivery_min,expected_delivery_max FROM orders WHERE id=?').get(id);void sendTelegramAlert(order);
    res.status(201).json({order:{...order,id,subtotal,discount,delivery_fee:deliveryFee},message:'Order placed successfully. Save your order number.'});
  } catch(error){console.error('Order creation failed:',error.message);res.status(500).json({error:error.message.startsWith('Stock changed')?error.message:'Could not place the order. Please retry.'});}
});
app.post('/api/orders/:id/receipt', requireAuth, (req, res, next) => { privateUpload.single('receipt')(req, res, (error) => { if (error) return res.status(400).json({ error: error.message || 'Could not upload receipt.' }); next(); }); }, (req, res) => {
  const orderId = Number(req.params.id); const order = db.prepare('SELECT id,user_id,payment_method FROM orders WHERE id=?').get(orderId);
  if (!order || (order.user_id !== req.user.id && req.user.role !== 'admin')) { if (req.file) fs.unlink(req.file.path, () => {}); return res.status(404).json({ error: 'Order not found.' }); }
  if (order.payment_method !== 'bank_transfer') { if (req.file) fs.unlink(req.file.path, () => {}); return res.status(400).json({ error: 'This order does not require a bank transfer receipt.' }); }
  if (!req.file) return res.status(400).json({ error: 'Choose a receipt file first.' });
  db.prepare('UPDATE orders SET receipt_path=? WHERE id=?').run(path.basename(req.file.filename), orderId); res.json({ message: 'Receipt uploaded. It remains pending until the store verifies the bank transaction.' });
});
const reviewImageUpload = multer({
  storage: multer.diskStorage({ destination: (_req, _file, cb) => cb(null, REVIEW_UPLOADS), filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${uploadExtension(file)}`) }),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.mimetype) ? cb(null, true) : cb(new Error('Review photos must be JPG, PNG, WEBP or AVIF.'))
});
app.post('/api/products/:id/reviews', requireAuth, (req, res, next) => { reviewImageUpload.single('image')(req,res,(error)=>{ if(error) return res.status(400).json({error:error.message || 'Could not upload review photo.'}); next(); }); }, (req, res) => {
  const productId = Number(req.params.id); const rating = Number(req.body.rating); const comment = String(req.body.comment || '').trim().slice(0, 500);
  if (!Number.isSafeInteger(rating) || rating < 1 || rating > 5) { if(req.file) fs.unlink(req.file.path,()=>{}); return res.status(400).json({ error: 'Choose a rating from 1 to 5.' }); }
  if (!db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(productId)) { if(req.file) fs.unlink(req.file.path,()=>{}); return res.status(404).json({ error: 'Product not found.' }); }
  const bought = db.prepare("SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=? AND o.user_id=? AND (o.payment_status='paid' OR (o.payment_method='cash_on_delivery' AND o.order_status='delivered')) LIMIT 1").get(productId, req.user.id);
  if (!bought) { if(req.file) fs.unlink(req.file.path,()=>{}); return res.status(403).json({ error: 'Verified-purchase reviews are available after ordering this product.' }); }
  const imageUrl=req.file?`/uploads/reviews/${path.basename(req.file.filename)}`:'';
  try { db.prepare('INSERT INTO reviews (product_id,user_id,rating,comment,image_url) VALUES (?,?,?,?,?)').run(productId,req.user.id,rating,comment,imageUrl); res.status(201).json({ message: 'Thanks for sharing your feedback.' }); }
  catch (error) { if(req.file) fs.unlink(req.file.path,()=>{}); if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'You have already reviewed this product.' }); res.status(500).json({ error: 'Could not save your review.' }); }
});

app.use('/api/admin', requireAuth, requireAdmin);
app.get('/api/admin/categories',(_req,res)=>res.json({categories:db.prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category=c.name AND p.active=1) product_count FROM categories c ORDER BY sort_order,name').all()}));
app.post('/api/admin/categories',(req,res)=>{
  const name=String(req.body.name||'').trim().slice(0,60);const icon=String(req.body.icon||'✨').trim().slice(0,12);const color=String(req.body.color||'#f4f5f7').trim();const description=String(req.body.description||'').trim().slice(0,180);const sortOrder=Number(req.body.sortOrder||0);
  if(name.length<2||!/^#[0-9a-fA-F]{6}$/.test(color)||!Number.isSafeInteger(sortOrder)||sortOrder<0||sortOrder>10000)return res.status(400).json({error:'Enter a valid category name, hex color and sort order.'});
  try{const result=db.prepare('INSERT INTO categories(name,icon,color,description,sort_order,active) VALUES(?,?,?,?,?,1)').run(name,icon||'✨',color,description,sortOrder);res.status(201).json({category:db.prepare('SELECT * FROM categories WHERE id=?').get(result.lastInsertRowid)});}catch{return res.status(409).json({error:'A category with this name already exists.'});}
});
app.patch('/api/admin/categories/:id/status',(req,res)=>{const active=req.body.active?1:0;const category=db.prepare('SELECT id,name FROM categories WHERE id=?').get(Number(req.params.id));if(!category)return res.status(404).json({error:'Category not found.'});if(!active&&db.prepare('SELECT COUNT(*) n FROM products WHERE category=? AND active=1').get(category.name).n>0)return res.status(409).json({error:'Move or hide this category’s active products before disabling the category.'});const result=db.prepare('UPDATE categories SET active=? WHERE id=?').run(active,category.id);res.json({message:'Category status updated.'});});
app.get('/api/admin/settings',(_req,res)=>res.json({settings:{storeName:getSetting('store_name',process.env.STORE_NAME||'Exora'),currency:getSetting('store_currency',process.env.STORE_CURRENCY||'LKR'),freeShippingThreshold:Number(getSetting('free_shipping_threshold',process.env.FREE_SHIPPING_THRESHOLD||15000)),defaultDeliveryFee:Number(getSetting('default_delivery_fee',process.env.DEFAULT_DELIVERY_FEE||450)),supportEmail:getSetting('support_email',process.env.STORE_SUPPORT_EMAIL||'support@example.com')}}));
app.put('/api/admin/settings',(req,res)=>{
  const name=String(req.body.storeName||'').trim().slice(0,80);const currency=String(req.body.currency||'LKR').trim().toUpperCase().slice(0,8);const supportEmail=String(req.body.supportEmail||'').trim().toLowerCase().slice(0,190);const free=Number(req.body.freeShippingThreshold);const fee=Number(req.body.defaultDeliveryFee);
  if(name.length<2||! /^[A-Z]{3,8}$/.test(currency)||!Number.isSafeInteger(free)||free<0||free>100000000||!Number.isSafeInteger(fee)||fee<0||fee>1000000|| (supportEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)))return res.status(400).json({error:'Check the store name, currency, support email, free-delivery threshold and delivery fee.'});
  const save=db.prepare('INSERT INTO store_settings(setting_key,setting_value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP');
  const txn=db.transaction(()=>{save.run('store_name',name);save.run('store_currency',currency);save.run('support_email',supportEmail);save.run('free_shipping_threshold',String(free));save.run('default_delivery_fee',String(fee));});txn();res.json({message:'Store settings saved. Refresh the storefront to see public changes.'});
});
app.get('/api/admin/summary', (_req, res) => {
  const totalOrders = db.prepare('SELECT COUNT(*) n FROM orders').get().n;
  const pendingOrders = db.prepare("SELECT COUNT(*) n FROM orders WHERE order_status IN ('pending','confirmed','processing')").get().n;
  const pendingPayments = db.prepare("SELECT COUNT(*) n FROM orders WHERE payment_status='pending'").get().n;
  const recognizedRevenue = db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE order_status!='cancelled' AND (payment_status='paid' OR (payment_method='cash_on_delivery' AND order_status='delivered'))").get().n;
  const grossSales = db.prepare("SELECT COALESCE(SUM(subtotal),0) n FROM orders WHERE order_status!='cancelled' AND (payment_status='paid' OR (payment_method='cash_on_delivery' AND order_status='delivered'))").get().n;
  const products = db.prepare('SELECT COUNT(*) n FROM products WHERE active=1').get().n; const lowStock = db.prepare('SELECT COUNT(*) n FROM products WHERE active=1 AND stock<=5').get().n; const customers = db.prepare("SELECT COUNT(*) n FROM users WHERE role='customer'").get().n; const activeSellers = db.prepare("SELECT COUNT(*) n FROM sellers WHERE status='active'").get().n;
  const todayOrders = db.prepare("SELECT COUNT(*) n FROM orders WHERE date(created_at)=date('now')").get().n;
  const monthlyRevenue = db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE strftime('%Y-%m',created_at)=strftime('%Y-%m','now') AND order_status!='cancelled' AND (payment_status='paid' OR (payment_method='cash_on_delivery' AND order_status='delivered'))").get().n;
  res.json({ totalOrders, pendingOrders, pendingPayments, revenue: recognizedRevenue, recognizedRevenue, grossSales, products, lowStock, customers, activeSellers, todayOrders, monthlyRevenue });
});
app.get('/api/admin/businesses/revenue', (_req, res) => {
  const recognized = "(o.order_status!='cancelled' AND (o.payment_status='paid' OR (o.payment_method='cash_on_delivery' AND o.order_status='delivered')))";
  const total = db.prepare(`SELECT COALESCE(SUM(o.total),0) AS revenue, COALESCE(SUM(o.subtotal),0) AS grossSales FROM orders o WHERE ${recognized}`).get();
  const businesses = db.prepare(`SELECT s.id,s.business_name,s.owner_name,s.email,s.region,s.commission_percent,s.status,COALESCE(x.orders,0) AS orders,COALESCE(p.product_count,0) AS products,COALESCE(x.revenue,0) AS revenue FROM sellers s LEFT JOIN (SELECT oi.seller_id,COUNT(DISTINCT CASE WHEN ${recognized} THEN o.id END) AS orders,SUM(CASE WHEN ${recognized} THEN oi.unit_price*oi.quantity - CASE WHEN o.subtotal>0 THEN ROUND((oi.unit_price*oi.quantity*o.discount*1.0)/o.subtotal) ELSE 0 END ELSE 0 END) AS revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.seller_id IS NOT NULL GROUP BY oi.seller_id) x ON x.seller_id=s.id LEFT JOIN (SELECT seller_id,COUNT(*) product_count FROM products WHERE active=1 GROUP BY seller_id) p ON p.seller_id=s.id ORDER BY revenue DESC,s.business_name`).all();
  const direct = db.prepare(`SELECT (SELECT COUNT(*) FROM products WHERE seller_id IS NULL AND active=1) AS products,(SELECT COUNT(DISTINCT o.id) FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE oi.seller_id IS NULL AND ${recognized}) AS orders,COALESCE((SELECT SUM(oi.unit_price*oi.quantity - CASE WHEN o.subtotal>0 THEN ROUND((oi.unit_price*oi.quantity*o.discount*1.0)/o.subtotal) ELSE 0 END) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.seller_id IS NULL AND ${recognized}),0) AS revenue`).get();
  res.json({ total, businesses, direct });
});
app.get('/api/public/banners', (_req,res) => res.json({banners:db.prepare('SELECT id,title,subtitle,image_url,cta_text,target_url FROM banners WHERE active=1 ORDER BY sort_order,id DESC LIMIT 8').all()}));
app.get('/api/admin/coupons', (_req,res) => res.json({coupons:db.prepare('SELECT * FROM coupons ORDER BY code').all()}));
app.post('/api/admin/coupons', (req,res) => {
  const code=String(req.body.code||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,32); const percent=Number(req.body.percentOff); const expiresAt=String(req.body.expiresAt||'').trim()||null;
  if(code.length<3||!Number.isSafeInteger(percent)||percent<1||percent>80) return res.status(400).json({error:'Enter a coupon code and discount from 1–80%.'});
  try{db.prepare('INSERT INTO coupons(code,percent_off,active,expires_at) VALUES (?,?,?,?)').run(code,percent,req.body.active===false?0:1,expiresAt);res.status(201).json({message:'Coupon created.'});}catch{res.status(409).json({error:'That coupon code already exists.'});}
});
app.patch('/api/admin/coupons/:code', (req,res) => {const active=Boolean(req.body.active);const result=db.prepare('UPDATE coupons SET active=? WHERE code=?').run(active?1:0,String(req.params.code).toUpperCase());if(!result.changes)return res.status(404).json({error:'Coupon not found.'});res.json({message:'Coupon status updated.'});});
app.get('/api/admin/banners', (_req,res)=>res.json({banners:db.prepare('SELECT * FROM banners ORDER BY sort_order,id DESC').all()}));
app.post('/api/admin/banners', (req,res)=>{const title=String(req.body.title||'').trim().slice(0,120);const subtitle=String(req.body.subtitle||'').trim().slice(0,240);const imageUrl=safeExternalImage(String(req.body.imageUrl||'').trim());const ctaText=String(req.body.ctaText||'Shop now').trim().slice(0,40);const targetUrl=String(req.body.targetUrl||'/deals.html').trim().slice(0,300);if(title.length<2)return res.status(400).json({error:'Banner title is required.'});const result=db.prepare('INSERT INTO banners(title,subtitle,image_url,cta_text,target_url,active,sort_order) VALUES (?,?,?,?,?,?,?)').run(title,subtitle,imageUrl,ctaText,targetUrl,req.body.active===false?0:1,Number(req.body.sortOrder||0));res.status(201).json({banner:db.prepare('SELECT * FROM banners WHERE id=?').get(result.lastInsertRowid)});});
app.patch('/api/admin/banners/:id', (req,res)=>{const result=db.prepare('UPDATE banners SET active=? WHERE id=?').run(req.body.active?1:0,Number(req.params.id));if(!result.changes)return res.status(404).json({error:'Banner not found.'});res.json({message:'Banner status updated.'});});
app.get('/api/admin/sellers', (_req, res) => res.json({ sellers: db.prepare('SELECT s.*,COUNT(DISTINCT p.id) product_count FROM sellers s LEFT JOIN products p ON p.seller_id=s.id GROUP BY s.id ORDER BY s.id DESC').all() }));
app.post('/api/admin/sellers', (req, res) => {
  const name = String(req.body.businessName || '').trim().slice(0,100); const owner = String(req.body.ownerName || '').trim().slice(0,80); const email = String(req.body.email || '').trim().toLowerCase().slice(0,190); const region = String(req.body.region || 'Sri Lanka').trim().slice(0,80); const commission = Number(req.body.commissionPercent ?? 10);
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !Number.isSafeInteger(commission) || commission<0 || commission>50) return res.status(400).json({ error:'Enter a business name, valid email and commission from 0–50%.' });
  const result = db.prepare('INSERT INTO sellers (business_name,owner_name,email,region,commission_percent,status) VALUES (?,?,?,?,?,\'active\')').run(name,owner,email,region,commission);
  res.status(201).json({ seller: db.prepare('SELECT * FROM sellers WHERE id=?').get(result.lastInsertRowid) });
});
app.patch('/api/admin/sellers/:id/status', (req, res) => {
  const status = String(req.body.status || ''); if (!['active','pending','suspended'].includes(status)) return res.status(400).json({ error:'Choose a valid seller status.' });
  const result = db.prepare('UPDATE sellers SET status=? WHERE id=?').run(status,Number(req.params.id)); if(!result.changes) return res.status(404).json({error:'Seller not found.'}); res.json({message:'Seller status updated.'});
});
app.get('/api/admin/products', (_req, res) => res.json({ products: db.prepare('SELECT * FROM products ORDER BY id DESC').all().map((p) => ({ ...publicProduct(p), featured: Boolean(p.featured), active: Boolean(p.active) })) }));
app.post('/api/admin/uploads/products', (req, res, next) => { imageUpload.array('images', 6)(req,res,(error)=>{ if(error) return res.status(400).json({error:error.message || 'Could not upload product images.'}); next(); }); }, (req,res)=> {
  if (!req.files?.length) return res.status(400).json({error:'Choose at least one image.'}); res.status(201).json({ images:req.files.map((file)=>`/uploads/products/${path.basename(file.filename)}`) });
});
app.post('/api/admin/products', (req, res) => {
  const p = readProduct(req.body); if (p.error) return res.status(400).json({ error: p.error });
  const result = db.prepare('INSERT INTO products (name,description,category,price,compare_at_price,image_url,image_urls,variants_json,delivery_min_days,delivery_max_days,flash_sale,flash_ends_at,seller_id,stock,featured,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(p.name,p.description,p.category,p.price,p.compareAtPrice,p.imageUrl,JSON.stringify(p.imageUrls),JSON.stringify(p.variants),p.deliveryMinDays,p.deliveryMaxDays,p.flashSale?1:0,p.flashEndsAt,p.sellerId,p.stock,p.featured?1:0,p.active?1:0);
  res.status(201).json({ product: publicProduct(db.prepare('SELECT * FROM products WHERE id=?').get(result.lastInsertRowid)) });
});
app.put('/api/admin/products/:id', (req, res) => {
  const p = readProduct(req.body); if (p.error) return res.status(400).json({ error: p.error });
  const result = db.prepare('UPDATE products SET name=?,description=?,category=?,price=?,compare_at_price=?,image_url=?,image_urls=?,variants_json=?,delivery_min_days=?,delivery_max_days=?,flash_sale=?,flash_ends_at=?,seller_id=?,stock=?,featured=?,active=? WHERE id=?').run(p.name,p.description,p.category,p.price,p.compareAtPrice,p.imageUrl,JSON.stringify(p.imageUrls),JSON.stringify(p.variants),p.deliveryMinDays,p.deliveryMaxDays,p.flashSale?1:0,p.flashEndsAt,p.sellerId,p.stock,p.featured?1:0,p.active?1:0,Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Product not found.' }); res.json({ message: 'Product saved.' });
});
app.delete('/api/admin/products/:id', (req, res) => { const result = db.prepare('UPDATE products SET active=0 WHERE id=?').run(Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Product not found.' }); res.json({ message: 'Product hidden from the shop.' }); });
app.get('/api/admin/orders', (_req, res) => {
  const orders = db.prepare('SELECT o.*,u.email AS account_email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 300').all();
  for(const order of orders) order.items = db.prepare('SELECT product_name,unit_price,quantity,seller_id,variant FROM order_items WHERE order_id=?').all(order.id); res.json({orders});
});
app.patch('/api/admin/orders/:id/status', (req, res) => {
  const status = String(req.body.status || '');
  const orderId = Number(req.params.id);
  if (!Number.isSafeInteger(orderId) || orderId < 1 || !['pending','confirmed','processing','shipped','delivered','cancelled'].includes(status)) return res.status(400).json({ error: 'Choose a valid order and status.' });
  const order = db.prepare('SELECT id,order_status FROM orders WHERE id=?').get(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.order_status === 'cancelled' && status !== 'cancelled') return res.status(409).json({ error: 'Cancelled orders cannot be reopened. Create a new order instead.' });
  if (status === 'cancelled' && ['shipped','delivered'].includes(order.order_status)) return res.status(409).json({ error: 'A shipped or delivered order cannot be cancelled here. Use the return/refund process.' });
  const change = db.transaction(() => {
    if (status === 'cancelled' && order.order_status !== 'cancelled') {
      const lines = db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=? AND product_id IS NOT NULL').all(orderId);
      const restore = db.prepare('UPDATE products SET stock=stock+? WHERE id=?');
      for (const line of lines) restore.run(line.quantity, line.product_id);
    }
    db.prepare('UPDATE orders SET order_status=? WHERE id=?').run(status, orderId);
  });
  change();
  res.json({ message: status === 'cancelled' && order.order_status !== 'cancelled' ? 'Order cancelled and stock restored.' : 'Order status updated.' });
});
app.patch('/api/admin/orders/:id/payment', (req, res) => {
  const status = String(req.body.status || ''); if(!['pending','paid','failed','refunded'].includes(status)) return res.status(400).json({error:'Choose a valid payment status.'});
  const order = db.prepare('SELECT payment_method,receipt_path FROM orders WHERE id=?').get(Number(req.params.id)); if(!order) return res.status(404).json({error:'Order not found.'});
  if(status==='paid' && order.payment_method==='bank_transfer' && !order.receipt_path) return res.status(400).json({error:'Upload and verify the bank transfer evidence before marking paid.'});
  const result = db.prepare('UPDATE orders SET payment_status=? WHERE id=?').run(status,Number(req.params.id)); res.json({message:'Payment status updated.'});
});
app.get('/api/admin/orders/:id/receipt', (req, res) => {
  const order = db.prepare('SELECT receipt_path,order_code FROM orders WHERE id=?').get(Number(req.params.id)); if(!order?.receipt_path) return res.status(404).json({error:'No receipt found.'});
  const file = path.resolve(PRIVATE_UPLOADS, path.basename(order.receipt_path)); if(!file.startsWith(PRIVATE_UPLOADS + path.sep) || !fs.existsSync(file)) return res.status(404).json({error:'Receipt file is missing.'}); res.download(file,`${order.order_code}-receipt${path.extname(file)}`);
});
app.get('/api/admin/customers', (_req, res) => {
  const customers = db.prepare("SELECT u.id,u.name,u.email,u.created_at,COUNT(o.id) order_count,COALESCE(SUM(CASE WHEN o.order_status!='cancelled' THEN o.total ELSE 0 END),0) order_value FROM users u LEFT JOIN orders o ON o.user_id=u.id WHERE u.role='customer' GROUP BY u.id ORDER BY u.id DESC LIMIT 500").all(); res.json({customers});
});
app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
app.get('/api/*path', (req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Something went wrong. Please try again.' : error.message || 'Internal server error.' }); });

app.listen(PORT, '0.0.0.0', () => { console.log(`Exora Store running at http://localhost:${PORT}`); console.log(`Admin dashboard at http://localhost:${PORT}/admin`); });
