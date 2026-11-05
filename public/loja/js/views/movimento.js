/* ============================================================
   Movimento de estoque por período.

   Para cada produto: saldo inicial, entradas, saídas e saldo final, com o
   total geral. Tudo sai do livro de estoque (cada venda, cancelamento,
   alteração, entrada, ajuste e inventário fica lá com a data), por isso o
   saldo final de um mês é sempre o inicial do mês seguinte.

   Tocar num produto abre a ficha (kardex): cada movimento do período com o
   saldo depois dele.
   ============================================================ */
import { listar, config } from '../db.js';
import { movimentoPorProduto, fichaDoProduto, TIPOS_MOVIMENTO } from '../regras.js';
import {
  el, limpar, dinheiro, numero, dataBR, dataHora, erro, sucesso, painel, vazio,
  kpi, hoje, atrasar, anexar } from '../ui.js';
import { pdfTabela, entregarPdf, dinheiroPdf, qtdPdf } from '../documentos.js';

const inicioDoMes = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const qtd = (v) => numero(v, Number(v) % 1 === 0 ? 0 : 2);
const sinal = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + qtd(Math.abs(v));

// agrupa os tipos do livro nas colunas que o dono reconhece
const GRUPOS_ENTRADA = { entrada: 'Compras/entradas', cancelamento: 'Vendas canceladas', alteracao: 'Alterações de venda',
                         ajuste: 'Ajustes', inventario: 'Inventário', abertura: 'Abertura' };
const GRUPOS_SAIDA = { venda: 'Vendas', saida_manual: 'Saídas manuais', alteracao: 'Alterações de venda',
                       ajuste: 'Ajustes', inventario: 'Inventário' };

