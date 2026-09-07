import { db, getSetting } from '../db.js';
import { isMaster, allowedStoreIds } from '../lib/auth.js';
import { ok, created, fail, str, num } from '../lib/http.js';
import { whatsappNumber } from './customers.js';
import { pushNotification } from '../lib/notify.js';

const AUDIENCIAS = ['todos', 'loja', 'compraram', 'inativos', 'selecao'];

/** Resolve os clientes-alvo de acordo com a audiencia escolhida. */
function selecionarClientes({ audience, storeId, days, ids, allowedStores }) {
  const inList = allowedStores.length ? allowedStores : [-1];
  const ph = inList.map(() => '?').join(',');
  const base = `SELECT c.id, c.name, c.phone, c.city FROM customers c
                 WHERE c.active = 1 AND c.phone IS NOT NULL AND c.phone <> ''
                   AND (c.store_id IS NULL OR c.store_id IN (${ph}))`;
  if (audience === 'selecao') {
    const lista = (ids || []).map(Number).filter(Boolean);
    if (!lista.length) return [];
    return db.prepare(`${base} AND c.id IN (${lista.map(() => '?').join(',')})`).all(...inList, ...lista);
  }
  if (audience === 'loja' && storeId) {
    return db.prepare(`${base} AND c.store_id = ?`).all(...inList, storeId);
  }
  if (audience === 'compraram') {
    return db.prepare(`${base} AND EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id AND s.status='concluida'
                          AND s.created_at >= datetime('now', ?))`).all(...inList, `-${num(days, 60)} days`);
  }
  if (audience === 'inativos') {
    return db.prepare(`${base} AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.customer_id = c.id AND s.status='concluida'
                          AND s.created_at >= datetime('now', ?))`).all(...inList, `-${num(days, 60)} days`);
  }
  return db.prepare(base).all(...inList);
}

/** Substitui as variaveis do template pela informacao do cliente. */
export function renderMessage(template, cliente, empresa) {
  const primeiro = (cliente.name || '').split(' ')[0];
  return String(template)
    .replaceAll('{{nome}}', primeiro || 'cliente')
    .replaceAll('{{nome_completo}}', cliente.name || 'cliente')
    .replaceAll('{{cidade}}', cliente.city || '')
    .replaceAll('{{loja}}', empresa?.nome || 'Loja das Argamassas');
}

/** Marca campanhas cuja data agendada ja passou como prontas para disparo. */
export function ativarCampanhasVencidas() {
  const vencidas = db.prepare(`SELECT * FROM campaigns WHERE status='agendada' AND scheduled_at IS NOT NULL
                                 AND datetime(scheduled_at) <= datetime('now')`).all();
  for (const c of vencidas) {
    db.prepare("UPDATE campaigns SET status='em_andamento' WHERE id = ?").run(c.id);
    const pend = db.prepare("SELECT COUNT(*) n FROM campaign_targets WHERE campaign_id = ? AND status='pendente'").get(c.id).n;
    pushNotification({
      storeId: c.store_id, kind: 'campanha',
      title: `Campanha "${c.name}" pronta para envio`,
      body: `${pend} cliente(s) na fila. Abra o menu WhatsApp para disparar as mensagens.`,
      link: '#/whatsapp', dedupKey: `camp:${c.id}`
    });
  }
  return vencidas.length;
}

