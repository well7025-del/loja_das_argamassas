/* Estatisticas: faturamento, ranking de produtos (curva ABC), clientes, ticket e lucro. */
import { api } from '../api.js';
import { estado, ehMaster } from '../app.js';
import {
  el, limpar, kpi, dinheiro, numero, percentual, dataCurta, dataBR,
  graficoLinha, graficoBarras, graficoRosca, vazio, diasAtras, hoje, telefoneBR
} from '../ui.js';

const varia = (a, b) => (b ? (a - b) / b * 100 : null);
const PAGAMENTO = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito', boleto: 'Boleto', prazo: 'A prazo' };

const PERIODOS = [
  { rotulo: 'Hoje', from: hoje(), to: hoje() },
  { rotulo: '7 dias', from: diasAtras(6), to: hoje() },
  { rotulo: '30 dias', from: diasAtras(29), to: hoje() },
  { rotulo: '90 dias', from: diasAtras(89), to: hoje() },
  { rotulo: '12 meses', from: diasAtras(364), to: hoje() }
];

export async function render(raiz) {
  let periodo = { from: diasAtras(29), to: hoje() };
  const corpo = el('div');

  const entradaDe = el('input', { type: 'date', value: periodo.from, onchange: (e) => { periodo.from = e.target.value; carregar(); } });
  const entradaAte = el('input', { type: 'date', value: periodo.to, onchange: (e) => { periodo.to = e.target.value; carregar(); } });
  const atalhos = el('div', { class: 'pdv-categorias', style: { margin: '0' } }, PERIODOS.map(p =>
    el('button', { class: 'chip', type: 'button', onclick: () => {
      periodo = { from: p.from, to: p.to };
      entradaDe.value = p.from; entradaAte.value = p.to;
      [...atalhos.children].forEach(c => c.classList.toggle('ativo', c.textContent === p.rotulo));
      carregar();
    } }, p.rotulo)));
  atalhos.children[2].classList.add('ativo');

  raiz.append(
    el('div', { class: 'filtros' }, [
      el('div', { class: 'campo' }, [el('label', { text: 'De' }), entradaDe]),
      el('div', { class: 'campo' }, [el('label', { text: 'Até' }), entradaAte]),
      el('div', { class: 'campo', style: { flex: '2' } }, [el('label', { text: 'Atalhos' }), atalhos]),
      el('button', { class: 'btn btn-vazio', onclick: () => window.print() }, '🖨️ Imprimir'),
      el('a', { class: 'btn btn-vazio', href: '#/mapa' }, '🗺️ Mapa de vendas')
    ]),
    corpo
  );

  async function carregar() {
    limpar(corpo).appendChild(el('div', { class: 'vazio', text: 'Calculando…' }));
    const filtro = { ...periodo, store_id: estado.lojaSelecionada || undefined };
    const [stats, prod, cli] = await Promise.all([
      api.get('/api/stats/resumo', filtro),
      api.get('/api/stats/produtos', filtro),
      api.get('/api/stats/clientes', filtro)
    ]);
    limpar(corpo);
    const r = stats.resumo, a = stats.anterior;

    corpo.appendChild(el('div', { class: 'grid g4 mb' }, [
      kpi({ rotulo: 'Faturamento', valor: dinheiro(r.faturamento), cor: 'verde', delta: varia(r.faturamento, a.faturamento), detalhe: `${numero(r.vendas)} vendas` }),
      kpi({ rotulo: 'Ticket médio', valor: dinheiro(r.ticket_medio), cor: 'amarelo', delta: varia(r.ticket_medio, a.ticket_medio) }),
      kpi({ rotulo: 'Lucro bruto', valor: dinheiro(r.lucro_bruto), delta: varia(r.lucro_bruto, a.lucro_bruto), detalhe: `margem ${percentual(r.margem_bruta)}` }),
      kpi({ rotulo: 'Resultado', valor: dinheiro(r.resultado), cor: r.resultado >= 0 ? 'verde' : 'vermelho', detalhe: `despesas ${dinheiro(r.despesas)}` })
    ]));

    corpo.appendChild(el('div', { class: 'grid g4 mb' }, [
      kpi({ rotulo: 'Unidades vendidas', valor: numero(r.unidades) }),
      kpi({ rotulo: 'Clientes atendidos', valor: numero(r.clientes_atendidos), detalhe: `${numero(cli.novos_clientes)} novos no período` }),
      kpi({ rotulo: 'Descontos concedidos', valor: dinheiro(r.descontos) }),
      ehMaster()
        ? kpi({ rotulo: 'Custo da mercadoria', valor: dinheiro(r.custo_mercadoria) })
        : kpi({ rotulo: 'Vendas sem cliente', valor: numero(cli.vendas_sem_cliente.n), detalhe: dinheiro(cli.vendas_sem_cliente.valor) })
    ]));

    /* --- evolucao --- */
    corpo.appendChild(el('div', { class: 'card mb' }, [
      el('div', { class: 'card-cab' }, [el('h3', { text: 'Evolução do faturamento' }), el('div', { class: 'espaco' }),
        el('span', { class: 'pequeno texto-mudo', text: `${stats.periodo.dias} dias` })]),
      el('div', { class: 'card-corpo' }, [
        stats.serie.length
          ? el('div', {}, [
              graficoLinha(stats.serie.map(s => ({ rotulo: dataCurta(s.dia), valor: s.faturamento })), { cor: '#2FA968', altura: 240 }),
              ehMaster() ? el('div', { class: 'mt' }, [
                el('div', { class: 'pequeno negrito mb', text: 'Lucro bruto por dia' }),
                graficoLinha(stats.serie.map(s => ({ rotulo: dataCurta(s.dia), valor: s.lucro })), { cor: '#1567C4', altura: 150 })
              ]) : null
            ])
          : vazio('Sem vendas neste período', '📈')
      ])
    ]));

    /* --- pagamento e lojas --- */
    corpo.appendChild(el('div', { class: 'grid g2 mb' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'card-cab' }, [el('h3', { text: 'Formas de pagamento' })]),
        el('div', { class: 'card-corpo' }, [
          graficoRosca(stats.pagamentos.map(p => ({ rotulo: PAGAMENTO[p.forma] || p.forma, valor: p.valor })))
        ])
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card-cab' }, [el('h3', { text: stats.por_loja.length > 1 ? 'Desempenho por loja' : 'Movimento por hora' })]),
        el('div', { class: 'card-corpo' }, [
          stats.por_loja.length > 1
            ? graficoBarras(stats.por_loja.map(l => ({ rotulo: l.store_name, valor: l.faturamento })), { cor: '#1567C4' })
            : (stats.por_hora.length
                ? graficoBarras(stats.por_hora.map(h => ({ rotulo: `${String(h.hora).padStart(2, '0')}h`, valor: h.valor })), { cor: '#FFB300' })
                : vazio('Sem dados', '🕒'))
        ])
      ])
    ]));

    /* --- ranking de produtos com curva ABC --- */
    corpo.appendChild(el('div', { class: 'card mb' }, [
      el('div', { class: 'card-cab' }, [
        el('h3', { text: 'Ranking de produtos' }),
        el('div', { class: 'espaco' }),
        prod.pareto.total_itens
          ? el('span', { class: 'tag tag-amarelo', text: `Pareto: ${prod.pareto.itens_classe_a} de ${prod.pareto.total_itens} produtos = 80% do faturamento` })
          : null
      ]),
      prod.ranking.length
        ? el('div', { class: 'tabela-wrap' }, el('table', {}, [
            el('thead', {}, el('tr', {}, [
              el('th', { text: '#' }), el('th', { text: 'Produto' }), el('th', { text: 'Categoria' }),
              el('th', { class: 'num', text: 'Qtd' }), el('th', { class: 'num', text: 'Faturamento' }),
              ehMaster() ? el('th', { class: 'num', text: 'Lucro' }) : null,
              el('th', { class: 'num', text: 'Part.' }), el('th', { text: 'Curva' })
            ].filter(Boolean))),
            el('tbody', {}, prod.ranking.slice(0, 40).map((p, i) => el('tr', {}, [
              el('td', { class: 'texto-mudo', text: String(i + 1) }),
              el('td', { class: 'negrito', text: p.name }),
              el('td', { class: 'pequeno texto-mudo', text: p.categoria || '—' }),
              el('td', { class: 'num', text: `${numero(p.quantidade)} ${p.unit}` }),
              el('td', { class: 'num negrito', text: dinheiro(p.faturamento) }),
              ehMaster() ? el('td', { class: 'num', text: dinheiro(p.lucro) }) : null,
              el('td', { class: 'num pequeno', text: percentual(p.participacao) }),
              el('td', {}, el('span', {
                class: `tag ${p.curva === 'A' ? 'tag-verde' : p.curva === 'B' ? 'tag-amarelo' : 'tag-cinza'}`, text: p.curva
              }))
            ].filter(Boolean))))
          ]))
        : vazio('Nenhum produto vendido no período', '🏷️')
    ]));

    /* --- ranking de clientes --- */
    corpo.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card-cab' }, [
        el('h3', { text: 'Ranking de clientes' }),
        el('div', { class: 'espaco' }),
        cli.vendas_sem_cliente.n
          ? el('span', { class: 'tag tag-cinza', text: `${cli.vendas_sem_cliente.n} vendas sem cliente identificado (${dinheiro(cli.vendas_sem_cliente.valor)})` })
          : null
      ]),
      cli.ranking.length
        ? el('div', { class: 'tabela-wrap' }, el('table', {}, [
            el('thead', {}, el('tr', {}, [
              el('th', { text: '#' }), el('th', { text: 'Cliente' }), el('th', { text: 'Contato' }), el('th', { text: 'Local' }),
              el('th', { class: 'num', text: 'Compras' }), el('th', { class: 'num', text: 'Total' }),
              el('th', { class: 'num', text: 'Ticket médio' }), el('th', { text: 'Última compra' })
            ])),
            el('tbody', {}, cli.ranking.slice(0, 40).map((c, i) => el('tr', {}, [
              el('td', { class: 'texto-mudo', text: String(i + 1) }),
              el('td', { class: 'negrito', text: c.name }),
              el('td', { class: 'pequeno', text: telefoneBR(c.phone) || '—' }),
              el('td', { class: 'pequeno', text: [c.city, c.uf].filter(Boolean).join('/') || '—' }),
              el('td', { class: 'num', text: numero(c.compras) }),
              el('td', { class: 'num negrito', text: dinheiro(c.total) }),
              el('td', { class: 'num pequeno', text: dinheiro(c.ticket_medio) }),
              el('td', { class: 'pequeno', text: dataBR(c.ultima_compra) })
            ])))
          ]))
        : vazio('Nenhum cliente identificado nas vendas do período', '👥')
    ]));
  }

  carregar();
}
