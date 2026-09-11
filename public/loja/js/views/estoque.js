/* Estoque e cadastro de produtos: entrada de mercadoria, preço e mínimo. */
import { listar, salvar, remover, entradaEstoque, obter } from '../db.js';
import { recalcularPendencias } from '../app.js';
import {
  el, limpar, dinheiro, numero, percentual, erro, sucesso, painel, vazio,
  confirmar, atrasar, dataHora
} from '../ui.js';

export async function render(raiz) {
  const corpo = el('div');
  let somenteAlerta = false;
  const entradaBusca = el('input', { type: 'search', placeholder: 'Buscar produto…' });
  entradaBusca.addEventListener('input', atrasar(desenhar, 200));

  const btnAlerta = el('button', { class: 'btn btn-vazio', onclick: () => {
    somenteAlerta = !somenteAlerta;
    btnAlerta.classList.toggle('btn-perigo', somenteAlerta);
    desenhar();
  } }, '⚠️ Repor');

  raiz.append(
    el('div', { class: 'busca-linha' }, [entradaBusca, btnAlerta]),
    el('button', { class: 'btn btn-acao btn-bloco mb', onclick: () => formulario() }, '+ Novo produto'),
    corpo
  );

  async function desenhar() {
    const produtos = (await listar('produtos')).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const termo = entradaBusca.value.trim().toLowerCase();
    const lista = produtos.filter(p =>
      (!termo || p.nome.toLowerCase().includes(termo)) &&
      (!somenteAlerta || (p.estoqueMin > 0 && p.estoque <= p.estoqueMin)));

    limpar(corpo);
    const valorCusto = produtos.reduce((a, p) => a + p.estoque * (p.custo || 0), 0);
    corpo.appendChild(el('div', { class: 'grade2 mb' }, [
      el('div', { class: 'kpi' }, [
        el('div', { class: 'rot', text: 'Produtos' }), el('div', { class: 'val', text: numero(produtos.length) })
      ]),
      el('div', { class: 'kpi amarelo' }, [
        el('div', { class: 'rot', text: 'Valor em estoque' }), el('div', { class: 'val', text: dinheiro(valorCusto) }),
        el('div', { class: 'det', text: 'pelo custo' })
      ])
    ]));

    if (!lista.length) { corpo.appendChild(vazio(somenteAlerta ? 'Nada para repor 🎉' : 'Nenhum produto', '📦')); return; }

    const grupo = el('div', { class: 'cartao' }, el('div', { class: 'lista' }, lista.map(p =>
      el('button', { class: 'item', onclick: () => abrir(p) }, [
        el('div', { class: 'info' }, [
          el('div', { class: 'titulo', text: p.nome }),
          el('div', { class: 'sub', text: `${dinheiro(p.preco)} · mínimo ${numero(p.estoqueMin)} ${p.unidade}` })
        ]),
        el('span', {
          class: `etiqueta ${p.estoque <= 0 ? 'et-vermelha' : (p.estoqueMin > 0 && p.estoque <= p.estoqueMin) ? 'et-amarela' : 'et-verde'}`,
          text: `${numero(p.estoque)} ${p.unidade}`
        })
      ])
    )));
    corpo.appendChild(grupo);
  }

  function abrir(produto) {
    const margem = produto.preco > 0 ? (produto.preco - (produto.custo || 0)) / produto.preco * 100 : 0;
    painel({
      titulo: produto.nome,
      corpo: el('div', {}, [
        el('div', { class: 'grade2 mb' }, [
          el('div', { class: 'kpi' }, [el('div', { class: 'rot', text: 'Em estoque' }), el('div', { class: 'val', text: `${numero(produto.estoque)} ${produto.unidade}` })]),
          el('div', { class: 'kpi verde' }, [el('div', { class: 'rot', text: 'Preço de venda' }), el('div', { class: 'val', text: dinheiro(produto.preco) })])
        ]),
        el('div', { class: 'aviso aviso-azul' },
          `Custo ${dinheiro(produto.custo || 0)} · lucro ${dinheiro(produto.preco - (produto.custo || 0))} por ${produto.unidade} · margem ${percentual(margem)}`),
        produto.movimentos?.length
          ? el('div', {}, [
              el('div', { class: 'pq negrito mb', text: 'Últimas entradas e saídas' }),
              el('div', { class: 'lista rolagem' }, [...produto.movimentos].reverse().slice(0, 12).map(m =>
                el('div', { class: 'item' }, [
                  el('div', { class: 'info' }, [
                    el('div', { class: 'titulo', style: { color: m.qtd >= 0 ? 'var(--verde-700)' : 'var(--vermelho-600)' },
                                text: `${m.qtd > 0 ? '+' : ''}${numero(m.qtd)} ${produto.unidade}` }),
                    el('div', { class: 'sub', text: `${dataHora(m.data)}${m.obs ? ' · ' + m.obs : ''}` })
                  ]),
                  el('span', { class: 'pq mudo', text: `saldo ${numero(m.saldo)}` })
                ])))
            ])
          : null
      ]),
      acoes: [
        { rotulo: 'Editar', acao: (f) => { f(); formulario(produto); } },
        { rotulo: '+ Entrada', class: 'btn-ok', acao: (f) => { f(); movimentar(produto); } }
      ]
    });
  }

  function movimentar(produto) {
    const tipo = el('select', {}, [
      el('option', { value: 'entrada', text: 'Entrada — chegou mercadoria' }),
      el('option', { value: 'saida', text: 'Saída — perda, quebra ou acerto' })
    ]);
    const qtd = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: '1' });
    const obs = el('input', { type: 'text', placeholder: 'Observação (nota fiscal, motivo…)' });

    painel({
      titulo: `Estoque — ${produto.nome}`,
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-azul', text: `Agora há ${numero(produto.estoque)} ${produto.unidade}.` }),
        el('div', { class: 'campo' }, [el('label', { text: 'O que aconteceu' }), tipo]),
        el('div', { class: 'campo' }, [el('label', { text: `Quantidade (${produto.unidade})` }), qtd]),
        el('div', { class: 'campo' }, [el('label', { text: 'Observação' }), obs])
      ]),
      acoes: [{
        rotulo: 'Confirmar', class: 'btn-primario', acao: async (fechar) => {
          const q = Number(qtd.value);
          if (!q || q <= 0) { erro('Informe a quantidade'); return; }
          try {
            const saldo = await entradaEstoque(produto.id, tipo.value === 'saida' ? -q : q, obs.value);
            sucesso(`Novo saldo: ${numero(saldo)} ${produto.unidade}`);
            fechar(); desenhar(); recalcularPendencias();
          } catch (e) { erro(e.message); }
        }
      }]
    });
  }

  function formulario(produto = null) {
    const campos = {
      nome: el('input', { type: 'text', value: produto?.nome || '' }),
      categoria: el('input', { type: 'text', value: produto?.categoria || '', placeholder: 'Ex.: Argamassas' }),
      unidade: el('input', { type: 'text', value: produto?.unidade || 'UN', maxlength: '6' }),
      custo: el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: produto?.custo ?? 0 }),
      preco: el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: produto?.preco ?? 0 }),
      estoqueMin: el('input', { type: 'number', inputmode: 'decimal', step: '1', min: '0', value: produto?.estoqueMin ?? 0 }),
      estoque: el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: produto?.estoque ?? 0 })
    };
    const info = el('div', { class: 'aviso aviso-azul' });
    const atualizarInfo = () => {
      const custo = Number(campos.custo.value) || 0, preco = Number(campos.preco.value) || 0;
      const lucro = preco - custo;
      info.textContent = `Lucro por unidade: ${dinheiro(lucro)} · margem ${percentual(preco ? lucro / preco * 100 : 0)}`;
    };
    campos.custo.addEventListener('input', atualizarInfo);
    campos.preco.addEventListener('input', atualizarInfo);
    atualizarInfo();

    painel({
      titulo: produto ? 'Editar produto' : 'Novo produto',
      corpo: el('div', {}, [
        el('div', { class: 'campo' }, [el('label', { text: 'Nome *' }), campos.nome]),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Categoria' }), campos.categoria]),
          el('div', { class: 'campo', style: { flex: '.5' } }, [el('label', { text: 'Unidade' }), campos.unidade])
        ]),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Custo (R$)' }), campos.custo]),
          el('div', { class: 'campo' }, [el('label', { text: 'Venda (R$)' }), campos.preco])
        ]),
        info,
        el('div', { class: 'linha mt' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Estoque atual' }), campos.estoque]),
          el('div', { class: 'campo' }, [el('label', { text: 'Estoque mínimo' }), campos.estoqueMin])
        ])
      ]),
      acoes: [
        produto ? { rotulo: 'Excluir', class: 'btn-perigo', acao: async (fechar) => {
          if (!await confirmar(`Excluir "${produto.nome}"? As vendas já feitas continuam no histórico.`, { perigo: true })) return;
          await remover('produtos', produto.id);
          sucesso('Produto excluído'); fechar(); desenhar();
        } } : null,
        { rotulo: 'Salvar', class: 'btn-primario', acao: async (fechar) => {
          if (!campos.nome.value.trim()) { erro('Informe o nome'); return; }
          const registro = {
            ...(produto || { ativo: true, movimentos: [] }),
            nome: campos.nome.value.trim(),
            categoria: campos.categoria.value.trim(),
            unidade: campos.unidade.value.trim().toUpperCase() || 'UN',
            custo: Number(campos.custo.value) || 0,
            preco: Number(campos.preco.value) || 0,
            estoqueMin: Number(campos.estoqueMin.value) || 0,
            estoque: Number(campos.estoque.value) || 0
          };
          await salvar('produtos', registro);
          sucesso(produto ? 'Produto atualizado' : 'Produto cadastrado');
          fechar(); desenhar(); recalcularPendencias();
        } }
      ].filter(Boolean)
    });
  }

  desenhar();
}
