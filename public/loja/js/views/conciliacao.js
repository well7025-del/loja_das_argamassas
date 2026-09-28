/* ============================================================
   Conferência do extrato bancário e das maquininhas.

   O dono exporta o extrato do banco (OFX ou CSV), escolhe a conta e o
   aplicativo casa cada crédito com as vendas daquela forma de pagamento.
   O que não casa vira pré-lançamento de receita ou despesa — nada entra
   no financeiro sem o dono aprovar.
   ============================================================ */
import { listar, salvar, saldos, config } from '../db.js';
import {
  el, limpar, dinheiro, numero, dataBR, erro, sucesso, aviso, painel, vazio,
  kpi, cartao, confirmar, anexar } from '../ui.js';
import { lerExtrato, conferir, aprovarConciliacao, aprovarLancamento } from '../conciliacao.js';
import { pdfTabela, entregarPdf, dinheiroPdf } from '../documentos.js';

const CATEGORIAS = ['aluguel', 'salario', 'comissao', 'energia', 'agua', 'internet', 'impostos',
  'telefone', 'frete', 'combustivel', 'manutencao', 'fornecedor', 'marketing', 'taxa_cartao', 'outros'];

export async function render(raiz) {
  const contas = await saldos();
  const corpo = el('div');
  const seletorConta = el('select', {}, contas.map(c => el('option', { value: c.id, text: c.nome })));
  const entradaArquivo = el('input', {
    type: 'file', accept: '.ofx,.csv,.txt,text/csv,text/plain', hidden: true
  });
  let analise = null;
  let conta = null;
  let nomeArquivo = '';

  entradaArquivo.addEventListener('change', async () => {
    const arquivo = entradaArquivo.files?.[0];
    if (!arquivo) return;
    nomeArquivo = arquivo.name;
    conta = contas.find(c => c.id === Number(seletorConta.value));
    try {
      aviso('Lendo o extrato…');
      const texto = await arquivo.text();
      const linhas = lerExtrato(texto, arquivo.name);
      const vendas = await listar('vendas');
      analise = conferir(linhas, vendas, { conta });
      desenhar();
      sucesso(`${linhas.length} lançamento(s) lidos de ${arquivo.name}`);
    } catch (e) {
      erro(e.message);
    } finally {
      entradaArquivo.value = '';
    }
  });

  anexar(raiz,
    el('div', { class: 'aviso aviso-azul' },
      'Exporte o extrato no aplicativo do banco ou da maquininha em OFX ou CSV. ' +
      'Nada é enviado para a internet: o arquivo é lido dentro do próprio celular.'),
    el('div', { class: 'campo' }, [el('label', { text: 'Conta a conferir' }), seletorConta]),
    el('button', { class: 'btn btn-acao btn-bloco mb', onclick: () => entradaArquivo.click() },
      '📥 Escolher arquivo do extrato'),
    entradaArquivo,
    corpo
  );

  /* ---------------- Tela ---------------- */

  function desenhar() {
    if (!analise) { anexar(limpar(corpo), vazio('Nenhum extrato carregado', '🏦')); return; }
    const r = analise.resumo;
    const pendentes = analise.linhas.filter(l => l.status !== 'aprovado');

    anexar(limpar(corpo),
      el('div', { class: 'grade2 mb' }, [
        kpi({ rot: 'Conciliados', val: numero(r.conciliados), cor: 'verde', det: dinheiro(r.valorConciliado) }),
        kpi({ rot: 'A classificar', val: numero(r.receitas + r.despesas), cor: 'amarelo',
              det: `${numero(r.receitas)} receita(s) · ${numero(r.despesas)} despesa(s)` }),
        r.taxasTotal
          ? kpi({ rot: 'Taxas identificadas', val: dinheiro(r.taxasTotal), cor: 'vermelho', det: 'maquininha' })
          : null,
        r.vendasSemExtrato
          ? kpi({ rot: 'Vendas sem crédito', val: numero(r.vendasSemExtrato), cor: 'vermelho',
                  det: dinheiro(r.valorVendasSemExtrato) })
          : null
      ].filter(Boolean)),

      r.vendasSemExtrato
        ? el('button', { class: 'btn btn-vazio btn-bloco mb', onclick: verVendasSemExtrato },
            `⚠️ Ver ${numero(r.vendasSemExtrato)} venda(s) sem crédito no extrato`)
        : el('div', { class: 'aviso aviso-verde', text: '✅ Toda venda do período tem crédito correspondente no extrato.' }),

      el('div', { class: 'grade2 mb' }, [
        el('button', { class: 'btn btn-vazio btn-sm', onclick: aprovarTodosConciliados }, '✅ Aprovar conciliados'),
        el('button', { class: 'btn btn-vazio btn-sm', onclick: imprimirPdf }, '📄 Relatório em PDF')
      ]),

      pendentes.length
        ? cartao(`Lançamentos do extrato — ${nomeArquivo}`,
            el('div', { class: 'lista' }, analise.linhas.map(linhaExtrato)))
        : el('div', { class: 'aviso aviso-verde', text: '✅ Tudo conferido e aprovado.' })
    );
  }

  const ETIQUETA = {
    conciliado: { texto: 'confere', classe: 'et-verde' },
    receita: { texto: 'receita?', classe: 'et-amarela' },
    despesa: { texto: 'despesa?', classe: 'et-vermelha' },
    aprovado: { texto: 'aprovado', classe: 'et-verde' }
  };

  function linhaExtrato(linha) {
    const et = ETIQUETA[linha.status] || { texto: linha.status, classe: '' };
    return el('button', { class: 'item', onclick: () => abrirLinha(linha) }, [
      el('div', { class: 'info' }, [
        el('div', { class: 'titulo' }, [
          el('span', { text: linha.descricao }),
          el('span', { class: `etiqueta ${et.classe}`, style: { marginLeft: '6px' }, text: et.texto })
        ]),
        el('div', { class: 'sub', text: `${dataBR(linha.data)}${linha.detalhe ? ' · ' + linha.detalhe : ''}` })
      ]),
      el('span', {
        class: 'valor',
        style: { color: linha.valor >= 0 ? 'var(--verde-700)' : 'var(--vermelho-600)' },
        text: `${linha.valor >= 0 ? '+' : '−'} ${dinheiro(Math.abs(linha.valor))}`
      })
    ]);
  }

  /* ---------------- Detalhe e aprovação ---------------- */

  function abrirLinha(linha) {
    if (linha.status === 'aprovado') {
      painel({
        titulo: 'Já aprovado',
        corpo: el('div', {}, el('div', { class: 'aviso aviso-verde', text: 'Este lançamento já entrou no financeiro.' }))
      });
      return;
    }
    if (linha.status === 'conciliado') return abrirConciliado(linha);
    return abrirClassificacao(linha);
  }

  function abrirConciliado(linha) {
    painel({
      titulo: 'Crédito conferido',
      corpo: el('div', {}, [
        el('div', { class: 'kpi verde mb' }, [
          el('div', { class: 'rot', text: dataBR(linha.data) }),
          el('div', { class: 'val', text: dinheiro(linha.valor) }),
          el('div', { class: 'det', text: linha.descricao })
        ]),
        el('div', { class: 'aviso aviso-verde', text: `✅ ${linha.detalhe}` }),
        linha.taxa > 0
          ? el('div', { class: 'aviso aviso-amarelo' },
              `A maquininha reteve ${dinheiro(linha.taxa)}. Ao aprovar, essa taxa é lançada como despesa em ${conta.nome}.`)
          : null
      ]),
      acoes: [{
        rotulo: 'Aprovar', class: 'btn-ok', acao: async (fechar) => {
          try {
            await aprovarConciliacao(linha, conta);
            linha.status = 'aprovado';
            sucesso('Venda(s) marcadas como conferidas');
            fechar(); desenhar();
          } catch (e) { erro(e.message); }
        }
      }]
    });
  }

  function abrirClassificacao(linha) {
    const ehReceita = linha.valor > 0;
    const descricao = el('input', { type: 'text', value: linha.descricao || '' });
    const categoria = el('select', {}, [
      el('option', { value: '', text: 'Sem categoria' }),
      ...CATEGORIAS.map(c => el('option', { value: c, text: c.replace('_', ' ') }))
    ]);

    painel({
      titulo: ehReceita ? 'Receita a classificar' : 'Despesa a classificar',
      corpo: el('div', {}, [
        el('div', { class: `kpi ${ehReceita ? 'verde' : 'vermelho'} mb` }, [
          el('div', { class: 'rot', text: dataBR(linha.data) }),
          el('div', { class: 'val', text: dinheiro(Math.abs(linha.valor)) }),
          el('div', { class: 'det', text: linha.descricao })
        ]),
        el('div', { class: 'aviso aviso-azul' }, ehReceita
          ? 'Entrou dinheiro sem venda correspondente. Pode ser aporte, devolução, transferência ou uma venda que não foi lançada.'
          : 'Saiu dinheiro da conta. Classifique para entrar nas despesas da loja.'),
        el('div', { class: 'campo' }, [el('label', { text: 'Descrição' }), descricao]),
        !ehReceita ? el('div', { class: 'campo' }, [el('label', { text: 'Categoria' }), categoria]) : null
      ]),
      acoes: [
        {
          rotulo: 'Ignorar', acao: (fechar) => {
            linha.status = 'aprovado';
            fechar(); desenhar();
          }
        },
        {
          rotulo: 'Lançar', class: ehReceita ? 'btn-ok' : 'btn-primario', acao: async (fechar) => {
            try {
              await aprovarLancamento(linha, conta, {
                categoria: ehReceita ? null : (categoria.value || null),
                descricao: descricao.value.trim()
              });
              linha.status = 'aprovado';
              sucesso(ehReceita ? 'Receita lançada' : 'Despesa lançada');
              fechar(); desenhar();
            } catch (e) { erro(e.message); }
          }
        }
      ]
    });
  }

  async function aprovarTodosConciliados() {
    const alvos = analise.linhas.filter(l => l.status === 'conciliado');
    if (!alvos.length) { erro('Nenhum lançamento conciliado pendente'); return; }
    if (!await confirmar(`Aprovar ${alvos.length} crédito(s) conferido(s)? As vendas ficam marcadas como conferidas.`)) return;
    try {
      for (const linha of alvos) { await aprovarConciliacao(linha, conta); linha.status = 'aprovado'; }
      sucesso(`${alvos.length} lançamento(s) aprovados`);
      desenhar();
    } catch (e) { erro(e.message); }
  }

  /* ---------------- Vendas sem crédito ---------------- */

  function verVendasSemExtrato() {
    painel({
      titulo: 'Vendas sem crédito no extrato',
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-amarelo' },
          'Estas vendas foram lançadas no aplicativo mas não têm crédito correspondente neste extrato. ' +
          'Pode ser prazo de liquidação, extrato de período diferente — ou dinheiro que não entrou.'),
        el('div', { class: 'lista rolagem' }, analise.vendasSemExtrato.map(v =>
          el('div', { class: 'item' }, [
            el('div', { class: 'info' }, [
              el('div', { class: 'titulo', text: v.codigo }),
              el('div', { class: 'sub', text: `${dataBR(v.data)} · ${v.clienteNome || 'sem cliente'} · ${v.pagamento}` })
            ]),
            el('span', { class: 'valor', text: dinheiro(v.total) })
          ])))
      ])
    });
  }

  /* ---------------- Relatório ---------------- */

  async function imprimirPdf() {
    if (!analise) { erro('Carregue um extrato primeiro'); return; }
    const loja = await config('loja', {});
    const r = analise.resumo;
    try {
      const bytes = pdfTabela({
        titulo: 'CONFERÊNCIA DO EXTRATO',
        subtitulo: `${conta.nome} · ${nomeArquivo}`,
        loja, paisagem: true,
        colunas: [
          { titulo: 'DATA', campo: 'data', peso: 1.2 },
          { titulo: 'HISTÓRICO', campo: 'descricao', peso: 4 },
          { titulo: 'SITUAÇÃO', campo: 'situacao', peso: 1.6 },
          { titulo: 'CONFERIDO COM', campo: 'detalhe', peso: 3 },
          { titulo: 'VALOR', campo: 'valor', peso: 1.6, alinhamento: 'direita' }
        ],
        linhas: analise.linhas.map(l => ({
          data: dataBR(l.data), descricao: l.descricao,
          situacao: l.status === 'conciliado' || l.status === 'aprovado' ? 'Conferido'
            : l.valor > 0 ? 'Receita a classificar' : 'Despesa a classificar',
          detalhe: l.detalhe || '—',
          valor: dinheiroPdf(l.valor),
          cor: l.valor < 0 ? [0.78, 0.16, 0.16] : null
        })),
        resumo: [
          { rotulo: 'Lançamentos no extrato', valor: String(r.total) },
          { rotulo: 'Conferidos com vendas', valor: `${r.conciliados} · ${dinheiroPdf(r.valorConciliado)}` },
          { rotulo: 'Taxas de maquininha', valor: dinheiroPdf(r.taxasTotal) },
          { rotulo: 'Vendas sem crédito', valor: `${r.vendasSemExtrato} · ${dinheiroPdf(r.valorVendasSemExtrato)}` }
        ],
        observacao: 'Conferência automática por data e valor: crédito igual à venda, soma das vendas do dia, '
          + 'ou soma do dia menos a taxa da maquininha. Cada aprovação ficou registrada no financeiro.'
      });
      sucesso(await entregarPdf(bytes, `conferencia-extrato-${new Date().toISOString().slice(0, 10)}.pdf`));
    } catch (e) { erro('Não consegui gerar o PDF: ' + e.message); }
  }

  desenhar();
}
