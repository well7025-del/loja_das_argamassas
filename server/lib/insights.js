/**
 * Motor de analise de negocio.
 *
 * Gera insights acionaveis a partir dos dados reais do ERP — sem depender de
 * servico externo. O modulo de IA (routes/ai.js) usa este resultado como base
 * factual e, quando ha chave da Anthropic configurada, pede uma narrativa em
 * cima destes mesmos numeros.
 */
import { db } from '../db.js';
import { resumoPeriodo } from '../routes/stats.js';

const round = (v) => Number((v || 0).toFixed(2));
const brl = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
const pct = (a, b) => (b ? round((a - b) / b * 100) : (a > 0 ? 100 : 0));
const DIAS_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

export function coletarDados(storeIds, from, to) {
  const inList = storeIds.length ? storeIds : [-1];
  const ph = inList.map(() => '?').join(',');
  const dias = Math.max(1, Math.round((new Date(to) - new Date(from)) / 864e5) + 1);
  const antFrom = new Date(new Date(from).getTime() - dias * 864e5).toISOString().slice(0, 10);
  const antTo = new Date(new Date(from).getTime() - 864e5).toISOString().slice(0, 10);

  const atual = resumoPeriodo(inList, from, to);
  const anterior = resumoPeriodo(inList, antFrom, antTo);

  const produtos = db.prepare(`
    SELECT p.id, p.name, p.unit, p.min_stock, p.cost_price, p.sale_price,
           ROUND(SUM(si.qty),2) AS quantidade, ROUND(SUM(si.total),2) AS faturamento,
           ROUND(SUM(si.total - si.unit_cost * si.qty),2) AS lucro
      FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
     WHERE s.status='concluida' AND s.store_id IN (${ph}) AND date(s.created_at) BETWEEN date(?) AND date(?)
     GROUP BY p.id ORDER BY faturamento DESC`).all(...inList, from, to);

  const clientes = db.prepare(`
    SELECT c.id, c.name, c.phone, COUNT(s.id) AS compras, ROUND(SUM(s.total),2) AS total
      FROM sales s JOIN customers c ON c.id = s.customer_id
     WHERE s.status='concluida' AND s.store_id IN (${ph}) AND date(s.created_at) BETWEEN date(?) AND date(?)
     GROUP BY c.id ORDER BY total DESC`).all(...inList, from, to);

  const despesas = db.prepare(`
    SELECT category, ROUND(SUM(amount),2) AS valor FROM expenses
     WHERE store_id IN (${ph}) AND date(created_at) BETWEEN date(?) AND date(?)
     GROUP BY category ORDER BY valor DESC`).all(...inList, from, to);

  const porLoja = db.prepare(`
    SELECT st.id, st.name, COUNT(s.id) AS vendas, ROUND(COALESCE(SUM(s.total),0),2) AS faturamento,
           ROUND(COALESCE(SUM(s.profit),0),2) AS lucro,
           ROUND(COALESCE(AVG(s.total),0),2) AS ticket
      FROM stores st LEFT JOIN sales s ON s.store_id = st.id AND s.status='concluida'
           AND date(s.created_at) BETWEEN date(?) AND date(?)
     WHERE st.id IN (${ph}) AND st.kind='loja' AND st.active=1
     GROUP BY st.id ORDER BY faturamento DESC`).all(from, to, ...inList);

  const porDiaSemana = db.prepare(`
    SELECT CAST(strftime('%w', created_at) AS INTEGER) AS dow, COUNT(*) AS vendas, ROUND(SUM(total),2) AS valor
      FROM sales WHERE status='concluida' AND store_id IN (${ph}) AND date(created_at) BETWEEN date(?) AND date(?)
     GROUP BY dow ORDER BY valor DESC`).all(...inList, from, to);

  const estoque = db.prepare(`
    SELECT p.id, p.name, p.unit, p.min_stock, p.cost_price, st.name AS loja, s.qty
      FROM stock s JOIN products p ON p.id = s.product_id JOIN stores st ON st.id = s.store_id
     WHERE s.store_id IN (${ph}) AND p.active=1 AND st.kind='loja'`).all(...inList);

  const caixa = db.prepare(`
    SELECT st.name, COALESCE(SUM(cm.amount),0) AS saldo
      FROM stores st LEFT JOIN cash_movements cm ON cm.store_id = st.id
     WHERE st.id IN (${ph}) AND st.kind='loja' AND st.active=1
     GROUP BY st.id`).all(...inList);

  const semCliente = db.prepare(`
    SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(total),0),2) AS valor FROM sales
     WHERE status='concluida' AND customer_id IS NULL AND store_id IN (${ph})
       AND date(created_at) BETWEEN date(?) AND date(?)`).get(...inList, from, to);

  const inativos = db.prepare(`
    SELECT c.id, c.name, c.phone, ROUND(SUM(s.total),2) AS total_historico, MAX(date(s.created_at)) AS ultima
      FROM customers c JOIN sales s ON s.customer_id = c.id AND s.status='concluida'
     WHERE c.active=1 AND s.store_id IN (${ph})
     GROUP BY c.id HAVING MAX(date(s.created_at)) < date(?, '-45 days')
     ORDER BY total_historico DESC LIMIT 20`).all(...inList, to);

  return { periodo: { from, to, dias, antFrom, antTo }, atual, anterior, produtos, clientes,
           despesas, porLoja, porDiaSemana, estoque, caixa, semCliente, inativos };
}

