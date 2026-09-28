/* ============================================================
   Inventário para auditoria.

   A contagem é feita com o saldo do sistema escondido, senão quem conta
   "confirma" o número em vez de contar. Só depois de fechar a contagem é
   que aparece a divergência de cada item — e ela vira ajuste registrado.
   ============================================================ */
import { listar, config, fecharInventario, documentosDe } from '../db.js';
import {
  el, limpar, dinheiro, numero, dataHora, dataBR, erro, sucesso, painel, vazio, confirmar,
  campoFoto, atrasar, kpi, cartao, anexar } from '../ui.js';
import { pdfTabela, entregarPdf, dinheiroPdf, qtdPdf } from '../documentos.js';

export async function render(raiz) {
  const corpo = el('div');
  anexar(raiz,
    el('button', { class: 'btn btn-acao btn-bloco mb', onclick: iniciarContagem }, '📋 Iniciar contagem'),
    corpo
  );

  async function desenhar() {
    const inventarios = (await listar('inventarios'))
      .sort((a, b) => String(b.data).localeCompare(String(a.data)));

    anexar(limpar(corpo),
      el('div', { class: 'aviso aviso-azul' },
        'A contagem é cega: o saldo do sistema só aparece depois de você digitar o que contou. ' +
        'Cada divergência vira um ajuste registrado, com data, responsável e valor.'),
      inventarios.length
        ? el('div', { class: 'cartao' }, [
            el('div', { class: 'cartao-cab' }, el('h3', { text: 'Contagens anteriores' })),
            el('div', { class: 'lista' }, inventarios.map(inv =>
              el('button', { class: 'item', onclick: () => abrir(inv) }, [
                el('div', { class: 'info' }, [
                  el('div', { class: 'titulo', text: dataHora(inv.data) }),
                  el('div', { class: 'sub', text:
                    `${numero(inv.produtosContados)} item(ns) · ${numero(inv.divergencias)} divergência(s)`
                    + (inv.responsavel ? ' · ' + inv.responsavel : '') })
                ]),
                el('span', {
                  class: 'valor',
                  style: { color: inv.valorDivergencia < 0 ? 'var(--vermelho-600)' : 'var(--verde-700)' },
                  text: dinheiro(inv.valorDivergencia)
                })
              ])))
          ])
        : vazio('Nenhum inventário fechado ainda', '📋')
    );
  }

  /* ---------------- Contagem ---------------- */

  async function iniciarContagem() {
    const produtos = (await listar('produtos')).filter(p => p.ativo !== false)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    if (!produtos.length) { erro('Cadastre produtos antes de fazer o inventário'); return; }

    const contagem = new Map();            // produtoId -> número contado
    const responsavel = el('input', { type: 'text', placeholder: 'Quem contou' });
    const observacao = el('input', { type: 'text', placeholder: 'Observação (opcional)' });
    const doc = campoFoto({ rotulo: 'Folha de contagem assinada (opcional)' });
    const busca = el('input', { type: 'search', placeholder: 'Buscar produto…' });
    const lista = el('div', { class: 'lista rolagem', style: { maxHeight: '46vh' } });
    const progresso = el('div', { class: 'pq mudo' });

    function desenharLista() {
      const termo = busca.value.trim().toLowerCase();
      limpar(lista);
      const filtrados = produtos.filter(p => !termo || p.nome.toLowerCase().includes(termo));
      if (!filtrados.length) { anexar(lista, vazio('Nenhum produto', '🔍')); return; }
      for (const p of filtrados) {
        const valor = contagem.has(p.id) ? String(contagem.get(p.id)) : '';
        const entrada = el('input', {
          type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: valor,
          style: { maxWidth: '96px', textAlign: 'right' },
          onchange: (e) => {
            const v = e.target.value.trim();
            if (v === '') contagem.delete(p.id);
            else contagem.set(p.id, Math.max(0, Number(v) || 0));
            atualizarProgresso();
            e.target.closest('.item')?.classList.toggle('contado', contagem.has(p.id));
          }
        });
        anexar(lista, el('div', { class: `item ${contagem.has(p.id) ? 'contado' : ''}` }, [
          el('div', { class: 'info' }, [
            el('div', { class: 'titulo', text: p.nome }),
            el('div', { class: 'sub', text: p.unidade })
          ]),
          entrada
        ]));
      }
    }

    function atualizarProgresso() {
      progresso.textContent = `${contagem.size} de ${produtos.length} produto(s) contados. `
        + 'O que ficar em branco não é alterado.';
    }
    busca.addEventListener('input', atrasar(desenharLista, 180));

    painel({
      titulo: 'Contagem de estoque',
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-amarelo' },
          'Conte fisicamente e digite a quantidade encontrada. O saldo do sistema não aparece agora, de propósito.'),
        el('div', { class: 'campo' }, [el('label', { text: 'Responsável pela contagem' }), responsavel]),
        busca, progresso, lista,
        el('div', { class: 'campo mt' }, [el('label', { text: 'Observação' }), observacao]),
        doc.elemento
      ]),
      acoes: [{
        rotulo: 'Fechar contagem', class: 'btn-primario', acao: async (fechar) => {
          if (!contagem.size) { erro('Conte pelo menos um produto'); return; }
          if (!responsavel.value.trim()) { erro('Informe quem fez a contagem'); return; }
          if (!await confirmar(
            `Fechar o inventário com ${contagem.size} item(ns)? As diferenças viram ajuste de estoque e não podem ser desfeitas.`)) return;
          try {
            const resultado = await fecharInventario({
              itens: [...contagem.entries()].map(([produtoId, contado]) => ({ produtoId, contado })),
              observacao: observacao.value.trim(),
              responsavel: responsavel.value.trim(),
              documento: doc.valor()
            });
            sucesso(`Inventário fechado — ${resultado.divergencias} divergência(s)`);
            fechar(); desenhar(); abrir(resultado);
          } catch (e) { erro(e.message); }
        }
      }]
    });

    desenharLista(); atualizarProgresso();
  }

  /* ---------------- Resultado de um inventário ---------------- */

  async function abrir(inv) {
    const loja = await config('loja', {});
    const docs = await documentosDe('inventario', inv.id);
    const divergentes = inv.itens.filter(l => l.diferenca !== 0);
    const faltas = divergentes.filter(l => l.diferenca < 0);
    const sobras = divergentes.filter(l => l.diferenca > 0);

    painel({
      titulo: `Inventário de ${dataBR(inv.data)}`,
      corpo: el('div', {}, [
        el('div', { class: 'grade2 mb' }, [
          kpi({ rot: 'Itens contados', val: numero(inv.produtosContados) }),
          kpi({ rot: 'Divergências', val: numero(inv.divergencias), cor: inv.divergencias ? 'vermelho' : 'verde' }),
          kpi({ rot: 'Faltas', val: dinheiro(faltas.reduce((a, l) => a + l.valorDiferenca, 0)), cor: 'vermelho' }),
          kpi({ rot: 'Sobras', val: dinheiro(sobras.reduce((a, l) => a + l.valorDiferenca, 0)), cor: 'verde' })
        ]),
        inv.responsavel ? el('div', { class: 'pq mudo', text: `Responsável: ${inv.responsavel}` }) : null,
        inv.observacao ? el('div', { class: 'aviso aviso-amarelo', text: inv.observacao }) : null,
        divergentes.length
          ? cartao('Divergências', el('div', { class: 'lista' }, divergentes.map(l =>
              el('div', { class: 'item' }, [
                el('div', { class: 'info' }, [
                  el('div', { class: 'titulo', text: l.nome }),
                  el('div', { class: 'sub', text: `sistema ${numero(l.esperado, 2)} → contado ${numero(l.contado, 2)} ${l.unidade}` })
                ]),
                el('span', {
                  class: 'valor',
                  style: { color: l.diferenca < 0 ? 'var(--vermelho-600)' : 'var(--verde-700)' },
                  text: `${l.diferenca > 0 ? '+' : ''}${numero(l.diferenca, 2)}`
                })
              ]))))
          : el('div', { class: 'aviso aviso-verde', text: '✅ Nenhuma divergência: o estoque bate com o sistema.' }),
        docs.length
          ? el('div', { class: 'mt' }, [
              el('div', { class: 'pq negrito mb', text: 'Documento do inventário' }),
              ...docs.map(d => el('img', { src: d.imagem, class: 'previa' }))
            ])
          : null
      ]),
      acoes: [{
        rotulo: '📄 PDF da contagem', class: 'btn-primario', acao: async () => {
          try {
            const bytes = pdfTabela({
              titulo: 'INVENTÁRIO DE ESTOQUE',
              subtitulo: `${dataHora(inv.data)}${inv.responsavel ? ' · ' + inv.responsavel : ''}`,
              loja, paisagem: true,
              colunas: [
                { titulo: 'PRODUTO', campo: 'nome', peso: 4 },
                { titulo: 'UN', campo: 'unidade', peso: 0.8 },
                { titulo: 'SISTEMA', campo: 'esperado', peso: 1.2, alinhamento: 'direita' },
                { titulo: 'CONTADO', campo: 'contado', peso: 1.2, alinhamento: 'direita' },
                { titulo: 'DIFERENÇA', campo: 'diferenca', peso: 1.2, alinhamento: 'direita' },
                { titulo: 'VALOR', campo: 'valor', peso: 1.5, alinhamento: 'direita' }
              ],
              linhas: inv.itens.map(l => ({
                nome: l.nome, unidade: l.unidade,
                esperado: qtdPdf(l.esperado), contado: qtdPdf(l.contado),
                diferenca: (l.diferenca > 0 ? '+' : '') + qtdPdf(l.diferenca),
                valor: dinheiroPdf(l.valorDiferenca),
                destaque: l.diferenca !== 0,
                cor: l.diferenca < 0 ? [0.78, 0.16, 0.16] : (l.diferenca > 0 ? [0.11, 0.51, 0.31] : null)
              })),
              resumo: [
                { rotulo: 'Itens contados', valor: String(inv.produtosContados) },
                { rotulo: 'Divergências', valor: String(inv.divergencias) },
                { rotulo: 'Valor da divergência', valor: dinheiroPdf(inv.valorDivergencia) }
              ],
              observacao: 'Contagem cega: o saldo do sistema não era visível durante a contagem. '
                + 'As diferenças foram lançadas como ajuste de estoque na mesma data.'
            });
            sucesso(await entregarPdf(bytes, `inventario-${String(inv.data).slice(0, 10)}.pdf`));
          } catch (e) { erro('Não consegui gerar o PDF: ' + e.message); }
        }
      }]
    });
  }

  desenhar();
}
