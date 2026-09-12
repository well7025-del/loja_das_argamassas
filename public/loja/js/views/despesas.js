/* Despesas da loja. Quando paga em dinheiro, sai do caixa automaticamente. */
import { listar, remover, registrarDespesa, lancar, saldos } from '../db.js';
import { el, limpar, dinheiro, dataBR, erro, sucesso, painel, vazio, barras, confirmar, hoje, numero, anexar } from '../ui.js';

const CATEGORIAS = ['aluguel', 'salario', 'comissao', 'energia', 'agua', 'internet', 'impostos',
  'telefone', 'frete', 'combustivel', 'manutencao', 'fornecedor', 'marketing', 'outros'];
const NOMES = {
  aluguel: 'Aluguel', salario: 'Salário', comissao: 'Comissão', energia: 'Energia', agua: 'Água',
  internet: 'Internet', impostos: 'Impostos', telefone: 'Telefone', frete: 'Frete',
  combustivel: 'Combustível', manutencao: 'Manutenção', fornecedor: 'Fornecedor',
  marketing: 'Marketing', outros: 'Outros'
};
// A conta define de onde o dinheiro saiu; guardamos o nome para o histórico
// continuar legível mesmo se a conta for renomeada ou excluída depois.

export async function render(raiz) {
  const corpo = el('div');
  const seletorMes = el('select');
  const agora = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const valor = d.toISOString().slice(0, 7);
    seletorMes.appendChild(el('option', { value: valor, text: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) }));
  }
  seletorMes.addEventListener('change', desenhar);

  raiz.append(
    el('div', { class: 'campo' }, [el('label', { text: 'Mês' }), seletorMes]),
    el('button', { class: 'btn btn-acao btn-bloco mb', onclick: formulario }, '+ Lançar despesa'),
    corpo
  );

  async function desenhar() {
    const todas = await listar('despesas');
    const mes = seletorMes.value;
    const lista = todas.filter(d => String(d.data).slice(0, 7) === mes)
      .sort((a, b) => String(b.data).localeCompare(String(a.data)));
    const total = lista.reduce((a, d) => a + d.valor, 0);

    const porCategoria = {};
    for (const d of lista) porCategoria[d.categoria] = (porCategoria[d.categoria] || 0) + d.valor;
    const ranking = Object.entries(porCategoria)
      .map(([c, v]) => ({ rotulo: NOMES[c] || c, valor: v }))
      .sort((a, b) => b.valor - a.valor);

anexar(limpar(corpo), 
      el('div', { class: 'kpi vermelho mb' }, [
        el('div', { class: 'rot', text: 'Total do mês' }),
        el('div', { class: 'val', text: dinheiro(total) }),
        el('div', { class: 'det', text: `${numero(lista.length)} lançamento(s)` })
      ]),
      ranking.length
        ? el('div', { class: 'cartao' }, [
            el('div', { class: 'cartao-cab' }, el('h3', { text: 'Para onde o dinheiro foi' })),
            el('div', { class: 'cartao-corpo' }, barras(ranking, { cor: '#C62828' }))
          ])
        : null,
      lista.length
        ? el('div', { class: 'cartao' }, el('div', { class: 'lista' }, lista.map(d =>
            el('button', { class: 'item', onclick: () => abrir(d) }, [
              el('div', { class: 'info' }, [
                el('div', { class: 'titulo', text: NOMES[d.categoria] || d.categoria }),
                el('div', { class: 'sub', text: [dataBR(d.data), d.contaNome, d.descricao].filter(Boolean).join(' · ') })
              ]),
              el('span', { class: 'valor', text: dinheiro(d.valor) })
            ]))))
        : vazio('Nenhuma despesa neste mês', '📉')
    );
  }

  function abrir(despesa) {
    painel({
      titulo: NOMES[despesa.categoria] || despesa.categoria,
      corpo: el('div', {}, [
        el('div', { class: 'kpi vermelho mb' }, [
          el('div', { class: 'rot', text: 'Valor' }), el('div', { class: 'val', text: dinheiro(despesa.valor) })
        ]),
        el('div', { class: 'pq mudo', text: `${dataBR(despesa.data)}${despesa.contaNome ? ' · pago por ' + despesa.contaNome : ''}` }),
        despesa.descricao ? el('p', { text: despesa.descricao }) : null
      ]),
      acoes: [{
        rotulo: 'Excluir', class: 'btn-perigo', acao: async (fechar) => {
          if (!await confirmar('Excluir esta despesa? Se foi paga em dinheiro, o valor volta para o caixa.', { perigo: true })) return;
          await remover('despesas', despesa.id);
          if (despesa.contaId) {
            await lancar({
              contaId: despesa.contaId, tipo: 'ajuste', valor: despesa.valor,
              descricao: `Estorno de despesa (${NOMES[despesa.categoria] || despesa.categoria})`
            });
          }
          sucesso('Despesa excluída'); fechar(); desenhar();
        }
      }]
    });
  }

  async function formulario() {
    const contas = await saldos();
    const categoria = el('select', {}, CATEGORIAS.map(c => el('option', { value: c, text: NOMES[c] })));
    const valor = el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', placeholder: '0,00' });
    const descricao = el('input', { type: 'text', placeholder: 'Ex.: conta de setembro' });
    const conta = el('select', {}, [
      ...contas.map(c => el('option', { value: c.id, text: `${c.nome} — ${dinheiro(c.saldo)}` })),
      el('option', { value: '', text: 'Não lançar em conta (só registrar)' })
    ]);
    const data = el('input', { type: 'date', value: hoje() });

    painel({
      titulo: 'Lançar despesa',
      corpo: el('div', {}, [
        el('div', { class: 'campo' }, [el('label', { text: 'Categoria' }), categoria]),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Valor (R$) *' }), valor]),
          el('div', { class: 'campo' }, [el('label', { text: 'Data' }), data])
        ]),
        el('div', { class: 'campo' }, [
          el('label', {}, ['Pago por qual conta ', el('span', { class: 'dica', text: '— o saldo dela é debitado' })]),
          conta
        ]),
        el('div', { class: 'campo' }, [el('label', { text: 'Descrição' }), descricao])
      ]),
      acoes: [{
        rotulo: 'Lançar', class: 'btn-primario', acao: async (fechar) => {
          const v = Number(valor.value);
          if (!v || v <= 0) { erro('Informe o valor'); return; }
          const contaId = conta.value ? Number(conta.value) : null;
          const escolhida = contas.find(c => c.id === contaId);
          if (escolhida && escolhida.saldo < v && !await confirmar(
            `${escolhida.nome} tem ${dinheiro(escolhida.saldo)}. Lançar mesmo assim deixa o saldo negativo.`)) return;
          await registrarDespesa({
            data: new Date(`${data.value}T12:00:00`).toISOString(),
            categoria: categoria.value, valor: v,
            descricao: descricao.value.trim(),
            contaId, contaNome: escolhida?.nome || null
          });
          sucesso('Despesa lançada');
          fechar(); desenhar();
        }
      }]
    });
  }

  desenhar();
}
