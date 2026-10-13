import jwt from 'jsonwebtoken';
import { db } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET;
export function createToken(user) {
  if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d', issuer: 'exora-store' });
}
function cookieToken(req) {
  const raw = req.headers.cookie || '';
  const tokenPair = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith('exora_session='));
  return tokenPair ? decodeURIComponent(tokenPair.slice('exora_session='.length)) : '';
}
export function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1] || cookieToken(req);
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET, { issuer: 'exora-store' });
    const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(Number(payload.sub));
    if (!user) return res.status(401).json({ error: 'Account not found. Please sign in again.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
}
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}
