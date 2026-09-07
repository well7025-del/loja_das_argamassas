/* Lancamento e acompanhamento das despesas das lojas. */
import { api } from '../api.js';
import { estado, ehMaster, lojaAtual, lojasOperacionais } from '../app.js';
import { el, limpar, dinheiro, dataBR, erro, sucesso, modal, vazio, graficoBarras, diasAtras, hoje, confirmar } from '../ui.js';

const NOMES = {
  aluguel: 'Aluguel', salario: 'Salário', comissao: 'Comissão', internet: 'Internet',
  impostos: 'Impostos', agua: 'Água', energia: 'Energia', telefone: 'Telefone',
  frete: 'Frete', combustivel: 'Combustível', manutencao: 'Manutenção', marketing: 'Marketing',
  fornecedor: 'Fornecedor', material_escritorio: 'Material de escritório',
  contabilidade: 'Contabilidade', outros: 'Outros'
};
const FORMAS = { dinheiro: 'Dinheiro', pix: 'PIX', cartao: 'Cartão', boleto: 'Boleto', transferencia: 'Transferência' };

export async function render(raiz) {
  const { categorias } = await api.get('/api/despesas/categorias');
  const filtros = { from: diasAtras(30), to: hoje(), category: '' };
  const corpo = el('div');

  const entradaDe = el('input', { type: 'date', value: filtros.from, onchange: (e) => { filtros.from = e.target.value; carregar(); } });
  const entradaAte = el('input', { type: 'date', value: filtros.to, onchange: (e) => { filtros.to = e.target.value; carregar(); } });
  const seletorCategoria = el('select', { onchange: (e) => { filtros.category = e.target.value; carregar(); } }, [
    el('option', { value: '', text: 'Todas as categorias' }),
    ...categorias.map(c => el('option', { value: c, text: NOMES[c] || c }))
  ]);

  raiz.append(
    el('div', { class: 'filtros' }, [
      el('div', { class: 'campo' }, [el('label', { text: 'De' }), entradaDe]),
      el('div', { class: 'campo' }, [el('label', { text: 'Até' }), entradaAte]),
      el('div', { class: 'campo' }, [el('label', { text: 'Categoria' }), seletorCategoria]),
      el('div', { style: { flex: '1' } }),
      el('button', { class: 'btn btn-acao', onclick: formulario }, '+ Lançar despesa')
    ]),
    corpo
  );

  async function carregar() {
    limpar(corpo).appendChild(el('div', { class: 'vazio', text: 'Carregando…' }));
    const dados = await api.get('/api/despesas', { ...filtros, store_id: estado.lojaSelecionada || undefined });
    limpar(corpo);

    const emDinheiro = dados.despesas.filter(d => d.paid_with === 'dinheiro').reduce((a, d) => a + d.amount, 0);
    corpo.appendChild(el('div', { class: 'grid g3 mb' }, [
      el('div', { class: 'kpi vermelho' }, [el('div', { class: 'rot', text: 'Total do período' }), el('div', { class: 'val', text: dinheiro(dados.total) })]),
      el('div', { class: 'kpi amarelo' }, [el('div', { class: 'rot', text: 'Pagas em dinheiro' }), el('div', { class: 'val', text: dinheiro(emDinheiro) }), el('div', { class: 'det', text: 'saíram do caixa da loja' })]),
      el('div', { class: 'kpi' }, [el('div', { class: 'rot', text: 'Lançamentos' }), el('div', { class: 'val', text: String(dados.despesas.length) })])
    ]));

    if (dados.por_categoria.length) {
      corpo.appendChild(el('div', { class: 'card mb' }, [
        el('div', { class: 'card-cab' }, [el('h3', { text: 'Para onde o dinheiro foi' })]),
        el('div', { class: 'card-corpo' }, [
          graficoBarras(dados.por_categoria.map(c => ({ rotulo: NOMES[c.categoria] || c.categoria, valor: c.valor })), { cor: '#C62828' })
        ])
      ]));
    }

    corpo.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card-cab' }, [el('h3', { text: 'Lançamentos' })]),
      dados.despesas.length
        ? el('div', { class: 'tabela-wrap' }, el('table', {}, [
            el('thead', {}, el('tr', {}, [
              el('th', { text: 'Data' }), ehMaster() ? el('th', { text: 'Loja' }) : null,
              el('th', { text: 'Categoria' }), el('th', { text: 'Descrição' }),
              el('th', { text: 'Pagamento' }), el('th', { class: 'num', text: 'Valor' }), el('th', { text: '' })
            ].filter(Boolean))),
            el('tbody', {}, dados.despesas.map(d => el('tr', {}, [
              el('td', { class: 'pequeno', text: dataBR(d.paid_at || d.created_at) }),
              ehMaster() ? el('td', { class: 'pequeno', text: d.store_name }) : null,
              el('td', {}, el('span', { class: 'tag tag-cinza', text: NOMES[d.category] || d.category })),
              el('td', { class: 'pequeno', text: d.description || '—' }),
              el('td', {}, el('span', { class: `tag ${d.paid_with === 'dinheiro' ? 'tag-amarelo' : 'tag-azul'}`, text: FORMAS[d.paid_with] || d.paid_with })),
              el('td', { class: 'num negrito', text: dinheiro(d.amount) }),
              el('td', { class: 'num' }, el('button', {
                class: 'btn btn-sm btn-vazio', title: 'Excluir', onclick: async () => {
                  if (!await confirmar('Excluir esta despesa? Se foi paga em dinheiro, o valor volta para o caixa.', { perigo: true })) return;
                  try { await api.del(`/api/despesas/${d.id}`); sucesso('Despesa excluída'); carregar(); }
                  catch (e) { erro(e.message); }
                }
              }, '🗑️'))
            ].filter(Boolean))))
          ]))
        : vazio('Nenhuma despesa lançada no período', '📉')
    ]));
  }

  function formulario() {
    const lojas = ehMaster() ? estado.lojas : [lojaAtual()].filter(Boolean);
    const seletorLoja = el('select', {}, lojas.map(l => el('option', { value: l.id, selected: String(l.id) === String(estado.lojaSelecionada), text: l.name })));
    const categoria = el('select', {}, categorias.map(c => el('option', { value: c, text: NOMES[c] || c })));
    const valor = el('input', { type: 'number', step: '0.01', min: '0', placeholder: '0,00' });
    const descricao = el('input', { type: 'text', placeholder: 'Ex.: aluguel de setembro' });
    const forma = el('select', {}, Object.entries(FORMAS).map(([k, v]) => el('option', { value: k, text: v })));
    const data = el('input', { type: 'date', value: hoje() });
    const aviso = el('div', { class: 'aviso aviso-amarelo', text: 'Despesa paga em dinheiro sai automaticamente do caixa da loja.' });
    forma.addEventListener('change', () => { aviso.hidden = forma.value !== 'dinheiro'; });

    modal({
      titulo: 'Lançar despesa', largo: true,
      corpo: el('div', {}, [
        el('div', { class: 'linha' }, [
          lojas.length > 1 ? el('div', { class: 'campo' }, [el('label', { text: 'Loja' }), seletorLoja]) : null,
          el('div', { class: 'campo' }, [el('label', { text: 'Categoria' }), categoria]),
          el('div', { class: 'campo' }, [el('label', { text: 'Data' }), data])
        ].filter(Boolean)),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Valor (R$) *' }), valor]),
          el('div', { class: 'campo' }, [el('label', { text: 'Forma de pagamento' }), forma])
        ]),
        el('div', { class: 'campo' }, [el('label', { text: 'Descrição' }), descricao]),
        aviso
      ]),
      acoes: [{
        rotulo: 'Lançar', class: 'btn-primario', acao: async (fechar) => {
          const v = Number(valor.value);
          if (!v || v <= 0) { erro('Informe o valor da despesa'); return; }
          try {
            await api.post('/api/despesas', {
              store_id: Number(seletorLoja.value), category: categoria.value, amount: v,
              description: descricao.value, paid_with: forma.value, paid_at: data.value,
              competencia: data.value.slice(0, 7)
            });
            sucesso('Despesa lançada');
            fechar(); carregar();
          } catch (e) { erro(e.message); }
        }
      }]
    });
  }

  carregar();
}
