/* Posicao de estoque por unidade (lojas + fabrica), ajustes e historico. */
import { api } from '../api.js';
import { estado, ehMaster } from '../app.js';
import { el, limpar, dinheiro, numero, dataHora, erro, sucesso, modal, vazio } from '../ui.js';

const ROTULO_MOV = {
  producao: '🏭 Produção', transferencia_saida: '📤 Transferência (saída)',
  transferencia_entrada: '📥 Transferência (entrada)', venda: '🧾 Venda',
  ajuste: '✏️ Ajuste', devolucao: '↩️ Devolução'
};

export async function render(raiz) {
  const corpo = el('div');
  let somenteAlerta = false;
  const entradaBusca = el('input', { type: 'search', placeholder: 'Buscar produto…' });
  let debounce;
  entradaBusca.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(carregar, 280); });

  const seletorLoja = el('select', { onchange: carregar }, [
    el('option', { value: '', text: 'Todas as unidades' }),
    ...estado.lojas.map(l => el('option', { value: l.id, text: `${l.kind === 'fabrica' ? '🏭 ' : '🏬 '}${l.name}` }))
  ]);
  seletorLoja.value = estado.lojaSelecionada || '';

  const btnAlerta = el('button', { class: 'btn btn-vazio', onclick: () => { somenteAlerta = !somenteAlerta; btnAlerta.classList.toggle('btn-perigo', somenteAlerta); carregar(); } }, '⚠️ Só alertas');

  raiz.append(
    el('div', { class: 'filtros' }, [
      el('div', { class: 'campo' }, [el('label', { text: 'Unidade' }), seletorLoja]),
      el('div', { class: 'campo', style: { flex: '2' } }, [el('label', { text: 'Produto' }), entradaBusca]),
      btnAlerta,
      el('button', { class: 'btn btn-vazio', onclick: historico }, '📜 Movimentações'),
      ehMaster() ? el('a', { class: 'btn btn-acao', href: '#/producao' }, '🏭 Produção e transferências') : null
    ].filter(Boolean)),
    corpo
  );

  async function carregar() {
    limpar(corpo).appendChild(el('div', { class: 'vazio', text: 'Carregando…' }));
    const dados = await api.get('/api/estoque', {
      store_id: seletorLoja.value || undefined, q: entradaBusca.value, somente_alerta: somenteAlerta ? '1' : undefined
    });
    limpar(corpo);
    if (!dados.itens.length) { corpo.appendChild(vazio(somenteAlerta ? 'Nenhum produto abaixo do mínimo 🎉' : 'Nenhum produto encontrado', '📦')); return; }

    // agrupa por unidade
    const porLoja = new Map();
    for (const item of dados.itens) {
      if (!porLoja.has(item.store_id)) porLoja.set(item.store_id, { nome: item.store_name, kind: item.store_kind, itens: [] });
      porLoja.get(item.store_id).itens.push(item);
    }

    corpo.appendChild(el('div', { class: 'grid g3 mb' }, [
      el('div', { class: 'kpi' }, [el('div', { class: 'rot', text: 'Itens monitorados' }), el('div', { class: 'val', text: numero(dados.itens.length) })]),
      el('div', { class: `kpi ${dados.alertas ? 'vermelho' : 'verde'}` }, [
        el('div', { class: 'rot', text: 'Abaixo do mínimo' }), el('div', { class: 'val', text: numero(dados.alertas) })
      ]),
      ehMaster() ? el('div', { class: 'kpi amarelo' }, [
        el('div', { class: 'rot', text: 'Valor em estoque (custo)' }), el('div', { class: 'val', text: dinheiro(dados.valor_custo_total) })
      ]) : null
    ].filter(Boolean)));

    for (const [lojaId, grupo] of porLoja) {
      corpo.appendChild(el('div', { class: 'card mb' }, [
        el('div', { class: 'card-cab' }, [
          el('h3', { text: `${grupo.kind === 'fabrica' ? '🏭' : '🏬'} ${grupo.nome}` }),
          el('div', { class: 'espaco' }),
          el('span', { class: 'pequeno texto-mudo', text: `${grupo.itens.length} produtos` })
        ]),
        el('div', { class: 'tabela-wrap' }, el('table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: 'Produto' }), el('th', { text: 'Código' }),
            el('th', { class: 'num', text: 'Estoque' }), el('th', { class: 'num', text: 'Mínimo' }),
            el('th', { text: 'Situação' }),
            ehMaster() ? el('th', { class: 'num', text: 'Custo total' }) : null,
            el('th', { text: '' })
          ].filter(Boolean))),
          el('tbody', {}, grupo.itens.map(i => el('tr', {}, [
            el('td', { class: 'negrito', text: i.name }),
            el('td', { class: 'pequeno texto-mudo', text: i.sku || '—' }),
            el('td', { class: 'num negrito', text: `${numero(i.qty)} ${i.unit}` }),
            el('td', { class: 'num pequeno', text: i.min_stock ? numero(i.min_stock) : '—' }),
            el('td', {}, i.qty <= 0
              ? el('span', { class: 'tag tag-vermelho', text: 'Sem estoque' })
              : i.abaixo_minimo ? el('span', { class: 'tag tag-amarelo', text: 'Repor' })
              : el('span', { class: 'tag tag-verde', text: 'OK' })),
            ehMaster() ? el('td', { class: 'num pequeno', text: dinheiro(i.qty * (i.cost_price || 0)) }) : null,
            el('td', { class: 'num' }, el('button', { class: 'btn btn-sm btn-vazio', onclick: () => ajustar(i, lojaId) }, 'Ajustar'))
          ].filter(Boolean))))
        ]))
      ]));
    }
  }

  function ajustar(item, lojaId) {
    const tipo = el('select', {}, [
      el('option', { value: 'entrada', text: 'Entrada (compra, devolução, correção para mais)' }),
      el('option', { value: 'saida', text: 'Saída (perda, quebra, correção para menos)' })
    ]);
    const qtd = el('input', { type: 'number', min: '0', step: '0.01', value: '1' });
    const nota = el('input', { type: 'text', placeholder: 'Motivo do ajuste' });

    modal({
      titulo: `Ajustar estoque — ${item.name}`,
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-azul mb', text: `${item.store_name}: ${numero(item.qty)} ${item.unit} em estoque` }),
        el('div', { class: 'campo' }, [el('label', { text: 'Tipo de ajuste' }), tipo]),
        el('div', { class: 'campo' }, [el('label', { text: `Quantidade (${item.unit})` }), qtd]),
        el('div', { class: 'campo' }, [el('label', { text: 'Observação' }), nota])
      ]),
      acoes: [{
        rotulo: 'Confirmar ajuste', class: 'btn-primario', acao: async (fechar) => {
          const q = Number(qtd.value);
          if (!q || q <= 0) { erro('Informe uma quantidade maior que zero'); return; }
          try {
            const r = await api.post('/api/estoque/ajuste', {
              store_id: lojaId, product_id: item.product_id,
              qty: tipo.value === 'saida' ? -q : q, note: nota.value
            });
            sucesso(`Novo saldo: ${numero(r.saldo)} ${item.unit}`);
            fechar(); carregar();
          } catch (e) { erro(e.message); }
        }
      }]
    });
  }

  async function historico() {
    const { movimentos } = await api.get('/api/estoque/movimentos', { store_id: seletorLoja.value || undefined, limit: 200 });
    modal({
      titulo: 'Movimentações de estoque', largo: true,
      corpo: movimentos.length
        ? el('div', { class: 'tabela-wrap rolagem' }, el('table', {}, [
            el('thead', {}, el('tr', {}, [
              el('th', { text: 'Data' }), el('th', { text: 'Produto' }), el('th', { text: 'Unidade' }),
              el('th', { text: 'Tipo' }), el('th', { class: 'num', text: 'Qtd' }), el('th', { text: 'Responsável' })
            ])),
            el('tbody', {}, movimentos.map(m => el('tr', {}, [
              el('td', { class: 'pequeno', text: dataHora(m.created_at) }),
              el('td', { text: m.product_name }),
              el('td', { class: 'pequeno', text: m.store_name }),
              el('td', { class: 'pequeno', text: ROTULO_MOV[m.kind] || m.kind }),
              el('td', { class: 'num negrito', style: { color: m.qty >= 0 ? 'var(--verde-700)' : 'var(--vermelho-600)' },
                         text: `${m.qty > 0 ? '+' : ''}${numero(m.qty)} ${m.unit}` }),
              el('td', { class: 'pequeno texto-mudo', text: m.user_name || m.note || '—' })
            ])))
          ]))
        : vazio('Nenhuma movimentação registrada', '📜')
    });
  }

  carregar();
}
