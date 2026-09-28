/* ============================================================
   Comissão por produto.

   A regra fica no cadastro do produto (percentual sobre a venda ou valor
   fixo por unidade). Aqui só se apura o período: o que cada produto gerou
   de comissão, para conferir e pagar.
   ============================================================ */
import { listar, config, comissaoDoItem, registrarDespesa, saldos } from '../db.js';
import {
  el, limpar, dinheiro, numero, percentual, dataBR, erro, sucesso, painel, vazio,
  kpi, cartao, hoje, diasAtras, confirmar, anexar } from '../ui.js';
import { pdfTabela, entregarPdf, dinheiroPdf, qtdPdf } from '../documentos.js';

const dia = (iso) => String(iso).slice(0, 10);

export async function render(raiz) {
  const [vendas, produtos, loja] = await Promise.all([
    listar('vendas'), listar('produtos'), config('loja', {})
  ]);
  const porId = new Map(produtos.map(p => [p.id, p]));
  const comComissao = produtos.filter(p => Number(p.comissao) > 0);

  const de = el('input', { type: 'date', value: diasAtras(29) });
  const ate = el('input', { type: 'date', value: hoje() });
  const corpo = el('div');
  let apuracao = null;

  [de, ate].forEach(c => c.addEventListener('change', desenhar));

  anexar(raiz,
    el('div', { class: 'linha mb' }, [
      el('div', { class: 'campo', style: { margin: 0 } }, [el('label', { text: 'De' }), de]),
      el('div', { class: 'campo', style: { margin: 0 } }, [el('label', { text: 'Até' }), ate])
    ]),
    el('div', { class: 'grade2 mb' }, [
      el('button', { class: 'btn btn-vazio btn-sm', onclick: () => imprimirPdf() }, '📄 Relatório em PDF'),
      el('button', { class: 'btn btn-acao btn-sm', onclick: () => lancarPagamento() }, '💸 Lançar pagamento')
    ]),
    corpo
  );

  function apurar() {
    const validas = vendas.filter(v => !v.cancelada && dia(v.data) >= de.value && dia(v.data) <= ate.value);
    const linhas = new Map();
    for (const v of validas) {
      for (const item of v.itens) {
        const produto = porId.get(item.produtoId);
        const comissao = comissaoDoItem(produto, item);
        if (!produto || !Number(produto.comissao)) continue;
        const atual = linhas.get(item.produtoId) || {
          nome: produto.nome, unidade: produto.unidade,
          regra: produto.comissaoTipo === 'valor'
            ? `${dinheiro(produto.comissao)}/${produto.unidade}`
            : `${percentual(produto.comissao)} da venda`,
          qtd: 0, faturamento: 0, comissao: 0
        };
        atual.qtd += Number(item.qtd) || 0;
        atual.faturamento += Number(item.total) || 0;
        atual.comissao += comissao;
        linhas.set(item.produtoId, atual);
      }
    }
    const lista = [...linhas.values()]
      .map(l => ({ ...l, comissao: Number(l.comissao.toFixed(2)) }))
      .sort((a, b) => b.comissao - a.comissao);
    return {
      de: de.value, ate: ate.value, lista,
      vendas: validas.length,
      faturamento: lista.reduce((a, l) => a + l.faturamento, 0),
      total: Number(lista.reduce((a, l) => a + l.comissao, 0).toFixed(2))
    };
  }

  function desenhar() {
    apuracao = apurar();
    const a = apuracao;

    anexar(limpar(corpo),
      el('div', { class: 'grade2 mb' }, [
        kpi({ rot: 'Comissão a pagar', val: dinheiro(a.total), cor: 'verde',
              det: `${numero(a.lista.length)} produto(s) com regra` }),
        kpi({ rot: 'Faturamento comissionado', val: dinheiro(a.faturamento), cor: 'amarelo',
              det: a.faturamento ? `${percentual(a.total / a.faturamento * 100)} do valor vendido` : '—' })
      ]),

      !comComissao.length
        ? el('div', { class: 'aviso aviso-amarelo' },
            'Nenhum produto tem comissão cadastrada. Abra o produto no Estoque e informe o percentual ' +
            'sobre a venda ou o valor fixo por unidade.')
        : null,

      a.lista.length
        ? cartao('Comissão por produto', el('div', { class: 'lista' }, a.lista.map(l =>
            el('div', { class: 'item' }, [
              el('div', { class: 'info' }, [
                el('div', { class: 'titulo', text: l.nome }),
                el('div', { class: 'sub', text:
                  `${numero(l.qtd, 2)} ${l.unidade} · ${dinheiro(l.faturamento)} · ${l.regra}` })
              ]),
              el('span', { class: 'valor', text: dinheiro(l.comissao) })
            ]))))
        : vazio('Nenhuma venda de produto comissionado no período', '💸'),

      el('div', { class: 'pq mudo', text: `Período: ${dataBR(a.de)} a ${dataBR(a.ate)} · ${numero(a.vendas)} venda(s) consideradas. Vendas canceladas ficam de fora.` })
    );
  }

  async function imprimirPdf() {
    if (!apuracao?.lista.length) { erro('Nada a imprimir neste período'); return; }
    const a = apuracao;
    try {
      const bytes = pdfTabela({
        titulo: 'RELATÓRIO DE COMISSÕES',
        subtitulo: `${dataBR(a.de)} a ${dataBR(a.ate)}`,
        loja, paisagem: true,
        colunas: [
          { titulo: 'PRODUTO', campo: 'nome', peso: 4 },
          { titulo: 'REGRA', campo: 'regra', peso: 2 },
          { titulo: 'QTD', campo: 'qtd', peso: 1.1, alinhamento: 'direita' },
          { titulo: 'FATURAMENTO', campo: 'faturamento', peso: 1.8, alinhamento: 'direita' },
          { titulo: 'COMISSÃO', campo: 'comissao', peso: 1.6, alinhamento: 'direita' }
        ],
        linhas: a.lista.map(l => ({
          nome: l.nome, regra: l.regra, qtd: qtdPdf(l.qtd),
          faturamento: dinheiroPdf(l.faturamento), comissao: dinheiroPdf(l.comissao)
        })),
        resumo: [
          { rotulo: 'Faturamento comissionado', valor: dinheiroPdf(a.faturamento) },
          { rotulo: 'TOTAL DE COMISSÃO', valor: dinheiroPdf(a.total) }
        ],
        observacao: 'Apuração pelas vendas efetivadas no período, já descontados os cancelamentos. '
          + 'A regra de cada produto é a cadastrada no estoque na data desta emissão.'
      });
      sucesso(await entregarPdf(bytes, `comissoes-${a.de}-a-${a.ate}.pdf`));
    } catch (e) { erro('Não consegui gerar o PDF: ' + e.message); }
  }

  async function lancarPagamento() {
    if (!apuracao?.total) { erro('Não há comissão apurada neste período'); return; }
    const contas = await saldos();
    const valor = el('input', { type: 'number', inputmode: 'decimal', step: '0.01', value: apuracao.total.toFixed(2) });
    const quem = el('input', { type: 'text', placeholder: 'Nome do vendedor' });
    const conta = el('select', {}, [
      ...contas.map(c => el('option', { value: c.id, text: `${c.nome} — ${dinheiro(c.saldo)}` })),
      el('option', { value: '', text: 'Não lançar em conta (só registrar)' })
    ]);

    painel({
      titulo: 'Pagar comissão',
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-azul' },
          `Apurado de ${dataBR(apuracao.de)} a ${dataBR(apuracao.ate)}: ${dinheiro(apuracao.total)}. ` +
          'O pagamento entra em Despesas, na categoria comissão.'),
        el('div', { class: 'campo' }, [el('label', { text: 'Vendedor' }), quem]),
        el('div', { class: 'campo' }, [el('label', { text: 'Valor (R$)' }), valor]),
        el('div', { class: 'campo' }, [el('label', { text: 'Pago por qual conta' }), conta])
      ]),
      acoes: [{
        rotulo: 'Lançar', class: 'btn-primario', acao: async (fechar) => {
          const v = Number(valor.value);
          if (!(v > 0)) { erro('Informe o valor'); return; }
          const contaId = conta.value ? Number(conta.value) : null;
          const escolhida = contas.find(c => c.id === contaId);
          if (escolhida && escolhida.saldo < v && !await confirmar(
            `${escolhida.nome} tem ${dinheiro(escolhida.saldo)}. Lançar mesmo assim deixa o saldo negativo.`)) return;
          await registrarDespesa({
            data: new Date().toISOString(), categoria: 'comissao', valor: v,
            descricao: `Comissão ${quem.value.trim() || 'vendedor'} — ${dataBR(apuracao.de)} a ${dataBR(apuracao.ate)}`,
            contaId, contaNome: escolhida?.nome || null
          });
          sucesso('Comissão lançada em Despesas');
          fechar();
        }
      }]
    });
  }

  desenhar();
}
