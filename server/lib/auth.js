import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from '../db.js';

const SESSION_DAYS = 30;

export function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(plain, stored) {
  try {
    const [alg, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const a = Buffer.from(hash, 'hex');
    const b = scryptSync(plain, salt, a.length);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, userId, expires);
  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
  return { token, expires };
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function userFromToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.role, u.store_id, u.active, u.notify_low_stock,
           s.name AS store_name, s.kind AS store_kind
      FROM sessions se
      JOIN users u ON u.id = se.user_id
      LEFT JOIN stores s ON s.id = u.store_id
     WHERE se.token = ? AND se.expires_at > datetime('now') AND u.active = 1`).get(token);
  return row || null;
}

export const isMaster = (user) => user?.role === 'master';

/** Lojas que o usuario pode enxergar. Master ve todas. */
export function allowedStoreIds(user) {
  if (isMaster(user)) return db.prepare('SELECT id FROM stores WHERE active = 1').all().map(r => r.id);
  return user.store_id ? [user.store_id] : [];
}

/** Resolve o filtro de loja de uma requisicao respeitando a permissao. */
export function resolveStoreFilter(user, requested) {
  const allowed = allowedStoreIds(user);
  const req = requested ? Number(requested) : null;
  if (req && allowed.includes(req)) return [req];
  if (req && !allowed.includes(req)) return [-1]; // sem acesso -> nenhum resultado
  return allowed;
}