export default {
  'GET /api/campanhas': async (ctx) => {
    ativarCampanhasVencidas();
    const stores = allowedStoreIds(ctx.user);
    const inList = stores.length ? stores : [-1];
    const rows = db.prepare(`
      SELECT c.*, st.name AS store_name, u.name AS user_name,
             (SELECT COUNT(*) FROM campaign_targets t WHERE t.campaign_id = c.id) AS total,
             (SELECT COUNT(*) FROM campaign_targets t WHERE t.campaign_id = c.id AND t.status='enviada') AS enviadas
        FROM campaigns c LEFT JOIN stores st ON st.id = c.store_id LEFT JOIN users u ON u.id = c.user_id
       WHERE c.store_id IS NULL OR c.store_id IN (${inList.map(() => '?').join(',')})
       ORDER BY c.id DESC LIMIT 100`).all(...inList);
    return ok(ctx.res, { campanhas: rows });
  },

  'POST /api/campanhas': async (ctx) => {
    const name = str(ctx.body.name), message = str(ctx.body.message);
    if (!name) fail(400, 'Informe o nome da campanha');
    if (!message) fail(400, 'Escreva a mensagem que sera enviada');
    const audience = AUDIENCIAS.includes(ctx.body.audience) ? ctx.body.audience : 'todos';
    const storeId = isMaster(ctx.user) ? (Number(ctx.body.store_id) || null) : ctx.user.store_id;
    const days = num(ctx.body.days, 60);
    const clientes = selecionarClientes({ audience, storeId, days, ids: ctx.body.customer_ids, allowedStores: allowedStoreIds(ctx.user) });
    if (!clientes.length) fail(400, 'Nenhum cliente com telefone encontrado para esta audiencia');

    const agendada = str(ctx.body.scheduled_at) || null;
    const status = agendada && new Date(agendada) > new Date() ? 'agendada' : 'em_andamento';

    db.exec('BEGIN');
    let id;
    try {
      id = Number(db.prepare(`INSERT INTO campaigns(name,message,audience,store_id,days,scheduled_at,status,user_id)
                              VALUES(?,?,?,?,?,?,?,?)`)
        .run(name, message, audience, storeId, days, agendada, status, ctx.user.id).lastInsertRowid);
      const ins = db.prepare('INSERT INTO campaign_targets(campaign_id,customer_id) VALUES(?,?)');
      for (const c of clientes) ins.run(id, c.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return created(ctx.res, { id, destinatarios: clientes.length, status });
  },

  'GET /api/campanhas/previa': async (ctx) => {
    const audience = AUDIENCIAS.includes(ctx.query.audience) ? ctx.query.audience : 'todos';
    const storeId = isMaster(ctx.user) ? (Number(ctx.query.store_id) || null) : ctx.user.store_id;
    const clientes = selecionarClientes({ audience, storeId, days: num(ctx.query.days, 60), ids: [], allowedStores: allowedStoreIds(ctx.user) });
    return ok(ctx.res, { total: clientes.length, exemplos: clientes.slice(0, 5).map(c => c.name) });
  },

  'GET /api/campanhas/:id': async (ctx) => {
    const id = Number(ctx.params.id);
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
    if (!c) fail(404, 'Campanha nao encontrada');
    if (c.store_id && !allowedStoreIds(ctx.user).includes(c.store_id)) fail(403, 'Campanha de outra loja');
    const empresa = getSetting('empresa', {});
    const alvos = db.prepare(`SELECT t.id AS target_id, t.status, t.sent_at, cu.id AS customer_id, cu.name, cu.phone, cu.city
                                FROM campaign_targets t JOIN customers cu ON cu.id = t.customer_id
                               WHERE t.campaign_id = ? ORDER BY t.status='enviada', cu.name`).all(id);
    const destinatarios = alvos.map(a => {
      const texto = renderMessage(c.message, a, empresa);
      const numero = whatsappNumber(a.phone);
      return { ...a, whatsapp: numero, mensagem: texto,
               link: numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : null };
    });
    return ok(ctx.res, { campanha: c, destinatarios });
  },

  'POST /api/campanhas/:id/enviado': async (ctx) => {
    const id = Number(ctx.params.id);
    const targetId = Number(ctx.body.target_id);
    const t = db.prepare('SELECT * FROM campaign_targets WHERE id = ? AND campaign_id = ?').get(targetId, id);
    if (!t) fail(404, 'Destinatario nao encontrado');
    db.prepare("UPDATE campaign_targets SET status='enviada', sent_at=datetime('now') WHERE id = ?").run(targetId);
    const pend = db.prepare("SELECT COUNT(*) n FROM campaign_targets WHERE campaign_id = ? AND status='pendente'").get(id).n;
    if (!pend) db.prepare("UPDATE campaigns SET status='concluida' WHERE id = ?").run(id);
    return ok(ctx.res, { pendentes: pend });
  },

  'PUT /api/campanhas/:id': async (ctx) => {
    const id = Number(ctx.params.id);
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
    if (!c) fail(404, 'Campanha nao encontrada');
    if (c.store_id && !allowedStoreIds(ctx.user).includes(c.store_id)) fail(403, 'Campanha de outra loja');
    const status = ['rascunho', 'agendada', 'em_andamento', 'concluida', 'cancelada'].includes(ctx.body.status) ? ctx.body.status : c.status;
    db.prepare('UPDATE campaigns SET name=?, message=?, scheduled_at=?, status=? WHERE id=?')
      .run(str(ctx.body.name, c.name), str(ctx.body.message, c.message),
           ctx.body.scheduled_at !== undefined ? (str(ctx.body.scheduled_at) || null) : c.scheduled_at, status, id);
    return ok(ctx.res);
  },

  'DELETE /api/campanhas/:id': async (ctx) => {
    const id = Number(ctx.params.id);
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
    if (!c) fail(404, 'Campanha nao encontrada');
    if (c.store_id && !allowedStoreIds(ctx.user).includes(c.store_id)) fail(403, 'Campanha de outra loja');
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
    return ok(ctx.res);
  }
};
