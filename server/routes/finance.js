import { db } from '../db.js';
import { isMaster, allowedStoreIds, resolveStoreFilter } from '../lib/auth.js';
import { ok, created, fail, str, num } from '../lib/http.js';

export const CATEGORIAS_DESPESA = [
  'aluguel', 'salario', 'comissao', 'internet', 'impostos', 'agua', 'energia',
  'telefone', 'frete', 'combustivel', 'manutencao', 'marketing', 'fornecedor',
  'material_escritorio', 'contabilidade', 'outros'
];
const FORMAS = ['dinheiro', 'pix', 'cartao', 'boleto', 'transferencia'];

const assertStore = (ctx, storeId) => {
  if (!allowedStoreIds(ctx.user).includes(Number(storeId))) fail(403, 'Voce nao tem acesso a esta loja');
};

const brl = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');

const assertLoja = (storeId) => {
  const loja = db.prepare('SELECT kind FROM stores WHERE id = ?').get(storeId);
  if (!loja || loja.kind !== 'loja') fail(400, 'Somente lojas possuem caixa em dinheiro');
};

export default {
  'GET /api/despesas/categorias': async (ctx) => ok(ctx.res, { categorias: CATEGORIAS_DESPESA, formas: FORMAS }),

  'GET /api/despesas': async (ctx) => {
    const stores = resolveStoreFilter(ctx.user, ctx.query.store_id);
    const inList = stores.length ? stores : [-1];
    const params = [...inList];
    let sql = `SELECT d.*, st.name AS store_name, u.name AS user_name
                 FROM expenses d JOIN stores st ON st.id = d.store_id
                 LEFT JOIN users u ON u.id = d.user_id
                WHERE d.store_id IN (${inList.map(() => '?').join(',')})`;
    if (ctx.query.from) { sql += ' AND date(d.created_at) >= date(?)'; params.push(ctx.query.from); }
    if (ctx.query.to) { sql += ' AND date(d.created_at) <= date(?)'; params.push(ctx.query.to); }
    if (ctx.query.category) { sql += ' AND d.category = ?'; params.push(ctx.query.category); }
    sql += ' ORDER BY d.id DESC LIMIT 500';
    const despesas = db.prepare(sql).all(...params);
    const porCategoria = {};
    let total = 0;
    for (const d of despesas) { total += d.amount; porCategoria[d.category] = (porCategoria[d.category] || 0) + d.amount; }
    return ok(ctx.res, {
      despesas, total: Number(total.toFixed(2)),
      por_categoria: Object.entries(porCategoria).map(([categoria, valor]) => ({ categoria, valor: Number(valor.toFixed(2)) }))
        .sort((a, b) => b.valor - a.valor)
    });
  },

  'POST /api/despesas': async (ctx) => {
    const storeId = Number(ctx.body.store_id) || ctx.user.store_id;
    assertStore(ctx, storeId);
    const amount = num(ctx.body.amount);
    if (amount <= 0) fail(400, 'Informe o valor da despesa');
    const category = CATEGORIAS_DESPESA.includes(ctx.body.category) ? ctx.body.category : 'outros';
    const paidWith = FORMAS.includes(ctx.body.paid_with) ? ctx.body.paid_with : 'dinheiro';
    const competencia = str(ctx.body.competencia) || new Date().toISOString().slice(0, 7);

    if (paidWith === 'dinheiro') {
      assertLoja(storeId);
      const saldo = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM cash_movements WHERE store_id = ?').get(storeId).s;
      if (saldo < amount) {
        fail(400, `O caixa desta loja tem ${brl(saldo)} e a despesa e de ${brl(amount)}. Registre um suprimento de caixa ou lance a despesa com outra forma de pagamento.`);
      }
    }

    db.exec('BEGIN');
    let id;
    try {
      id = Number(db.prepare(`INSERT INTO expenses(store_id,category,description,amount,paid_with,competencia,due_date,paid_at,user_id)
                              VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(storeId, category, str(ctx.body.description), amount, paidWith, competencia,
             str(ctx.body.due_date) || null, str(ctx.body.paid_at) || new Date().toISOString().slice(0, 10), ctx.user.id).lastInsertRowid);
      if (paidWith === 'dinheiro') {
        db.prepare(`INSERT INTO cash_movements(store_id,kind,amount,description,ref_type,ref_id,user_id)
                    VALUES(?,'despesa',?,?,'despesa',?,?)`)
          .run(storeId, -amount, `${category}${ctx.body.description ? ' - ' + str(ctx.body.description) : ''}`, id, ctx.user.id);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return created(ctx.res, { id });
  },

  'DELETE /api/despesas/:id': async (ctx) => {
    const id = Number(ctx.params.id);
    const d = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    if (!d) fail(404, 'Despesa nao encontrada');
    assertStore(ctx, d.store_id);
    db.exec('BEGIN');
    try {
      if (d.paid_with === 'dinheiro') {
        db.prepare(`INSERT INTO cash_movements(store_id,kind,amount,description,ref_type,ref_id,user_id)
                    VALUES(?,'ajuste',?,?,'estorno_despesa',?,?)`)
          .run(d.store_id, d.amount, `Estorno de despesa #${id}`, id, ctx.user.id);
      }
      db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return ok(ctx.res);
  },

  /* ---------------- Caixa por loja ---------------- */
  'GET /api/caixa': async (ctx) => {
    const stores = resolveStoreFilter(ctx.user, ctx.query.store_id);
    const inList = stores.length ? stores : [-1];
    const saldos = db.prepare(`
      SELECT st.id AS store_id, st.name AS store_name,
             COALESCE(SUM(cm.amount),0) AS saldo,
             COALESCE(SUM(CASE WHEN date(cm.created_at)=date('now','localtime') AND cm.amount>0 THEN cm.amount END),0) AS entradas_hoje,
             COALESCE(SUM(CASE WHEN date(cm.created_at)=date('now','localtime') AND cm.amount<0 THEN -cm.amount END),0) AS saidas_hoje
        FROM stores st LEFT JOIN cash_movements cm ON cm.store_id = st.id
       WHERE st.id IN (${inList.map(() => '?').join(',')}) AND st.active = 1 AND st.kind = 'loja'
       GROUP BY st.id ORDER BY st.name`).all(...inList);

    const params = [...inList];
    let sql = `SELECT cm.*, st.name AS store_name, u.name AS user_name
                 FROM cash_movements cm JOIN stores st ON st.id = cm.store_id
                 LEFT JOIN users u ON u.id = cm.user_id
                WHERE cm.store_id IN (${inList.map(() => '?').join(',')})`;
    if (ctx.query.from) { sql += ' AND date(cm.created_at) >= date(?)'; params.push(ctx.query.from); }
    if (ctx.query.to) { sql += ' AND date(cm.created_at) <= date(?)'; params.push(ctx.query.to); }
    sql += ' ORDER BY cm.id DESC LIMIT 300';
    const movimentos = db.prepare(sql).all(...params);

    const depositos = db.prepare(`SELECT COALESCE(SUM(-amount),0) t FROM cash_movements
                                   WHERE kind='deposito_matriz' AND store_id IN (${inList.map(() => '?').join(',')})`).get(...inList).t;
    return ok(ctx.res, {
      saldos, movimentos,
      saldo_total: Number(saldos.reduce((a, s) => a + s.saldo, 0).toFixed(2)),
      depositos_matriz: Number(depositos.toFixed(2))
    });
  },

  'POST /api/caixa/movimento': async (ctx) => {
    const storeId = Number(ctx.body.store_id) || ctx.user.store_id;
    assertStore(ctx, storeId);
    assertLoja(storeId);
    const tipo = ['deposito_matriz', 'sangria', 'suprimento', 'ajuste'].includes(ctx.body.kind) ? ctx.body.kind : null;
    if (!tipo) fail(400, 'Tipo de movimento invalido');
    const valor = num(ctx.body.amount);
    if (valor <= 0) fail(400, 'Informe um valor maior que zero');
    const saldo = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM cash_movements WHERE store_id = ?').get(storeId).s;
    const assinado = tipo === 'suprimento' ? valor : -valor;
    if (assinado < 0 && saldo < valor) fail(400, `Saldo do caixa insuficiente. Disponivel: ${brl(saldo)}`);
    const descricoes = { deposito_matriz: 'Deposito para a matriz', sangria: 'Sangria de caixa', suprimento: 'Suprimento de caixa', ajuste: 'Ajuste de caixa' };
    const r = db.prepare(`INSERT INTO cash_movements(store_id,kind,amount,description,ref_type,user_id) VALUES(?,?,?,?,?,?)`)
      .run(storeId, tipo, assinado, str(ctx.body.description) || descricoes[tipo], 'manual', ctx.user.id);
    const novo = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM cash_movements WHERE store_id = ?').get(storeId).s;
    return created(ctx.res, { id: Number(r.lastInsertRowid), saldo: Number(novo.toFixed(2)) });
  }
};
