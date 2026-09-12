/* ============================================================
   Contas da loja: dinheiro no caixa, conta do PIX e conta dos cartões.
   Cada venda cai na conta da sua forma de pagamento; aqui ficam as
   transferências entre contas e os lançamentos avulsos de receita e despesa.
   ============================================================ */
import { listar, salvar, saldos, contasAtivas, lancar, transferir, remover } from '../db.js';
import {
  el, limpar, dinheiro, dataHora, erro, sucesso, painel, vazio, confirmar, numero, anexar
} from '../ui.js';

const ICONES = { dinheiro: '💵', banco: '🏦', cartao: '💳', outro: '📁' };
const ROTULOS = {
  venda: '🧾 Venda', despesa: '📉 Despesa', compra: '📦 Compra de mercadoria',
  receita: '📈 Receita', estorno: '↩️ Estorno', ajuste: '✏️ Acerto',
  transferencia_saida: '📤 Transferência enviada', transferencia_entrada: '📥 Transferência recebida'
};

const FORMAS_PAGAMENTO = [
  { id: 'dinheiro', rotulo: 'Dinheiro' }, { id: 'pix', rotulo: 'PIX' },
  { id: 'debito', rotulo: 'Cartão de débito' }, { id: 'credito', rotulo: 'Cartão de crédito' },
  { id: 'boleto', rotulo: 'Boleto' }, { id: 'prazo', rotulo: 'A prazo' }
];

