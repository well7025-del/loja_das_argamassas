/* ============================================================
   Comissão por produto.

   A regra fica no cadastro do produto (percentual sobre a venda ou valor
   fixo por unidade). Aqui só se apura o período: o que cada produto gerou
   de comissão, para conferir e pagar.

   A percentual incide sobre o valor LÍQUIDO de cada item: depois do desconto
   por quantidade, do desconto dado no item e da parte que cabe ao item no
   desconto geral do pedido. A por unidade não depende de preço.
   ============================================================ */
import { listar, config, registrarDespesa, saldos } from '../db.js';
import { comissaoDoItem, valorLiquidoItem } from '../regras.js';
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
        if (!produto || !Number(produto.comissao)) continue;
        const comissao = comissaoDoItem(produto, item, v);
        const liquido = valorLiquidoItem(v, item);
        const atual = linhas.get(item.produtoId) || {
          nome: produto.nome, unidade: produto.unidade,
          regra: produto.comissaoTipo === 'valor'
            ? `${dinheiro(produto.comissao)}/${produto.unidade}`
            : `${percentual(produto.comissao)} da venda`,
          qtd: 0, bruto: 0, descontos: 0, faturamento: 0, comissao: 0
        };
        const tabela = (Number(item.precoTabela) || Number(item.preco) || 0) * (Number(item.qtd) || 0);
        atual.qtd += Number(item.qtd) || 0;
        atual.bruto += tabela;
        atual.descontos += Math.max(0, tabela - liquido);
        atual.faturamento += liquido;
        atual.comissao += comissao;
        linhas.set(item.produtoId, atual);
      }
    }
    const lista = [...linhas.values()]
      .map(l => ({ ...l, comissao: Number(l.comissao.toFixed(2)), bruto: Number(l.bruto.toFixed(2)),
                   descontos: Number(l.descontos.toFixed(2)), faturamento: Number(l.faturamento.toFixed(2)) }))
      .sort((a, b) => b.comissao - a.comissao);
    return {
      de: de.value, ate: ate.value, lista,
      vendas: validas.length,
      faturamento: lista.reduce((a, l) => a + l.faturamento, 0),
      bruto: lista.reduce((a, l) => a + l.bruto, 0),
      descontos: lista.reduce((a, l) => a + l.descontos, 0),
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
        kpi({ rot: 'Base líquida', val: dinheiro(a.faturamento), cor: 'amarelo',
              det: a.descontos > 0 ? `já sem ${dinheiro(a.descontos)} de descontos` : 'sem descontos no período' })
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
                  `${numero(l.qtd, 2)} ${l.unidade} · líquido ${dinheiro(l.faturamento)}` +
                  (l.descontos > 0 ? ` (−${dinheiro(l.descontos)} desc.)` : '') + ` · ${l.regra}` })
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
          { titulo: 'VALOR TABELA', campo: 'bruto', peso: 1.7, alinhamento: 'direita' },
          { titulo: 'DESCONTOS', campo: 'descontos', peso: 1.5, alinhamento: 'direita' },
          { titulo: 'LÍQUIDO', campo: 'faturamento', peso: 1.7, alinhamento: 'direita' },
          { titulo: 'COMISSÃO', campo: 'comissao', peso: 1.6, alinhamento: 'direita' }
        ],
        linhas: a.lista.map(l => ({
          nome: l.nome, regra: l.regra, qtd: qtdPdf(l.qtd),
          bruto: dinheiroPdf(l.bruto), descontos: dinheiroPdf(l.descontos),
          faturamento: dinheiroPdf(l.faturamento), comissao: dinheiroPdf(l.comissao)
        })),
        resumo: [
          { rotulo: 'Valor de tabela', valor: dinheiroPdf(a.bruto) },
          { rotulo: 'Descontos concedidos', valor: '- ' + dinheiroPdf(a.descontos) },
          { rotulo: 'Base líquida da comissão', valor: dinheiroPdf(a.faturamento) },
          { rotulo: 'TOTAL DE COMISSÃO', valor: dinheiroPdf(a.total) }
        ],
        observacao: 'Apuração pelas vendas efetivadas no período, já descontados os cancelamentos. '
          + 'A comissão percentual incide sobre o valor líquido de cada item: tabela menos o desconto por '
          + 'quantidade, o desconto no item e a parte do item no desconto geral do pedido. A comissão por '
          + 'unidade não muda com desconto. A regra de cada produto é a cadastrada na data desta emissão.'
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
