/* Relatorio e insights gerados a partir dos dados da operacao. */
import { api } from '../api.js';
import { estado } from '../app.js';
import { el, limpar, kpi, dinheiro, numero, percentual, erro, copiar, vazio, diasAtras, hoje } from '../ui.js';

const ICONE = { risco: '⚠️', alerta: '🔔', oportunidade: '💡', destaque: '✅' };
const NOME_TIPO = { risco: 'Risco', alerta: 'Atenção', oportunidade: 'Oportunidade', destaque: 'Destaque' };

export async function render(raiz) {
  const periodo = { from: diasAtras(29), to: hoje() };
  const corpo = el('div');
  const narrativa = el('div');

  const entradaDe = el('input', { type: 'date', value: periodo.from, onchange: (e) => { periodo.from = e.target.value; carregar(); } });
  const entradaAte = el('input', { type: 'date', value: periodo.to, onchange: (e) => { periodo.to = e.target.value; carregar(); } });
  const pergunta = el('input', { type: 'text', placeholder: 'Pergunta opcional: "como aumento a margem?"' });
  const btnRelatorio = el('button', { class: 'btn btn-acao', onclick: gerarRelatorio }, '📝 Gerar relatório executivo');

  raiz.append(
    el('div', { class: 'filtros' }, [
      el('div', { class: 'campo' }, [el('label', { text: 'De' }), entradaDe]),
      el('div', { class: 'campo' }, [el('label', { text: 'Até' }), entradaAte]),
      el('div', { class: 'campo', style: { flex: '2' } }, [el('label', { text: 'Foco da análise' }), pergunta]),
      btnRelatorio
    ]),
    corpo, narrativa
  );

  async function carregar() {
    limpar(corpo).appendChild(el('div', { class: 'vazio', text: 'Analisando os dados…' }));
    limpar(narrativa);
    const dados = await api.get('/api/ia/insights', { ...periodo, store_id: estado.lojaSelecionada || undefined });
    limpar(corpo);
    const r = dados.resumo;

    corpo.appendChild(el('div', { class: 'grid g4 mb' }, [
      kpi({ rotulo: 'Faturamento', valor: dinheiro(r.faturamento), cor: 'verde', detalhe: `${numero(r.vendas)} vendas` }),
      kpi({ rotulo: 'Lucro bruto', valor: dinheiro(r.lucro_bruto), detalhe: `margem ${percentual(r.margem_bruta)}` }),
      kpi({ rotulo: 'Despesas', valor: dinheiro(r.despesas), cor: 'amarelo' }),
      kpi({ rotulo: 'Resultado', valor: dinheiro(r.resultado), cor: r.resultado >= 0 ? 'verde' : 'vermelho' })
    ]));

    if (!dados.insights.length) {
      corpo.appendChild(vazio('Ainda não há movimento suficiente para gerar análises. Registre vendas e despesas.', '🤖'));
      return;
    }

    const contagem = dados.insights.reduce((a, i) => { a[i.tipo] = (a[i.tipo] || 0) + 1; return a; }, {});
    corpo.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'card-cab' }, [
        el('h3', { text: `${dados.insights.length} pontos identificados na operação` }),
        el('div', { class: 'espaco' }),
        ...Object.entries(contagem).map(([t, n]) => el('span', {
          class: `tag ${t === 'risco' ? 'tag-vermelho' : t === 'alerta' ? 'tag-amarelo' : t === 'oportunidade' ? 'tag-azul' : 'tag-verde'}`,
          style: { marginLeft: '5px' }, text: `${ICONE[t]} ${n} ${NOME_TIPO[t]}`
        }))
      ]),
      el('div', {}, dados.insights.map(i => el('div', { class: `insight ${i.tipo}` }, [
        el('div', { class: 'marca-tipo' }),
        el('div', { style: { flex: '1', minWidth: '0' } }, [
          el('h4', { text: `${ICONE[i.tipo]} ${i.titulo}` }),
          el('p', { text: i.texto }),
          el('div', { class: 'acao', text: `👉 ${i.acao}` })
        ])
      ])))
    ]));

    corpo.appendChild(el('div', { class: 'card mt' }, [
      el('div', { class: 'card-cab' }, [
        el('h3', { text: 'Resumo executivo' }),
        el('div', { class: 'espaco' }),
        el('button', { class: 'btn btn-sm btn-vazio', onclick: () => copiar(dados.relatorio) }, '📋 Copiar')
      ]),
      el('div', { class: 'card-corpo' }, el('div', { class: 'relatorio-ia', text: dados.relatorio }))
    ]));

    if (!dados.ia_externa_disponivel) {
      corpo.appendChild(el('div', { class: 'aviso aviso-azul mt' },
        'A análise acima é calculada pelo próprio ERP a partir dos seus dados. Para gerar um relatório escrito em linguagem natural, configure a variável de ambiente ANTHROPIC_API_KEY no servidor e instale o pacote @anthropic-ai/sdk.'));
    }
  }

  async function gerarRelatorio() {
    btnRelatorio.disabled = true; btnRelatorio.textContent = 'Gerando…';
    limpar(narrativa).appendChild(el('div', { class: 'card mt' }, el('div', { class: 'card-corpo' }, 'Analisando período e escrevendo o relatório…')));
    try {
      const r = await api.post('/api/ia/relatorio', { ...periodo, store_id: estado.lojaSelecionada || undefined, pergunta: pergunta.value });
      const texto = r.narrativa || r.relatorio;
      limpar(narrativa).appendChild(el('div', { class: 'card mt' }, [
        el('div', { class: 'card-cab' }, [
          el('h3', { text: '📝 Relatório executivo do período' }),
          el('div', { class: 'espaco' }),
          el('span', { class: `tag ${r.fonte === 'claude' ? 'tag-verde' : 'tag-cinza'}`,
                       text: r.fonte === 'claude' ? 'Escrito por IA (Claude)' : 'Análise do próprio ERP' }),
          el('button', { class: 'btn btn-sm btn-vazio', onclick: () => copiar(texto) }, '📋 Copiar')
        ]),
        el('div', { class: 'card-corpo' }, [
          el('div', { class: 'relatorio-ia', text: texto }),
          r.erro ? el('div', { class: 'aviso aviso-amarelo mt', text: `A geração por IA falhou (${r.erro}); o texto acima foi produzido pela análise interna do sistema.` }) : null
        ])
      ]));
    } catch (e) {
      erro(e.message);
      limpar(narrativa);
    } finally {
      btnRelatorio.disabled = false; btnRelatorio.textContent = '📝 Gerar relatório executivo';
    }
  }

  carregar();
}
