import { db } from '../db.js';
import { isMaster, allowedStoreIds } from '../lib/auth.js';
import { ok, created, fail, str, num, bool } from '../lib/http.js';
import { saveImage } from '../lib/files.js';

const requireMaster = (ctx) => { if (!isMaster(ctx.user)) fail(403, 'Apenas o usuario master pode cadastrar ou alterar custo e preco de venda'); };

/** Remove custo e margem do payload para quem nao e master. */
function sanitize(rows, user) {
  if (isMaster(user)) return rows;
  return rows.map(({ cost_price, margem, lucro_unitario, ...rest }) => rest);
}

export default {
  'GET /api/produtos': async (ctx) => {
    const stores = allowedStoreIds(ctx.user);
    const storeFilter = ctx.query.store_id && stores.includes(Number(ctx.query.store_id))
      ? [Number(ctx.query.store_id)] : stores;
    const inList = storeFilter.length ? storeFilter : [-1];
    const busca = str(ctx.query.q);
    let sql = `
      SELECT p.*, c.name AS category_name,
             COALESCE((SELECT SUM(s.qty) FROM stock s WHERE s.product_id = p.id AND s.store_id IN (${inList.map(() => '?').join(',')})), 0) AS estoque,
             CASE WHEN p.sale_price > 0 THEN ROUND((p.sale_price - p.cost_price) / p.sale_price * 100, 1) ELSE 0 END AS margem,
             ROUND(p.sale_price - p.cost_price, 2) AS lucro_unitario
        FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE 1=1`;
    const params = [...inList];
    if (ctx.query.ativos !== '0') sql += ' AND p.active = 1';
    if (busca) { sql += ' AND (p.name LIKE ? OR p.sku LIKE ?)'; params.push(`%${busca}%`, `%${busca}%`); }
    if (ctx.query.category_id) { sql += ' AND p.category_id = ?'; params.push(Number(ctx.query.category_id)); }
    sql += ' ORDER BY p.name';
    const rows = db.prepare(sql).all(...params);
    return ok(ctx.res, { produtos: sanitize(rows, ctx.user) });
  },

  'GET /api/produtos/:id': async (ctx) => {
    const id = Number(ctx.params.id);
    const p = db.prepare(`SELECT p.*, c.name AS category_name FROM products p
                          LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`).get(id);
    if (!p) fail(404, 'Produto nao encontrado');
    const stores = allowedStoreIds(ctx.user);
    const estoque = stores.length ? db.prepare(`
      SELECT st.id AS store_id, st.name AS store_name, st.kind, COALESCE(s.qty,0) AS qty
        FROM stores st LEFT JOIN stock s ON s.store_id = st.id AND s.product_id = ?
       WHERE st.active = 1 AND st.id IN (${stores.map(() => '?').join(',')})
       ORDER BY st.kind DESC, st.name`).all(id, ...stores) : [];
    return ok(ctx.res, { produto: sanitize([p], ctx.user)[0], estoque });
  },

  'POST /api/produtos': async (ctx) => {
    requireMaster(ctx);
    const name = str(ctx.body.name);
    if (!name) fail(400, 'Informe o nome do produto');
    let sku = str(ctx.body.sku).toUpperCase() || null;
    if (sku && db.prepare('SELECT 1 FROM products WHERE sku = ?').get(sku)) fail(400, 'Ja existe um produto com este codigo (SKU)');
    const imagem = ctx.body.image_data ? await saveImage(ctx.body.image_data, 'produto') : str(ctx.body.image_url) || null;
    const r = db.prepare(`INSERT INTO products(sku,name,category_id,unit,cost_price,sale_price,min_stock,description,image_url,in_catalog)
                          VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(sku, name, Number(ctx.body.category_id) || null, str(ctx.body.unit, 'UN').toUpperCase(),
           num(ctx.body.cost_price), num(ctx.body.sale_price), num(ctx.body.min_stock),
           str(ctx.body.description), imagem, ctx.body.in_catalog === undefined ? 1 : (bool(ctx.body.in_catalog) ? 1 : 0));
    return created(ctx.res, { id: Number(r.lastInsertRowid) });
  },

  'PUT /api/produtos/:id': async (ctx) => {
    requireMaster(ctx);
    const id = Number(ctx.params.id);
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!p) fail(404, 'Produto nao encontrado');
    let sku = ctx.body.sku !== undefined ? (str(ctx.body.sku).toUpperCase() || null) : p.sku;
    if (sku && sku !== p.sku && db.prepare('SELECT 1 FROM products WHERE sku = ?').get(sku)) fail(400, 'Ja existe um produto com este codigo (SKU)');
    const imagem = ctx.body.image_data ? await saveImage(ctx.body.image_data, 'produto')
                 : (ctx.body.image_url !== undefined ? (str(ctx.body.image_url) || null) : p.image_url);
    db.prepare(`UPDATE products SET sku=?, name=?, category_id=?, unit=?, cost_price=?, sale_price=?, min_stock=?,
                       description=?, image_url=?, in_catalog=?, active=? WHERE id=?`)
      .run(sku, str(ctx.body.name, p.name), ctx.body.category_id !== undefined ? (Number(ctx.body.category_id) || null) : p.category_id,
           str(ctx.body.unit, p.unit).toUpperCase(),
           ctx.body.cost_price !== undefined ? num(ctx.body.cost_price) : p.cost_price,
           ctx.body.sale_price !== undefined ? num(ctx.body.sale_price) : p.sale_price,
           ctx.body.min_stock !== undefined ? num(ctx.body.min_stock) : p.min_stock,
           str(ctx.body.description, p.description), imagem,
           ctx.body.in_catalog === undefined ? p.in_catalog : (bool(ctx.body.in_catalog) ? 1 : 0),
           ctx.body.active === undefined ? p.active : (bool(ctx.body.active) ? 1 : 0), id);
    return ok(ctx.res);
  },

  'DELETE /api/produtos/:id': async (ctx) => {
    requireMaster(ctx);
    const id = Number(ctx.params.id);
    const vendido = db.prepare('SELECT 1 FROM sale_items WHERE product_id = ?').get(id);
    if (vendido) { db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id); return ok(ctx.res, { desativado: true }); }
    db.prepare('DELETE FROM stock WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM stock_moves WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    return ok(ctx.res, { removido: true });
  },

  'GET /api/categorias': async (ctx) =>
    ok(ctx.res, { categorias: db.prepare('SELECT * FROM categories ORDER BY name').all() }),

  'POST /api/categorias': async (ctx) => {
    requireMaster(ctx);
    const name = str(ctx.body.name);
    if (!name) fail(400, 'Informe o nome da categoria');
    const existe = db.prepare('SELECT id FROM categories WHERE lower(name) = lower(?)').get(name);
    if (existe) return ok(ctx.res, { id: existe.id });
    const r = db.prepare('INSERT INTO categories(name) VALUES(?)').run(name);
    return created(ctx.res, { id: Number(r.lastInsertRowid) });
  }
};
