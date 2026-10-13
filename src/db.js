import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDb = path.resolve(here, '../data/exora.sqlite');
const dbFile = path.resolve(process.env.DB_FILE || defaultDb);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

export const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  firebase_uid TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'General',
  price INTEGER NOT NULL CHECK(price >= 0),
  compare_at_price INTEGER,
  image_url TEXT NOT NULL DEFAULT '',
  image_urls TEXT NOT NULL DEFAULT '[]',
  variants_json TEXT NOT NULL DEFAULT '[]',
  delivery_min_days INTEGER NOT NULL DEFAULT 2,
  delivery_max_days INTEGER NOT NULL DEFAULT 5,
  flash_sale INTEGER NOT NULL DEFAULT 0,
  flash_ends_at TEXT,
  seller_id INTEGER REFERENCES sellers(id),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  postal_code TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL CHECK(payment_method IN ('bank_transfer','cash_on_delivery')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','failed','refunded')),
  order_status TEXT NOT NULL DEFAULT 'pending' CHECK(order_status IN ('pending','confirmed','processing','shipped','delivered','cancelled')),
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  coupon_code TEXT,
  receipt_path TEXT,
  expected_delivery_min TEXT,
  expected_delivery_max TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  seller_id INTEGER REFERENCES sellers(id),
  variant TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, user_id)
);
CREATE TABLE IF NOT EXISTS sellers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_name TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT 'Sri Lanka',
  commission_percent INTEGER NOT NULL DEFAULT 10 CHECK(commission_percent BETWEEN 0 AND 50),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending','suspended')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY,
  percent_off INTEGER NOT NULL CHECK(percent_off BETWEEN 1 AND 80),
  active INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT
);
CREATE TABLE IF NOT EXISTS user_wishlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, product_id)
);
CREATE TABLE IF NOT EXISTS user_cart_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, product_id, variant)
);
CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  cta_text TEXT NOT NULL DEFAULT 'Shop now',
  target_url TEXT NOT NULL DEFAULT '/deals.html',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL DEFAULT '✨',
  color TEXT NOT NULL DEFAULT '#f4f5f7',
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS store_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS user_addresses (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  recipient_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  postal_code TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Safe, additive migrations for users upgrading an existing local Exora database.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('users', 'firebase_uid', 'TEXT');
ensureColumn('products', 'image_urls', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('products', 'variants_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('products', 'delivery_min_days', 'INTEGER NOT NULL DEFAULT 2');
ensureColumn('products', 'delivery_max_days', 'INTEGER NOT NULL DEFAULT 5');
ensureColumn('products', 'flash_sale', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('products', 'flash_ends_at', 'TEXT');
ensureColumn('products', 'seller_id', 'INTEGER REFERENCES sellers(id)');
ensureColumn('reviews', 'image_url', "TEXT NOT NULL DEFAULT ''");
ensureColumn('orders', 'delivery_fee', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('orders', 'expected_delivery_min', 'TEXT');
ensureColumn('orders', 'expected_delivery_max', 'TEXT');
ensureColumn('order_items', 'seller_id', 'INTEGER REFERENCES sellers(id)');
ensureColumn('order_items', 'variant', "TEXT NOT NULL DEFAULT ''");
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid) WHERE firebase_uid IS NOT NULL');

const seedProducts = [
  ['Exora Wireless Headphones', 'Comfortable over-ear headphones with rich sound and all-day battery life.', 'Electronics', 8990, 10990, 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=85', 24, 1],
  ['Minimal Everyday Backpack', 'A clean, practical backpack for study, work and weekend travel.', 'Fashion', 6490, 7990, 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=85', 18, 1],
  ['Smart Watch Active', 'Track everyday activity and stay connected with a bright display.', 'Electronics', 12490, 14990, 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85', 12, 1],
  ['Everyday Ceramic Mug Set', 'Simple modern mugs designed for your home desk or kitchen.', 'Home', 2890, null, 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=900&q=85', 40, 0],
  ['Portable Bluetooth Speaker', 'Compact wireless audio for small gatherings and outdoor days.', 'Electronics', 5790, 6990, 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=900&q=85', 20, 1],
  ['Classic Sneaker', 'Versatile low-top sneakers for daily comfort and casual looks.', 'Fashion', 7490, null, 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85', 16, 0],
  ['Desk Lamp Studio', 'A warm, focused light for late study sessions and creative work.', 'Home', 4590, 5290, 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85', 14, 0],
  ['Travel Bottle 750ml', 'Reusable stainless-style bottle for your daily commute.', 'Lifestyle', 2190, null, 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?auto=format&fit=crop&w=900&q=85', 32, 0]
];
const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
if (!productCount) {
  const insert = db.prepare('INSERT INTO products (name, description, category, price, compare_at_price, image_url, stock, featured) VALUES (?,?,?,?,?,?,?,?)');
  const transaction = db.transaction((items) => items.forEach((p) => insert.run(...p)));
  transaction(seedProducts);
}

db.prepare('INSERT OR IGNORE INTO coupons (code, percent_off, active) VALUES (?, ?, 1)').run('EXORA10', 10);
db.prepare('INSERT OR IGNORE INTO coupons (code, percent_off, active) VALUES (?, ?, 1)').run('WELCOME5', 5);

const initialCategories = [
  ['Electronics','🎧','#e1f0ff','Everyday tech',1],['Fashion','🧢','#ffeadf','Style and essentials',2],
  ['Home','🏠','#e6f6e9','Make it yours',3],['Lifestyle','🎒','#f0e8ff','Carry your day',4],
  ['Beauty','✨','#ffe9f1','Little rituals',5],['Sports','⚽','#e3f7f4','Move your way',6],
  ['Accessories','⌚','#fff4d6','Finishing touches',7],['Mobiles','📱','#e8edff','Stay connected',8]
];
const seedCategory = db.prepare('INSERT OR IGNORE INTO categories (name,icon,color,description,sort_order,active) VALUES (?,?,?,?,?,1)');
for (const category of initialCategories) seedCategory.run(...category);


// Demo vendors make the multi-vendor dashboards testable. Replace these with real, verified sellers before launch.
db.prepare('INSERT INTO sellers (business_name,owner_name,email,region,commission_percent,status) SELECT ?,?,?,?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM sellers WHERE business_name=?)')
  .run('Nova Tech (Demo)', 'Demo Owner', 'nova-demo@example.com', 'Colombo', 10, 'active', 'Nova Tech (Demo)');
db.prepare('INSERT INTO sellers (business_name,owner_name,email,region,commission_percent,status) SELECT ?,?,?,?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM sellers WHERE business_name=?)')
  .run('UrbanNest (Demo)', 'Demo Owner', 'urbannest-demo@example.com', 'Kandy', 8, 'active', 'UrbanNest (Demo)');
const novaSeller = db.prepare("SELECT id FROM sellers WHERE business_name='Nova Tech (Demo)'").get()?.id;
const urbanSeller = db.prepare("SELECT id FROM sellers WHERE business_name='UrbanNest (Demo)'").get()?.id;
db.prepare("UPDATE products SET seller_id=?, flash_sale=1 WHERE id IN (1,3,5) AND seller_id IS NULL").run(novaSeller);
db.prepare("UPDATE products SET seller_id=? WHERE id IN (2,4,6) AND seller_id IS NULL").run(urbanSeller);

const adminEmail = (process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe_12345!_before_deploy';
const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
if (!existingAdmin) {
  const hash = bcrypt.hashSync(adminPassword, 12);
  db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
    .run(process.env.ADMIN_NAME || 'Exora Admin', adminEmail, hash, 'admin');
}