/** Traduz os dados em insights priorizados e acionaveis. */
export function gerarInsights(d) {
  const out = [];
  const add = (i) => out.push(i);
  const { atual, anterior, produtos, clientes, despesas, porLoja, porDiaSemana, estoque, caixa, semCliente, inativos } = d;
  const totalDespesas = despesas.reduce((a, x) => a + x.valor, 0);

  /* 1. Tendencia de faturamento */
  if (anterior.faturamento > 0 || atual.faturamento > 0) {
    const v = pct(atual.faturamento, anterior.faturamento);
    const semBase = anterior.faturamento === 0;
    add({
      chave: 'faturamento',
      tipo: v >= 0 ? 'destaque' : 'risco', prioridade: Math.abs(v) > 15 && !semBase ? 1 : 3,
      titulo: semBase ? `Faturamento de ${brl(atual.faturamento)} no periodo`
                      : v >= 0 ? `Faturamento cresceu ${v}%` : `Faturamento caiu ${Math.abs(v)}%`,
      texto: semBase
        ? `Nao houve venda registrada no periodo anterior, entao ainda nao da para comparar a evolucao.`
        : `No periodo o faturamento foi de ${brl(atual.faturamento)} contra ${brl(anterior.faturamento)} no periodo anterior de mesmo tamanho.`,
      acao: v >= 0 ? 'Identifique o que puxou o crescimento e repita a acao no proximo ciclo.'
                   : 'Compare mix de produtos e numero de atendimentos: a queda veio de menos clientes ou de ticket menor?',
      metrica: { atual: atual.faturamento, anterior: anterior.faturamento, variacao_percentual: v }
    });
  }

  /* 2. Ticket medio */
  if (atual.vendas >= 3) {
    const v = pct(atual.ticket_medio, anterior.ticket_medio);
    add({
      chave: 'ticket_medio',
      tipo: v >= 0 ? 'destaque' : 'oportunidade', prioridade: 3,
      titulo: `Ticket medio de ${brl(atual.ticket_medio)}`,
      texto: `Foram ${atual.vendas} vendas no periodo${anterior.vendas ? `, contra ${anterior.vendas} no anterior` : ''}. ` +
             (anterior.ticket_medio ? `O ticket variou ${v}%.` : ''),
      acao: 'Sugira sempre um item complementar (rejunte, desempenadeira, impermeabilizante) no fechamento do pedido — e a forma mais barata de subir o ticket.',
      metrica: { ticket_medio: atual.ticket_medio, variacao_percentual: v }
    });
  }

  /* 3. Pareto de produtos (curva ABC) */
  const totalProd = produtos.reduce((a, p) => a + p.faturamento, 0);
  if (totalProd > 0) {
    let acc = 0; const classeA = [];
    for (const p of produtos) { acc += p.faturamento; classeA.push(p); if (acc / totalProd >= 0.8) break; }
    add({
      chave: 'pareto',
      tipo: 'destaque', prioridade: 2,
      titulo: `${classeA.length} de ${produtos.length} produtos geram 80% do faturamento`,
      texto: `Principais: ${classeA.slice(0, 5).map(p => p.name).join(', ')}. ` +
             `Esses itens somam ${brl(classeA.reduce((a, p) => a + p.faturamento, 0))}.`,
      acao: 'Concentre compra, estoque de seguranca e negociacao com fornecedor nesses itens. Eles decidem o seu resultado.',
      metrica: { itens_classe_a: classeA.length, itens_total: produtos.length,
                 participacao: round(classeA.length / produtos.length * 100) }
    });

    /* 4. Ruptura de estoque nos itens classe A */
    const idsA = new Set(classeA.map(p => p.id));
    const risco = estoque.filter(e => idsA.has(e.id))
      .map(e => {
        const vendaDia = (produtos.find(p => p.id === e.id)?.quantidade || 0) / d.periodo.dias;
        return { ...e, cobertura_dias: vendaDia > 0 ? round(e.qty / vendaDia) : null, venda_dia: round(vendaDia) };
      })
      .filter(e => e.cobertura_dias !== null && e.cobertura_dias < 10)
      .sort((a, b) => a.cobertura_dias - b.cobertura_dias);
    if (risco.length) {
      add({
        chave: 'ruptura',
        tipo: 'risco', prioridade: 1,
        titulo: `${risco.length} produto(s) campeao(oes) com menos de 10 dias de estoque`,
        texto: risco.slice(0, 5).map(r => `${r.name} em ${r.loja}: ${r.qty} ${r.unit} (~${r.cobertura_dias} dias)`).join(' | '),
        acao: 'Programe producao na fabrica e transferencia para as lojas antes da ruptura. Faltar item de curva A e a perda de venda mais cara que existe.',
        metrica: { itens: risco.length, detalhe: risco.slice(0, 10) }
      });
    }

    /* 5. Estoque parado */
    const vendidos = new Set(produtos.map(p => p.id));
    const parado = estoque.filter(e => !vendidos.has(e.id) && e.qty > 0);
    const valorParado = parado.reduce((a, e) => a + e.qty * e.cost_price, 0);
    const nomesParados = [...new Set(parado.map(p => p.name))];
    if (nomesParados.length >= 3) {
      add({
        chave: 'estoque_parado',
        tipo: 'oportunidade', prioridade: 3,
        titulo: `${nomesParados.length} produtos sem nenhuma venda no periodo`,
        texto: `Ha ${brl(valorParado)} de capital parado em produtos que nao giraram. Ex.: ${nomesParados.slice(0, 5).join(', ')}.`,
        acao: 'Monte um combo ou promocao com esses itens no catalogo e dispare uma campanha de WhatsApp. Capital parado nao paga conta.',
        metrica: { produtos: nomesParados.length, capital_parado: round(valorParado) }
      });
    }

    /* 6. Margem por produto */
    const comMargem = produtos.filter(p => p.faturamento > 0)
      .map(p => ({ ...p, margem: round(p.lucro / p.faturamento * 100) }));
    const margemMedia = comMargem.length ? round(comMargem.reduce((a, p) => a + p.margem, 0) / comMargem.length) : 0;
    const fracos = comMargem.filter(p => p.margem < margemMedia * 0.6 && p.faturamento > totalProd * 0.03);
    if (fracos.length) {
      add({
        chave: 'margem_baixa',
        tipo: 'alerta', prioridade: 2,
        titulo: `${fracos.length} produto(s) vendem bem mas com margem baixa`,
        texto: `Margem media da loja: ${margemMedia}%. Abaixo disso: ${fracos.slice(0, 5).map(p => `${p.name} (${p.margem}%)`).join(', ')}.`,
        acao: 'Renegocie o custo com o fornecedor ou reajuste o preco. Um ponto de margem nesses itens vale mais que uma promocao nova.',
        metrica: { margem_media: margemMedia, itens: fracos.slice(0, 10).map(p => ({ nome: p.name, margem: p.margem })) }
      });
    }
  }

  /* 7. Despesas x faturamento */
  if (totalDespesas > 0) {
    const proporcao = atual.faturamento ? round(totalDespesas / atual.faturamento * 100) : 100;
    const maior = despesas[0];
    add({
      tipo: proporcao > 60 ? 'risco' : proporcao > 40 ? 'alerta' : 'destaque',
      prioridade: proporcao > 60 ? 1 : 2,
      chave: 'despesas',
      titulo: `Despesas consomem ${proporcao}% do faturamento`,
      texto: `Total de ${brl(totalDespesas)} em despesas. Maior categoria: ${maior.category} com ${brl(maior.valor)} ` +
             `(${round(maior.valor / totalDespesas * 100)}% do total). Resultado do periodo: ${brl(atual.resultado)}.`,
      acao: proporcao > 60 ? 'Ataque a maior categoria primeiro — e onde 1% de corte vale mais.'
                           : 'Estrutura de custo sob controle. Mantenha o acompanhamento mensal por categoria.',
      metrica: { despesas: round(totalDespesas), proporcao, maior_categoria: maior.category, resultado: atual.resultado }
    });
  }

  /* 8. Lucro bruto e resultado */
  if (atual.faturamento > 0) {
    add({
      chave: 'resultado',
      tipo: atual.resultado >= 0 ? 'destaque' : 'risco', prioridade: atual.resultado >= 0 ? 3 : 1,
      titulo: atual.resultado >= 0 ? `Resultado positivo de ${brl(atual.resultado)}` : `Resultado negativo de ${brl(atual.resultado)}`,
      texto: `Lucro bruto de ${brl(atual.lucro_bruto)} (margem ${atual.margem_bruta}%) menos ${brl(totalDespesas)} de despesas.`,
      acao: atual.resultado >= 0 ? 'Separe uma parte do resultado para reposicao de estoque dos itens de curva A.'
                                 : 'Para virar o resultado: suba a margem dos campeoes de venda ou corte a maior despesa. Fazer os dois resolve mais rapido.',
      metrica: { lucro_bruto: atual.lucro_bruto, margem_bruta: atual.margem_bruta, resultado: atual.resultado }
    });
  }

  /* 9. Concentracao de clientes */
  const totalClientes = clientes.reduce((a, c) => a + c.total, 0);
  if (clientes.length >= 3 && totalClientes > 0) {
    const top5 = clientes.slice(0, 5);
    const conc = round(top5.reduce((a, c) => a + c.total, 0) / totalClientes * 100);
    add({
      chave: 'concentracao_clientes',
      tipo: conc > 60 ? 'risco' : 'destaque', prioridade: conc > 60 ? 2 : 4,
      titulo: `Top 5 clientes representam ${conc}% das vendas identificadas`,
      texto: `Maiores: ${top5.map(c => `${c.name} (${brl(c.total)})`).join(', ')}.`,
      acao: conc > 60 ? 'Dependencia alta de poucos clientes. Use o catalogo online e campanhas de WhatsApp para ampliar a base.'
                      : 'Base equilibrada. Crie um beneficio simples de recompra para os cinco maiores.',
      metrica: { concentracao: conc, top: top5.map(c => ({ nome: c.name, total: c.total })) }
    });
  }

  /* 10. Clientes inativos */
  if (inativos.length) {
    const valor = inativos.reduce((a, c) => a + c.total_historico, 0);
    add({
      chave: 'clientes_inativos',
      tipo: 'oportunidade', prioridade: 2,
      titulo: `${inativos.length} clientes sem comprar ha mais de 45 dias`,
      texto: `Juntos ja compraram ${brl(valor)}. Maiores: ${inativos.slice(0, 5).map(c => c.name).join(', ')}.`,
      acao: 'Crie uma campanha de WhatsApp com audiencia "inativos" — reativar cliente antigo custa muito menos que conquistar um novo.',
      metrica: { clientes: inativos.length, valor_historico: round(valor) }
    });
  }

  /* 11. Vendas sem cliente identificado */
  if (semCliente.n > 0 && atual.vendas > 0) {
    const p = round(semCliente.n / atual.vendas * 100);
    if (p >= 30) add({
      chave: 'venda_sem_cliente',
      tipo: 'alerta', prioridade: 3,
      titulo: `${p}% das vendas sairam sem cliente identificado`,
      texto: `${semCliente.n} vendas somando ${brl(semCliente.valor)} nao tem cliente vinculado.`,
      acao: 'Peca sempre nome, telefone e CEP no PDV. Sem isso nao ha campanha de WhatsApp nem mapa de densidade de vendas.',
      metrica: { vendas: semCliente.n, valor: semCliente.valor, percentual: p }
    });
  }

  /* 12. Comparacao entre lojas */
  if (porLoja.length >= 2) {
    const [primeira, ...resto] = porLoja;
    const ultima = resto[resto.length - 1];
    if (primeira.faturamento > 0) add({
      chave: 'comparativo_lojas',
      tipo: 'destaque', prioridade: 3,
      titulo: `${primeira.name} lidera com ${brl(primeira.faturamento)}`,
      texto: porLoja.map(l => `${l.name}: ${brl(l.faturamento)} em ${l.vendas} vendas (ticket ${brl(l.ticket)})`).join(' | '),
      acao: ultima && ultima.ticket < primeira.ticket
        ? `O ticket de ${ultima.name} esta ${brl(primeira.ticket - ultima.ticket)} abaixo de ${primeira.name}. Replique o mix e a abordagem da loja lider.`
        : 'Compare o mix vendido entre as lojas e padronize o que funciona melhor.',
      metrica: { lojas: porLoja }
    });
  }

  /* 13. Melhor dia da semana */
  if (porDiaSemana.length >= 3) {
    const melhor = porDiaSemana[0], pior = porDiaSemana[porDiaSemana.length - 1];
    add({
      chave: 'dia_forte',
      tipo: 'oportunidade', prioridade: 4,
      titulo: `${DIAS_SEMANA[melhor.dow]} e o dia mais forte`,
      texto: `${DIAS_SEMANA[melhor.dow]}: ${brl(melhor.valor)} em ${melhor.vendas} vendas. ` +
             `${DIAS_SEMANA[pior.dow]} e o mais fraco: ${brl(pior.valor)}.`,
      acao: `Concentre equipe e estoque na ${DIAS_SEMANA[melhor.dow]} e dispare promocoes na ${DIAS_SEMANA[pior.dow]} para equilibrar o movimento.`,
      metrica: { por_dia: porDiaSemana.map(x => ({ dia: DIAS_SEMANA[x.dow], vendas: x.vendas, valor: x.valor })) }
    });
  }

  /* 14. Caixa acumulado */
  const caixaAlto = caixa.filter(c => c.saldo > 2000);
  if (caixaAlto.length) {
    add({
      chave: 'caixa_alto',
      tipo: 'alerta', prioridade: 2,
      titulo: 'Dinheiro em caixa acima do recomendado',
      texto: caixaAlto.map(c => `${c.name}: ${brl(c.saldo)}`).join(' | '),
      acao: 'Registre um deposito para a matriz. Dinheiro parado na loja e risco de seguranca e capital fora do controle financeiro.',
      metrica: { caixas: caixaAlto.map(c => ({ loja: c.name, saldo: round(c.saldo) })) }
    });
  }

  return out.sort((a, b) => a.prioridade - b.prioridade || (a.tipo === 'risco' ? -1 : 1));
}

/** Texto executivo gerado localmente (usado sem IA externa e como base do prompt). */
export function relatorioTexto(d, insights) {
  const { atual, anterior, periodo } = d;
  const linhas = [
    `RESUMO EXECUTIVO — ${periodo.from} a ${periodo.to} (${periodo.dias} dias)`,
    '',
    `Faturamento: ${brl(atual.faturamento)} (${pct(atual.faturamento, anterior.faturamento) >= 0 ? '+' : ''}${pct(atual.faturamento, anterior.faturamento)}% vs periodo anterior)`,
    `Vendas: ${atual.vendas} | Ticket medio: ${brl(atual.ticket_medio)} | Unidades: ${atual.unidades}`,
    `Lucro bruto: ${brl(atual.lucro_bruto)} (margem ${atual.margem_bruta}%)`,
    `Despesas: ${brl(atual.despesas)} | Resultado: ${brl(atual.resultado)}`,
    `Clientes atendidos: ${atual.clientes_atendidos}`,
    '',
    'PRINCIPAIS PONTOS DE ATENCAO:',
    ...insights.slice(0, 5).map((i, n) => `${n + 1}. [${i.tipo.toUpperCase()}] ${i.titulo} — ${i.acao}`)
  ];
  return linhas.join('\n');
}
