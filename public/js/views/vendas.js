/* Historico de vendas: filtros, comprovante de pagamento e envio do recibo. */
import { api } from '../api.js';
import { estado, ehMaster } from '../app.js';
import {
  el, limpar, dinheiro, numero, dataHora, diasAtras, hoje, erro, sucesso,
  modal, vazio, campoUpload, abrirWhatsApp, copiar, confirmar, telefoneBR
} from '../ui.js';

const ROTULO_PAGAMENTO = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito', boleto: 'Boleto', prazo: 'A prazo' };

export async function render(raiz) {
  const filtros = { from: diasAtras(30), to: hoje(), q: '', payment_method: '' };
  const corpo = el('div');

  const entradaDe = el('input', { type: 'date', value: filtros.from, onchange: (e) => { filtros.from = e.target.value; carregar(); } });
  const entradaAte = el('input', { type: 'date', value: filtros.to, onchange: (e) => { filtros.to = e.target.value; carregar(); } });
  const entradaBusca = el('input', { type: 'search', placeholder: 'Código da venda ou cliente' });
  const seletorPagamento = el('select', { onchange: (e) => { filtros.payment_method = e.target.value; carregar(); } }, [
    el('option', { value: '', text: 'Todas as formas' }),
    ...Object.entries(ROTULO_PAGAMENTO).map(([k, v]) => el('option', { value: k, text: v }))
  ]);
  let debounce;
  entradaBusca.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => { filtros.q = entradaBusca.value; carregar(); }, 300); });

  raiz.append(
    el('div', { class: 'filtros' }, [
      el('div', { class: 'campo' }, [el('label', { text: 'De' }), entradaDe]),
      el('div', { class: 'campo' }, [el('label', { text: 'Até' }), entradaAte]),
      el('div', { class: 'campo' }, [el('label', { text: 'Pagamento' }), seletorPagamento]),
      el('div', { class: 'campo', style: { flex: '2' } }, [el('label', { text: 'Buscar' }), entradaBusca]),
      el('a', { class: 'btn btn-acao', href: '#/pdv' }, '+ Nova venda')
    ]),
    corpo
  );

  async function carregar() {
    limpar(corpo).appendChild(el('div', { class: 'vazio', text: 'Carregando…' }));
    const { vendas, total } = await api.get('/api/vendas', { ...filtros, store_id: estado.lojaSelecionada || undefined, limit: 300 });
    limpar(corpo);

    if (!vendas.length) { corpo.appendChild(vazio('Nenhuma venda no período selecionado', '🧾')); return; }

    const concluidas = vendas.filter(v => v.status === 'concluida');
    corpo.appendChild(el('div', { class: 'grid g3 mb' }, [
      el('div', { class: 'kpi verde' }, [el('div', { class: 'rot', text: 'Faturamento do filtro' }), el('div', { class: 'val', text: dinheiro(total) })]),
      el('div', { class: 'kpi' }, [el('div', { class: 'rot', text: 'Vendas' }), el('div', { class: 'val', text: numero(concluidas.length) })]),
      el('div', { class: 'kpi amarelo' }, [el('div', { class: 'rot', text: 'Ticket médio' }), el('div', { class: 'val', text: dinheiro(concluidas.length ? total / concluidas.length : 0) })])
    ]));

    const tabela = el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Venda' }), el('th', { text: 'Data' }), el('th', { text: 'Cliente' }),
        ehMaster() ? el('th', { text: 'Loja' }) : null,
        el('th', { text: 'Vendedor' }), el('th', { text: 'Pagamento' }),
        el('th', { class: 'num', text: 'Total' }),
        ehMaster() ? el('th', { class: 'num', text: 'Lucro' }) : null,
        el('th', { text: '' })
      ].filter(Boolean))),
      el('tbody', {}, vendas.map(v => el('tr', {}, [
        el('td', {}, [
          el('span', { class: 'negrito', text: v.code }),
          v.proof_path ? el('span', { title: 'Comprovante anexado', text: ' 📎' }) : null,
          v.status === 'cancelada' ? el('span', { class: 'tag tag-vermelho', style: { marginLeft: '6px' }, text: 'cancelada' }) : null
        ]),
        el('td', { class: 'pequeno', text: dataHora(v.created_at) }),
        el('td', { text: v.customer_name || '—' }),
        ehMaster() ? el('td', { class: 'pequeno', text: v.store_name }) : null,
        el('td', { class: 'pequeno', text: v.user_name || '—' }),
        el('td', {}, el('span', { class: `tag ${v.payment_method === 'dinheiro' ? 'tag-verde' : 'tag-azul'}`, text: ROTULO_PAGAMENTO[v.payment_method] || v.payment_method })),
        el('td', { class: 'num negrito', text: dinheiro(v.total) }),
        ehMaster() ? el('td', { class: 'num', style: { color: v.profit >= 0 ? 'var(--verde-700)' : 'var(--vermelho-600)' }, text: dinheiro(v.profit) }) : null,
        el('td', { class: 'num' }, el('button', { class: 'btn btn-sm btn-vazio', onclick: () => abrirVenda(v.id) }, 'Detalhes'))
      ].filter(Boolean))))
    ]);
    corpo.appendChild(el('div', { class: 'card' }, el('div', { class: 'tabela-wrap' }, tabela)));
  }

  async function abrirVenda(id) {
    const { venda, recibo, whatsapp } = await api.get(`/api/vendas/${id}`);
    const upload = campoUpload({ rotulo: venda.proof_path ? 'Substituir comprovante' : 'Anexar comprovante de pagamento' });

    const acoes = [
      { rotulo: '📋 Copiar recibo', acao: () => copiar(recibo) },
      { rotulo: '💬 WhatsApp', class: 'btn-ok', acao: () => abrirWhatsApp(whatsapp, recibo) },
      { rotulo: '💾 Salvar comprovante', class: 'btn-primario', acao: async (fechar) => {
          if (!upload.valor()) { erro('Selecione a foto ou o print do comprovante'); return; }
          try {
            await api.post(`/api/vendas/${id}/comprovante`, { proof_data: upload.valor() });
            sucesso('Comprovante salvo');
            fechar(); carregar();
          } catch (e) { erro(e.message); }
        } }
    ];
    if (ehMaster() && venda.status === 'concluida') {
      acoes.unshift({ rotulo: 'Cancelar venda', class: 'btn-perigo', acao: async (fechar) => {
        if (!await confirmar('Cancelar esta venda? O estoque será devolvido e o caixa estornado.', { perigo: true })) return;
        try { await api.post(`/api/vendas/${id}/cancelar`); sucesso('Venda cancelada'); fechar(); carregar(); }
        catch (e) { erro(e.message); }
      } });
    }

    modal({
      titulo: `Venda ${venda.code}`, largo: true,
      corpo: el('div', {}, [
        el('div', { class: 'grid g2 mb' }, [
          el('div', {}, [
            el('div', { class: 'pequeno texto-mudo', text: 'Cliente' }),
            el('div', { class: 'negrito', text: venda.customer_name || 'Não identificado' }),
            venda.customer_phone ? el('div', { class: 'pequeno', text: telefoneBR(venda.customer_phone) }) : null,
            venda.customer_cep ? el('div', { class: 'pequeno texto-mudo', text: `${venda.customer_cep} · ${venda.customer_city || ''}` }) : null
          ]),
          el('div', {}, [
            el('div', { class: 'pequeno texto-mudo', text: 'Venda' }),
            el('div', { text: `${venda.store_name} · ${dataHora(venda.created_at)}` }),
            el('div', { class: 'pequeno', text: `Vendedor: ${venda.user_name || '—'} · ${ROTULO_PAGAMENTO[venda.payment_method]}` })
          ])
        ]),
        el('div', { class: 'card mb' }, el('div', { class: 'tabela-wrap' }, el('table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: 'Produto' }), el('th', { class: 'num', text: 'Qtd' }),
            el('th', { class: 'num', text: 'Unitário' }), el('th', { class: 'num', text: 'Total' })
          ])),
          el('tbody', {}, venda.itens.map(i => el('tr', {}, [
            el('td', { text: i.product_name }),
            el('td', { class: 'num', text: `${numero(i.qty)} ${i.unit}` }),
            el('td', { class: 'num', text: dinheiro(i.unit_price) }),
            el('td', { class: 'num negrito', text: dinheiro(i.total) })
          ])))
        ]))),
        el('div', { class: 'total-linha' }, [el('span', { text: 'Subtotal' }), el('span', { text: dinheiro(venda.subtotal) })]),
        venda.discount > 0 ? el('div', { class: 'total-linha' }, [el('span', { text: 'Desconto' }), el('span', { text: `− ${dinheiro(venda.discount)}` })]) : null,
        el('div', { class: 'total-linha grande' }, [el('span', { text: 'Total' }), el('span', { text: dinheiro(venda.total) })]),
        ehMaster() ? el('div', { class: 'aviso aviso-azul mt', text: `Custo da mercadoria: ${dinheiro(venda.cost_total)} · Lucro bruto: ${dinheiro(venda.profit)}` }) : null,
        venda.note ? el('div', { class: 'aviso aviso-amarelo mt', text: `Observação: ${venda.note}` }) : null,
        venda.proof_path
          ? el('div', { class: 'mt' }, [
              el('div', { class: 'pequeno negrito mb', text: 'Comprovante de pagamento' }),
              venda.proof_path.endsWith('.pdf')
                ? el('a', { class: 'btn btn-vazio', href: venda.proof_path, target: '_blank' }, '📄 Abrir PDF do comprovante')
                : el('a', { href: venda.proof_path, target: '_blank' }, el('img', { src: venda.proof_path, class: 'upload-previa' }))
            ])
          : null,
        el('div', { class: 'mt' }, [upload.elemento])
      ]),
      acoes
    });
  }

  carregar();
}
