/* Caixa em dinheiro da loja: entra com venda, sai com despesa, sangria e depósito. */
import { listar, salvar, saldoCaixa } from '../db.js';
import { el, limpar, dinheiro, dataHora, erro, sucesso, painel, vazio, kpi, numero, anexar } from '../ui.js';

const ROTULOS = {
  venda: '🧾 Venda em dinheiro', despesa: '📉 Despesa paga em dinheiro',
  deposito: '🏦 Depósito para a matriz', sangria: '📤 Sangria',
  suprimento: '📥 Suprimento (troco)', estorno: '↩️ Estorno', acerto: '✏️ Acerto'
};

export async function render(raiz) {
  const corpo = el('div');
  raiz.append(
    el('div', { class: 'grade3 mb' }, [
      el('button', { class: 'btn btn-vazio btn-sm', onclick: () => lancar('suprimento') }, '📥 Troco'),
      el('button', { class: 'btn btn-vazio btn-sm', onclick: () => lancar('sangria') }, '📤 Sangria'),
      el('button', { class: 'btn btn-acao btn-sm', onclick: () => lancar('deposito') }, '🏦 Depósito')
    ]),
    corpo
  );

  async function desenhar() {
    const movimentos = (await listar('caixa')).sort((a, b) => String(b.data).localeCompare(String(a.data)));
    const saldo = await saldoCaixa();
    const hoje = new Date().toISOString().slice(0, 10);
    const doDia = movimentos.filter(m => String(m.data).slice(0, 10) === hoje);
    const depositado = movimentos.filter(m => m.tipo === 'deposito').reduce((a, m) => a + -m.valor, 0);

anexar(limpar(corpo), 
      el('div', { class: 'grade2 mb' }, [
        kpi({ rot: 'Saldo em caixa', val: dinheiro(saldo), det: 'dinheiro na loja', cor: saldo >= 0 ? 'verde' : 'vermelho' }),
        kpi({ rot: 'Entradas de hoje', val: dinheiro(doDia.filter(m => m.valor > 0).reduce((a, m) => a + m.valor, 0)),
              det: `${numero(doDia.length)} lançamento(s)`, cor: 'amarelo' })
      ]),
      depositado > 0 ? el('div', { class: 'aviso aviso-azul', text: `🏦 Já depositado para a matriz: ${dinheiro(depositado)}` }) : null,
      movimentos.length
        ? el('div', { class: 'cartao' }, el('div', { class: 'lista' }, movimentos.slice(0, 120).map(m =>
            el('div', { class: 'item' }, [
              el('div', { class: 'info' }, [
                el('div', { class: 'titulo', text: ROTULOS[m.tipo] || m.tipo }),
                el('div', { class: 'sub', text: `${dataHora(m.data)}${m.descricao ? ' · ' + m.descricao : ''}` })
              ]),
              el('span', {
                class: 'valor', style: { color: m.valor >= 0 ? 'var(--verde-700)' : 'var(--vermelho-600)' },
                text: `${m.valor >= 0 ? '+' : '−'} ${dinheiro(Math.abs(m.valor))}`
              })
            ])))
          )
        : vazio('Nenhum lançamento ainda. As vendas em dinheiro entram aqui automaticamente.', '💵')
    );
  }

  function lancar(tipo) {
    const titulos = { deposito: 'Depósito para a matriz', sangria: 'Sangria de caixa', suprimento: 'Suprimento de caixa' };
    const explicacoes = {
      deposito: 'Retira o dinheiro do caixa e registra como enviado para a matriz.',
      sangria: 'Retirada de dinheiro do caixa que não é depósito para a matriz.',
      suprimento: 'Entrada de dinheiro no caixa, normalmente para formar o troco do dia.'
    };
    const valor = el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', placeholder: '0,00' });
    const descricao = el('input', { type: 'text', placeholder: 'Descrição (opcional)' });

    painel({
      titulo: titulos[tipo],
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-azul', text: explicacoes[tipo] }),
        el('div', { class: 'campo' }, [el('label', { text: 'Valor (R$)' }), valor]),
        el('div', { class: 'campo' }, [el('label', { text: 'Descrição' }), descricao])
      ]),
      acoes: [{
        rotulo: 'Confirmar', class: 'btn-primario', acao: async (fechar) => {
          const v = Number(valor.value);
          if (!v || v <= 0) { erro('Informe um valor maior que zero'); return; }
          const saldo = await saldoCaixa();
          if (tipo !== 'suprimento' && saldo < v) {
            erro(`O caixa tem ${dinheiro(saldo)}. Não dá para retirar ${dinheiro(v)}.`);
            return;
          }
          await salvar('caixa', {
            data: new Date().toISOString(), tipo,
            valor: tipo === 'suprimento' ? v : -v,
            descricao: descricao.value.trim() || titulos[tipo]
          });
          sucesso('Lançado no caixa');
          fechar(); desenhar();
        }
      }]
    });
  }

  desenhar();
}
