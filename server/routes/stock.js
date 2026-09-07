import { db } from '../db.js';
import { isMaster, allowedStoreIds, resolveStoreFilter } from '../lib/auth.js';
import { ok, created, fail, str, num } from '../lib/http.js';
import { applyMove, getQty, lowStockList } from '../lib/stock.js';
import { checkLowStock } from '../lib/notify.js';

const requireMaster = (ctx, msg) => { if (!isMaster(ctx.user)) fail(403, msg || 'Apenas o usuario master pode executar esta acao'); };

function assertStoreAccess(ctx, storeId) {
  if (!allowedStoreIds(ctx.user).includes(Number(storeId))) fail(403, 'Voce nao tem acesso a esta loja');
}

export default {
  /* ---------- Posicao de estoque ---------- */
  'GET /api/estoque': async (ctx) => {
    const stores = resolveStoreFilter(ctx.user, ctx.query.store_id);
    const inList = stores.length ? stores : [-1];
    const busca = str(ctx.query.q);
    let sql = `
      SELECT p.id AS product_id, p.sku, p.name, p.unit, p.min_stock, p.sale_price, p.cost_price,
             st.id AS store_id, st.name AS store_name, st.kind AS store_kind,
             COALESCE(s.qty,0) AS qty,
             CASE WHEN p.min_stock > 0 AND COALESCE(s.qty,0) <= p.min_stock THEN 1 ELSE 0 END AS abaixo_minimo
        FROM products p
        CROSS JOIN stores st
        LEFT JOIN stock s ON s.product_id = p.id AND s.store_id = st.id
       WHERE p.active = 1 AND st.active = 1 AND st.id IN (${inList.map(() => '?').join(',')})`;
    const params = [...inList];
    if (busca) { sql += ' AND (p.name LIKE ? OR p.sku LIKE ?)'; params.push(`%${busca}%`, `%${busca}%`); }
    if (ctx.query.somente_alerta === '1') sql += ' AND p.min_stock > 0 AND COALESCE(s.qty,0) <= p.min_stock';
    sql += ' ORDER BY st.kind DESC, st.name, p.name';
    const rows = db.prepare(sql).all(...params);
    const itens = isMaster(ctx.user) ? rows : rows.map(({ cost_price, ...r }) => r);
    const totalValor = rows.reduce((a, r) => a + r.qty * (isMaster(ctx.user) ? r.cost_price : 0), 0);
    return ok(ctx.res, { itens, valor_custo_total: Number(totalValor.toFixed(2)), alertas: rows.filter(r => r.abaixo_minimo).length });
  },

  'GET /api/estoque/alertas': async (ctx) =>
    ok(ctx.res, { alertas: lowStockList(resolveStoreFilter(ctx.user, ctx.query.store_id)) }),

  'GET /api/estoque/movimentos': async (ctx) => {
    const stores = resolveStoreFilter(ctx.user, ctx.query.store_id);
    const inList = stores.length ? stores : [-1];
    const limit = Math.min(500, Number(ctx.query.limit) || 100);
    const rows = db.prepare(`
      SELECT m.*, p.name AS product_name, p.sku, p.unit, st.name AS store_name, u.name AS user_name
        FROM stock_moves m
        JOIN products p ON p.id = m.product_id
        JOIN stores st ON st.id = m.store_id
        LEFT JOIN users u ON u.id = m.user_id
       WHERE m.store_id IN (${inList.map(() => '?').join(',')})
       ORDER BY m.id DESC LIMIT ?`).all(...inList, limit);
    return ok(ctx.res, { movimentos: rows });
  },

  'POST /api/estoque/ajuste': async (ctx) => {
    const storeId = Number(ctx.body.store_id);
    const productId = Number(ctx.body.product_id);
    const qty = num(ctx.body.qty);
    assertStoreAccess(ctx, storeId);
    if (!productId || !qty) fail(400, 'Informe o produto e a quantidade do ajuste');
    const atual = getQty(productId, storeId);
    if (atual + qty < 0) fail(400, `Ajuste deixaria o estoque negativo (disponivel: ${atual})`);
    applyMove({ productId, storeId, kind: 'ajuste', qty, refType: 'ajuste', userId: ctx.user.id, note: str(ctx.body.note, 'Ajuste manual') });
    checkLowStock(productId, storeId);
    return ok(ctx.res, { saldo: getQty(productId, storeId) });
  },

  /* ---------- Producao na fabrica ---------- */
  'GET /api/producao': async (ctx) => {
    requireMaster(ctx, 'Somente o usuario master acompanha a producao da fabrica');
    const rows = db.prepare(`
      SELECT pr.*, st.name AS store_name, u.name AS user_name
        FROM productions pr JOIN stores st ON st.id = pr.store_id
        LEFT JOIN users u ON u.id = pr.user_id
       ORDER BY pr.id DESC LIMIT 100`).all();
    const itens = db.prepare(`SELECT pi.*, p.name AS product_name, p.unit, p.sku FROM production_items pi
                              JOIN products p ON p.id = pi.product_id WHERE pi.production_id = ?`);
    return ok(ctx.res, { producoes: rows.map(r => ({ ...r, itens: itens.all(r.id) })) });
  },

  'POST /api/producao': async (ctx) => {
    requireMaster(ctx, 'Somente o usuario master lanca producao da fabrica');
    const storeId = Number(ctx.body.store_id);
    const fabrica = db.prepare(`SELECT * FROM stores WHERE id = ? AND active = 1`).get(storeId);
    if (!fabrica) fail(400, 'Selecione a fabrica de destino');
    if (fabrica.kind !== 'fabrica') fail(400, 'A producao so pode ser lancada em uma unidade do tipo fabrica');
    const itens = Array.isArray(ctx.body.itens) ? ctx.body.itens : [];
    if (!itens.length) fail(400, 'Adicione ao menos um produto a producao');

    db.exec('BEGIN');
    try {
      const total = itens.reduce((a, i) => a + num(i.qty), 0);
      const prodId = Number(db.prepare('INSERT INTO productions(store_id,user_id,lote,note,total_qty) VALUES(?,?,?,?,?)')
        .run(storeId, ctx.user.id, str(ctx.body.lote), str(ctx.body.note), total).lastInsertRowid);
      const insItem = db.prepare('INSERT INTO production_items(production_id,product_id,qty) VALUES(?,?,?)');
      for (const it of itens) {
        const pid = Number(it.product_id), q = num(it.qty);
        if (!pid || q <= 0) fail(400, 'Quantidade de producao invalida');
        insItem.run(prodId, pid, q);
        applyMove({ productId: pid, storeId, kind: 'producao', qty: q, refType: 'producao', refId: prodId,
                    userId: ctx.user.id, note: str(ctx.body.lote) ? `Lote ${str(ctx.body.lote)}` : 'Producao' });
      }
      db.exec('COMMIT');
      return created(ctx.res, { id: prodId });
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  },

  /* ---------- Transferencias entre unidades ---------- */
  'GET /api/transferencias': async (ctx) => {
    const stores = allowedStoreIds(ctx.user);
    const inList = stores.length ? stores : [-1];
    const rows = db.prepare(`
      SELECT t.*, o.name AS from_name, d.name AS to_name, u.name AS user_name
        FROM transfers t
        JOIN stores o ON o.id = t.from_store_id
        JOIN stores d ON d.id = t.to_store_id
        LEFT JOIN users u ON u.id = t.user_id
       WHERE t.from_store_id IN (${inList.map(() => '?').join(',')})
          OR t.to_store_id IN (${inList.map(() => '?').join(',')})
       ORDER BY t.id DESC LIMIT 100`).all(...inList, ...inList);
    const itens = db.prepare(`SELECT ti.*, p.name AS product_name, p.unit, p.sku FROM transfer_items ti
                              JOIN products p ON p.id = ti.product_id WHERE ti.transfer_id = ?`);
    return ok(ctx.res, { transferencias: rows.map(r => ({ ...r, itens: itens.all(r.id) })) });
  },

  'POST /api/transferencias': async (ctx) => {
    requireMaster(ctx, 'Somente o usuario master transfere estoque entre unidades');
    const from = Number(ctx.body.from_store_id), to = Number(ctx.body.to_store_id);
    if (!from || !to || from === to) fail(400, 'Selecione a origem e o destino da transferencia');
    const origem = db.prepare('SELECT * FROM stores WHERE id = ? AND active = 1').get(from);
    const destino = db.prepare('SELECT * FROM stores WHERE id = ? AND active = 1').get(to);
    if (!origem || !destino) fail(400, 'Unidade de origem ou destino invalida');
    const itens = Array.isArray(ctx.body.itens) ? ctx.body.itens : [];
    if (!itens.length) fail(400, 'Adicione ao menos um produto a transferencia');

    for (const it of itens) {
      const q = num(it.qty), pid = Number(it.product_id);
      if (!pid || q <= 0) fail(400, 'Quantidade de transferencia invalida');
      const disp = getQty(pid, from);
      if (disp < q) {
        const nome = db.prepare('SELECT name FROM products WHERE id = ?').get(pid)?.name || `#${pid}`;
        fail(400, `Estoque insuficiente de "${nome}" em ${origem.name}: disponivel ${disp}, solicitado ${q}`);
      }
    }

    db.exec('BEGIN');
    try {
      const tid = Number(db.prepare('INSERT INTO transfers(from_store_id,to_store_id,user_id,note) VALUES(?,?,?,?)')
        .run(from, to, ctx.user.id, str(ctx.body.note)).lastInsertRowid);
      const insItem = db.prepare('INSERT INTO transfer_items(transfer_id,product_id,qty) VALUES(?,?,?)');
      for (const it of itens) {
        const pid = Number(it.product_id), q = num(it.qty);
        insItem.run(tid, pid, q);
        applyMove({ productId: pid, storeId: from, kind: 'transferencia_saida', qty: -q, refType: 'transferencia', refId: tid,
                    userId: ctx.user.id, note: `Envio para ${destino.name}` });
        applyMove({ productId: pid, storeId: to, kind: 'transferencia_entrada', qty: q, refType: 'transferencia', refId: tid,
                    userId: ctx.user.id, note: `Recebido de ${origem.name}` });
      }
      db.exec('COMMIT');
      for (const it of itens) checkLowStock(Number(it.product_id), from);
      return created(ctx.res, { id: tid });
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
};
