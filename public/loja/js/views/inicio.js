/* ============================================================
   Início: o que o responsável precisa ver ao abrir a loja.

   Resultado das vendas e movimento das contas do mês ou do ano (um toque
   troca), comparado com o mesmo período anterior; vendas de hoje; e o que
   está para repor.
   ============================================================ */
import { listar, saldos } from '../db.js';
import { estado, recalcularPendencias } from '../app.js';
import { pagamentosDe, nomeForma } from '../regras.js';
import { el, limpar, kpi, dinheiro, numero, linha, barras, dataCurta, cartao, percentual, anexar } from '../ui.js';

const dia = (iso) => String(iso).slice(0, 10);
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ROTULO_LANCAMENTO = {
  venda: 'Vendas', receita: 'Outras receitas', despesa: 'Despesas', compra: 'Compras de mercadoria',
  estorno: 'Estornos', ajuste: 'Acertos', transferencia_entrada: 'Transferências recebidas',
  transferencia_saida: 'Transferências enviadas'
};

/** Período atual e o anterior equivalente (mês passado até o mesmo dia / ano passado até a mesma data). */
function periodos(modo) {
  const agora = new Date();
  const hoje = iso(agora);
  if (modo === 'ano') {
    const ano = agora.getFullYear();
    return {
      titulo: String(ano), de: `${ano}-01-01`, ate: hoje,
      antes: { de: `${ano - 1}-01-01`, ate: `${ano - 1}${hoje.slice(4)}`, titulo: `${ano - 1} até ${hoje.slice(8)}/${hoje.slice(5, 7)}` }
    };
  }
  const inicio = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const inicioAnterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
  const fimAnterior = new Date(agora.getFullYear(), agora.getMonth(), 0);
  const mesmoDia = new Date(inicioAnterior.getFullYear(), inicioAnterior.getMonth(), Math.min(agora.getDate(), fimAnterior.getDate()));
  return {
    titulo: agora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    de: iso(inicio), ate: hoje,
    antes: { de: iso(inicioAnterior), ate: iso(mesmoDia), titulo: `${MESES[inicioAnterior.getMonth()]} até dia ${mesmoDia.getDate()}` }
  };
}

function resumoVendas(validas, despesas, de, ate) {
  const vendas = validas.filter(v => dia(v.data) >= de && dia(v.data) <= ate);
  const faturamento = vendas.reduce((a, v) => a + v.total, 0);
  const lucro = vendas.reduce((a, v) => a + (v.lucro || 0), 0);
  const descontos = vendas.reduce((a, v) => a + (v.descontoQuantidade || 0) + (v.descontoItens || 0) + (v.desconto || 0), 0);
  const gastos = despesas.filter(d => dia(d.data) >= de && dia(d.data) <= ate).reduce((a, d) => a + d.valor, 0);
  const porForma = {};
  for (const v of vendas) for (const p of pagamentosDe(v)) porForma[p.forma] = (porForma[p.forma] || 0) + p.valor;
  return {
    vendas, faturamento, lucro, descontos, despesas: gastos,
    ticket: vendas.length ? faturamento / vendas.length : 0,
    resultado: lucro - gastos, porForma
  };
}

/** Por conta: saldo no início do período, entradas, saídas e saldo no fim. */
function movimentoContas(contas, lancamentos, de, ate) {
  return contas.map(c => {
    const daConta = lancamentos.filter(l => l.contaId === c.id);
    const antes = daConta.filter(l => dia(l.data) < de).reduce((a, l) => a + l.valor, 0);
    const noPeriodo = daConta.filter(l => dia(l.data) >= de && dia(l.data) <= ate);
    const entradas = noPeriodo.filter(l => l.valor > 0).reduce((a, l) => a + l.valor, 0);
    const saidas = noPeriodo.filter(l => l.valor < 0).reduce((a, l) => a - l.valor, 0);
    const porTipo = {};
    for (const l of noPeriodo) porTipo[l.tipo] = (porTipo[l.tipo] || 0) + l.valor;
    const inicial = (c.saldoInicial || 0) + antes;
    return { conta: c, inicial, entradas, saidas, final: inicial + entradas - saidas, porTipo, transferencias:
      noPeriodo.filter(l => String(l.tipo).startsWith('transferencia')).reduce((a, l) => a + l.valor, 0) };
  });
}

const variacao = (atual, anterior) => {
  if (!anterior) return null;
  const v = (atual - anterior) / Math.abs(anterior) * 100;
  return `${v >= 0 ? '▲' : '▼'} ${percentual(Math.abs(v))}`;
};

