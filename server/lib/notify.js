import { db, getSetting } from '../db.js';
import { lowStockList } from './stock.js';

/** Cria notificacao para todos os usuarios que podem ver aquela loja e optaram por receber. */
export function pushNotification({ storeId, kind, title, body, link = null, dedupKey = null }) {
  const users = db.prepare(`
    SELECT id FROM users
     WHERE active = 1 AND notify_low_stock = 1
       AND (role = 'master' OR store_id = ?)`).all(storeId);
  const ins = db.prepare(`INSERT OR IGNORE INTO notifications(store_id,user_id,kind,title,body,link,dedup_key)
                          VALUES(?,?,?,?,?,?,?)`);
  for (const u of users) {
    ins.run(storeId, u.id, kind, title, body, link, dedupKey ? `${dedupKey}:${u.id}` : null);
  }
}

/** Verifica estoque minimo apos uma movimentacao e notifica uma vez por dia por produto/loja. */
export function checkLowStock(productId, storeId) {
  const cfg = getSetting('notificacoes', {}) || {};
  if (cfg.estoque_minimo === false) return;
  const row = db.prepare(`
    SELECT p.name, p.unit, p.min_stock, s.qty, st.name AS store_name
      FROM stock s JOIN products p ON p.id = s.product_id JOIN stores st ON st.id = s.store_id
     WHERE s.product_id = ? AND s.store_id = ?`).get(productId, storeId);
  if (!row || !row.min_stock || row.qty > row.min_stock) return;
  const dia = new Date().toISOString().slice(0, 10);
  pushNotification({
    storeId,
    kind: 'estoque_minimo',
    title: `Estoque baixo: ${row.name}`,
    body: `${row.store_name} tem ${row.qty} ${row.unit} — minimo definido: ${row.min_stock} ${row.unit}.`,
    link: '#/estoque',
    dedupKey: `low:${productId}:${storeId}:${dia}`
  });
}

/** Reavalia todo o estoque e gera as notificacoes pendentes (usado no login e por rotina). */
export function sweepLowStock() {
  for (const r of lowStockList()) checkLowStock(r.product_id, r.store_id);
}
