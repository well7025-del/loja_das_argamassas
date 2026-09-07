import { db } from '../db.js';
import { isMaster, allowedStoreIds, resolveStoreFilter } from '../lib/auth.js';
import { ok, created, fail, str } from '../lib/http.js';
import { resolveCep, onlyDigits, formatCep } from '../lib/geo.js';

/** Normaliza telefone brasileiro para o formato aceito pelo WhatsApp (55DDD9XXXXXXXX). */
export function whatsappNumber(phone) {
  let d = onlyDigits(phone);
  if (!d) return null;
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (d.length === 12 || d.length === 13) return d;
  return d.length >= 12 ? d : null;
}

async function applyCep(payload) {
  const cepDigits = onlyDigits(payload.cep);
  if (cepDigits.length !== 8) return { cep: str(payload.cep) || null, lat: null, lng: null };
  const geo = await resolveCep(cepDigits, { online: process.env.OFFLINE_CEP !== '1' });
  return {
    cep: formatCep(cepDigits),
    address: str(payload.address) || geo?.street || '',
    district: str(payload.district) || geo?.district || '',
    city: str(payload.city) || geo?.city || '',
    uf: (str(payload.uf) || geo?.uf || '').toUpperCase().slice(0, 2),
    lat: geo?.lat ?? null, lng: geo?.lng ?? null
  };
}

export default {
  'GET /api/clientes': async (ctx) => {
    const stores = resolveStoreFilter(ctx.user, ctx.query.store_id);
    const inList = stores.length ? stores : [-1];
    const busca = str(ctx.query.q);
    let sql = `
      SELECT c.*, st.name AS store_name,
             (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND s.status='concluida') AS compras,
             (SELECT COALESCE(SUM(s.total),0) FROM sales s WHERE s.customer_id = c.id AND s.status='concluida') AS total_comprado,
             (SELECT MAX(s.created_at) FROM sales s WHERE s.customer_id = c.id AND s.status='concluida') AS ultima_compra
        FROM customers c LEFT JOIN stores st ON st.id = c.store_id
       WHERE c.active = 1 AND (c.store_id IS NULL OR c.store_id IN (${inList.map(() => '?').join(',')}))`;
    const params = [...inList];
    if (busca) {
      sql += ' AND (c.name LIKE ? OR c.phone LIKE ? OR c.doc LIKE ? OR c.city LIKE ?)';
      const like = `%${busca}%`; params.push(like, like, like, like);
    }
    sql += ' ORDER BY c.name LIMIT 500';
    return ok(ctx.res, { clientes: db.prepare(sql).all(...params) });
  },

  'GET /api/clientes/:id': async (ctx) => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(ctx.params.id));
    if (!c) fail(404, 'Cliente nao encontrado');
    const stores = allowedStoreIds(ctx.user);
    const inList = stores.length ? stores : [-1];
    const compras = db.prepare(`
      SELECT s.id, s.code, s.total, s.payment_method, s.created_at, st.name AS store_name
        FROM sales s JOIN stores st ON st.id = s.store_id
       WHERE s.customer_id = ? AND s.status='concluida' AND s.store_id IN (${inList.map(() => '?').join(',')})
       ORDER BY s.id DESC LIMIT 50`).all(c.id, ...inList);
    return ok(ctx.res, { cliente: c, compras, whatsapp: whatsappNumber(c.phone) });
  },

  'POST /api/clientes': async (ctx) => {
    const name = str(ctx.body.name);
    if (!name) fail(400, 'Informe o nome do cliente');
    const end = await applyCep(ctx.body);
    const storeId = isMaster(ctx.user) ? (Number(ctx.body.store_id) || null) : ctx.user.store_id;
    const r = db.prepare(`INSERT INTO customers(name,phone,email,doc,cep,address,number,district,city,uf,lat,lng,notes,store_id)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(name, str(ctx.body.phone), str(ctx.body.email), str(ctx.body.doc), end.cep, end.address || null,
           str(ctx.body.number), end.district || null, end.city || null, end.uf || null, end.lat, end.lng,
           str(ctx.body.notes), storeId);
    return created(ctx.res, { id: Number(r.lastInsertRowid), endereco: end });
  },

  'PUT /api/clientes/:id': async (ctx) => {
    const id = Number(ctx.params.id);
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!c) fail(404, 'Cliente nao encontrado');
    if (!isMaster(ctx.user) && c.store_id && c.store_id !== ctx.user.store_id) fail(403, 'Cliente de outra loja');
    const mudouCep = onlyDigits(ctx.body.cep) && onlyDigits(ctx.body.cep) !== onlyDigits(c.cep);
    const end = mudouCep ? await applyCep(ctx.body) : {
      cep: ctx.body.cep !== undefined ? str(ctx.body.cep) : c.cep,
      address: ctx.body.address !== undefined ? str(ctx.body.address) : c.address,
      district: ctx.body.district !== undefined ? str(ctx.body.district) : c.district,
      city: ctx.body.city !== undefined ? str(ctx.body.city) : c.city,
      uf: ctx.body.uf !== undefined ? str(ctx.body.uf).toUpperCase().slice(0, 2) : c.uf,
      lat: c.lat, lng: c.lng
    };
    db.prepare(`UPDATE customers SET name=?, phone=?, email=?, doc=?, cep=?, address=?, number=?, district=?, city=?, uf=?,
                       lat=?, lng=?, notes=?, active=? WHERE id=?`)
      .run(str(ctx.body.name, c.name), str(ctx.body.phone, c.phone), str(ctx.body.email, c.email), str(ctx.body.doc, c.doc),
           end.cep, end.address, str(ctx.body.number, c.number), end.district, end.city, end.uf, end.lat, end.lng,
           str(ctx.body.notes, c.notes), ctx.body.active === undefined ? c.active : (ctx.body.active ? 1 : 0), id);
    return ok(ctx.res);
  },

  'DELETE /api/clientes/:id': async (ctx) => {
    const id = Number(ctx.params.id);
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!c) fail(404, 'Cliente nao encontrado');
    if (!isMaster(ctx.user) && c.store_id !== ctx.user.store_id) fail(403, 'Cliente de outra loja');
    db.prepare('UPDATE customers SET active = 0 WHERE id = ?').run(id);
    return ok(ctx.res);
  },

  'GET /api/cep/:cep': async (ctx) => {
    const geo = await resolveCep(ctx.params.cep, { online: process.env.OFFLINE_CEP !== '1' });
    if (!geo) fail(404, 'CEP nao encontrado');
    return ok(ctx.res, { endereco: geo });
  }
};
