/* Painel do dia: o que o responsável precisa ver ao abrir a loja. */
import { listar, saldoCaixa } from '../db.js';
import { estado, recalcularPendencias } from '../app.js';
import { el, kpi, dinheiro, numero, linha, dataCurta, vazio, cartao, percentual } from '../ui.js';

const dia = (iso) => String(iso).slice(0, 10);

export async function render(raiz) {
  const [vendas, produtos, despesas, saldo] = await Promise.all([
    listar('vendas'), listar('produtos'), listar('despesas'), saldoCaixa()
  ]);
  const validas = vendas.filter(v => !v.cancelada);
  const hoje = dia(new Date().toISOString());

  const doDia = validas.filter(v => dia(v.data) === hoje);
  const faturamentoHoje = doDia.reduce((a, v) => a + v.total, 0);

  const inicio30 = dia(new Date(Date.now() - 29 * 864e5).toISOString());
  const do30 = validas.filter(v => dia(v.data) >= inicio30);
  const faturamento30 = do30.reduce((a, v) => a + v.total, 0);
  const lucro30 = do30.reduce((a, v) => a + (v.lucro || 0), 0);
  const despesas30 = despesas.filter(d => dia(d.data) >= inicio30).reduce((a, d) => a + d.valor, 0);

  // série dos últimos 14 dias
  const serie = [];
  for (let i = 13; i >= 0; i--) {
    const d = dia(new Date(Date.now() - i * 864e5).toISOString());
    serie.push({ rotulo: dataCurta(d), valor: validas.filter(v => dia(v.data) === d).reduce((a, v) => a + v.total, 0) });
  }

  const baixos = produtos.filter(p => p.ativo !== false && p.estoqueMin > 0 && p.estoque <= p.estoqueMin);
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';

  raiz.append(
    el('div', { class: 'mb' }, [
      el('h2', { style: { fontSize: '20px' }, text: `${saudacao}!` }),
      el('div', { class: 'pq mudo', text: estado.loja?.nome || 'Loja Caruaru' })
    ]),

    el('a', { class: 'btn btn-acao btn-bloco btn-gg mb', href: '#/pdv' }, '🧾  Nova venda'),

    el('div', { class: 'grade2 mb' }, [
      kpi({ rot: 'Vendas de hoje', val: dinheiro(faturamentoHoje), det: `${numero(doDia.length)} venda(s)`, cor: 'verde' }),
      kpi({ rot: 'Caixa em dinheiro', val: dinheiro(saldo), det: 'disponível na loja', cor: 'amarelo' })
    ]),

    cartao('Últimos 14 dias', el('div', { class: 'cartao-corpo' }, [
      linha(serie),
      el('div', { class: 'grade3 mt' }, [
        el('div', {}, [el('div', { class: 'pq mudo', text: 'Faturamento 30d' }), el('div', { class: 'negrito', text: dinheiro(faturamento30) })]),
        el('div', {}, [el('div', { class: 'pq mudo', text: 'Lucro bruto' }), el('div', { class: 'negrito', text: dinheiro(lucro30) })]),
        el('div', {}, [el('div', { class: 'pq mudo', text: 'Resultado' }), el('div', {
          class: 'negrito', style: { color: lucro30 - despesas30 >= 0 ? 'var(--verde-700)' : 'var(--vermelho-600)' },
          text: dinheiro(lucro30 - despesas30)
        })])
      ])
    ])),

    cartao(
      baixos.length ? `⚠️ ${baixos.length} produto(s) para repor` : '📦 Estoque',
      baixos.length
        ? el('div', { class: 'lista' }, baixos.slice(0, 6).map(p => el('div', { class: 'item' }, [
            el('div', { class: 'info' }, [
              el('div', { class: 'titulo', text: p.nome }),
              el('div', { class: 'sub', text: `mínimo ${numero(p.estoqueMin)} ${p.unidade}` })
            ]),
            el('span', { class: `etiqueta ${p.estoque <= 0 ? 'et-vermelha' : 'et-amarela'}`, text: `${numero(p.estoque)} ${p.unidade}` })
          ])))
        : el('div', { class: 'cartao-corpo' }, el('div', { class: 'aviso aviso-verde', style: { margin: 0 } }, '✅ Nenhum produto no estoque mínimo.')),
      el('a', { class: 'btn btn-vazio btn-sm', href: '#/estoque' }, 'Abrir')
    ),

    el('div', { class: 'grade2' }, [
      el('a', { class: 'btn btn-vazio', href: '#/despesas' }, '📉 Despesa'),
      el('a', { class: 'btn btn-vazio', href: '#/relatorio' }, '📊 Resultado')
    ])
  );

  recalcularPendencias();
}
