/* Histórico de vendas: consulta, alteração, comprovante em PDF e reenvio do recibo. */
import { listar, porIndice, cancelarVenda, alterarVenda, salvar, config } from '../db.js';
import { calcularLinha, montarItem, totalizarVenda, pagamentosDe, nomeForma, descreverPagamento } from '../regras.js';
import { editorPagamentos, painelDescontoItem } from '../componentes.js';
import { estado } from '../app.js';
import {
  el, limpar, dinheiro, numero, percentual, dataHora, erro, sucesso, painel, vazio,
  abrirWhatsApp, numeroWhatsApp, copiar, confirmar, atrasar, diasAtras, hoje, kpi,
  telefoneBR, redesenho, anexar } from '../ui.js';
import { impressoraDisponivel, imprimirCupom } from '../impressora.js';
import { pdfComprovante, entregarPdf, nomeArquivoSeguro, textoRecibo, pixParaVenda } from '../documentos.js';


export async function render(raiz) {
  const corpo = el('div');
  const de = el('input', { type: 'date', value: diasAtras(29) });
  const ate = el('input', { type: 'date', value: hoje() });
  const busca = el('input', { type: 'search', placeholder: 'Código da venda ou cliente…' });
  [de, ate].forEach(c => c.addEventListener('change', desenhar));
  busca.addEventListener('input', atrasar(desenhar, 250));

  const atalho = (rotulo, dias) => el('button', {
    class: 'chip', type: 'button',
    onclick: () => { de.value = diasAtras(dias); ate.value = hoje(); desenhar(); }
  }, rotulo);

  anexar(raiz,
    el('div', { class: 'linha mb' }, [
      el('div', { class: 'campo', style: { margin: 0 } }, [el('label', { text: 'De' }), de]),
      el('div', { class: 'campo', style: { margin: 0 } }, [el('label', { text: 'Até' }), ate])
    ]),
    el('div', { class: 'chips mb' }, [atalho('Hoje', 0), atalho('7 dias', 6), atalho('30 dias', 29), atalho('90 dias', 89)]),
    el('div', { class: 'campo' }, [busca]),
    corpo
  );

  async function desenhar() {
    const todas = await listar('vendas');
    const termo = busca.value.trim().toLowerCase();
    const lista = todas
      .filter(v => {
        const dia = String(v.data).slice(0, 10);
        return dia >= de.value && dia <= ate.value &&
          (!termo || v.codigo.toLowerCase().includes(termo) || (v.clienteNome || '').toLowerCase().includes(termo));
      })
      .sort((a, b) => String(b.data).localeCompare(String(a.data)));

    const validas = lista.filter(v => !v.cancelada);
    const total = validas.reduce((a, v) => a + v.total, 0);

    anexar(limpar(corpo),
      el('div', { class: 'grade2 mb' }, [
        kpi({ rot: 'Faturamento', val: dinheiro(total), det: `${numero(validas.length)} venda(s)`, cor: 'verde' }),
        kpi({ rot: 'Ticket médio', val: dinheiro(validas.length ? total / validas.length : 0), cor: 'amarelo' })
      ]),
      lista.length
        ? el('div', { class: 'cartao' }, el('div', { class: 'lista' }, lista.slice(0, 200).map(v =>
            el('button', { class: 'item', onclick: () => abrir(v) }, [
              el('div', { class: 'info' }, [
                el('div', { class: 'titulo' }, [
                  el('span', { text: v.codigo }),
                  v.temComprovante ? el('span', { text: ' 📎' }) : null,
                  (v.alteracoes || []).length ? el('span', { class: 'etiqueta et-amarela', style: { marginLeft: '6px' }, text: 'alterada' }) : null,
                  v.cancelada ? el('span', { class: 'etiqueta et-vermelha', style: { marginLeft: '6px' }, text: 'cancelada' }) : null
                ]),
                el('div', { class: 'sub', text: `${dataHora(v.data)} · ${v.clienteNome || 'sem cliente'} · ${descreverPagamento(v, dinheiro)}` })
              ]),
              el('span', { class: 'valor', style: v.cancelada ? { textDecoration: 'line-through', color: 'var(--cinza-500)' } : {}, text: dinheiro(v.total) })
            ]))))
        : vazio('Nenhuma venda no período', '🧾')
    );
  }

  /* ---------------- recibo ---------------- */

  /* ---------------- detalhe da venda ---------------- */

  async function abrir(venda) {
    const comprovantes = await porIndice('comprovantes', 'vendaId', IDBKeyRange.only(venda.id));
    const foto = comprovantes[0]?.imagem;
    const loja = await config('loja', estado.loja || {});
    const pix = pixParaVenda(venda, await config('pix', null));
    const texto = textoRecibo(venda, loja, pix);
    const zap = numeroWhatsApp(venda.clienteTelefone);

    const conteudo = el('div', {}, [
      venda.cancelada ? el('div', { class: 'aviso aviso-vermelho', text: 'Esta venda foi cancelada.' }) : null,
      el('div', { class: 'pq mudo mb', text: `${dataHora(venda.data)} · ${descreverPagamento(venda, dinheiro)}` }),
      el('div', { class: 'cartao mb' }, el('div', { class: 'cartao-corpo' }, [
        el('div', { class: 'pq negrito', text: 'Cliente' }),
        el('div', { text: venda.clienteNome || 'Sem cliente identificado' }),
        venda.clienteTelefone ? el('div', { class: 'pq mudo', text: telefoneBR(venda.clienteTelefone) }) : null,
        !venda.cancelada
          ? el('button', { class: 'btn btn-vazio btn-sm mt', type: 'button', onclick: () => escolherCliente(venda) },
              venda.clienteId ? 'Trocar cliente' : '+ Identificar cliente')
          : null
      ])),
      el('div', { class: 'cartao mb' }, el('div', { class: 'lista' }, venda.itens.map(i =>
        el('div', { class: 'item' }, [
          el('div', { class: 'info' }, [
            el('div', { class: 'titulo', text: i.nome }),
            el('div', { class: 'sub', text: `${numero(i.qtd)} ${i.unidade} × ${dinheiro(i.preco)}`
              + (i.descontoQtd ? ` · −${percentual(i.descontoQtd)} por quantidade` : '')
              + (i.descontoItem > 0 ? ` · −${dinheiro(i.descontoItem)} no item` : '') })
          ]),
          el('span', { class: 'valor', text: dinheiro(i.total) })
        ])))),
      venda.descontoQuantidade > 0
        ? el('div', { class: 'total-linha', style: { color: 'var(--verde-700)' } },
            [el('span', { text: 'Desconto por quantidade' }), el('span', { text: `− ${dinheiro(venda.descontoQuantidade)}` })])
        : null,
      venda.descontoItens > 0
        ? el('div', { class: 'total-linha', style: { color: 'var(--verde-700)' } },
            [el('span', { text: 'Desconto nos itens' }), el('span', { text: `− ${dinheiro(venda.descontoItens)}` })])
        : null,
      venda.desconto > 0
        ? el('div', { class: 'total-linha' }, [el('span', { text: 'Desconto no pedido' }), el('span', { text: `− ${dinheiro(venda.desconto)}` })])
        : null,
      el('div', { class: 'total-linha grande' }, [el('span', { text: 'Total' }), el('span', { text: dinheiro(venda.total) })]),
      pagamentosDe(venda).filter(p => p.valor > 0).length > 1
        ? el('div', { class: 'cartao mt' }, el('div', { class: 'lista' }, pagamentosDe(venda).filter(p => p.valor > 0).map(p =>
            el('div', { class: 'item' }, [
              el('div', { class: 'info' }, [el('div', { class: 'titulo', text: nomeForma(p.forma) }),
                p.conciliado ? el('div', { class: 'sub', text: '✓ conferido no extrato' }) : null]),
              el('span', { class: 'valor', text: dinheiro(p.valor) })
            ]))))
        : null,
      venda.observacao ? el('div', { class: 'aviso aviso-amarelo mt', text: `Obs.: ${venda.observacao}` }) : null,
      (venda.alteracoes || []).length
        ? el('div', { class: 'aviso aviso-azul mt' },
            'Alterações: ' + venda.alteracoes.map(a => `${dataHora(a.data)} (${a.motivo || 'sem motivo'})`).join(' · '))
        : null,
      pix ? el('div', { class: 'cartao mt' }, el('div', { class: 'cartao-corpo' }, [
        el('div', { class: 'pq negrito', text: `Chave PIX (${pix.tipo || 'PIX'})` }),
        el('div', { style: { wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace', fontSize: '14px', margin: '6px 0 10px' }, text: pix.chave }),
        el('button', { class: 'btn btn-acao btn-bloco', type: 'button', onclick: () => copiar(pix.chave) }, '📋 Copiar chave PIX')
      ])) : null,
      foto ? el('div', { class: 'mt' }, [
        el('div', { class: 'pq negrito mb', text: 'Comprovante de pagamento' }),
        el('img', { src: foto, class: 'previa' })
      ]) : null
    ]);

    const { fechar } = painel({
      titulo: `Venda ${venda.codigo}`,
      corpo: conteudo,
      acoes: [
        impressoraDisponivel() && !venda.cancelada
          ? { rotulo: '🖨️', acao: async () => {
              try { sucesso(await imprimirCupom(venda)); } catch (e) { erro(e.message); }
            } }
          : { rotulo: '📋', acao: () => copiar(texto) },
        {
          rotulo: '📄 PDF', acao: async () => {
            try {
              const bytes = pdfComprovante(venda, loja, pix);
              sucesso(await entregarPdf(bytes, `comprovante-${nomeArquivoSeguro(venda.codigo)}.pdf`, { compartilhar: true }));
            } catch (e) { erro('Não consegui gerar o PDF: ' + e.message); }
          }
        },
        !venda.cancelada ? { rotulo: '✏️ Alterar', acao: (f) => { f(); editar(venda); } } : null,
        !venda.cancelada ? {
          rotulo: 'Cancelar venda', class: 'btn-perigo', acao: async (f) => {
            if (!await confirmar('Cancelar esta venda? O estoque volta e o caixa é estornado.', { perigo: true })) return;
            try { await cancelarVenda(venda.id); sucesso('Venda cancelada'); f(); desenhar(); }
            catch (e) { erro(e.message); }
          }
        } : null,
        { rotulo: '💬 Enviar', class: 'btn-ok', acao: () => abrirWhatsApp(zap, texto) }
      ].filter(Boolean)
    });
    return fechar;
  }

  /* ---------------- alterar venda ---------------- */

  async function editar(venda) {
    const produtos = (await listar('produtos')).filter(p => p.ativo !== false)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const porId = new Map(produtos.map(p => [p.id, p]));
    let desconto = Number(venda.desconto) || 0;

    /* Cópia de trabalho: nada é gravado até confirmar. Item que não foi mexido
       volta exatamente como estava (com o preço do dia da venda); o que mudou
       é recalculado pelo preço de tabela daquele dia, com a faixa de
       quantidade e o desconto do item. */
    const linhas = venda.itens.map(i => ({
      original: i, produtoId: i.produtoId, qtd: Number(i.qtd), mexido: false,
      regra: i.regraDesconto || (i.descontoItem > 0 ? { tipo: 'valor', valor: i.descontoItem } : null)
    }));

    function produtoDaLinha(l) {
      const atual = porId.get(l.produtoId);
      if (!l.original) return atual || null;
      // preço e custo do dia da venda; faixas de desconto do cadastro de hoje
      return {
        ...(atual || {}), id: l.produtoId, nome: l.original.nome, unidade: l.original.unidade,
        preco: l.original.precoTabela ?? l.original.preco, custo: l.original.custo
      };
    }
    function itemDaLinha(l) {
      if (!l.mexido && l.original) return l.original;
      const produto = produtoDaLinha(l);
      return produto ? montarItem(produto, l.qtd, l.regra) : l.original;
    }
    const itensAtuais = () => linhas.map(itemDaLinha);
    const totais = () => totalizarVenda(itensAtuais(), desconto);

    const listaItens = el('div', { class: 'lista' });
    const totalArea = el('div');
    const entradaDesconto = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: String(desconto) });
    const observacao = el('input', { type: 'text', value: venda.observacao || '', placeholder: 'Observação' });
    const motivo = el('input', { type: 'text', placeholder: 'Motivo da alteração (fica no histórico)' });
    const pagamentoUI = editorPagamentos({ total: () => totais().total, inicial: pagamentosDe(venda) });

    const redesenharTudo = () => { desenharItens(); desenharTotais(); if (pagamentoUI.dividido()) pagamentoUI.redesenhar(); };
    entradaDesconto.addEventListener('input', () => { desconto = Number(entradaDesconto.value) || 0; desenharTotais(); if (pagamentoUI.dividido()) pagamentoUI.redesenhar(); });

    const desenharItens = redesenho(() => {
      limpar(listaItens);
      if (!linhas.length) { anexar(listaItens, vazio('Sem itens — a venda não pode ficar vazia', '🛒')); return; }
      linhas.forEach((l, indice) => {
        const produto = produtoDaLinha(l);
        const item = itemDaLinha(l);
        const conta = produto ? calcularLinha(produto, l.qtd, l.regra) : null;
        const entrada = el('input', {
          type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: String(l.qtd), disabled: !produto,
          onchange: (e) => {
            const q = Number(e.target.value) || 0;
            if (q <= 0) linhas.splice(indice, 1); else { l.qtd = q; l.mexido = true; }
            redesenharTudo();
          }
        });
        anexar(listaItens, el('div', { class: 'item item-pedido' }, [
          el('div', { class: 'info' }, [
            el('div', { class: 'titulo', text: item.nome }),
            el('div', { class: 'sub', text: `${dinheiro(item.preco)} × ${numero(item.qtd)} = ${dinheiro(item.total)}`
              + (item.descontoQtd ? ` · −${percentual(item.descontoQtd)} qtd` : '')
              + (item.descontoItem > 0 ? ` · −${dinheiro(item.descontoItem)} no item` : '') }),
            produto ? el('button', {
              class: 'btn btn-vazio btn-sm', type: 'button', style: { marginTop: '6px', padding: '4px 10px', minHeight: '0' },
              onclick: () => painelDescontoItem({
                nome: item.nome, base: conta.bruto, regra: l.regra,
                aoAplicar: (nova) => { l.regra = nova; l.mexido = true; redesenharTudo(); }
              })
            }, item.descontoItem > 0 ? '🏷️ Mudar desconto' : '🏷️ Desconto no item')
              : el('div', { class: 'pq mudo', text: 'Produto fora do cadastro: só dá para retirar' })
          ]),
          el('div', { class: 'qtd' }, [entrada,
            el('button', { type: 'button', onclick: () => { linhas.splice(indice, 1); redesenharTudo(); } }, '✕')])
        ]));
      });
    });

    function desenharTotais() {
      const t = totais();
      anexar(limpar(totalArea),
        el('div', { class: 'total-linha' }, [el('span', { text: 'Subtotal' }), el('span', { text: dinheiro(t.subtotal) })]),
        t.desconto > 0 ? el('div', { class: 'total-linha' }, [el('span', { text: 'Desconto no pedido' }), el('span', { text: '− ' + dinheiro(t.desconto) })]) : null,
        el('div', { class: 'total-linha grande' }, [el('span', { text: 'Novo total' }), el('span', { text: dinheiro(t.total) })]),
        el('div', { class: 'pq mudo', text: `Total anterior: ${dinheiro(venda.total)}` })
      );
    }

    function adicionarProduto() {
      const entrada = el('input', { type: 'search', placeholder: 'Buscar produto…' });
      const lista = el('div', { class: 'lista rolagem' });
      function desenhar() {
        const termo = entrada.value.trim().toLowerCase();
        limpar(lista);
        const achados = produtos.filter(p => !termo || p.nome.toLowerCase().includes(termo)).slice(0, 60);
        if (!achados.length) { anexar(lista, vazio('Nenhum produto', '🔍')); return; }
        for (const p of achados) {
          anexar(lista, el('button', {
            class: 'item', onclick: () => {
              const existente = linhas.find(l => l.produtoId === p.id);
              if (existente) { existente.qtd += 1; existente.mexido = true; }
              else linhas.push({ original: null, produtoId: p.id, qtd: 1, mexido: true, regra: null });
              fecharBusca(); redesenharTudo();
            }
          }, [
            el('div', { class: 'info' }, [
              el('div', { class: 'titulo', text: p.nome }),
              el('div', { class: 'sub', text: `${numero(p.estoque)} ${p.unidade} em estoque` })
            ]),
            el('span', { class: 'valor', text: dinheiro(p.preco) })
          ]));
        }
      }
      entrada.addEventListener('input', atrasar(desenhar, 150));
      const { fechar: fecharBusca } = painel({
        titulo: 'Adicionar produto',
        corpo: el('div', {}, [entrada, el('div', { style: { height: '10px' } }), lista])
      });
      desenhar();
    }

    painel({
      titulo: `Alterar venda ${venda.codigo}`,
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-amarelo' },
          'O estoque e o lançamento financeiro são refeitos ao salvar. A alteração fica registrada no histórico da venda.'),
        listaItens,
        el('button', { class: 'btn btn-vazio btn-bloco mt', type: 'button', onclick: adicionarProduto }, '+ Adicionar produto'),
        el('div', { class: 'campo mt' }, [el('label', { text: 'Desconto no pedido (R$)' }), entradaDesconto]),
        totalArea,
        el('label', { class: 'pq negrito mt', text: 'Forma de pagamento', style: { display: 'block', marginBottom: '7px' } }),
        pagamentoUI.elemento,
        el('div', { class: 'campo mt' }, [el('label', { text: 'Observação' }), observacao]),
        el('div', { class: 'campo' }, [el('label', { text: 'Motivo da alteração' }), motivo])
      ]),
      acoes: [{
        rotulo: 'Salvar alteração', class: 'btn-primario', acao: async (fechar) => {
          if (!linhas.length) { erro('A venda precisa ter ao menos um item'); return; }
          if (!motivo.value.trim()) { erro('Informe o motivo da alteração'); return; }
          const problema = pagamentoUI.problema();
          if (problema) { erro(problema); return; }
          try {
            await alterarVenda(venda.id, {
              itens: itensAtuais(), desconto, pagamentos: pagamentoUI.valor(),
              observacao: observacao.value.trim()
            }, motivo.value.trim());
            sucesso('Venda alterada');
            fechar(); desenhar();
          } catch (e) { erro(e.message); }
        }
      }]
    });

    desenharItens(); desenharTotais();
  }

  /* ---------------- cliente da venda ---------------- */

  async function escolherCliente(venda) {
    const clientes = (await listar('clientes')).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const entrada = el('input', { type: 'search', placeholder: 'Nome ou telefone…' });
    const lista = el('div', { class: 'lista rolagem' });

    async function vincular(c, fechar) {
      try {
        await alterarVenda(venda.id, {
          clienteId: c.id, clienteNome: c.nome, clienteTelefone: c.telefone || null
        }, 'identificação do cliente');
        sucesso('Cliente vinculado à venda');
        fechar(); desenhar();
      } catch (e) { erro(e.message); }
    }

    function desenhar2() {
      const termo = entrada.value.trim().toLowerCase();
      const achados = clientes.filter(c =>
        !termo || c.nome.toLowerCase().includes(termo) || String(c.telefone || '').includes(termo));
      limpar(lista);
      if (!achados.length) { anexar(lista, vazio('Nenhum cliente', '👤')); return; }
      for (const c of achados.slice(0, 60)) {
        anexar(lista, el('button', { class: 'item', onclick: () => vincular(c, fechar) }, [
          el('div', { class: 'info' }, [
            el('div', { class: 'titulo', text: c.nome }),
            el('div', { class: 'sub', text: telefoneBR(c.telefone) || c.cidade || '—' })
          ])
        ]));
      }
    }
    entrada.addEventListener('input', atrasar(desenhar2, 150));

    const { fechar } = painel({
      titulo: 'Cliente da venda',
      corpo: el('div', {}, [entrada, el('div', { style: { height: '10px' } }), lista]),
      acoes: [{ rotulo: '+ Cadastrar novo', class: 'btn-acao', acao: (f) => { f(); novoCliente(venda); } }]
    });
    desenhar2();
  }

  function novoCliente(venda) {
    const nome = el('input', { type: 'text', placeholder: 'Nome do cliente' });
    const telefone = el('input', { type: 'tel', placeholder: '(81) 90000-0000' });
    const cidade = el('input', { type: 'text', placeholder: 'Cidade / bairro' });

    painel({
      titulo: 'Novo cliente',
      corpo: el('div', {}, [
        el('div', { class: 'campo' }, [el('label', { text: 'Nome *' }), nome]),
        el('div', { class: 'campo' }, [el('label', { text: 'WhatsApp' }), telefone]),
        el('div', { class: 'campo' }, [el('label', { text: 'Cidade / bairro' }), cidade])
      ]),
      acoes: [{
        rotulo: 'Salvar e vincular', class: 'btn-primario', acao: async (fechar) => {
          if (!nome.value.trim()) { erro('Informe o nome'); return; }
          try {
            const registro = {
              nome: nome.value.trim(), telefone: telefone.value.trim(),
              cidade: cidade.value.trim(), criadoEm: new Date().toISOString()
            };
            registro.id = await salvar('clientes', registro);
            await alterarVenda(venda.id, {
              clienteId: registro.id, clienteNome: registro.nome, clienteTelefone: registro.telefone || null
            }, 'cadastro do cliente na venda');
            sucesso('Cliente cadastrado e vinculado');
            fechar(); desenhar();
          } catch (e) { erro(e.message); }
        }
      }]
    });
  }

  desenhar();
}
