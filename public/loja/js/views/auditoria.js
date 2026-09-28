/* ============================================================
   Relatórios de auditoria.

   Auditoria não é "quanto vendi" — é "o que aconteceu com o estoque e com
   o dinheiro, quem mandou e com qual documento". Todos os relatórios daqui
   saem em PDF e mostram a trilha: antes, depois, motivo, responsável.
   ============================================================ */
import { listar, config, documentosDe } from '../db.js';
import {
  el, limpar, dinheiro, numero, percentual, dataBR, dataHora, erro, sucesso, painel, vazio,
  kpi, cartao, hoje, diasAtras, anexar } from '../ui.js';
import { pdfTabela, entregarPdf, dinheiroPdf, qtdPdf } from '../documentos.js';

const dia = (iso) => String(iso).slice(0, 10);
const MOTIVO = {
  preco: 'Mudança de preço',
  perda: 'Perda / avaria', devolucao: 'Devolução de cliente',
  devolucao_fornecedor: 'Devolução ao fornecedor', inventario: 'Acerto de inventário',
  balanco: 'Balanço', bonificacao: 'Bonificação', uso_interno: 'Uso interno'
};

export async function render(raiz) {
  const de = el('input', { type: 'date', value: diasAtras(89) });
  const ate = el('input', { type: 'date', value: hoje() });
  const corpo = el('div');
  [de, ate].forEach(c => c.addEventListener('change', desenhar));

  const dados = {};
  [dados.vendas, dados.ajustes, dados.produtos, dados.lancamentos, dados.despesas,
   dados.inventarios, dados.documentos, dados.contas, dados.loja] = await Promise.all([
    listar('vendas'), listar('ajustes'), listar('produtos'), listar('lancamentos'),
    listar('despesas'), listar('inventarios'), listar('documentos'), listar('contas'),
    config('loja', {})
  ]);
  const nomeConta = (id) => dados.contas.find(c => c.id === id)?.nome || `conta ${id}`;

  anexar(raiz,
    el('div', { class: 'aviso aviso-azul' },
      'Relatórios de conferência: alterações de venda, ajustes de estoque, mudanças de preço, ' +
      'documentos anexados e movimento financeiro. Todos saem em PDF.'),
    el('div', { class: 'linha mb' }, [
      el('div', { class: 'campo', style: { margin: 0 } }, [el('label', { text: 'De' }), de]),
      el('div', { class: 'campo', style: { margin: 0 } }, [el('label', { text: 'Até' }), ate])
    ]),
    corpo
  );

  const noPeriodo = (lista, campo = 'data') =>
    lista.filter(r => dia(r[campo]) >= de.value && dia(r[campo]) <= ate.value);

  /* ---------------- Tela ---------------- */

  function desenhar() {
    const vendas = noPeriodo(dados.vendas);
    const canceladas = vendas.filter(v => v.cancelada);
    const alteradas = vendas.filter(v => (v.alteracoes || []).length);
    // alterarPreco também grava em "ajustes"; separamos para não misturar
    // mudança de tabela com movimento físico de estoque
    const todosAjustes = noPeriodo(dados.ajustes);
    const ajustes = todosAjustes.filter(a => a.motivo !== 'preco');
    const mudancasPreco = todosAjustes.filter(a => a.motivo === 'preco');
    const semDocumento = ajustes.filter(a =>
      !dados.documentos.some(d => d.refTipo === 'ajuste' && d.refId === a.id));
    const semComprovante = vendas.filter(v => !v.cancelada && !v.temComprovante && v.pagamento !== 'dinheiro');
    const naoConciliadas = vendas.filter(v => !v.cancelada && !v.conciliada && v.pagamento !== 'dinheiro');

    const valorAjustes = ajustes.reduce((a, r) => a + Math.abs(r.valorCusto || 0), 0);

    anexar(limpar(corpo),
      el('div', { class: 'grade2 mb' }, [
        kpi({ rot: 'Vendas canceladas', val: numero(canceladas.length),
              cor: canceladas.length ? 'vermelho' : '', det: dinheiro(canceladas.reduce((a, v) => a + v.total, 0)) }),
        kpi({ rot: 'Vendas alteradas', val: numero(alteradas.length), cor: alteradas.length ? 'amarelo' : '' }),
        kpi({ rot: 'Ajustes de estoque', val: numero(ajustes.length), det: dinheiro(valorAjustes) }),
        kpi({ rot: 'Mudanças de preço', val: numero(mudancasPreco.length) })
      ]),

      semDocumento.length
        ? el('div', { class: 'aviso aviso-vermelho' },
            `⚠️ ${numero(semDocumento.length)} ajuste(s) de estoque sem documento anexado.`)
        : el('div', { class: 'aviso aviso-verde', text: '✅ Todo ajuste de estoque do período tem documento anexado.' }),

      cartao('Relatórios', el('div', { class: 'lista' }, [
        item('🧾', 'Vendas canceladas e alteradas', `${canceladas.length + alteradas.length} ocorrência(s)`,
          () => pdfVendasIrregulares(vendas, canceladas, alteradas)),
        item('📦', 'Ajustes extraordinários de estoque', `${ajustes.length} lançamento(s) · ${dinheiro(valorAjustes)}`,
          () => pdfAjustes(ajustes)),
        item('🏷️', 'Alterações de preço de venda', `${mudancasPreco.length} mudança(s)`,
          () => pdfPrecos(mudancasPreco)),
        item('📄', 'Vendas sem comprovante anexado', `${semComprovante.length} venda(s)`,
          () => pdfSemComprovante(semComprovante)),
        item('🏦', 'Vendas ainda não conferidas no extrato', `${naoConciliadas.length} venda(s)`,
          () => pdfNaoConciliadas(naoConciliadas)),
        item('💰', 'Razão das contas (movimento financeiro)', `${noPeriodo(dados.lancamentos).length} lançamento(s)`,
          () => pdfRazao(noPeriodo(dados.lancamentos))),
        item('📋', 'Posição de estoque valorizada', `${dados.produtos.length} produto(s)`,
          () => pdfPosicaoEstoque())
      ])),

      ajustes.length
        ? cartao('Últimos ajustes de estoque', el('div', { class: 'lista' },
            [...ajustes].sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 25)
              .map(a => el('button', { class: 'item', onclick: () => verAjuste(a) }, [
                el('div', { class: 'info' }, [
                  el('div', { class: 'titulo', text: a.produtoNome }),
                  el('div', { class: 'sub', text:
                    `${dataBR(a.data)} · ${MOTIVO[a.motivo] || a.motivo} · ${a.antes} → ${a.depois} ${a.unidade}`
                    + (a.responsavel ? ' · ' + a.responsavel : '') })
                ]),
                el('span', {
                  class: 'valor',
                  style: { color: a.diferenca < 0 ? 'var(--vermelho-600)' : 'var(--verde-700)' },
                  text: `${a.diferenca > 0 ? '+' : ''}${numero(a.diferenca, 2)}`
                })
              ]))))
        : vazio('Nenhum ajuste de estoque no período', '📦')
    );
  }

  const item = (icone, titulo, sub, acao) =>
    el('button', { class: 'item', onclick: acao }, [
      el('span', { style: { fontSize: '21px' }, text: icone }),
      el('div', { class: 'info' }, [
        el('div', { class: 'titulo', text: titulo }),
        el('div', { class: 'sub', text: sub })
      ]),
      el('span', { class: 'mudo', text: '📄' })
    ]);

  async function verAjuste(ajuste) {
    const docs = await documentosDe('ajuste', ajuste.id);
    painel({
      titulo: MOTIVO[ajuste.motivo] || ajuste.motivo,
      corpo: el('div', {}, [
        el('div', { class: 'kpi mb' }, [
          el('div', { class: 'rot', text: ajuste.produtoNome }),
          el('div', { class: 'val', text: `${numero(ajuste.antes, 2)} → ${numero(ajuste.depois, 2)} ${ajuste.unidade}` }),
          el('div', { class: 'det', text: `${dataHora(ajuste.data)} · impacto de ${dinheiro(ajuste.valorCusto)} a custo` })
        ]),
        ajuste.responsavel ? el('div', { class: 'pq mudo', text: `Responsável: ${ajuste.responsavel}` }) : null,
        ajuste.observacao ? el('div', { class: 'aviso aviso-amarelo', text: ajuste.observacao }) : null,
        docs.length
          ? el('div', { class: 'mt' }, [
              el('div', { class: 'pq negrito mb', text: 'Documento que autoriza' }),
              ...docs.map(d => el('img', { src: d.imagem, class: 'previa' }))
            ])
          : el('div', { class: 'aviso aviso-vermelho', text: '⚠️ Sem documento anexado a este ajuste.' })
      ])
    });
  }

  /* ---------------- PDFs ---------------- */

  const periodo = () => `${dataBR(de.value)} a ${dataBR(ate.value)}`;

  async function emitir(nome, opcoes) {
    try {
      const bytes = pdfTabela({ loja: dados.loja, subtitulo: periodo(), ...opcoes });
      sucesso(await entregarPdf(bytes, `${nome}-${de.value}-a-${ate.value}.pdf`));
    } catch (e) { erro('Não consegui gerar o PDF: ' + e.message); }
  }

  function pdfVendasIrregulares(vendas, canceladas, alteradas) {
    const linhas = [];
    if (canceladas.length) {
      linhas.push({ separador: 'VENDAS CANCELADAS' });
      for (const v of canceladas) linhas.push({
        codigo: v.codigo, data: dataBR(v.data), cliente: v.clienteNome || 'sem cliente',
        detalhe: `${v.itens.length} item(ns) · ${v.pagamento}`, valor: dinheiroPdf(v.total),
        cor: [0.78, 0.16, 0.16]
      });
    }
    if (alteradas.length) {
      linhas.push({ separador: 'VENDAS ALTERADAS APÓS O LANÇAMENTO' });
      for (const v of alteradas) for (const a of v.alteracoes) linhas.push({
        codigo: v.codigo, data: dataBR(a.data), cliente: v.clienteNome || 'sem cliente',
        detalhe: `${a.motivo || 'sem motivo'} · ${dinheiroPdf(a.de.total)} → ${dinheiroPdf(a.para.total)}`,
        valor: dinheiroPdf(v.total)
      });
    }
    if (!linhas.length) { erro('Nenhum cancelamento ou alteração no período'); return; }
    return emitir('auditoria-vendas', {
      titulo: 'VENDAS CANCELADAS E ALTERADAS', paisagem: true,
      colunas: [
        { titulo: 'VENDA', campo: 'codigo', peso: 1.4 },
        { titulo: 'DATA', campo: 'data', peso: 1.2 },
        { titulo: 'CLIENTE', campo: 'cliente', peso: 2.4 },
        { titulo: 'OCORRÊNCIA', campo: 'detalhe', peso: 4 },
        { titulo: 'VALOR', campo: 'valor', peso: 1.5, alinhamento: 'direita' }
      ],
      linhas,
      resumo: [
        { rotulo: 'Vendas no período', valor: String(vendas.length) },
        { rotulo: 'Canceladas', valor: `${canceladas.length} · ${dinheiroPdf(canceladas.reduce((a, v) => a + v.total, 0))}` },
        { rotulo: 'Alteradas', valor: String(alteradas.length) },
        { rotulo: '% de cancelamento', valor: vendas.length ? percentual(canceladas.length / vendas.length * 100) : '0%' }
      ],
      observacao: 'Cancelar devolve o estoque e estorna a conta. Alterar refaz o estoque e o lançamento financeiro; '
        + 'ambos ficam registrados com data e motivo.'
    });
  }

  function pdfAjustes(ajustes) {
    if (!ajustes.length) { erro('Nenhum ajuste de estoque no período'); return; }
    const comDoc = (a) => dados.documentos.some(d => d.refTipo === 'ajuste' && d.refId === a.id);
    return emitir('auditoria-ajustes', {
      titulo: 'AJUSTES EXTRAORDINÁRIOS DE ESTOQUE', paisagem: true,
      colunas: [
        { titulo: 'DATA', campo: 'data', peso: 1.2 },
        { titulo: 'PRODUTO', campo: 'produto', peso: 3 },
        { titulo: 'MOTIVO', campo: 'motivo', peso: 2 },
        { titulo: 'ANTES', campo: 'antes', peso: 1, alinhamento: 'direita' },
        { titulo: 'DEPOIS', campo: 'depois', peso: 1, alinhamento: 'direita' },
        { titulo: 'DIF.', campo: 'diferenca', peso: 1, alinhamento: 'direita' },
        { titulo: 'CUSTO', campo: 'valor', peso: 1.4, alinhamento: 'direita' },
        { titulo: 'DOC', campo: 'doc', peso: 0.8 },
        { titulo: 'RESPONSÁVEL', campo: 'responsavel', peso: 2 }
      ],
      linhas: [...ajustes].sort((a, b) => String(a.data).localeCompare(String(b.data))).map(a => ({
        data: dataBR(a.data), produto: a.produtoNome, motivo: MOTIVO[a.motivo] || a.motivo,
        antes: qtdPdf(a.antes), depois: qtdPdf(a.depois),
        diferenca: (a.diferenca > 0 ? '+' : '') + qtdPdf(a.diferenca),
        valor: dinheiroPdf(a.valorCusto), doc: comDoc(a) ? 'sim' : 'NAO',
        responsavel: a.responsavel || '—',
        cor: comDoc(a) ? null : [0.78, 0.16, 0.16]
      })),
      resumo: [
        { rotulo: 'Ajustes no período', valor: String(ajustes.length) },
        { rotulo: 'Sem documento anexado', valor: String(ajustes.filter(a => !comDoc(a)).length),
          cor: [0.78, 0.16, 0.16] },
        { rotulo: 'Perdas (a custo)', valor: dinheiroPdf(ajustes.filter(a => a.diferenca < 0).reduce((s, a) => s + Math.abs(a.valorCusto), 0)) },
        { rotulo: 'Entradas (a custo)', valor: dinheiroPdf(ajustes.filter(a => a.diferenca > 0).reduce((s, a) => s + a.valorCusto, 0)) }
      ],
      observacao: 'Linhas em vermelho são ajustes sem documento de autorização anexado. '
        + 'O valor é calculado pelo custo médio do produto na data do ajuste.'
    });
  }

  function pdfPrecos(mudancas) {
    if (!mudancas.length) { erro('Nenhuma mudança de preço no período'); return; }
    const temDoc = (a) => dados.documentos.some(d => d.refTipo === 'ajuste' && d.refId === a.id);
    const comDoc = mudancas.filter(temDoc).length;
    return emitir('auditoria-precos', {
      titulo: 'ALTERAÇÕES DE PREÇO DE VENDA', paisagem: true,
      colunas: [
        { titulo: 'DATA', campo: 'data', peso: 1.3 },
        { titulo: 'PRODUTO', campo: 'produto', peso: 3.5 },
        { titulo: 'DE', campo: 'antes', peso: 1.4, alinhamento: 'direita' },
        { titulo: 'PARA', campo: 'depois', peso: 1.4, alinhamento: 'direita' },
        { titulo: 'VARIAÇÃO', campo: 'variacao', peso: 1.3, alinhamento: 'direita' },
        { titulo: 'MOTIVO', campo: 'motivo', peso: 2.6 },
        { titulo: 'DOC', campo: 'doc', peso: 0.8 },
        { titulo: 'RESPONSÁVEL', campo: 'responsavel', peso: 2 }
      ],
      linhas: [...mudancas].sort((a, b) => String(a.data).localeCompare(String(b.data))).map(h => {
        const variacao = h.antes ? (h.depois - h.antes) / h.antes * 100 : 0;
        return {
          data: dataBR(h.data), produto: h.produtoNome,
          antes: dinheiroPdf(h.antes), depois: dinheiroPdf(h.depois),
          variacao: `${variacao >= 0 ? '+' : ''}${variacao.toFixed(1).replace('.', ',')}%`,
          motivo: h.observacao || '—', doc: temDoc(h) ? 'sim' : 'NAO',
          responsavel: h.responsavel || '—',
          cor: temDoc(h) ? null : [0.78, 0.16, 0.16]
        };
      }),
      resumo: [
        { rotulo: 'Alterações no período', valor: String(mudancas.length) },
        { rotulo: 'Com documento anexado', valor: String(comDoc) },
        { rotulo: 'Reduções de preço', valor: String(mudancas.filter(h => h.depois < h.antes).length) }
      ],
      observacao: 'Toda alteração de preço pede motivo e permite anexar o documento que autoriza.'
    });
  }

  function pdfSemComprovante(vendas) {
    if (!vendas.length) { sucesso('Todas as vendas eletrônicas do período têm comprovante'); return; }
    return emitir('auditoria-sem-comprovante', {
      titulo: 'VENDAS SEM COMPROVANTE ANEXADO',
      colunas: [
        { titulo: 'VENDA', campo: 'codigo', peso: 1.6 },
        { titulo: 'DATA', campo: 'data', peso: 1.4 },
        { titulo: 'CLIENTE', campo: 'cliente', peso: 3 },
        { titulo: 'PAGAMENTO', campo: 'pagamento', peso: 1.6 },
        { titulo: 'VALOR', campo: 'valor', peso: 1.6, alinhamento: 'direita' }
      ],
      linhas: vendas.map(v => ({
        codigo: v.codigo, data: dataBR(v.data), cliente: v.clienteNome || 'sem cliente',
        pagamento: v.pagamento, valor: dinheiroPdf(v.total)
      })),
      resumo: [
        { rotulo: 'Vendas sem comprovante', valor: String(vendas.length) },
        { rotulo: 'Valor envolvido', valor: dinheiroPdf(vendas.reduce((a, v) => a + v.total, 0)) }
      ],
      observacao: 'Vendas em dinheiro não entram nesta lista. Para PIX e cartão, o print do pagamento '
        + 'é a prova de que o valor entrou.'
    });
  }

  function pdfNaoConciliadas(vendas) {
    if (!vendas.length) { sucesso('Todas as vendas eletrônicas do período já foram conferidas no extrato'); return; }
    return emitir('auditoria-nao-conciliadas', {
      titulo: 'VENDAS NÃO CONFERIDAS NO EXTRATO',
      colunas: [
        { titulo: 'VENDA', campo: 'codigo', peso: 1.6 },
        { titulo: 'DATA', campo: 'data', peso: 1.4 },
        { titulo: 'CLIENTE', campo: 'cliente', peso: 3 },
        { titulo: 'PAGAMENTO', campo: 'pagamento', peso: 1.6 },
        { titulo: 'VALOR', campo: 'valor', peso: 1.6, alinhamento: 'direita' }
      ],
      linhas: vendas.map(v => ({
        codigo: v.codigo, data: dataBR(v.data), cliente: v.clienteNome || 'sem cliente',
        pagamento: v.pagamento, valor: dinheiroPdf(v.total)
      })),
      resumo: [
        { rotulo: 'Vendas pendentes', valor: String(vendas.length) },
        { rotulo: 'Valor pendente', valor: dinheiroPdf(vendas.reduce((a, v) => a + v.total, 0)) }
      ],
      observacao: 'Suba o extrato do banco e da maquininha em Conferência do extrato para casar estes valores.'
    });
  }

  function pdfRazao(lancamentos) {
    if (!lancamentos.length) { erro('Nenhum lançamento financeiro no período'); return; }
    const contas = new Map();
    for (const l of lancamentos) {
      if (!contas.has(l.contaId)) contas.set(l.contaId, []);
      contas.get(l.contaId).push(l);
    }
    const linhas = [];
    for (const [contaId, movimentos] of contas) {
      linhas.push({ separador: nomeConta(contaId).toUpperCase() });
      let saldo = 0;
      for (const l of [...movimentos].sort((a, b) => String(a.data).localeCompare(String(b.data)))) {
        saldo += l.valor;
        linhas.push({
          data: dataBR(l.data), tipo: l.tipo, descricao: l.descricao || '—',
          doc: l.temDocumento ? 'sim' : '—',
          valor: dinheiroPdf(l.valor), saldo: dinheiroPdf(saldo),
          cor: l.valor < 0 ? [0.78, 0.16, 0.16] : null
        });
      }
      linhas.push({ data: '', tipo: '', descricao: 'Movimento do período', doc: '',
        valor: dinheiroPdf(saldo), saldo: '', destaque: true });
    }
    return emitir('auditoria-razao', {
      titulo: 'RAZÃO DAS CONTAS', paisagem: true,
      colunas: [
        { titulo: 'DATA', campo: 'data', peso: 1.2 },
        { titulo: 'TIPO', campo: 'tipo', peso: 1.8 },
        { titulo: 'HISTÓRICO', campo: 'descricao', peso: 4.5 },
        { titulo: 'DOC', campo: 'doc', peso: 0.8 },
        { titulo: 'VALOR', campo: 'valor', peso: 1.6, alinhamento: 'direita' },
        { titulo: 'ACUMULADO', campo: 'saldo', peso: 1.6, alinhamento: 'direita' }
      ],
      linhas,
      resumo: [
        { rotulo: 'Lançamentos', valor: String(lancamentos.length) },
        { rotulo: 'Entradas', valor: dinheiroPdf(lancamentos.filter(l => l.valor > 0).reduce((a, l) => a + l.valor, 0)) },
        { rotulo: 'Saídas', valor: dinheiroPdf(lancamentos.filter(l => l.valor < 0).reduce((a, l) => a + l.valor, 0)) }
      ],
      observacao: 'O acumulado é o movimento do período por conta, não o saldo total (que inclui o saldo inicial '
        + 'e os lançamentos anteriores).'
    });
  }

  function pdfPosicaoEstoque() {
    const produtos = [...dados.produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    if (!produtos.length) { erro('Nenhum produto cadastrado'); return; }
    const totalCusto = produtos.reduce((a, p) => a + (p.estoque || 0) * (p.custo || 0), 0);
    const totalVenda = produtos.reduce((a, p) => a + (p.estoque || 0) * (p.preco || 0), 0);
    return emitir('auditoria-posicao-estoque', {
      titulo: 'POSIÇÃO DE ESTOQUE VALORIZADA',
      subtitulo: `Posição em ${dataBR(new Date().toISOString())}`,
      paisagem: true,
      colunas: [
        { titulo: 'PRODUTO', campo: 'nome', peso: 4 },
        { titulo: 'UN', campo: 'unidade', peso: 0.8 },
        { titulo: 'SALDO', campo: 'estoque', peso: 1.2, alinhamento: 'direita' },
        { titulo: 'CUSTO MÉDIO', campo: 'custo', peso: 1.5, alinhamento: 'direita' },
        { titulo: 'TOTAL A CUSTO', campo: 'totalCusto', peso: 1.7, alinhamento: 'direita' },
        { titulo: 'PREÇO', campo: 'preco', peso: 1.4, alinhamento: 'direita' },
        { titulo: 'TOTAL A VENDA', campo: 'totalVenda', peso: 1.7, alinhamento: 'direita' }
      ],
      linhas: produtos.map(p => ({
        nome: p.nome, unidade: p.unidade, estoque: qtdPdf(p.estoque || 0),
        custo: dinheiroPdf(p.custo || 0), totalCusto: dinheiroPdf((p.estoque || 0) * (p.custo || 0)),
        preco: dinheiroPdf(p.preco || 0), totalVenda: dinheiroPdf((p.estoque || 0) * (p.preco || 0)),
        cor: (p.estoqueMin > 0 && p.estoque <= p.estoqueMin) ? [0.78, 0.16, 0.16] : null
      })),
      resumo: [
        { rotulo: 'Produtos', valor: String(produtos.length) },
        { rotulo: 'Estoque a custo', valor: dinheiroPdf(totalCusto) },
        { rotulo: 'Estoque a preço de venda', valor: dinheiroPdf(totalVenda) },
        { rotulo: 'Lucro embutido', valor: dinheiroPdf(totalVenda - totalCusto) }
      ],
      observacao: 'O custo é a média ponderada das entradas. Linhas em vermelho estão no estoque mínimo ou abaixo.'
    });
  }

  desenhar();
}
