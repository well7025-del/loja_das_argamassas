import { db, getSetting } from '../db.js';
import { isMaster, allowedStoreIds, resolveStoreFilter } from '../lib/auth.js';
import { ok, created, fail, str, num } from '../lib/http.js';
import { applyMove, getQty } from '../lib/stock.js';
import { checkLowStock, pushNotification } from '../lib/notify.js';
import { saveImage } from '../lib/files.js';
import { whatsappNumber } from './customers.js';

const PAGAMENTOS = ['dinheiro', 'pix', 'debito', 'credito', 'boleto', 'prazo'];
const brl = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
const dataBR = (iso) => {
  const d = new Date((iso || '').replace(' ', 'T') + (String(iso).includes('Z') ? '' : 'Z'));
  return isNaN(d) ? String(iso) : d.toLocaleString('pt-BR', { timeZone: 'America/Recife' });
};

function nextCode(storeId) {
  const store = db.prepare('SELECT code FROM stores WHERE id = ?').get(storeId);
  const seq = db.prepare('SELECT COUNT(*) n FROM sales WHERE store_id = ?').get(storeId).n + 1;
  return `${(store?.code || 'LJ').slice(0, 3)}-${String(seq).padStart(5, '0')}`;
}

function saleDetail(id) {
  const venda = db.prepare(`
    SELECT s.*, st.name AS store_name, st.phone AS store_phone, u.name AS user_name,
           c.name AS customer_name, c.phone AS customer_phone, c.cep AS customer_cep,
           c.city AS customer_city, c.uf AS customer_uf
      FROM sales s
      JOIN stores st ON st.id = s.store_id
      LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.id = ?`).get(id);
  if (!venda) return null;
  venda.itens = db.prepare(`SELECT si.*, p.name AS product_name, p.sku, p.unit
                              FROM sale_items si JOIN products p ON p.id = si.product_id
                             WHERE si.sale_id = ?`).all(id);
  return venda;
}

/** Texto do comprovante pronto para envio no WhatsApp. */
export function receiptText(venda) {
  const empresa = getSetting('empresa', { nome: 'Loja das Argamassas' });
  const linhas = [
    `*${empresa.nome || 'Loja das Argamassas'}*`,
    `${venda.store_name}${venda.store_phone ? ' - ' + venda.store_phone : ''}`,
    '',
    `*Comprovante de venda ${venda.code}*`,
    `Data: ${dataBR(venda.created_at)}`,
    venda.customer_name ? `Cliente: ${venda.customer_name}` : null,
    `Vendedor: ${venda.user_name || '-'}`,
    '',
    ...venda.itens.map(i => `• ${i.qty}x ${i.product_name} — ${brl(i.total)}`),
    '',
    venda.discount > 0 ? `Subtotal: ${brl(venda.subtotal)}` : null,
    venda.discount > 0 ? `Desconto: -${brl(venda.discount)}` : null,
    `*Total: ${brl(venda.total)}*`,
    `Pagamento: ${venda.payment_method.toUpperCase()}`,
    venda.note ? `Obs.: ${venda.note}` : null,
    '',
    'Obrigado pela preferencia!'
  ];
  return linhas.filter(l => l !== null).join('\n');
}

