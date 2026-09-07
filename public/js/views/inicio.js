/* Painel inicial: o essencial do dia em uma tela (principio de Pareto). */
import { api } from '../api.js';
import { estado, ehMaster } from '../app.js';
import { el, kpi, dinheiro, numero, percentual, dataCurta, graficoLinha, vazio, dataHora } from '../ui.js';

const varia = (atual, anterior) => (anterior ? (atual - anterior) / anterior * 100 : null);

export async function render(raiz) {
  const filtro = { store_id: estado.lojaSelecionada || undefined };
  const [stats, ia, alertas, caixa] = await Promise.all([
    api.get('/api/stats/resumo', filtro),
    api.get('/api/ia/insights', filtro).catch(() => ({ insights: [] })),
    api.get('/api/estoque/alertas', filtro).catch(() => ({ alertas: [] })),
    api.get('/api/caixa', filtro).catch(() => ({ saldo_total: 0, saldos: [] }))
  ]);

  const r = stats.resumo, a = stats.anterior;
  const nome = (estado.usuario.name || '').split(' ')[0];
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';

  raiz.append(
    el('div', { class: 'flex quebra mb', style: { justifyContent: 'space-between' } }, [
      el('div', {}, [
        el('h1', { style: { fontSize: '22px' }, text: `${saudacao}, ${nome}!` }),
        el('div', { class: 'texto-mudo pequeno', text: `Resultados de ${stats.periodo.from.split('-').reverse().join('/')} a ${stats.periodo.to.split('-').reverse().join('/')} · ${ehMaster() && !estado.lojaSelecionada ? 'todas as unidades' : (estado.lojas.find(l => String(l.id) === String(estado.lojaSelecionada))?.name || estado.usuario.store_name || 'sua loja')}` })
      ]),
      el('div', { class: 'flex quebra' }, [
        el('a', { class: 'btn btn-acao btn-lg', href: '#/pdv' }, '🧾 Nova venda'),
        el('a', { class: 'btn btn-vazio', href: '#/estatisticas' }, '📊 Ver análise completa')
      ])
    ]),

    el('div', { class: 'grid g4 mb' }, [
      kpi({ rotulo: 'Faturamento (30 dias)', valor: dinheiro(r.faturamento), cor: 'verde',
            delta: varia(r.faturamento, a.faturamento), detalhe: `${numero(r.vendas)} vendas` }),
      kpi({ rotulo: 'Ticket médio', valor: dinheiro(r.ticket_medio), cor: 'amarelo',
            delta: varia(r.ticket_medio, a.ticket_medio), detalhe: `${numero(r.clientes_atendidos)} clientes` }),
      kpi({ rotulo: 'Lucro bruto', valor: dinheiro(r.lucro_bruto), cor: '',
            detalhe: `margem de ${percentual(r.margem_bruta)}` }),
      kpi({ rotulo: 'Resultado do período', valor: dinheiro(r.resultado), cor: r.resultado >= 0 ? 'verde' : 'vermelho',
            detalhe: `após ${dinheiro(r.despesas)} de despesas` })
    ]),

    el('div', { class: 'grid g-2-1' }, [
      el('div', { class: 'grid' }, [
        el('div', { class: 'card' }, [
          el('div', { class: 'card-cab' }, [el('h3', { text: 'Faturamento por dia' })]),
          el('div', { class: 'card-corpo' }, [
            stats.serie.length
              ? graficoLinha(stats.serie.map(s => ({ rotulo: dataCurta(s.dia), valor: s.faturamento })), { cor: '#2FA968' })
              : vazio('Ainda não há vendas registradas neste período', '📈')
          ])
        ]),
        el('div', { class: 'card' }, [
          el('div', { class: 'card-cab' }, [
            el('h3', { text: '🤖 O que os números estão dizendo' }),
            el('div', { class: 'espaco' }),
            el('a', { class: 'btn btn-vazio btn-sm', href: '#/ia' }, 'Relatório completo')
          ]),
          ia.insights.length
            ? el('div', {}, ia.insights.slice(0, 4).map(i => el('div', { class: `insight ${i.tipo}` }, [
                el('div', { class: 'marca-tipo' }),
                el('div', { style: { flex: '1', minWidth: '0' } }, [
                  el('h4', { text: i.titulo }),
                  el('p', { text: i.texto }),
                  el('div', { class: 'acao', text: `👉 ${i.acao}` })
                ])
              ])))
            : vazio('Registre algumas vendas para o sistema começar a gerar insights', '🤖')
        ])
      ]),

      el('div', { class: 'grid' }, [
        el('div', { class: 'card' }, [
          el('div', { class: 'card-cab' }, [
            el('h3', { text: 'Caixa em dinheiro' }),
            el('div', { class: 'espaco' }),
            el('a', { class: 'btn btn-vazio btn-sm', href: '#/caixa' }, 'Abrir')
          ]),
          el('div', { class: 'card-corpo' }, [
            el('div', { style: { fontSize: '26px', fontWeight: '800', color: 'var(--verde-700)' }, text: dinheiro(caixa.saldo_total) }),
            el('div', { class: 'pequeno texto-mudo mb', text: 'saldo disponível nas lojas' }),
            ...(caixa.saldos || []).map(s => el('div', { class: 'total-linha' }, [
              el('span', { class: 'pequeno', text: s.store_name }),
              el('span', { class: 'pequeno negrito', text: dinheiro(s.saldo) })
            ]))
          ])
        ]),

        el('div', { class: 'card' }, [
          el('div', { class: 'card-cab' }, [
            el('h3', { text: 'Estoque em alerta' }),
            el('div', { class: 'espaco' }),
            alertas.alertas.length ? el('span', { class: 'tag tag-vermelho', text: `${alertas.alertas.length}` }) : null
          ]),
          alertas.alertas.length
            ? el('div', { class: 'rolagem' }, alertas.alertas.slice(0, 12).map(x => el('div', {
                class: 'item-carrinho'
              }, [
                el('div', { class: 'info' }, [
                  el('div', { class: 'nome', text: x.product_name }),
                  el('div', { class: 'sub', text: `${x.store_name} · mínimo ${numero(x.min_stock)} ${x.unit}` })
                ]),
                el('span', { class: `tag ${x.qty <= 0 ? 'tag-vermelho' : 'tag-amarelo'}`, text: `${numero(x.qty)} ${x.unit}` })
              ])))
            : el('div', { class: 'card-corpo' }, [el('div', { class: 'aviso aviso-verde' }, '✅ Nenhum produto abaixo do estoque mínimo.')])
        ])
      ])
    ])
  );
}
