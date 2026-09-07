import { db } from '../db.js';
import { isMaster, resolveStoreFilter } from '../lib/auth.js';
import { ok, str } from '../lib/http.js';
import { haversineKm } from '../lib/geo.js';

/** Periodo padrao: ultimos 30 dias. */
export function periodo(query) {
  const to = str(query.to) || new Date().toISOString().slice(0, 10);
  const from = str(query.from) || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  return { from, to };
}

const round = (v) => Number((v || 0).toFixed(2));

export function resumoPeriodo(storeIds, from, to) {
  const inList = storeIds.length ? storeIds : [-1];
  const ph = inList.map(() => '?').join(',');
  const v = db.prepare(`
    SELECT COUNT(*) AS vendas, COALESCE(SUM(total),0) AS faturamento,
           COALESCE(SUM(profit),0) AS lucro_bruto, COALESCE(SUM(cost_total),0) AS custo,
           COALESCE(SUM(discount),0) AS descontos
      FROM sales
     WHERE status='concluida' AND store_id IN (${ph})
       AND date(created_at) BETWEEN date(?) AND date(?)`).get(...inList, from, to);
  const d = db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS despesas FROM expenses
     WHERE store_id IN (${ph}) AND date(created_at) BETWEEN date(?) AND date(?)`).get(...inList, from, to);
  const itens = db.prepare(`
    SELECT COALESCE(SUM(si.qty),0) AS unidades FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.status='concluida' AND s.store_id IN (${ph}) AND date(s.created_at) BETWEEN date(?) AND date(?)`).get(...inList, from, to);
  const clientes = db.prepare(`
    SELECT COUNT(DISTINCT customer_id) AS n FROM sales
     WHERE status='concluida' AND customer_id IS NOT NULL AND store_id IN (${ph})
       AND date(created_at) BETWEEN date(?) AND date(?)`).get(...inList, from, to);

  const faturamento = round(v.faturamento);
  const lucro = round(v.lucro_bruto);
  return {
    vendas: v.vendas,
    faturamento,
    custo_mercadoria: round(v.custo),
    lucro_bruto: lucro,
    margem_bruta: faturamento ? round(lucro / faturamento * 100) : 0,
    ticket_medio: v.vendas ? round(faturamento / v.vendas) : 0,
    unidades: round(itens.unidades),
    descontos: round(v.descontos),
    despesas: round(d.despesas),
    resultado: round(lucro - d.despesas),
    clientes_atendidos: clientes.n
  };
}

export default {
  'GET /api/stats/resumo': async (ctx) => {
    const stores = resolveStoreFilter(ctx.user, ctx.query.store_id);
    const inList = stores.length ? stores : [-1];
    const ph = inList.map(() => '?').join(',');
    const { from, to } = periodo(ctx.query);

    const atual = resumoPeriodo(inList, from, to);
    const dias = Math.max(1, Math.round((new Date(to) - new Date(from)) / 864e5) + 1);
    const antFrom = new Date(new Date(from).getTime() - dias * 864e5).toISOString().slice(0, 10);
    const antTo = new Date(new Date(from).getTime() - 864e5).toISOString().slice(0, 10);
    const anterior = resumoPeriodo(inList, antFrom, antTo);

    const serie = db.prepare(`
      SELECT date(created_at) AS dia, COUNT(*) AS vendas, ROUND(SUM(total),2) AS faturamento, ROUND(SUM(profit),2) AS lucro
        FROM sales WHERE status='concluida' AND store_id IN (${ph}) AND date(created_at) BETWEEN date(?) AND date(?)
       GROUP BY dia ORDER BY dia`).all(...inList, from, to);

    const pagamentos = db.prepare(`
      SELECT payment_method AS forma, COUNT(*) AS vendas, ROUND(SUM(total),2) AS valor
        FROM sales WHERE status='concluida' AND store_id IN (${ph}) AND date(created_at) BETWEEN date(?) AND date(?)
       GROUP BY forma ORDER BY valor DESC`).all(...inList, from, to);

    const porLoja = db.prepare(`
      SELECT st.id AS store_id, st.name AS store_name, COUNT(s.id) AS vendas,
             ROUND(COALESCE(SUM(s.total),0),2) AS faturamento, ROUND(COALESCE(SUM(s.profit),0),2) AS lucro
        FROM stores st LEFT JOIN sales s ON s.store_id = st.id AND s.status='concluida'
             AND date(s.created_at) BETWEEN date(?) AND date(?)
       WHERE st.id IN (${ph}) AND st.active = 1 AND st.kind = 'loja'
       GROUP BY st.id ORDER BY faturamento DESC`).all(from, to, ...inList);

    const porHora = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hora, COUNT(*) AS vendas, ROUND(SUM(total),2) AS valor
        FROM sales WHERE status='concluida' AND store_id IN (${ph}) AND date(created_at) BETWEEN date(?) AND date(?)
       GROUP BY hora ORDER BY hora`).all(...inList, from, to);

    if (!isMaster(ctx.user)) {
      delete atual.custo_mercadoria; delete anterior.custo_mercadoria;
    }
    return ok(ctx.res, { periodo: { from, to, dias }, resumo: atual, anterior, serie, pagamentos, por_loja: porLoja, por_hora: porHora });
  },

  'GET /api/stats/produtos': async (ctx) => {
    const stores = resolveStoreFilter(ctx.user, ctx.query.store_id);
    const inList = stores.length ? stores : [-1];
    const ph = inList.map(() => '?').join(',');
    const { from, to } = periodo(ctx.query);
    const rows = db.prepare(`
      SELECT p.id, p.name, p.sku, p.unit, c.name AS categoria,
             ROUND(SUM(si.qty),2) AS quantidade,
             ROUND(SUM(si.total),2) AS faturamento,
             ROUND(SUM(si.total - si.unit_cost * si.qty),2) AS lucro,
             COUNT(DISTINCT si.sale_id) AS pedidos
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        JOIN products p ON p.id = si.product_id
        LEFT JOIN categories c ON c.id = p.category_id
       WHERE s.status='concluida' AND s.store_id IN (${ph}) AND date(s.created_at) BETWEEN date(?) AND date(?)
       GROUP BY p.id ORDER BY faturamento DESC LIMIT 100`).all(...inList, from, to);

    // Curva ABC (principio de Pareto) sobre o faturamento
    const total = rows.reduce((a, r) => a + r.faturamento, 0);
    let acumulado = 0;
    const ranking = rows.map((r) => {
      acumulado += r.faturamento;
      const perc = total ? acumulado / total * 100 : 0;
      return { ...r, participacao: total ? round(r.faturamento / total * 100) : 0,
               acumulado: round(perc), curva: perc <= 80 ? 'A' : perc <= 95 ? 'B' : 'C',
               ...(isMaster(ctx.user) ? {} : { lucro: undefined }) };
    });
    const classeA = ranking.filter(r => r.curva === 'A');
    return ok(ctx.res, {
      periodo: { from, to }, ranking,
      pareto: { itens_classe_a: classeA.length, total_itens: ranking.length,
                percentual_itens: ranking.length ? round(classeA.length / ranking.length * 100) : 0,
                faturamento_classe_a: round(classeA.reduce((a, r) => a + r.faturamento, 0)) }
    });
  },

  'GET /api/stats/clientes': async (ctx) => {
    const stores = resolveStoreFilter(ctx.user, ctx.query.store_id);
    const inList = stores.length ? stores : [-1];
    const ph = inList.map(() => '?').join(',');
    const { from, to } = periodo(ctx.query);
    const ranking = db.prepare(`
      SELECT c.id, c.name, c.phone, c.city, c.uf, c.cep,
             COUNT(s.id) AS compras, ROUND(SUM(s.total),2) AS total,
             ROUND(AVG(s.total),2) AS ticket_medio, MAX(date(s.created_at)) AS ultima_compra
        FROM sales s JOIN customers c ON c.id = s.customer_id
       WHERE s.status='concluida' AND s.store_id IN (${ph}) AND date(s.created_at) BETWEEN date(?) AND date(?)
       GROUP BY c.id ORDER BY total DESC LIMIT 100`).all(...inList, from, to);
    const semCadastro = db.prepare(`
      SELECT COUNT(*) n, ROUND(COALESCE(SUM(total),0),2) valor FROM sales
       WHERE status='concluida' AND customer_id IS NULL AND store_id IN (${ph})
         AND date(created_at) BETWEEN date(?) AND date(?)`).get(...inList, from, to);
    const novos = db.prepare(`
      SELECT COUNT(*) n FROM customers WHERE date(created_at) BETWEEN date(?) AND date(?)
        AND (store_id IS NULL OR store_id IN (${ph}))`).get(from, to, ...inList);
    return ok(ctx.res, { periodo: { from, to }, ranking, vendas_sem_cliente: semCadastro, novos_clientes: novos.n });
  },

  /**
   * Mapa de calor das vendas: agrupa clientes atendidos no periodo pela coordenada
   * aproximada do CEP e calcula densidade por km2.
   */
  'GET /api/stats/mapa': async (ctx) => {
    const stores = resolveStoreFilter(ctx.user, ctx.query.store_id);
    const inList = stores.length ? stores : [-1];
    const ph = inList.map(() => '?').join(',');
    const { from, to } = periodo(ctx.query);

    const pontos = db.prepare(`
      SELECT c.id, c.name, c.cep, c.city, c.uf, c.district, c.lat, c.lng,
             COUNT(s.id) AS compras, ROUND(SUM(s.total),2) AS total
        FROM sales s JOIN customers c ON c.id = s.customer_id
       WHERE s.status='concluida' AND s.store_id IN (${ph})
         AND date(s.created_at) BETWEEN date(?) AND date(?)
         AND c.lat IS NOT NULL AND c.lng IS NOT NULL
       GROUP BY c.id ORDER BY total DESC`).all(...inList, from, to);

    const lojas = db.prepare(`SELECT id, name, cep, city, uf FROM stores WHERE id IN (${ph}) AND active = 1`).all(...inList);

    // Grade de ~1 km para medir concentracao
    const CELL_KM = Number(ctx.query.celula_km) || 1;
    const cells = new Map();
    for (const p of pontos) {
      const latStep = CELL_KM / 111;
      const lngStep = CELL_KM / (111 * Math.cos(p.lat * Math.PI / 180) || 1);
      const key = `${Math.floor(p.lat / latStep)}:${Math.floor(p.lng / lngStep)}`;
      const cur = cells.get(key) || { lat: 0, lng: 0, clientes: 0, compras: 0, total: 0 };
      cur.lat += p.lat; cur.lng += p.lng; cur.clientes += 1; cur.compras += p.compras; cur.total += p.total;
      cells.set(key, cur);
    }
    const grade = [...cells.values()].map(c => ({
      lat: c.lat / c.clientes, lng: c.lng / c.clientes,
      clientes: c.clientes, compras: c.compras, total: round(c.total),
      densidade_clientes_km2: round(c.clientes / (CELL_KM * CELL_KM)),
      densidade_faturamento_km2: round(c.total / (CELL_KM * CELL_KM))
    })).sort((a, b) => b.total - a.total);

    // Area de cobertura pela caixa envolvente dos pontos
    let area = 0, raioMedio = null, centro = null;
    if (pontos.length) {
      const lats = pontos.map(p => p.lat), lngs = pontos.map(p => p.lng);
      const min = { lat: Math.min(...lats), lng: Math.min(...lngs) };
      const max = { lat: Math.max(...lats), lng: Math.max(...lngs) };
      const alturaKm = haversineKm({ lat: min.lat, lng: min.lng }, { lat: max.lat, lng: min.lng });
      const larguraKm = haversineKm({ lat: min.lat, lng: min.lng }, { lat: min.lat, lng: max.lng });
      area = round(Math.max(alturaKm, 0.5) * Math.max(larguraKm, 0.5));
      centro = { lat: lats.reduce((a, v) => a + v, 0) / lats.length, lng: lngs.reduce((a, v) => a + v, 0) / lngs.length };
      raioMedio = round(pontos.reduce((a, p) => a + haversineKm(centro, p), 0) / pontos.length);
    }

    const porCidade = {};
    for (const p of pontos) {
      const k = `${p.city || 'Nao informado'}${p.uf ? '/' + p.uf : ''}`;
      porCidade[k] = porCidade[k] || { cidade: k, clientes: 0, compras: 0, total: 0, pontos: [] };
      porCidade[k].clientes++; porCidade[k].compras += p.compras; porCidade[k].total += p.total;
      porCidade[k].pontos.push(p);
    }
    // densidade calculada dentro de cada cidade — a caixa envolvente geral fica distorcida
    // quando a operacao atende regioes distantes (ex.: Recife e Caruaru).
    for (const c of Object.values(porCidade)) {
      const lats = c.pontos.map(p => p.lat), lngs = c.pontos.map(p => p.lng);
      const min = { lat: Math.min(...lats), lng: Math.min(...lngs) };
      const max = { lat: Math.max(...lats), lng: Math.max(...lngs) };
      const alt = haversineKm({ lat: min.lat, lng: min.lng }, { lat: max.lat, lng: min.lng });
      const larg = haversineKm({ lat: min.lat, lng: min.lng }, { lat: min.lat, lng: max.lng });
      c.area_km2 = round(Math.max(alt, 1) * Math.max(larg, 1));
      c.densidade_clientes_km2 = round(c.clientes / c.area_km2);
      c.densidade_faturamento_km2 = round(c.total / c.area_km2);
      delete c.pontos;
    }

    return ok(ctx.res, {
      periodo: { from, to },
      pontos, lojas, grade, celula_km: CELL_KM,
      cobertura: {
        clientes_geolocalizados: pontos.length,
        area_km2: area,
        densidade_clientes_km2: area ? round(pontos.length / area) : 0,
        densidade_faturamento_km2: area ? round(pontos.reduce((a, p) => a + p.total, 0) / area) : 0,
        raio_medio_km: raioMedio, centro
      },
      por_cidade: Object.values(porCidade).map(c => ({ ...c, total: round(c.total) })).sort((a, b) => b.total - a.total),
      aviso: 'Coordenadas aproximadas a partir do CEP do cliente (precisao de bairro/regiao).'
    });
  }
};
