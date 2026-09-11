/* Despesas da loja. Quando paga em dinheiro, sai do caixa automaticamente. */
import { listar, remover, salvar, registrarDespesa, saldoCaixa } from '../db.js';
import { el, limpar, dinheiro, dataBR, erro, sucesso, painel, vazio, barras, confirmar, hoje, numero, anexar } from '../ui.js';

const CATEGORIAS = ['aluguel', 'salario', 'comissao', 'energia', 'agua', 'internet', 'impostos',
  'telefone', 'frete', 'combustivel', 'manutencao', 'fornecedor', 'marketing', 'outros'];
const NOMES = {
  aluguel: 'Aluguel', salario: 'Salário', comissao: 'Comissão', energia: 'Energia', agua: 'Água',
  internet: 'Internet', impostos: 'Impostos', telefone: 'Telefone', frete: 'Frete',
  combustivel: 'Combustível', manutencao: 'Manutenção', fornecedor: 'Fornecedor',
  marketing: 'Marketing', outros: 'Outros'
};
const FORMAS = { dinheiro: 'Dinheiro', pix: 'PIX', cartao: 'Cartão', boleto: 'Boleto', transferencia: 'Transferência' };

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
                el('div', { class: 'sub', text: `${dataBR(d.data)} · ${FORMAS[d.forma] || d.forma}${d.descricao ? ' · ' + d.descricao : ''}` })
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
        el('div', { class: 'pq mudo', text: `${dataBR(despesa.data)} · pago em ${FORMAS[despesa.forma] || despesa.forma}` }),
        despesa.descricao ? el('p', { text: despesa.descricao }) : null
      ]),
      acoes: [{
        rotulo: 'Excluir', class: 'btn-perigo', acao: async (fechar) => {
          if (!await confirmar('Excluir esta despesa? Se foi paga em dinheiro, o valor volta para o caixa.', { perigo: true })) return;
          await remover('despesas', despesa.id);
          if (despesa.forma === 'dinheiro') {
            await salvar('caixa', {
              data: new Date().toISOString(), tipo: 'acerto', valor: despesa.valor,
              descricao: `Estorno de despesa (${NOMES[despesa.categoria] || despesa.categoria})`
            });
          }
          sucesso('Despesa excluída'); fechar(); desenhar();
        }
      }]
    });
  }

  function formulario() {
    const categoria = el('select', {}, CATEGORIAS.map(c => el('option', { value: c, text: NOMES[c] })));
    const valor = el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', placeholder: '0,00' });
    const descricao = el('input', { type: 'text', placeholder: 'Ex.: conta de setembro' });
    const forma = el('select', {}, Object.entries(FORMAS).map(([k, v]) => el('option', { value: k, text: v })));
    const data = el('input', { type: 'date', value: hoje() });
    const avisoCaixa = el('div', { class: 'aviso aviso-amarelo', text: 'Pago em dinheiro: sai do caixa da loja.' });
    forma.addEventListener('change', () => { avisoCaixa.hidden = forma.value !== 'dinheiro'; });

    painel({
      titulo: 'Lançar despesa',
      corpo: el('div', {}, [
        el('div', { class: 'campo' }, [el('label', { text: 'Categoria' }), categoria]),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Valor (R$) *' }), valor]),
          el('div', { class: 'campo' }, [el('label', { text: 'Data' }), data])
        ]),
        el('div', { class: 'campo' }, [el('label', { text: 'Forma de pagamento' }), forma]),
        el('div', { class: 'campo' }, [el('label', { text: 'Descrição' }), descricao]),
        avisoCaixa
      ]),
      acoes: [{
        rotulo: 'Lançar', class: 'btn-primario', acao: async (fechar) => {
          const v = Number(valor.value);
          if (!v || v <= 0) { erro('Informe o valor'); return; }
          if (forma.value === 'dinheiro') {
            const saldo = await saldoCaixa();
            if (saldo < v) {
              erro(`O caixa tem ${dinheiro(saldo)}. Lance um suprimento ou escolha outra forma de pagamento.`);
              return;
            }
          }
          await registrarDespesa({
            data: new Date(`${data.value}T12:00:00`).toISOString(),
            categoria: categoria.value, valor: v,
            descricao: descricao.value.trim(), forma: forma.value
          });
          sucesso('Despesa lançada');
          fechar(); desenhar();
        }
      }]
    });
  }

  desenhar();
}
