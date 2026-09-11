/* Resultado da loja: o essencial para decidir — sem relatório que ninguém lê. */
import { listar } from '../db.js';
import { el, limpar, kpi, dinheiro, numero, percentual, barras, linha, dataCurta, vazio, cartao, anexar } from '../ui.js';

const dia = (iso) => String(iso).slice(0, 10);
const PERIODOS = [
  { rotulo: 'Hoje', dias: 0 }, { rotulo: '7 dias', dias: 6 },
  { rotulo: '30 dias', dias: 29 }, { rotulo: '90 dias', dias: 89 }
];
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export async function render(raiz) {
  const [vendas, despesas] = await Promise.all([listar('vendas'), listar('despesas')]);
  const validas = vendas.filter(v => !v.cancelada);
  let dias = 29;

  const corpo = el('div');
  const chips = el('div', { class: 'chips' }, PERIODOS.map((p, i) =>
    el('button', {
      class: `chip ${p.dias === dias ? 'ativo' : ''}`, type: 'button',
      onclick: (e) => {
        dias = p.dias;
        [...chips.children].forEach(c => c.classList.toggle('ativo', c === e.currentTarget));
        desenhar();
      }
    }, p.rotulo)));

  raiz.append(chips, corpo);

  function desenhar() {
    const inicio = dia(new Date(Date.now() - dias * 864e5).toISOString());
    const noPeriodo = validas.filter(v => dia(v.data) >= inicio);
    const despesasPeriodo = despesas.filter(d => dia(d.data) >= inicio);

    const faturamento = noPeriodo.reduce((a, v) => a + v.total, 0);
    const lucro = noPeriodo.reduce((a, v) => a + (v.lucro || 0), 0);
    const custoTotal = noPeriodo.reduce((a, v) => a + (v.custo || 0), 0);
    const totalDespesas = despesasPeriodo.reduce((a, d) => a + d.valor, 0);
    const ticket = noPeriodo.length ? faturamento / noPeriodo.length : 0;

    // período anterior de mesmo tamanho, para comparar
    const inicioAnterior = dia(new Date(Date.now() - (dias * 2 + 1) * 864e5).toISOString());
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

    // série diária
    const serie = [];
    for (let i = Math.min(dias, 29); i >= 0; i--) {
      const d = dia(new Date(Date.now() - i * 864e5).toISOString());
      serie.push({ rotulo: dataCurta(d), valor: validas.filter(v => dia(v.data) === d).reduce((a, v) => a + v.total, 0) });
    }

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
        `Custo da mercadoria vendida: ${dinheiro(custoTotal)} · despesas: ${dinheiro(totalDespesas)}.`)
    );
  }

  desenhar();
}
