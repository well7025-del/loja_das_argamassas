/* Resultado da loja: o essencial para decidir — sem relatório que ninguém lê. */
import { listar, config } from '../db.js';
import { el, limpar, kpi, dinheiro, numero, percentual, barras, linha, dataCurta, dataBR,
  vazio, cartao, hoje, diasAtras, erro, sucesso, anexar } from '../ui.js';
import { pdfTabela, entregarPdf, dinheiroPdf, qtdPdf } from '../documentos.js';

const dia = (iso) => String(iso).slice(0, 10);
const PERIODOS = [
  { rotulo: 'Hoje', dias: 0 }, { rotulo: '7 dias', dias: 6 },
  { rotulo: '30 dias', dias: 29 }, { rotulo: '90 dias', dias: 89 }
];
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export async function render(raiz) {
  const [vendas, despesas, loja] = await Promise.all([
    listar('vendas'), listar('despesas'), config('loja', {})
  ]);
  const validas = vendas.filter(v => !v.cancelada);

  /* O período é sempre um intervalo de datas; os atalhos só preenchem os
     campos, para que o filtro livre e os botões não briguem entre si. */
  let de = diasAtras(29), ate = hoje();

  const corpo = el('div');
  const entradaDe = el('input', { type: 'date', value: de });
  const entradaAte = el('input', { type: 'date', value: ate });
  const chips = el('div', { class: 'chips' });
  let ultimo = null;   // dados do período, para exportar em PDF

  function aplicar() {
    de = entradaDe.value || diasAtras(29);
    ate = entradaAte.value || hoje();
    if (de > ate) { const t = de; de = ate; ate = t; entradaDe.value = de; entradaAte.value = ate; }
    desenhar();
  }
  entradaDe.addEventListener('change', () => { marcarChip(null); aplicar(); });
  entradaAte.addEventListener('change', () => { marcarChip(null); aplicar(); });

  function marcarChip(alvo) {
    [...chips.children].forEach(c => c.classList.toggle('ativo', c === alvo));
  }

  for (const p of PERIODOS) {
    const b = el('button', { class: 'chip', type: 'button' }, p.rotulo);
    b.onclick = () => {
      entradaDe.value = diasAtras(p.dias); entradaAte.value = hoje();
      marcarChip(b); aplicar();
    };
    if (p.dias === 29) b.classList.add('ativo');
    chips.appendChild(b);
  }
  const btnMes = el('button', { class: 'chip', type: 'button' }, 'Mês atual');
  btnMes.onclick = () => {
    const agora = new Date();
    entradaDe.value = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString().slice(0, 10);
    entradaAte.value = hoje();
    marcarChip(btnMes); aplicar();
  };
  chips.appendChild(btnMes);

  anexar(raiz,
    chips,
    el('div', { class: 'linha mb mt' }, [
      el('div', { class: 'campo', style: { margin: 0 } }, [el('label', { text: 'De' }), entradaDe]),
      el('div', { class: 'campo', style: { margin: 0 } }, [el('label', { text: 'Até' }), entradaAte])
    ]),
    el('button', { class: 'btn btn-vazio btn-bloco mb', type: 'button', onclick: () => exportarPdf() },
      '📄 Exportar resultado em PDF'),
    corpo
  );

  function desenhar() {
    const inicio = de;
    const dias = Math.max(0, Math.round((new Date(ate) - new Date(de)) / 864e5));
    const noPeriodo = validas.filter(v => dia(v.data) >= de && dia(v.data) <= ate);
    const despesasPeriodo = despesas.filter(d => dia(d.data) >= de && dia(d.data) <= ate);

    const faturamento = noPeriodo.reduce((a, v) => a + v.total, 0);
    const lucro = noPeriodo.reduce((a, v) => a + (v.lucro || 0), 0);
    const custoTotal = noPeriodo.reduce((a, v) => a + (v.custo || 0), 0);
    const totalDespesas = despesasPeriodo.reduce((a, d) => a + d.valor, 0);
    const ticket = noPeriodo.length ? faturamento / noPeriodo.length : 0;

    // período anterior de mesmo tamanho, para comparar
    const inicioAnterior = dia(new Date(new Date(de).getTime() - (dias + 1) * 864e5).toISOString());
    const anterior = validas.filter(v => dia(v.data) >= inicioAnterior && dia(v.data) < inicio);
    const faturamentoAnterior = anterior.reduce((a, v) => a + v.total, 0);
    const variacao = faturamentoAnterior ? (faturamento - faturamentoAnterior) / faturamentoAnterior * 100 : null;

    // ranking de produtos e curva ABC
    const porProduto = new Map();
    for (const v of noPeriodo) for (const i of v.itens) {
      const atual = porProduto.get(i.nome) || { qtd: 0, valor: 0, lucro: 0 };
      atual.qtd += i.qtd; atual.valor += i.total; atual.lucro += i.total - i.custo * i.qtd;
      porProduto.set(i.nome, atual);
    }
    const ranking = [...porProduto.entries()].map(([nome, r]) => ({ nome, ...r })).sort((a, b) => b.valor - a.valor);
    let acumulado = 0;
    const classeA = [];
    for (const p of ranking) { acumulado += p.valor; classeA.push(p); if (faturamento && acumulado / faturamento >= 0.8) break; }

    // formas de pagamento e dia da semana
    const porPagamento = {};
    const porDia = {};
    for (const v of noPeriodo) {
      porPagamento[v.pagamento] = (porPagamento[v.pagamento] || 0) + v.total;
      const d = new Date(v.data).getDay();
      porDia[d] = (porDia[d] || 0) + v.total;
    }
    const melhorDia = Object.entries(porDia).sort((a, b) => b[1] - a[1])[0];

    // série diária (no máximo 30 colunas, senão o gráfico vira sopa)
    const serie = [];
    const fim = new Date(ate).getTime();
    for (let i = Math.min(dias, 29); i >= 0; i--) {
      const d = dia(new Date(fim - i * 864e5).toISOString());
      serie.push({ rotulo: dataCurta(d), valor: validas.filter(v => dia(v.data) === d).reduce((a, v) => a + v.total, 0) });
    }

    ultimo = { de, ate, noPeriodo, faturamento, lucro, custoTotal, totalDespesas, ticket, ranking, porPagamento };

anexar(limpar(corpo), 
      el('div', { class: 'grade2 mb' }, [
        kpi({ rot: 'Faturamento', val: dinheiro(faturamento), cor: 'verde',
              det: variacao === null ? `${numero(noPeriodo.length)} venda(s)`
                                     : `${variacao >= 0 ? '▲' : '▼'} ${percentual(Math.abs(variacao))} vs. período anterior` }),
        kpi({ rot: 'Ticket médio', val: dinheiro(ticket), det: `${numero(noPeriodo.length)} venda(s)`, cor: 'amarelo' }),
        kpi({ rot: 'Lucro bruto', val: dinheiro(lucro), det: `margem ${percentual(faturamento ? lucro / faturamento * 100 : 0)}` }),
        kpi({ rot: 'Resultado', val: dinheiro(lucro - totalDespesas), cor: lucro - totalDespesas >= 0 ? 'verde' : 'vermelho',
              det: `após ${dinheiro(totalDespesas)} de despesas` })
      ]),

      cartao('Faturamento por dia', el('div', { class: 'cartao-corpo' }, linha(serie))),

      ranking.length
        ? cartao('Produtos que mais vendem', el('div', { class: 'cartao-corpo' }, [
            barras(ranking.slice(0, 8).map(p => ({ rotulo: p.nome, valor: p.valor })), { cor: '#1567C4' }),
            faturamento ? el('div', { class: 'aviso aviso-amarelo mt' },
              `📌 ${classeA.length} de ${ranking.length} produtos fazem 80% do faturamento. ` +
              'São esses que não podem faltar no estoque.') : null
          ]))
        : vazio('Nenhuma venda no período', '📊'),

      Object.keys(porPagamento).length
        ? cartao('Como os clientes pagam', el('div', { class: 'cartao-corpo' },
            barras(Object.entries(porPagamento).map(([k, v]) => ({ rotulo: k.toUpperCase(), valor: v })), { cor: '#2FA968' })))
        : null,

      melhorDia
        ? el('div', { class: 'aviso aviso-azul' },
            `📅 ${DIAS_SEMANA[melhorDia[0]].replace(/^./, c => c.toUpperCase())} é o dia mais forte: ${dinheiro(melhorDia[1])} no período.`)
        : null,

      el('div', { class: 'aviso aviso-verde' },
        `Custo da mercadoria vendida: ${dinheiro(custoTotal)} · despesas: ${dinheiro(totalDespesas)}.`),

      el('div', { class: 'pq mudo', text: `Período: ${dataBR(de)} a ${dataBR(ate)}.` })
    );
  }

  async function exportarPdf() {
    if (!ultimo) { erro('Nada para exportar'); return; }
    const r = ultimo;
    try {
      const bytes = pdfTabela({
        titulo: 'RESULTADO DO PERÍODO',
        subtitulo: `${dataBR(r.de)} a ${dataBR(r.ate)}`,
        loja,
        colunas: [
          { titulo: 'PRODUTO', campo: 'nome', peso: 4 },
          { titulo: 'QTD', campo: 'qtd', peso: 1.2, alinhamento: 'direita' },
          { titulo: 'FATURAMENTO', campo: 'valor', peso: 2, alinhamento: 'direita' },
          { titulo: 'LUCRO', campo: 'lucro', peso: 2, alinhamento: 'direita' }
        ],
        linhas: r.ranking.map(p => ({
          nome: p.nome, qtd: qtdPdf(p.qtd), valor: dinheiroPdf(p.valor), lucro: dinheiroPdf(p.lucro)
        })),
        resumo: [
          { rotulo: 'Vendas no período', valor: String(r.noPeriodo.length) },
          { rotulo: 'Faturamento', valor: dinheiroPdf(r.faturamento) },
          { rotulo: 'Ticket médio', valor: dinheiroPdf(r.ticket) },
          { rotulo: 'Custo da mercadoria', valor: dinheiroPdf(r.custoTotal) },
          { rotulo: 'Lucro bruto', valor: dinheiroPdf(r.lucro) },
          { rotulo: 'Despesas', valor: dinheiroPdf(r.totalDespesas) },
          { rotulo: 'RESULTADO DO PERÍODO', valor: dinheiroPdf(r.lucro - r.totalDespesas),
            cor: r.lucro - r.totalDespesas >= 0 ? [0.11, 0.51, 0.31] : [0.78, 0.16, 0.16] }
        ],
        observacao: 'Lucro bruto = faturamento − custo da mercadoria vendida. O resultado desconta ainda as despesas lançadas no período.'
      });
      sucesso(await entregarPdf(bytes, `resultado-${r.de}-a-${r.ate}.pdf`));
    } catch (e) { erro('Não consegui gerar o PDF: ' + e.message); }
  }

  desenhar();
}
