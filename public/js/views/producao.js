/* Fabrica: lancamento de producao e transferencia de estoque para as lojas. */
import { api } from '../api.js';
import { estado, fabricas, lojasOperacionais } from '../app.js';
import { el, limpar, numero, dataHora, erro, sucesso, modal, vazio, dinheiro } from '../ui.js';

/** Editor de itens (produto + quantidade) reutilizado por producao e transferencia. */
function editorItens(produtos, { comSaldo = null } = {}) {
  const linhas = [];
  const lista = el('div', { class: 'grid', style: { gap: '8px' } });

  function desenhar() {
    limpar(lista);
    if (!linhas.length) lista.appendChild(el('div', { class: 'pequeno texto-mudo', text: 'Nenhum produto adicionado.' }));
    linhas.forEach((linha, i) => {
      const sel = el('select', { onchange: (e) => { linha.product_id = Number(e.target.value); desenhar(); } },
        produtos.map(p => el('option', { value: p.id, selected: p.id === linha.product_id, text: p.name })));
      const qtd = el('input', { type: 'number', min: '0', step: '1', value: linha.qty, style: { maxWidth: '110px' },
        oninput: (e) => { linha.qty = Number(e.target.value); } });
      const prod = produtos.find(p => p.id === linha.product_id);
      const saldo = comSaldo ? comSaldo(linha.product_id) : null;
      lista.appendChild(el('div', { class: 'flex', style: { gap: '8px' } }, [
        el('div', { style: { flex: '1' } }, sel),
        qtd,
        el('span', { class: 'pequeno texto-mudo', style: { minWidth: '92px' },
          text: saldo !== null ? `disp.: ${numero(saldo)} ${prod?.unit || ''}` : (prod?.unit || '') }),
        el('button', { class: 'btn btn-sm btn-vazio', type: 'button', onclick: () => { linhas.splice(i, 1); desenhar(); } }, '✕')
      ]));
    });
  }

  const adicionar = el('button', { class: 'btn btn-vazio btn-bloco', type: 'button', style: { marginTop: '10px' },
    onclick: () => { linhas.push({ product_id: produtos[0]?.id, qty: 1 }); desenhar(); } }, '+ Adicionar produto');

  desenhar();
  return {
    elemento: el('div', {}, [lista, adicionar]),
    itens: () => linhas.filter(l => l.product_id && l.qty > 0)
  };
}

