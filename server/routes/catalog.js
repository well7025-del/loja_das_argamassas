import { db, getSetting } from '../db.js';
import { ok, fail, str } from '../lib/http.js';

/** Catalogo publico: sem autenticacao, sem custo, apenas o que a loja quer expor. */
export default {
  'GET /api/catalogo/lojas': async (ctx) => ok(ctx.res, {
    empresa: getSetting('empresa', { nome: 'Loja das Argamassas' }),
    lojas: db.prepare(`SELECT code, name, city, uf, phone, address FROM stores
                        WHERE active = 1 AND kind = 'loja' ORDER BY name`).all()
  }),

  'GET /api/catalogo': async (ctx) => {
    const empresa = getSetting('empresa', { nome: 'Loja das Argamassas' });
    const codigo = str(ctx.query.loja).toUpperCase();
    const loja = codigo ? db.prepare("SELECT * FROM stores WHERE code = ? AND active = 1 AND kind='loja'").get(codigo) : null;
    if (codigo && !loja) fail(404, 'Loja nao encontrada');

    const params = [];
    let disponibilidade = '0 AS estoque';
    if (loja) { disponibilidade = 'COALESCE((SELECT qty FROM stock s WHERE s.product_id = p.id AND s.store_id = ?), 0) AS estoque'; params.push(loja.id); }

    let sql = `SELECT p.id, p.sku, p.name, p.unit, p.sale_price, p.description, p.image_url,
                      c.name AS categoria, ${disponibilidade}
                 FROM products p LEFT JOIN categories c ON c.id = p.category_id
                WHERE p.active = 1 AND p.in_catalog = 1`;
    const busca = str(ctx.query.q);
    if (busca) { sql += ' AND (p.name LIKE ? OR c.name LIKE ?)'; params.push(`%${busca}%`, `%${busca}%`); }
    sql += ' ORDER BY c.name, p.name';

    const produtos = db.prepare(sql).all(...params).map(p => ({
      ...p, disponivel: loja ? p.estoque > 0 : null
    }));
    const categorias = [...new Set(produtos.map(p => p.categoria || 'Outros'))];
    const lojas = db.prepare(`SELECT code, name, city, uf, phone FROM stores WHERE active=1 AND kind='loja' ORDER BY name`).all();
    return ok(ctx.res, { empresa, loja: loja ? { code: loja.code, name: loja.name, city: loja.city, uf: loja.uf, phone: loja.phone, address: loja.address } : null, lojas, categorias, produtos });
  }
};
