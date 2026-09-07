import { db, getSetting, setSetting } from '../db.js';
import { hashPassword, isMaster } from '../lib/auth.js';
import { ok, created, fail, str, num, bool } from '../lib/http.js';

const requireMaster = (ctx) => { if (!isMaster(ctx.user)) fail(403, 'Apenas o usuario master pode executar esta acao'); };
const slug = (s) => str(s).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '_').slice(0, 20);

export default {
  /* ---------- Lojas ---------- */
  'GET /api/lojas': async (ctx) => {
    const rows = isMaster(ctx.user)
      ? db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM users u WHERE u.store_id = s.id AND u.active=1) AS usuarios
                      FROM stores s ORDER BY s.kind DESC, s.name`).all()
      : db.prepare('SELECT * FROM stores WHERE id = ?').all(ctx.user.store_id);
    return ok(ctx.res, { lojas: rows });
  },

  'POST /api/lojas': async (ctx) => {
    requireMaster(ctx);
    const name = str(ctx.body.name);
    if (!name) fail(400, 'Informe o nome da loja');
    let code = slug(ctx.body.code || name);
    if (db.prepare('SELECT 1 FROM stores WHERE code = ?').get(code)) code = `${code}_${Date.now().toString().slice(-4)}`;
    const kind = ctx.body.kind === 'fabrica' ? 'fabrica' : 'loja';
    const r = db.prepare(`INSERT INTO stores(name,code,kind,city,uf,address,phone,cep) VALUES(?,?,?,?,?,?,?,?)`)
      .run(name, code, kind, str(ctx.body.city), str(ctx.body.uf).toUpperCase().slice(0, 2),
           str(ctx.body.address), str(ctx.body.phone), str(ctx.body.cep));
    return created(ctx.res, { id: Number(r.lastInsertRowid), code });
  },

  'PUT /api/lojas/:id': async (ctx) => {
    requireMaster(ctx);
    const id = Number(ctx.params.id);
    const loja = db.prepare('SELECT * FROM stores WHERE id = ?').get(id);
    if (!loja) fail(404, 'Loja nao encontrada');
    db.prepare(`UPDATE stores SET name=?, city=?, uf=?, address=?, phone=?, cep=?, active=? WHERE id=?`)
      .run(str(ctx.body.name, loja.name), str(ctx.body.city, loja.city), str(ctx.body.uf, loja.uf).toUpperCase().slice(0, 2),
           str(ctx.body.address, loja.address), str(ctx.body.phone, loja.phone), str(ctx.body.cep, loja.cep),
           ctx.body.active === undefined ? loja.active : (bool(ctx.body.active) ? 1 : 0), id);
    return ok(ctx.res);
  },

  /* ---------- Usuarios ---------- */
  'GET /api/usuarios': async (ctx) => {
    requireMaster(ctx);
    const rows = db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.role,u.store_id,u.active,u.notify_low_stock,u.created_at,
                                    s.name AS store_name
                               FROM users u LEFT JOIN stores s ON s.id = u.store_id
                              ORDER BY u.role='master' DESC, u.name`).all();
    return ok(ctx.res, { usuarios: rows });
  },

  'POST /api/usuarios': async (ctx) => {
    requireMaster(ctx);
    const name = str(ctx.body.name), email = str(ctx.body.email).toLowerCase(), password = str(ctx.body.password);
    if (!name || !email) fail(400, 'Informe nome e e-mail');
    if (password.length < 6) fail(400, 'A senha precisa ter ao menos 6 caracteres');
    if (db.prepare('SELECT 1 FROM users WHERE lower(email)=?').get(email)) fail(400, 'Ja existe um usuario com este e-mail');
    const role = ['master', 'gerente', 'vendedor'].includes(ctx.body.role) ? ctx.body.role : 'gerente';
    const storeId = role === 'master' ? null : Number(ctx.body.store_id) || null;
    if (role !== 'master' && !storeId) fail(400, 'Selecione a loja do usuario');
    const r = db.prepare(`INSERT INTO users(name,email,phone,password_hash,role,store_id) VALUES(?,?,?,?,?,?)`)
      .run(name, email, str(ctx.body.phone), hashPassword(password), role, storeId);
    return created(ctx.res, { id: Number(r.lastInsertRowid) });
  },

  'PUT /api/usuarios/:id': async (ctx) => {
    requireMaster(ctx);
    const id = Number(ctx.params.id);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) fail(404, 'Usuario nao encontrado');
    const role = ['master', 'gerente', 'vendedor'].includes(ctx.body.role) ? ctx.body.role : u.role;
    const storeId = role === 'master' ? null : (ctx.body.store_id !== undefined ? Number(ctx.body.store_id) || null : u.store_id);
    db.prepare(`UPDATE users SET name=?, phone=?, role=?, store_id=?, active=?, notify_low_stock=? WHERE id=?`)
      .run(str(ctx.body.name, u.name), str(ctx.body.phone, u.phone), role, storeId,
           ctx.body.active === undefined ? u.active : (bool(ctx.body.active) ? 1 : 0),
           ctx.body.notify_low_stock === undefined ? u.notify_low_stock : (bool(ctx.body.notify_low_stock) ? 1 : 0), id);
    if (str(ctx.body.password)) {
      if (str(ctx.body.password).length < 6) fail(400, 'A senha precisa ter ao menos 6 caracteres');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(str(ctx.body.password)), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    return ok(ctx.res);
  },

  /* ---------- Preferencias do proprio usuario ---------- */
  'PUT /api/perfil': async (ctx) => {
    db.prepare('UPDATE users SET name=?, phone=?, notify_low_stock=? WHERE id=?')
      .run(str(ctx.body.name, ctx.user.name), str(ctx.body.phone, ctx.user.phone),
           bool(ctx.body.notify_low_stock) ? 1 : 0, ctx.user.id);
    return ok(ctx.res);
  },

  /* ---------- Configuracoes ---------- */
  'GET /api/config': async (ctx) => ok(ctx.res, {
    empresa: getSetting('empresa', {}),
    notificacoes: getSetting('notificacoes', { estoque_minimo: true, percentual_alerta: 100, alerta_caixa_alto: 3000 })
  }),

  'PUT /api/config': async (ctx) => {
    requireMaster(ctx);
    if (ctx.body.empresa) setSetting('empresa', { ...getSetting('empresa', {}), ...ctx.body.empresa });
    if (ctx.body.notificacoes) {
      const atual = getSetting('notificacoes', {});
      setSetting('notificacoes', {
        ...atual,
        estoque_minimo: bool(ctx.body.notificacoes.estoque_minimo),
        percentual_alerta: Math.max(10, num(ctx.body.notificacoes.percentual_alerta, 100)),
        alerta_caixa_alto: Math.max(0, num(ctx.body.notificacoes.alerta_caixa_alto, 3000))
      });
    }
    return ok(ctx.res);
  }
};