export async function render(raiz) {
  const [vendas, produtos, despesas, contas, lancamentos] = await Promise.all([
    listar('vendas'), listar('produtos'), listar('despesas'), saldos(), listar('lancamentos')
  ]);
  const validas = vendas.filter(v => !v.cancelada);
  const hoje = iso(new Date());
  const doDia = validas.filter(v => dia(v.data) === hoje);
  const faturamentoHoje = doDia.reduce((a, v) => a + v.total, 0);

  let modo = 'mes';
  try { modo = localStorage.getItem('inicio.periodo') === 'ano' ? 'ano' : 'mes'; } catch {}

  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const areaPeriodo = el('div');
  const chips = el('div', { class: 'chips mb' });

  function desenharChips() {
    limpar(chips);
    for (const [id, rotulo] of [['mes', 'Este mês'], ['ano', 'Este ano']]) {
      anexar(chips, el('button', {
        class: `chip ${modo === id ? 'ativo' : ''}`, type: 'button',
        onclick: () => {
          modo = id;
          try { localStorage.setItem('inicio.periodo', id); } catch {}
          desenharChips(); desenharPeriodo();
        }
      }, rotulo));
    }
  }

  function desenharPeriodo() {
    const p = periodos(modo);
    const r = resumoVendas(validas, despesas, p.de, p.ate);
    const ant = resumoVendas(validas, despesas, p.antes.de, p.antes.ate);

    // gráfico: dia a dia no mês, mês a mês no ano
    let grafico;
    if (modo === 'mes') {
      const serie = [];
      for (let d = new Date(`${p.de}T12:00:00`); iso(d) <= p.ate; d.setDate(d.getDate() + 1)) {
        const chave = iso(d);
        serie.push({ rotulo: dataCurta(chave), valor: r.vendas.filter(v => dia(v.data) === chave).reduce((a, v) => a + v.total, 0) });
      }
      grafico = linha(serie.length > 1 ? serie : [...serie, ...serie]);
    } else {
      const ano = p.de.slice(0, 4);
      const meses = MESES.map((m, i) => {
        const prefixo = `${ano}-${String(i + 1).padStart(2, '0')}`;
        return { rotulo: m, valor: r.vendas.filter(v => dia(v.data).startsWith(prefixo)).reduce((a, v) => a + v.total, 0) };
      }).filter((m, i) => i <= new Date().getMonth());
      grafico = barras(meses, { cor: '#1567C4' });
    }

    const contasMov = movimentoContas(contas, lancamentos, p.de, p.ate);
    const total = contasMov.reduce((a, c) => ({
      inicial: a.inicial + c.inicial, final: a.final + c.final,
      // no total da loja, transferência entre contas não é entrada nem saída
      entradas: a.entradas + c.entradas - Math.max(0, c.porTipo.transferencia_entrada || 0),
      saidas: a.saidas + c.saidas + Math.min(0, c.porTipo.transferencia_saida || 0)
    }), { inicial: 0, final: 0, entradas: 0, saidas: 0 });

    const formas = Object.entries(r.porForma).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

    anexar(limpar(areaPeriodo),
      cartao(`📊 Vendas — ${p.titulo}`, el('div', { class: 'cartao-corpo' }, [
        el('div', { class: 'grade2 mb' }, [
          kpi({ rot: 'Faturamento', val: dinheiro(r.faturamento), cor: 'verde',
                det: variacao(r.faturamento, ant.faturamento) ? `${variacao(r.faturamento, ant.faturamento)} vs. ${p.antes.titulo}` : `${numero(r.vendas.length)} venda(s)` }),
          kpi({ rot: 'Vendas', val: numero(r.vendas.length), det: `ticket médio ${dinheiro(r.ticket)}`, cor: 'amarelo' }),
          kpi({ rot: 'Lucro bruto', val: dinheiro(r.lucro), det: `margem ${percentual(r.faturamento ? r.lucro / r.faturamento * 100 : 0)}` }),
          kpi({ rot: 'Resultado', val: dinheiro(r.resultado), cor: r.resultado >= 0 ? 'verde' : 'vermelho',
                det: `após ${dinheiro(r.despesas)} de despesas` })
        ]),
        r.descontos > 0
          ? el('div', { class: 'pq mudo mb', text: `Descontos concedidos no período: ${dinheiro(r.descontos)}` + (r.faturamento + r.descontos > 0
              ? ` (${percentual(r.descontos / (r.faturamento + r.descontos) * 100)} do valor de tabela)` : '') })
          : null,
        grafico,
        formas.length
          ? el('div', { class: 'mt' }, [
              el('div', { class: 'pq negrito mb', text: 'Como os clientes pagaram' }),
              barras(formas.map(([f, v]) => ({ rotulo: nomeForma(f), valor: v })), { cor: '#2FA968' })
            ])
          : null
      ]), el('a', { class: 'btn btn-vazio btn-sm', href: '#/relatorio' }, 'Detalhes')),

      cartao(`🏦 Contas — ${p.titulo}`, el('div', {}, [
        el('div', { class: 'tabela-mov cab', style: { gridTemplateColumns: 'minmax(0,1.6fr) repeat(4,minmax(0,1fr))' } }, [
          el('span', { text: 'Conta' }), el('span', { text: 'Início' }), el('span', { text: 'Entrou' }),
          el('span', { text: 'Saiu' }), el('span', { text: 'Agora' })
        ]),
        ...contasMov.map(c => el('a', {
          class: 'tabela-mov', href: '#/contas',
          style: { gridTemplateColumns: 'minmax(0,1.6fr) repeat(4,minmax(0,1fr))', textDecoration: 'none' },
          title: Object.entries(c.porTipo).map(([t, v]) => `${ROTULO_LANCAMENTO[t] || t}: ${dinheiro(v)}`).join('\n')
        }, [
          el('span', { class: 'nome' }, [el('b', { text: c.conta.nome })]),
          el('span', { text: compacto(c.inicial) }),
          el('span', { class: 'ent', text: c.entradas ? '+' + compacto(c.entradas) : '—' }),
          el('span', { class: 'sai', text: c.saidas ? '−' + compacto(c.saidas) : '—' }),
          el('span', { class: 'fim', style: c.final < 0 ? { color: 'var(--vermelho-600)' } : {}, text: compacto(c.final) })
        ])),
        el('div', { class: 'tabela-mov total', style: { gridTemplateColumns: 'minmax(0,1.6fr) repeat(4,minmax(0,1fr))' } }, [
          el('span', { text: 'TOTAL' }), el('span', { text: compacto(total.inicial) }),
          el('span', { class: 'ent', text: '+' + compacto(total.entradas) }),
          el('span', { class: 'sai', text: '−' + compacto(total.saidas) }),
          el('span', { class: 'fim', text: compacto(total.final) })
        ]),
        el('div', { class: 'cartao-corpo pq mudo', text:
          'Entrou e saiu incluem vendas, receitas, despesas, compras e estornos. No total, as transferências entre ' +
          'contas não contam — o dinheiro só mudou de lugar.' })
      ]), el('a', { class: 'btn btn-vazio btn-sm', href: '#/contas' }, 'Abrir'))
    );
  }

  const baixos = produtos.filter(p => p.ativo !== false && p.estoqueMin > 0 && p.estoque <= p.estoqueMin);

  anexar(raiz,
    el('div', { class: 'mb' }, [
      el('h2', { style: { fontSize: '20px' }, text: `${saudacao}!` }),
      el('div', { class: 'pq mudo', text: estado.loja?.nome || 'Loja Caruaru' })
    ]),
    el('a', { class: 'btn btn-acao btn-bloco btn-gg mb', href: '#/pdv' }, '🧾  Nova venda'),
    el('div', { class: 'grade2 mb' }, [
      kpi({ rot: 'Vendas de hoje', val: dinheiro(faturamentoHoje), det: `${numero(doDia.length)} venda(s)`, cor: 'verde' }),
      kpi({ rot: 'Saldo das contas', val: dinheiro(contas.reduce((a, c) => a + c.saldo, 0)),
            det: contas.map(c => `${nomeCurto(c.nome)} ${dinheiro(c.saldo)}`).slice(0, 3).join(' · '), cor: 'amarelo' })
    ]),
    chips,
    areaPeriodo,
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
    )
  );

  desenharChips();
  desenharPeriodo();
  recalcularPendencias();
}

/** "Caixa da loja" → "Caixa", "Conta PIX" → "PIX". */
function nomeCurto(nome) {
  const partes = String(nome || '').split(' ');
  return partes[0].toLowerCase() === 'conta' && partes[1] ? partes[1] : partes[0];
}

/** R$ sem centavos para caber na tabela do celular (12.345 em vez de R$ 12.345,67). */
function compacto(v) {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  const texto = abs >= 100000 ? `${(abs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
    : abs.toLocaleString('pt-BR', { maximumFractionDigits: abs >= 1000 ? 0 : 2, minimumFractionDigits: abs >= 1000 ? 0 : 2 });
  return (n < 0 ? '−' : '') + texto;
}