export async function render(raiz) {
  const [movimentos, produtosTodos, loja] = await Promise.all([listar('estoqueMov'), listar('produtos'), config('loja', {})]);
  const produtos = produtosTodos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const de = el('input', { type: 'date', value: inicioDoMes() });
  const ate = el('input', { type: 'date', value: hoje() });
  const busca = el('input', { type: 'search', placeholder: 'Filtrar produto…' });
  const soComMovimento = el('input', { type: 'checkbox', checked: false });
  const corpo = el('div');
  let ultimo = null;

  const atalho = (rotulo, calcular) => el('button', {
    class: 'chip', type: 'button',
    onclick: () => { const [a, b] = calcular(); de.value = a; ate.value = b; desenhar(); }
  }, rotulo);
  const mesAnterior = () => {
    const d = new Date(); const ini = new Date(d.getFullYear(), d.getMonth() - 1, 1); const fim = new Date(d.getFullYear(), d.getMonth(), 0);
    return [ini.toISOString().slice(0, 10), fim.toISOString().slice(0, 10)];
  };

  [de, ate].forEach(c => c.addEventListener('change', desenhar));
  busca.addEventListener('input', atrasar(desenhar, 200));
  soComMovimento.addEventListener('change', desenhar);

  anexar(raiz,
    el('div', { class: 'chips mb' }, [
      atalho('Este mês', () => [inicioDoMes(), hoje()]),
      atalho('Mês passado', mesAnterior),
      atalho('Este ano', () => [`${new Date().getFullYear()}-01-01`, hoje()])
    ]),
    el('div', { class: 'linha mb' }, [
      el('div', { class: 'campo', style: { margin: 0 } }, [el('label', { text: 'De' }), de]),
      el('div', { class: 'campo', style: { margin: 0 } }, [el('label', { text: 'Até' }), ate])
    ]),
    el('div', { class: 'campo' }, [busca]),
    el('label', { class: 'check mb' }, [soComMovimento, el('span', { text: 'Só produtos com movimento no período' })]),
    el('button', { class: 'btn btn-vazio btn-bloco mb', type: 'button', onclick: () => exportarPdf() }, '📄 Relatório em PDF'),
    corpo
  );

  function calcular() {
    let a = de.value || inicioDoMes(), b = ate.value || hoje();
    if (a > b) { [a, b] = [b, a]; de.value = a; ate.value = b; }
    const termo = busca.value.trim().toLowerCase();
    const linhas = movimentoPorProduto(movimentos, produtos, a, b)
      .filter(l => !termo || l.nome.toLowerCase().includes(termo))
      .filter(l => !soComMovimento.checked || l.movimentos > 0);
    const somar = (campo) => linhas.reduce((s, l) => s + l[campo], 0);
    return {
      de: a, ate: b, linhas,
      totais: {
        saldoInicial: somar('saldoInicial'), entradas: somar('entradas'), saidas: somar('saidas'),
        saldoFinal: somar('saldoFinal'), valorFinal: somar('valorFinal'),
        valorInicial: linhas.reduce((s, l) => s + l.saldoInicial * l.custo, 0),
        valorEntradas: linhas.reduce((s, l) => s + l.entradas * l.custo, 0),
        valorSaidas: linhas.reduce((s, l) => s + l.saidas * l.custo, 0)
      }
    };
  }

  function desenhar() {
    const r = calcular();
    ultimo = r;
    const t = r.totais;

    anexar(limpar(corpo),
      el('div', { class: 'grade2 mb' }, [
        kpi({ rot: 'Saldo inicial', val: qtd(t.saldoInicial), det: `${dinheiro(t.valorInicial)} a custo` }),
        kpi({ rot: 'Entradas', val: '+' + qtd(t.entradas), det: dinheiro(t.valorEntradas), cor: 'verde' }),
        kpi({ rot: 'Saídas', val: '−' + qtd(t.saidas), det: dinheiro(t.valorSaidas), cor: 'vermelho' }),
        kpi({ rot: 'Saldo final', val: qtd(t.saldoFinal), det: `${dinheiro(t.valorFinal)} a custo`, cor: 'amarelo' })
      ]),
      el('div', { class: 'pq mudo mb', text:
        `${dataBR(r.de)} a ${dataBR(r.ate)} · ${numero(r.linhas.length)} produto(s). As quantidades somam unidades ` +
        'diferentes (saco, unidade, balde); para comparar produtos, use o valor a custo.' }),
      r.linhas.length
        ? el('div', { class: 'cartao' }, [
            el('div', { class: 'tabela-mov cab' }, [
              el('span', { text: 'Produto' }), el('span', { text: 'Inicial' }), el('span', { text: 'Entr.' }),
              el('span', { text: 'Saídas' }), el('span', { text: 'Final' })
            ]),
            ...r.linhas.map(l => el('button', { class: 'tabela-mov', type: 'button', onclick: () => abrirFicha(l, r) }, [
              el('span', { class: 'nome' }, [el('b', { text: l.nome }), el('small', { text: ` ${l.unidade}` })]),
              el('span', { text: qtd(l.saldoInicial) }),
              el('span', { class: 'ent', text: l.entradas ? '+' + qtd(l.entradas) : '—' }),
              el('span', { class: 'sai', text: l.saidas ? '−' + qtd(l.saidas) : '—' }),
              el('span', { class: 'fim', text: qtd(l.saldoFinal) })
            ])),
            el('div', { class: 'tabela-mov total' }, [
              el('span', { text: 'TOTAL' }), el('span', { text: qtd(t.saldoInicial) }),
              el('span', { class: 'ent', text: '+' + qtd(t.entradas) }), el('span', { class: 'sai', text: '−' + qtd(t.saidas) }),
              el('span', { class: 'fim', text: qtd(t.saldoFinal) })
            ])
          ])
        : vazio('Nenhum produto para mostrar', '📦')
    );
  }

  /* ---------------- Ficha do produto ---------------- */

  function abrirFicha(linha, r) {
    const ficha = fichaDoProduto(movimentos, linha.produtoId, r.de, r.ate);
    const entradas = Object.entries(linha.porTipo).filter(([, v]) => v > 0);
    const saidas = Object.entries(linha.porTipo).filter(([, v]) => v < 0);

    painel({
      titulo: linha.nome,
      corpo: el('div', {}, [
        el('div', { class: 'grade2 mb' }, [
          kpi({ rot: 'Saldo inicial', val: `${qtd(linha.saldoInicial)} ${linha.unidade}` }),
          kpi({ rot: 'Saldo final', val: `${qtd(linha.saldoFinal)} ${linha.unidade}`, det: `${dinheiro(linha.valorFinal)} a custo`, cor: 'amarelo' })
        ]),
        el('div', { class: 'grade2 mb' }, [
          el('div', { class: 'cartao' }, el('div', { class: 'cartao-corpo' }, [
            el('div', { class: 'pq negrito', text: `Entradas +${qtd(linha.entradas)}` }),
            ...(entradas.length ? entradas : [['—', 0]]).map(([tipo, v]) =>
              el('div', { class: 'pq', text: v ? `${GRUPOS_ENTRADA[tipo] || TIPOS_MOVIMENTO[tipo] || tipo}: +${qtd(v)}` : 'nenhuma' }))
          ])),
          el('div', { class: 'cartao' }, el('div', { class: 'cartao-corpo' }, [
            el('div', { class: 'pq negrito', text: `Saídas −${qtd(linha.saidas)}` }),
            ...(saidas.length ? saidas : [['—', 0]]).map(([tipo, v]) =>
              el('div', { class: 'pq', text: v ? `${GRUPOS_SAIDA[tipo] || TIPOS_MOVIMENTO[tipo] || tipo}: −${qtd(-v)}` : 'nenhuma' }))
          ]))
        ]),
        ficha.linhas.length
          ? el('div', { class: 'lista rolagem' }, ficha.linhas.slice().reverse().map(m => el('div', { class: 'item' }, [
              el('div', { class: 'info' }, [
                el('div', { class: 'titulo', text: TIPOS_MOVIMENTO[m.tipo] || m.tipo }),
                el('div', { class: 'sub', text: `${dataHora(m.data)}${m.obs ? ' · ' + m.obs : ''}` })
              ]),
              el('div', { style: { textAlign: 'right' } }, [
                el('div', { class: 'valor', style: { color: m.qtd >= 0 ? 'var(--verde-700)' : 'var(--vermelho-600)' }, text: sinal(m.qtd) }),
                el('div', { class: 'pq mudo', text: `saldo ${qtd(m.saldo)}` })
              ])
            ])))
          : vazio('Sem movimento neste período', '📦')
      ]),
      acoes: [{ rotulo: '📄 Ficha em PDF', class: 'btn-primario', acao: () => pdfFicha(linha, ficha, r) }]
    });
  }

  /* ---------------- PDF ---------------- */

  async function exportarPdf() {
    if (!ultimo?.linhas.length) { erro('Nada para exportar neste período'); return; }
    const r = ultimo, t = r.totais;
    try {
      const bytes = pdfTabela({
        titulo: 'MOVIMENTO DE ESTOQUE',
        subtitulo: `${dataBR(r.de)} a ${dataBR(r.ate)}`,
        loja, paisagem: true,
        colunas: [
          { titulo: 'PRODUTO', campo: 'nome', peso: 4 },
          { titulo: 'UN', campo: 'unidade', peso: 0.7 },
          { titulo: 'SALDO INICIAL', campo: 'inicial', peso: 1.4, alinhamento: 'direita' },
          { titulo: 'ENTRADAS', campo: 'entradas', peso: 1.2, alinhamento: 'direita' },
          { titulo: 'SAÍDAS', campo: 'saidas', peso: 1.2, alinhamento: 'direita' },
          { titulo: 'SALDO FINAL', campo: 'final', peso: 1.3, alinhamento: 'direita' },
          { titulo: 'CUSTO MÉDIO', campo: 'custo', peso: 1.3, alinhamento: 'direita' },
          { titulo: 'VALOR FINAL', campo: 'valor', peso: 1.5, alinhamento: 'direita' }
        ],
        linhas: [
          ...r.linhas.map(l => ({
            nome: l.nome, unidade: l.unidade,
            inicial: qtdPdf(l.saldoInicial), entradas: l.entradas ? '+' + qtdPdf(l.entradas) : '-',
            saidas: l.saidas ? '-' + qtdPdf(l.saidas) : '-', final: qtdPdf(l.saldoFinal),
            custo: dinheiroPdf(l.custo), valor: dinheiroPdf(l.valorFinal),
            cor: l.saldoFinal < 0 ? [0.78, 0.16, 0.16] : null
          })),
          {
            nome: 'TOTAL', unidade: '', inicial: qtdPdf(t.saldoInicial), entradas: '+' + qtdPdf(t.entradas),
            saidas: '-' + qtdPdf(t.saidas), final: qtdPdf(t.saldoFinal), custo: '', valor: dinheiroPdf(t.valorFinal),
            destaque: true
          }
        ],
        resumo: [
          { rotulo: 'Estoque inicial a custo', valor: dinheiroPdf(t.valorInicial) },
          { rotulo: 'Entradas a custo', valor: '+ ' + dinheiroPdf(t.valorEntradas) },
          { rotulo: 'Saídas a custo', valor: '- ' + dinheiroPdf(t.valorSaidas) },
          { rotulo: 'ESTOQUE FINAL A CUSTO', valor: dinheiroPdf(t.valorFinal) }
        ],
        observacao: 'Saldo final = saldo inicial + entradas - saídas. Entradas: compras, cancelamentos e ajustes ' +
          'positivos. Saídas: vendas, saídas manuais, perdas e ajustes negativos. Valores pelo custo médio atual ' +
          'de cada produto. Movimentos anteriores ao primeiro registro do aplicativo aparecem como saldo de abertura.'
      });
      sucesso(await entregarPdf(bytes, `movimento-estoque-${r.de}-a-${r.ate}.pdf`));
    } catch (e) { erro('Não consegui gerar o PDF: ' + e.message); }
  }

  async function pdfFicha(linha, ficha, r) {
    try {
      const bytes = pdfTabela({
        titulo: 'FICHA DE ESTOQUE',
        subtitulo: `${linha.nome} · ${dataBR(r.de)} a ${dataBR(r.ate)}`,
        loja,
        colunas: [
          { titulo: 'DATA', campo: 'data', peso: 1.6 },
          { titulo: 'MOVIMENTO', campo: 'tipo', peso: 2.2 },
          { titulo: 'HISTÓRICO', campo: 'obs', peso: 3.4 },
          { titulo: 'QTD', campo: 'qtd', peso: 1, alinhamento: 'direita' },
          { titulo: 'SALDO', campo: 'saldo', peso: 1, alinhamento: 'direita' }
        ],
        linhas: [
          { data: dataBR(r.de), tipo: 'Saldo inicial', obs: '', qtd: '', saldo: qtdPdf(ficha.saldoInicial), destaque: true },
          ...ficha.linhas.map(m => ({
            data: dataHora(m.data), tipo: TIPOS_MOVIMENTO[m.tipo] || m.tipo, obs: m.obs || '',
            qtd: (m.qtd > 0 ? '+' : '') + qtdPdf(m.qtd), saldo: qtdPdf(m.saldo),
            cor: m.qtd < 0 ? [0.78, 0.16, 0.16] : null
          })),
          { data: dataBR(r.ate), tipo: 'Saldo final', obs: '', qtd: '', saldo: qtdPdf(linha.saldoFinal), destaque: true }
        ],
        resumo: [
          { rotulo: 'Entradas', valor: '+' + qtdPdf(linha.entradas) + ' ' + linha.unidade },
          { rotulo: 'Saídas', valor: '-' + qtdPdf(linha.saidas) + ' ' + linha.unidade },
          { rotulo: 'Saldo final', valor: qtdPdf(linha.saldoFinal) + ' ' + linha.unidade }
        ]
      });
      sucesso(await entregarPdf(bytes, `ficha-estoque-${linha.produtoId}-${r.de}-a-${r.ate}.pdf`));
    } catch (e) { erro('Não consegui gerar o PDF: ' + e.message); }
  }

  desenhar();
}
