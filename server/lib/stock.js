import { db, getSetting } from '../db.js';

export function getQty(productId, storeId) {
  const r = db.prepare('SELECT qty FROM stock WHERE product_id = ? AND store_id = ?').get(productId, storeId);
  return r ? r.qty : 0;
}

/**
 * Aplica um movimento de estoque (qty assinado) e registra o historico.
 * Deve ser chamado dentro de uma transacao quando fizer parte de uma operacao maior.
 */
export function applyMove({ productId, storeId, kind, qty, refType = null, refId = null, userId = null, note = null }) {
  db.prepare(`INSERT INTO stock(product_id,store_id,qty) VALUES(?,?,0)
              ON CONFLICT(product_id,store_id) DO NOTHING`).run(productId, storeId);
  db.prepare('UPDATE stock SET qty = qty + ? WHERE product_id = ? AND store_id = ?').run(qty, productId, storeId);
  db.prepare(`INSERT INTO stock_moves(product_id,store_id,kind,qty,ref_type,ref_id,user_id,note)
              VALUES(?,?,?,?,?,?,?,?)`).run(productId, storeId, kind, qty, refType, refId, userId, note);
  return getQty(productId, storeId);
}

/** Produtos abaixo (ou no limite) do estoque minimo, opcionalmente filtrado por lojas. */
export function lowStockList(storeIds = null) {
  const cfg = getSetting('notificacoes', { percentual_alerta: 100 }) || {};
  const fator = Math.max(0.1, Number(cfg.percentual_alerta ?? 100) / 100);
  let sql = `SELECT p.id AS product_id, p.name AS product_name, p.sku, p.unit, p.min_stock,
                    s.store_id, st.name AS store_name, st.kind AS store_kind, s.qty
               FROM stock s
               JOIN products p ON p.id = s.product_id
               JOIN stores st ON st.id = s.store_id
              WHERE p.active = 1 AND st.active = 1 AND p.min_stock > 0
                AND s.qty <= p.min_stock * ?`;
  const params = [fator];
  if (storeIds && storeIds.length) {
    sql += ` AND s.store_id IN (${storeIds.map(() => '?').join(',')})`;
    params.push(...storeIds);
  }
  sql += ' ORDER BY (s.qty / NULLIF(p.min_stock,0)) ASC, p.name';
  return db.prepare(sql).all(...params);
}