export async function render(raiz) {
  const corpo = el('div');

  anexar(raiz,
    el('div', { class: 'grade3 mb' }, [
      el('button', { class: 'btn btn-vazio btn-sm', onclick: formTransferencia }, '🔁 Transferir'),
      el('button', { class: 'btn btn-vazio btn-sm', onclick: () => formLancamento('receita') }, '📈 Receita'),
      el('button', { class: 'btn btn-vazio btn-sm', onclick: () => formLancamento('despesa') }, '📉 Despesa')
    ]),
    corpo
  );

  async function desenhar() {
    const [contas, lancamentos] = await Promise.all([saldos(), listar('lancamentos')]);
    const total = contas.reduce((a, c) => a + c.saldo, 0);
    const hoje = new Date().toISOString().slice(0, 10);
    const doDia = lancamentos.filter(l => String(l.data).slice(0, 10) === hoje);

    limpar(corpo);
    anexar(corpo,
      el('div', { class: 'kpi verde mb' }, [
        el('div', { class: 'rot', text: 'Total em todas as contas' }),
        el('div', { class: 'val', text: dinheiro(total) }),
        el('div', { class: 'det', text: `${numero(doDia.length)} lançamento(s) hoje` })
      ]),

      el('div', { class: 'cartao mb' }, [
        el('div', { class: 'cartao-cab' }, [
          el('h3', { text: 'Suas contas' }),
          el('button', { class: 'btn btn-vazio btn-sm', onclick: () => formConta() }, '+ Conta')
        ]),
        el('div', { class: 'lista' }, contas.map(c => {
          const entradas = lancamentos.filter(l => l.contaId === c.id && l.valor > 0).reduce((a, l) => a + l.valor, 0);
          return el('button', { class: 'item', onclick: () => extrato(c, lancamentos) }, [
            el('span', { style: { fontSize: '22px' }, text: ICONES[c.tipo] || '📁' }),
            el('div', { class: 'info' }, [
              el('div', { class: 'titulo', text: c.nome }),
              el('div', { class: 'sub', text: (c.recebe || []).length
                ? 'recebe ' + (c.recebe || []).map(f => FORMAS_PAGAMENTO.find(x => x.id === f)?.rotulo || f).join(', ').toLowerCase()
                : 'sem recebimento automático' })
            ]),
            el('span', { class: 'valor', style: { color: c.saldo < 0 ? 'var(--vermelho-600)' : 'var(--cinza-900)' },
                         text: dinheiro(c.saldo) })
          ]);
        }))
      ]),

      lancamentos.length
        ? el('div', { class: 'cartao' }, [
            el('div', { class: 'cartao-cab' }, el('h3', { text: 'Últimos lançamentos' })),
            el('div', { class: 'lista' }, [...lancamentos]
              .sort((a, b) => String(b.data).localeCompare(String(a.data)))
              .slice(0, 60)
              .map(l => linhaLancamento(l, contas)))
          ])
        : vazio('Nenhum lançamento ainda. As vendas entram aqui automaticamente.', '🏦')
    );
  }

  function linhaLancamento(l, contas) {
    const conta = contas.find(c => c.id === l.contaId);
    return el('div', { class: 'item' }, [
      el('div', { class: 'info' }, [
        el('div', { class: 'titulo', text: ROTULOS[l.tipo] || l.tipo }),
        el('div', { class: 'sub', text: `${dataHora(l.data)} · ${conta?.nome || 'conta removida'}${l.descricao ? ' · ' + l.descricao : ''}` })
      ]),
      el('span', {
        class: 'valor', style: { color: l.valor >= 0 ? 'var(--verde-700)' : 'var(--vermelho-600)' },
        text: `${l.valor >= 0 ? '+' : '−'} ${dinheiro(Math.abs(l.valor))}`
      })
    ]);
  }

  /* ---------------- Extrato de uma conta ---------------- */
  function extrato(conta, todos) {
    const movimentos = todos.filter(l => l.contaId === conta.id)
      .sort((a, b) => String(b.data).localeCompare(String(a.data)));
    const entradas = movimentos.filter(l => l.valor > 0).reduce((a, l) => a + l.valor, 0);
    const saidas = movimentos.filter(l => l.valor < 0).reduce((a, l) => a - l.valor, 0);

    painel({
      titulo: `${ICONES[conta.tipo] || ''} ${conta.nome}`,
      corpo: el('div', {}, [
        el('div', { class: 'kpi verde mb' }, [
          el('div', { class: 'rot', text: 'Saldo' }),
          el('div', { class: 'val', text: dinheiro(conta.saldo) })
        ]),
        el('div', { class: 'grade2 mb' }, [
          el('div', { class: 'kpi' }, [el('div', { class: 'rot', text: 'Entradas' }), el('div', { class: 'val', text: dinheiro(entradas) })]),
          el('div', { class: 'kpi vermelho' }, [el('div', { class: 'rot', text: 'Saídas' }), el('div', { class: 'val', text: dinheiro(saidas) })])
        ]),
        conta.saldoInicial ? el('div', { class: 'aviso aviso-azul', text: `Saldo inicial informado: ${dinheiro(conta.saldoInicial)}` }) : null,
        movimentos.length
          ? el('div', { class: 'lista rolagem' }, movimentos.slice(0, 200).map(l => linhaLancamento(l, [conta])))
          : vazio('Nenhum lançamento nesta conta', '🏦')
      ]),
      acoes: [
        { rotulo: 'Editar conta', acao: (f) => { f(); formConta(conta); } },
        { rotulo: '🔁 Transferir', class: 'btn-primario', acao: (f) => { f(); formTransferencia(conta.id); } }
      ]
    });
  }

  /* ---------------- Transferência ---------------- */
  async function formTransferencia(origemPadrao = null) {
    const contas = await saldos();
    if (contas.length < 2) { erro('Cadastre pelo menos duas contas para transferir'); return; }

    const origem = el('select', {}, contas.map(c =>
      el('option', { value: c.id, selected: c.id === origemPadrao, text: `${c.nome} — ${dinheiro(c.saldo)}` })));
    const destino = el('select', {}, contas.map((c, i) =>
      el('option', { value: c.id, selected: origemPadrao ? c.id !== origemPadrao : i === 1, text: c.nome })));
    const valor = el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', placeholder: '0,00' });
    const descricao = el('input', { type: 'text', placeholder: 'Ex.: depósito do caixa no banco' });

    painel({
      titulo: 'Transferir entre contas',
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-azul' },
          'Sai de uma conta e entra na outra. O total da loja não muda — muda só onde o dinheiro está.'),
        el('div', { class: 'campo' }, [el('label', { text: 'De' }), origem]),
        el('div', { class: 'campo' }, [el('label', { text: 'Para' }), destino]),
        el('div', { class: 'campo' }, [el('label', { text: 'Valor (R$)' }), valor]),
        el('div', { class: 'campo' }, [el('label', { text: 'Descrição' }), descricao])
      ]),
      acoes: [{
        rotulo: 'Transferir', class: 'btn-primario', acao: async (fechar) => {
          const v = Number(valor.value);
          const origemId = Number(origem.value), destinoId = Number(destino.value);
          if (!(v > 0)) { erro('Informe um valor maior que zero'); return; }
          if (origemId === destinoId) { erro('Escolha duas contas diferentes'); return; }
          const saldoOrigem = contas.find(c => c.id === origemId)?.saldo ?? 0;
          if (saldoOrigem < v && !await confirmar(
            `A conta de origem tem ${dinheiro(saldoOrigem)}. Transferir mesmo assim deixa o saldo negativo.`)) return;
          try {
            await transferir({ origemId, destinoId, valor: v, descricao: descricao.value.trim() });
            sucesso('Transferência registrada');
            fechar(); desenhar();
          } catch (e) { erro(e.message); }
        }
      }]
    });
  }

  /* ---------------- Receita / despesa avulsa ---------------- */
  async function formLancamento(tipo) {
    const contas = await saldos();
    const conta = el('select', {}, contas.map(c => el('option', { value: c.id, text: `${c.nome} — ${dinheiro(c.saldo)}` })));
    const valor = el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', placeholder: '0,00' });
    const descricao = el('input', { type: 'text', placeholder: tipo === 'receita' ? 'Ex.: aluguel de andaime' : 'Ex.: material de limpeza' });

    painel({
      titulo: tipo === 'receita' ? 'Lançar receita' : 'Lançar despesa',
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-azul' }, tipo === 'receita'
          ? 'Entrada de dinheiro que não veio de uma venda do PDV.'
          : 'Saída de dinheiro de qualquer conta. Para despesas do mês (aluguel, energia…), use o menu Despesas.'),
        el('div', { class: 'campo' }, [el('label', { text: 'Conta' }), conta]),
        el('div', { class: 'campo' }, [el('label', { text: 'Valor (R$)' }), valor]),
        el('div', { class: 'campo' }, [el('label', { text: 'Descrição' }), descricao])
      ]),
      acoes: [{
        rotulo: 'Lançar', class: tipo === 'receita' ? 'btn-ok' : 'btn-primario', acao: async (fechar) => {
          const v = Number(valor.value);
          if (!(v > 0)) { erro('Informe um valor maior que zero'); return; }
          await lancar({
            contaId: Number(conta.value), tipo,
            valor: tipo === 'receita' ? v : -v,
            descricao: descricao.value.trim()
          });
          sucesso(tipo === 'receita' ? 'Receita lançada' : 'Despesa lançada');
          fechar(); desenhar();
        }
      }]
    });
  }

  /* ---------------- Cadastro de conta ---------------- */
  function formConta(conta = null) {
    const nome = el('input', { type: 'text', value: conta?.nome || '' });
    const tipo = el('select', {}, [
      ['dinheiro', '💵 Dinheiro em espécie'], ['banco', '🏦 Conta bancária'],
      ['cartao', '💳 Maquininha / cartões'], ['outro', '📁 Outra']
    ].map(([v, t]) => el('option', { value: v, selected: conta?.tipo === v, text: t })));
    const saldoInicial = el('input', { type: 'number', inputmode: 'decimal', step: '0.01', value: conta?.saldoInicial ?? 0 });
    const recebe = FORMAS_PAGAMENTO.map(f => {
      const caixa = el('input', { type: 'checkbox', checked: (conta?.recebe || []).includes(f.id) });
      return { id: f.id, caixa, elemento: el('label', { class: 'check' }, [caixa, el('span', { text: f.rotulo })]) };
    });

    painel({
      titulo: conta ? 'Editar conta' : 'Nova conta',
      corpo: el('div', {}, [
        el('div', { class: 'campo' }, [el('label', { text: 'Nome *' }), nome]),
        el('div', { class: 'campo' }, [el('label', { text: 'Tipo' }), tipo]),
        el('div', { class: 'campo' }, [
          el('label', {}, ['Saldo inicial (R$) ', el('span', { class: 'dica', text: '— o que já havia antes de usar o aplicativo' })]),
          saldoInicial
        ]),
        el('label', { class: 'pq negrito', text: 'Vendas que caem nesta conta', style: { display: 'block', marginBottom: '6px' } }),
        el('div', {}, recebe.map(r => r.elemento)),
        el('div', { class: 'aviso aviso-amarelo mt' },
          'Cada forma de pagamento deve estar marcada em uma conta só. Se ficar sem conta, a venda é registrada mas não entra em nenhum saldo.')
      ]),
      acoes: [
        conta && !conta.chave ? { rotulo: 'Excluir', class: 'btn-perigo', acao: async (fechar) => {
          if (!await confirmar(`Excluir a conta "${conta.nome}"? Os lançamentos dela ficam órfãos.`, { perigo: true })) return;
          await remover('contas', conta.id);
          sucesso('Conta excluída'); fechar(); desenhar();
        } } : null,
        { rotulo: 'Salvar', class: 'btn-primario', acao: async (fechar) => {
          if (!nome.value.trim()) { erro('Informe o nome da conta'); return; }
          const marcadas = recebe.filter(r => r.caixa.checked).map(r => r.id);

          // uma forma de pagamento em duas contas faria a venda cair na primeira
          // encontrada, sem o dono entender por quê: melhor impedir na entrada
          const outras = (await contasAtivas()).filter(c => c.id !== conta?.id);
          const conflito = marcadas.find(f => outras.some(c => (c.recebe || []).includes(f)));
          if (conflito) {
            const dona = outras.find(c => (c.recebe || []).includes(conflito));
            erro(`${FORMAS_PAGAMENTO.find(f => f.id === conflito).rotulo} já cai em "${dona.nome}". Desmarque lá primeiro.`);
            return;
          }

          await salvar('contas', {
            ...(conta || { criadaEm: new Date().toISOString(), ordem: 90, ativa: true }),
            nome: nome.value.trim(), tipo: tipo.value,
            saldoInicial: Number(saldoInicial.value) || 0,
            recebe: marcadas
          });
          sucesso(conta ? 'Conta atualizada' : 'Conta criada');
          fechar(); desenhar();
        } }
      ].filter(Boolean)
    });
  }

  desenhar();
}