export async function render(raiz) {
  const unidadesFabrica = fabricas();
  if (!unidadesFabrica.length) {
    raiz.appendChild(el('div', { class: 'aviso aviso-amarelo' },
      'Nenhuma unidade do tipo fábrica cadastrada. Crie uma em Configurações › Lojas e unidades.'));
    return;
  }

  const [{ produtos }, { produtos: doFabrica }] = await Promise.all([
    api.get('/api/produtos'),
    api.get('/api/produtos', { store_id: unidadesFabrica[0].id })
  ]);
  const saldoFabrica = new Map(doFabrica.map(p => [p.id, p.estoque]));
  const corpo = el('div');

  raiz.append(
    el('div', { class: 'filtros' }, [
      el('div', { style: { flex: '1' } }, [
        el('h3', { text: 'Fábrica e movimentação de estoque' }),
        el('div', { class: 'pequeno texto-mudo', text: 'Lance o que foi produzido e depois transfira para as lojas.' })
      ]),
      el('button', { class: 'btn btn-acao', onclick: formProducao }, '🏭 Lançar produção'),
      el('button', { class: 'btn btn-primario', onclick: formTransferencia }, '🚚 Transferir para loja')
    ]),
    corpo
  );

  async function carregar() {
    limpar(corpo).appendChild(el('div', { class: 'vazio', text: 'Carregando…' }));
    const [{ producoes }, { transferencias }, estoque] = await Promise.all([
      api.get('/api/producao'), api.get('/api/transferencias'),
      api.get('/api/estoque', { store_id: unidadesFabrica[0].id })
    ]);
    limpar(corpo);

    corpo.appendChild(el('div', { class: 'card mb' }, [
      el('div', { class: 'card-cab' }, [
        el('h3', { text: `📦 Estoque da ${unidadesFabrica[0].name}` }),
        el('div', { class: 'espaco' }),
        el('span', { class: 'pequeno texto-mudo', text: `Valor em custo: ${dinheiro(estoque.valor_custo_total)}` })
      ]),
      el('div', { class: 'tabela-wrap rolagem' }, el('table', {}, [
        el('thead', {}, el('tr', {}, [el('th', { text: 'Produto' }), el('th', { class: 'num', text: 'Disponível' }), el('th', { text: 'Situação' })])),
        el('tbody', {}, estoque.itens.map(i => el('tr', {}, [
          el('td', { text: i.name }),
          el('td', { class: 'num negrito', text: `${numero(i.qty)} ${i.unit}` }),
          el('td', {}, i.qty <= 0 ? el('span', { class: 'tag tag-vermelho', text: 'Produzir' })
                     : i.abaixo_minimo ? el('span', { class: 'tag tag-amarelo', text: 'Baixo' })
                     : el('span', { class: 'tag tag-verde', text: 'OK' }))
        ])))
      ]))
    ]));

    corpo.appendChild(el('div', { class: 'grid g2' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'card-cab' }, [el('h3', { text: '🏭 Últimas produções' })]),
        producoes.length
          ? el('div', { class: 'rolagem' }, producoes.map(p => el('div', { class: 'insight destaque' }, [
              el('div', { class: 'marca-tipo' }),
              el('div', { style: { flex: '1' } }, [
                el('h4', { text: `${p.lote ? `Lote ${p.lote} · ` : ''}${numero(p.total_qty)} unidades` }),
                el('p', { text: p.itens.map(i => `${numero(i.qty)} ${i.unit} de ${i.product_name}`).join(' · ') }),
                el('div', { class: 'pequeno texto-mudo', text: `${dataHora(p.created_at)} · ${p.user_name || ''}` })
              ])
            ])))
          : vazio('Nenhuma produção lançada', '🏭')
      ]),
      el('div', { class: 'card' }, [
        el('div', { class: 'card-cab' }, [el('h3', { text: '🚚 Últimas transferências' })]),
        transferencias.length
          ? el('div', { class: 'rolagem' }, transferencias.map(t => el('div', { class: 'insight oportunidade' }, [
              el('div', { class: 'marca-tipo' }),
              el('div', { style: { flex: '1' } }, [
                el('h4', { text: `${t.from_name} → ${t.to_name}` }),
                el('p', { text: t.itens.map(i => `${numero(i.qty)} ${i.unit} de ${i.product_name}`).join(' · ') }),
                el('div', { class: 'pequeno texto-mudo', text: `${dataHora(t.created_at)} · ${t.user_name || ''}` })
              ])
            ])))
          : vazio('Nenhuma transferência registrada', '🚚')
      ])
    ]));
  }

  function formProducao() {
    const fabrica = el('select', {}, unidadesFabrica.map(f => el('option', { value: f.id, text: f.name })));
    const lote = el('input', { type: 'text', placeholder: 'Ex.: L-2026-014' });
    const nota = el('input', { type: 'text', placeholder: 'Observação (opcional)' });
    const editor = editorItens(produtos);

    modal({
      titulo: 'Lançar produção da fábrica', largo: true,
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-azul mb' }, 'O que for lançado aqui entra no estoque da fábrica e depois pode ser transferido para as lojas.'),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Unidade' }), fabrica]),
          el('div', { class: 'campo' }, [el('label', { text: 'Lote' }), lote])
        ]),
        el('div', { class: 'campo' }, [el('label', { text: 'Observação' }), nota]),
        el('label', { class: 'pequeno negrito', text: 'Produtos produzidos' }),
        editor.elemento
      ]),
      acoes: [{
        rotulo: 'Registrar produção', class: 'btn-primario', acao: async (fechar) => {
          const itens = editor.itens();
          if (!itens.length) { erro('Adicione ao menos um produto'); return; }
          try {
            await api.post('/api/producao', { store_id: Number(fabrica.value), lote: lote.value, note: nota.value, itens });
            sucesso('Produção registrada e estoque da fábrica atualizado');
            fechar(); carregar();
          } catch (e) { erro(e.message); }
        }
      }]
    });
  }

  function formTransferencia() {
    const lojas = lojasOperacionais();
    if (!lojas.length) { erro('Cadastre ao menos uma loja para transferir'); return; }
    const origem = el('select', {}, estado.lojas.map(l => el('option', { value: l.id, selected: l.kind === 'fabrica', text: `${l.kind === 'fabrica' ? '🏭' : '🏬'} ${l.name}` })));
    const destino = el('select', {}, lojas.map(l => el('option', { value: l.id, text: `🏬 ${l.name}` })));
    const nota = el('input', { type: 'text', placeholder: 'Observação (opcional)' });
    const editor = editorItens(produtos, { comSaldo: (id) => saldoFabrica.get(id) ?? 0 });

    modal({
      titulo: 'Transferir estoque', largo: true,
      corpo: el('div', {}, [
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Origem' }), origem]),
          el('div', { class: 'campo' }, [el('label', { text: 'Destino' }), destino])
        ]),
        el('div', { class: 'campo' }, [el('label', { text: 'Observação' }), nota]),
        el('label', { class: 'pequeno negrito', text: 'Produtos a transferir' }),
        editor.elemento,
        el('div', { class: 'aviso aviso-amarelo mt' }, 'A saída da origem e a entrada no destino são registradas na mesma operação — o estoque das duas unidades é atualizado na hora.')
      ]),
      acoes: [{
        rotulo: 'Confirmar transferência', class: 'btn-primario', acao: async (fechar) => {
          const itens = editor.itens();
          if (!itens.length) { erro('Adicione ao menos um produto'); return; }
          try {
            await api.post('/api/transferencias', {
              from_store_id: Number(origem.value), to_store_id: Number(destino.value), note: nota.value, itens
            });
            sucesso('Transferência concluída');
            fechar();
            const { produtos: novos } = await api.get('/api/produtos', { store_id: unidadesFabrica[0].id });
            novos.forEach(p => saldoFabrica.set(p.id, p.estoque));
            carregar();
          } catch (e) { erro(e.message); }
        }
      }]
    });
  }

  carregar();
}
