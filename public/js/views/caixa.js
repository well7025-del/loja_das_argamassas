/* Caixa em dinheiro por loja: entra com venda em dinheiro, sai com despesa e deposito. */
import { api } from '../api.js';
import { estado, ehMaster, lojaAtual, lojasOperacionais } from '../app.js';
import { el, limpar, dinheiro, dataHora, erro, sucesso, modal, vazio, diasAtras, hoje } from '../ui.js';

const ROTULO = {
  venda: '🧾 Venda em dinheiro', despesa: '📉 Despesa paga em dinheiro',
  deposito_matriz: '🏦 Depósito para a matriz', sangria: '📤 Sangria',
  suprimento: '📥 Suprimento (troco)', ajuste: '✏️ Ajuste'
};

export async function render(raiz) {
  const corpo = el('div');
  const filtros = { from: diasAtras(30), to: hoje() };
  const entradaDe = el('input', { type: 'date', value: filtros.from, onchange: (e) => { filtros.from = e.target.value; carregar(); } });
  const entradaAte = el('input', { type: 'date', value: filtros.to, onchange: (e) => { filtros.to = e.target.value; carregar(); } });

  raiz.append(
    el('div', { class: 'filtros' }, [
      el('div', { class: 'campo' }, [el('label', { text: 'De' }), entradaDe]),
      el('div', { class: 'campo' }, [el('label', { text: 'Até' }), entradaAte]),
      el('div', { style: { flex: '1' } }),
      el('button', { class: 'btn btn-vazio', onclick: () => movimento('suprimento') }, '📥 Suprimento'),
      el('button', { class: 'btn btn-vazio', onclick: () => movimento('sangria') }, '📤 Sangria'),
      el('button', { class: 'btn btn-acao', onclick: () => movimento('deposito_matriz') }, '🏦 Depositar na matriz')
    ]),
    corpo
  );

  async function carregar() {
    limpar(corpo).appendChild(el('div', { class: 'vazio', text: 'Carregando…' }));
    const dados = await api.get('/api/caixa', { ...filtros, store_id: estado.lojaSelecionada || undefined });
    limpar(corpo);

    corpo.appendChild(el('div', { class: 'grid g3 mb' }, [
      el('div', { class: 'kpi verde' }, [
        el('div', { class: 'rot', text: 'Saldo em caixa' }),
        el('div', { class: 'val', text: dinheiro(dados.saldo_total) }),
        el('div', { class: 'det', text: 'dinheiro físico nas lojas' })
      ]),
      el('div', { class: 'kpi amarelo' }, [
        el('div', { class: 'rot', text: 'Entradas hoje' }),
        el('div', { class: 'val', text: dinheiro(dados.saldos.reduce((a, s) => a + s.entradas_hoje, 0)) })
      ]),
      el('div', { class: 'kpi' }, [
        el('div', { class: 'rot', text: 'Já depositado na matriz' }),
        el('div', { class: 'val', text: dinheiro(dados.depositos_matriz) })
      ])
    ]));

    if (dados.saldos.length > 1) {
      corpo.appendChild(el('div', { class: 'card mb' }, [
        el('div', { class: 'card-cab' }, [el('h3', { text: 'Saldo por loja' })]),
        el('div', { class: 'card-corpo' }, dados.saldos.map(s => el('div', { class: 'total-linha' }, [
          el('span', { text: `🏬 ${s.store_name}` }),
          el('span', { class: 'negrito', text: dinheiro(s.saldo) })
        ])))
      ]));
    }

    corpo.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card-cab' }, [el('h3', { text: 'Movimentações do caixa' })]),
      dados.movimentos.length
        ? el('div', { class: 'tabela-wrap' }, el('table', {}, [
            el('thead', {}, el('tr', {}, [
              el('th', { text: 'Data' }), ehMaster() ? el('th', { text: 'Loja' }) : null,
              el('th', { text: 'Tipo' }), el('th', { text: 'Descrição' }),
              el('th', { text: 'Responsável' }), el('th', { class: 'num', text: 'Valor' })
            ].filter(Boolean))),
            el('tbody', {}, dados.movimentos.map(m => el('tr', {}, [
              el('td', { class: 'pequeno', text: dataHora(m.created_at) }),
              ehMaster() ? el('td', { class: 'pequeno', text: m.store_name }) : null,
              el('td', { class: 'pequeno', text: ROTULO[m.kind] || m.kind }),
              el('td', { class: 'pequeno', text: m.description || '—' }),
              el('td', { class: 'pequeno texto-mudo', text: m.user_name || '—' }),
              el('td', { class: 'num negrito', style: { color: m.amount >= 0 ? 'var(--verde-700)' : 'var(--vermelho-600)' },
                         text: `${m.amount >= 0 ? '+' : '−'} ${dinheiro(Math.abs(m.amount))}` })
            ].filter(Boolean))))
          ]))
        : vazio('Nenhuma movimentação de caixa no período', '💵')
    ]));
  }

  function movimento(tipo) {
    const lojas = ehMaster() ? lojasOperacionais() : [lojaAtual()].filter(Boolean);
    if (!lojas.length) { erro('Nenhuma loja disponível'); return; }
    const seletor = el('select', {}, lojas.map(l => el('option', { value: l.id, selected: String(l.id) === String(estado.lojaSelecionada), text: l.name })));
    const valor = el('input', { type: 'number', step: '0.01', min: '0', placeholder: '0,00' });
    const descricao = el('input', { type: 'text', placeholder: 'Descrição (opcional)' });

    const titulos = {
      deposito_matriz: 'Depósito para a matriz', sangria: 'Sangria de caixa',
      suprimento: 'Suprimento de caixa (troco)', ajuste: 'Ajuste de caixa'
    };
    const explicacoes = {
      deposito_matriz: 'Retira o dinheiro do caixa da loja e registra como enviado para a matriz.',
      sangria: 'Retirada de dinheiro do caixa sem ser depósito para a matriz.',
      suprimento: 'Entrada de dinheiro no caixa, normalmente para formar o troco do dia.'
    };

    modal({
      titulo: titulos[tipo],
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-azul mb', text: explicacoes[tipo] || '' }),
        lojas.length > 1 ? el('div', { class: 'campo' }, [el('label', { text: 'Loja' }), seletor]) : null,
        el('div', { class: 'campo' }, [el('label', { text: 'Valor (R$)' }), valor]),
        el('div', { class: 'campo' }, [el('label', { text: 'Descrição' }), descricao])
      ]),
      acoes: [{
        rotulo: 'Confirmar', class: 'btn-primario', acao: async (fechar) => {
          const v = Number(valor.value);
          if (!v || v <= 0) { erro('Informe um valor maior que zero'); return; }
          try {
            const r = await api.post('/api/caixa/movimento', {
              store_id: Number(seletor.value), kind: tipo, amount: v, description: descricao.value
            });
            sucesso(`Registrado. Novo saldo: ${dinheiro(r.saldo)}`);
            fechar(); carregar();
          } catch (e) { erro(e.message); }
        }
      }]
    });
  }

  carregar();
}
