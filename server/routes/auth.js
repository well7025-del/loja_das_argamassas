import { db } from '../db.js';
import { hashPassword, verifyPassword, createSession, destroySession } from '../lib/auth.js';
import { ok, fail, str } from '../lib/http.js';
import { sweepLowStock } from '../lib/notify.js';

export default {
  'POST /api/auth/login': async (ctx) => {
    const email = str(ctx.body.email).toLowerCase();
    const password = str(ctx.body.password);
    if (!email || !password) fail(400, 'Informe e-mail e senha');
    const user = db.prepare('SELECT * FROM users WHERE lower(email) = ? AND active = 1').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) fail(401, 'E-mail ou senha invalidos');
    const { token, expires } = createSession(user.id);
    ctx.setCookie('erp_session', token, expires);
    try { sweepLowStock(); } catch {}
    const store = user.store_id ? db.prepare('SELECT id,name,kind FROM stores WHERE id = ?').get(user.store_id) : null;
    return ok(ctx.res, {
      user: { id: user.id, name: user.name, email: user.email, role: user.role, store_id: user.store_id, store_name: store?.name || null }
    });
  },

  'POST /api/auth/logout': async (ctx) => {
    destroySession(ctx.token);
    ctx.setCookie('erp_session', '', new Date(0).toISOString());
    return ok(ctx.res);
  },

  'GET /api/auth/me': async (ctx) => {
    if (!ctx.user) fail(401, 'Nao autenticado');
    const stores = ctx.user.role === 'master'
      ? db.prepare('SELECT id,name,code,kind FROM stores WHERE active = 1 ORDER BY kind DESC, name').all()
      : db.prepare('SELECT id,name,code,kind FROM stores WHERE id = ? AND active = 1').all(ctx.user.store_id);
    const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(ctx.user.id).n;
    return ok(ctx.res, { user: ctx.user, stores, unread });
  },

  'POST /api/auth/change-password': async (ctx) => {
    if (!ctx.user) fail(401, 'Nao autenticado');
    const atual = str(ctx.body.atual), nova = str(ctx.body.nova);
    if (nova.length < 6) fail(400, 'A nova senha precisa ter ao menos 6 caracteres');
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(ctx.user.id);
    if (!verifyPassword(atual, row.password_hash)) fail(400, 'Senha atual incorreta');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(nova), ctx.user.id);
    return ok(ctx.res);
  }
};