export default {
  'GET /api/vendas': async (ctx) => {
    const stores = resolveStoreFilter(ctx.user, ctx.query.store_id);
    const inList = stores.length ? stores : [-1];
    const params = [...inList];
    let sql = `
      SELECT s.id, s.code, s.total, s.subtotal, s.discount, s.payment_method, s.status, s.proof_path, s.created_at, s.note,
             ${isMaster(ctx.user) ? 's.profit, s.cost_total,' : ''}
             st.name AS store_name, u.name AS user_name, c.name AS customer_name, c.phone AS customer_phone
        FROM sales s
        JOIN stores st ON st.id = s.store_id
        LEFT JOIN users u ON u.id = s.user_id
        LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.store_id IN (${inList.map(() => '?').join(',')})`;
    if (ctx.query.from) { sql += " AND date(s.created_at) >= date(?)"; params.push(ctx.query.from); }
    if (ctx.query.to) { sql += " AND date(s.created_at) <= date(?)"; params.push(ctx.query.to); }
    if (ctx.query.customer_id) { sql += ' AND s.customer_id = ?'; params.push(Number(ctx.query.customer_id)); }
    if (ctx.query.payment_method) { sql += ' AND s.payment_method = ?'; params.push(ctx.query.payment_method); }
    if (ctx.query.q) { sql += ' AND (s.code LIKE ? OR c.name LIKE ?)'; params.push(`%${ctx.query.q}%`, `%${ctx.query.q}%`); }
    sql += ' ORDER BY s.id DESC LIMIT ?';
    params.push(Math.min(500, Number(ctx.query.limit) || 100));
    const vendas = db.prepare(sql).all(...params);
    const total = vendas.filter(v => v.status === 'concluida').reduce((a, v) => a + v.total, 0);
    return ok(ctx.res, { vendas, total: Number(total.toFixed(2)) });
  },

  'GET /api/vendas/:id': async (ctx) => {
    const venda = saleDetail(Number(ctx.params.id));
    if (!venda) fail(404, 'Venda nao encontrada');
    if (!allowedStoreIds(ctx.user).includes(venda.store_id)) fail(403, 'Venda de outra loja');
    if (!isMaster(ctx.user)) { delete venda.profit; delete venda.cost_total; venda.itens.forEach(i => delete i.unit_cost); }
    return ok(ctx.res, { venda, recibo: receiptText(venda), whatsapp: whatsappNumber(venda.customer_phone) });
  },

  'POST /api/vendas': async (ctx) => {
    const storeId = Number(ctx.body.store_id) || ctx.user.store_id;
    if (!storeId) fail(400, 'Selecione a loja da venda');
    if (!allowedStoreIds(ctx.user).includes(storeId)) fail(403, 'Voce nao tem acesso a esta loja');
    const loja = db.prepare('SELECT * FROM stores WHERE id = ? AND active = 1').get(storeId);
    if (!loja) fail(400, 'Loja invalida');
    if (loja.kind === 'fabrica') fail(400, 'A fabrica nao realiza vendas no PDV. Selecione uma loja.');

    const itens = Array.isArray(ctx.body.itens) ? ctx.body.itens : [];
    if (!itens.length) fail(400, 'Adicione ao menos um produto ao pedido');
    const pagamento = PAGAMENTOS.includes(ctx.body.payment_method) ? ctx.body.payment_method : 'dinheiro';
    let customerId = ctx.body.customer_id ? Number(ctx.body.customer_id) : null;
    if (customerId && !db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId)) fail(400, 'Cliente nao encontrado');

    // valida estoque e monta linhas
    const linhas = [];
    for (const it of itens) {
      const pid = Number(it.product_id), q = num(it.qty);
      if (!pid || q <= 0) fail(400, 'Quantidade invalida no pedido');
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(pid);
      if (!p) fail(400, 'Produto invalido no pedido');
      const disp = getQty(pid, storeId);
      if (disp < q) fail(400, `Estoque insuficiente de "${p.name}": disponivel ${disp} ${p.unit}`);
      // o preco unitario so pode ser alterado pelo master (desconto por item)
      const preco = (isMaster(ctx.user) && it.unit_price !== undefined) ? num(it.unit_price) : p.sale_price;
      linhas.push({ product_id: pid, qty: q, unit_price: preco, unit_cost: p.cost_price, total: Number((preco * q).toFixed(2)), nome: p.name });
    }

    const subtotal = Number(linhas.reduce((a, l) => a + l.total, 0).toFixed(2));
    const desconto = Math.min(subtotal, Math.max(0, num(ctx.body.discount)));
    const total = Number((subtotal - desconto).toFixed(2));
    const custo = Number(linhas.reduce((a, l) => a + l.unit_cost * l.qty, 0).toFixed(2));
    const lucro = Number((total - custo).toFixed(2));
    const proof = ctx.body.proof_data ? await saveImage(ctx.body.proof_data, 'comprovante') : null;

    db.exec('BEGIN');
    let saleId;
    try {
      const code = nextCode(storeId);
      saleId = Number(db.prepare(`INSERT INTO sales(code,store_id,user_id,customer_id,subtotal,discount,total,cost_total,profit,payment_method,proof_path,note)
                                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(code, storeId, ctx.user.id, customerId, subtotal, desconto, total, custo, lucro, pagamento, proof, str(ctx.body.note)).lastInsertRowid);

      const insItem = db.prepare('INSERT INTO sale_items(sale_id,product_id,qty,unit_price,unit_cost,total) VALUES(?,?,?,?,?,?)');
      for (const l of linhas) {
        insItem.run(saleId, l.product_id, l.qty, l.unit_price, l.unit_cost, l.total);
        applyMove({ productId: l.product_id, storeId, kind: 'venda', qty: -l.qty, refType: 'venda', refId: saleId,
                    userId: ctx.user.id, note: `Venda ${code}` });
      }

      if (pagamento === 'dinheiro') {
        db.prepare(`INSERT INTO cash_movements(store_id,kind,amount,description,ref_type,ref_id,user_id)
                    VALUES(?,'venda',?,?,'venda',?,?)`)
          .run(storeId, total, `Venda ${code}`, saleId, ctx.user.id);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }

    for (const l of linhas) checkLowStock(l.product_id, storeId);

    const cfg = getSetting('notificacoes', {});
    if (pagamento === 'dinheiro' && cfg.alerta_caixa_alto > 0) {
      const saldo = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM cash_movements WHERE store_id = ?').get(storeId).s;
      if (saldo >= cfg.alerta_caixa_alto) {
        pushNotification({ storeId, kind: 'caixa_alto', title: 'Caixa acima do limite',
          body: `O caixa de ${loja.name} esta em ${brl(saldo)}. Considere registrar um deposito para a matriz.`,
          link: '#/caixa', dedupKey: `caixa:${storeId}:${new Date().toISOString().slice(0, 10)}` });
      }
    }

    const venda = saleDetail(saleId);
    return created(ctx.res, { venda, recibo: receiptText(venda), whatsapp: whatsappNumber(venda.customer_phone) });
  },

  'POST /api/vendas/:id/comprovante': async (ctx) => {
    const id = Number(ctx.params.id);
    const venda = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!venda) fail(404, 'Venda nao encontrada');
    if (!allowedStoreIds(ctx.user).includes(venda.store_id)) fail(403, 'Venda de outra loja');
    const path = await saveImage(ctx.body.proof_data, 'comprovante');
    if (!path) fail(400, 'Envie a imagem do comprovante');
    db.prepare('UPDATE sales SET proof_path = ? WHERE id = ?').run(path, id);
    return ok(ctx.res, { proof_path: path });
  },

  'GET /api/vendas/:id/recibo': async (ctx) => {
    const venda = saleDetail(Number(ctx.params.id));
    if (!venda) fail(404, 'Venda nao encontrada');
    if (!allowedStoreIds(ctx.user).includes(venda.store_id)) fail(403, 'Venda de outra loja');
    const texto = receiptText(venda);
    const numero = whatsappNumber(venda.customer_phone);
    return ok(ctx.res, {
      recibo: texto,
      whatsapp: numero,
      link: numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
                   : `https://wa.me/?text=${encodeURIComponent(texto)}`
    });
  },

  'POST /api/vendas/:id/cancelar': async (ctx) => {
    if (!isMaster(ctx.user)) fail(403, 'Apenas o usuario master pode cancelar uma venda');
    const id = Number(ctx.params.id);
    const venda = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!venda) fail(404, 'Venda nao encontrada');
    if (venda.status === 'cancelada') fail(400, 'Esta venda ja foi cancelada');

    db.exec('BEGIN');
    try {
      for (const it of db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id)) {
        applyMove({ productId: it.product_id, storeId: venda.store_id, kind: 'devolucao', qty: it.qty,
                    refType: 'cancelamento', refId: id, userId: ctx.user.id, note: `Cancelamento da venda ${venda.code}` });
      }
      if (venda.payment_method === 'dinheiro') {
        db.prepare(`INSERT INTO cash_movements(store_id,kind,amount,description,ref_type,ref_id,user_id)
                    VALUES(?,'ajuste',?,?,'cancelamento',?,?)`)
          .run(venda.store_id, -venda.total, `Estorno da venda ${venda.code}`, id, ctx.user.id);
      }
      db.prepare("UPDATE sales SET status = 'cancelada' WHERE id = ?").run(id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return ok(ctx.res);
  }
};
