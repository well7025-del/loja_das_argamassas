/* Histórico de vendas: consulta, alteração, comprovante em PDF e reenvio do recibo. */
import {
  listar, porIndice, cancelarVenda, alterarVenda, salvar, config, precoComDesconto } from '../db.js';
import { estado } from '../app.js';
import {
  el, limpar, dinheiro, numero, percentual, dataHora, erro, sucesso, painel, vazio,
  abrirWhatsApp, numeroWhatsApp, copiar, confirmar, atrasar, diasAtras, hoje, kpi,
  telefoneBR, redesenho, anexar } from '../ui.js';
import { impressoraDisponivel, imprimirCupom } from '../impressora.js';
import { pdfComprovante, entregarPdf, nomeArquivoSeguro } from '../documentos.js';

const PAGAMENTO = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito' };
const FORMAS = ['dinheiro', 'pix', 'debito', 'credito'];

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
                el('div', { class: 'sub', text: `${dataHora(v.data)} · ${v.clienteNome || 'sem cliente'} · ${PAGAMENTO[v.pagamento] || v.pagamento}` })
              ]),
              el('span', { class: 'valor', style: v.cancelada ? { textDecoration: 'line-through', color: 'var(--cinza-500)' } : {}, text: dinheiro(v.total) })
            ]))))
        : vazio('Nenhuma venda no período', '🧾')
    );
  }

  /* ---------------- recibo ---------------- */

  function textoRecibo(venda, loja, pix) {
    const linhas = [
      `*${loja.nome || 'Loja das Argamassas — Caruaru'}*`,
      loja.endereco || null,
      loja.whatsapp || loja.telefone || null, '',
      `*Comprovante de venda ${venda.codigo}*`, `Data: ${dataHora(venda.data)}`,
      venda.clienteNome ? `Cliente: ${venda.clienteNome}` : null, '',
      ...venda.itens.map(i => `• ${numero(i.qtd)}x ${i.nome} — ${dinheiro(i.total)}`
        + (i.descontoQtd ? ` (−${percentual(i.descontoQtd)})` : '')), '',
      venda.descontoQuantidade > 0 ? `Desconto por quantidade: -${dinheiro(venda.descontoQuantidade)}` : null,
      venda.desconto > 0 ? `Desconto no pedido: -${dinheiro(venda.desconto)}` : null,
      `*Total: ${dinheiro(venda.total)}*`,
      `Pagamento: ${PAGAMENTO[venda.pagamento] || venda.pagamento}`
    ];
    if (pix?.chave) {
      linhas.push('', '*Pagamento via PIX*', `Chave (${pix.tipo || 'PIX'}):`, pix.chave);
      if (pix.titular) linhas.push(`Titular: ${pix.titular}`);
      if (pix.banco) linhas.push(`Banco: ${pix.banco}`);
    }
    linhas.push('', 'Obrigado pela preferência!');
    return linhas.filter(l => l !== null).join('\n');
  }

  /* ---------------- detalhe da venda ---------------- */

  async function abrir(venda) {
    const comprovantes = await porIndice('comprovantes', 'vendaId', IDBKeyRange.only(venda.id));
    const foto = comprovantes[0]?.imagem;
    const loja = await config('loja', estado.loja || {});
    const pixConfig = await config('pix', null);
    const pix = (pixConfig?.chave && (venda.pagamento === 'pix' || pixConfig.sempre)) ? pixConfig : null;
    const texto = textoRecibo(venda, loja, pix);
    const zap = numeroWhatsApp(venda.clienteTelefone);

    const conteudo = el('div', {}, [
      venda.cancelada ? el('div', { class: 'aviso aviso-vermelho', text: 'Esta venda foi cancelada.' }) : null,
      el('div', { class: 'pq mudo mb', text: `${dataHora(venda.data)} · ${PAGAMENTO[venda.pagamento] || venda.pagamento}` }),
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
              + (i.descontoQtd ? ` · −${percentual(i.descontoQtd)} por quantidade` : '') })
          ]),
          el('span', { class: 'valor', text: dinheiro(i.total) })
        ])))),
      venda.descontoQuantidade > 0
        ? el('div', { class: 'total-linha', style: { color: 'var(--verde)' } },
            [el('span', { text: 'Desconto por quantidade' }), el('span', { text: `− ${dinheiro(venda.descontoQuantidade)}` })])
        : null,
      venda.desconto > 0
        ? el('div', { class: 'total-linha' }, [el('span', { text: 'Desconto' }), el('span', { text: `− ${dinheiro(venda.desconto)}` })])
        : null,
      el('div', { class: 'total-linha grande' }, [el('span', { text: 'Total' }), el('span', { text: dinheiro(venda.total) })]),
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
    // cópia de trabalho: nada é gravado até o usuário confirmar
    const itens = venda.itens.map(i => ({ ...i }));
    let pagamento = venda.pagamento;
    let desconto = Number(venda.desconto) || 0;

    const listaItens = el('div', { class: 'lista' });
    const gradePag = el('div', { class: 'pagamentos' });
    const totalArea = el('div');
    const entradaDesconto = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: String(desconto) });
    const observacao = el('input', { type: 'text', value: venda.observacao || '', placeholder: 'Observação' });
    const motivo = el('input', { type: 'text', placeholder: 'Motivo da alteração (fica no histórico)' });

    entradaDesconto.addEventListener('input', () => { desconto = Number(entradaDesconto.value) || 0; desenharTotais(); });

    /* Ao mudar a quantidade o desconto por faixa é recalculado, senão a
       alteração passaria por cima da regra cadastrada no produto. */
    function recalcular(item) {
      const produto = produtos.find(p => p.id === item.produtoId);
      if (produto) {
        const { pct, preco } = precoComDesconto(produto, item.qtd);
        item.preco = Number(preco.toFixed(2));
        item.precoTabela = produto.preco;
        item.descontoQtd = pct;
      }
      item.total = Number((item.preco * item.qtd).toFixed(2));
    }

    const desenharItens = redesenho(() => {
      limpar(listaItens);
      if (!itens.length) { anexar(listaItens, vazio('Sem itens — a venda não pode ficar vazia', '🛒')); return; }
      itens.forEach((item, i) => {
        const entrada = el('input', {
          type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: String(item.qtd),
          onchange: (e) => {
            const q = Number(e.target.value) || 0;
            if (q <= 0) { itens.splice(i, 1); } else { item.qtd = q; recalcular(item); }
            desenharItens(); desenharTotais();
          }
        });
        anexar(listaItens, el('div', { class: 'item' }, [
          el('div', { class: 'info' }, [
            el('div', { class: 'titulo', text: item.nome }),
            el('div', { class: 'sub', text: `${dinheiro(item.preco)} × ${numero(item.qtd)} = ${dinheiro(item.total)}`
              + (item.descontoQtd ? ` · −${percentual(item.descontoQtd)}` : '') })
          ]),
          el('div', { class: 'qtd' }, [entrada,
            el('button', { type: 'button', onclick: () => { itens.splice(i, 1); desenharItens(); desenharTotais(); } }, '✕')])
        ]));
      });
    });

    function desenharPagamento() {
      limpar(gradePag);
      for (const f of FORMAS) {
        anexar(gradePag, el('button', {
          class: `pag ${pagamento === f ? 'ativo' : ''}`, type: 'button',
          onclick: () => { pagamento = f; desenharPagamento(); }
        }, PAGAMENTO[f]));
      }
    }

    function desenharTotais() {
      const subtotal = itens.reduce((a, i) => a + i.total, 0);
      const desc = Math.min(subtotal, Math.max(0, desconto));
      anexar(limpar(totalArea),
        el('div', { class: 'total-linha' }, [el('span', { text: 'Subtotal' }), el('span', { text: dinheiro(subtotal) })]),
        el('div', { class: 'total-linha grande' }, [el('span', { text: 'Novo total' }), el('span', { text: dinheiro(subtotal - desc) })]),
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
              const existente = itens.find(i => i.produtoId === p.id);
              if (existente) { existente.qtd += 1; recalcular(existente); }
              else {
                const novo = {
                  produtoId: p.id, nome: p.nome, unidade: p.unidade, qtd: 1,
                  preco: p.preco, precoTabela: p.preco, descontoQtd: 0,
                  custo: p.custo || 0, total: p.preco
                };
                recalcular(novo); itens.push(novo);
              }
              fecharBusca(); desenharItens(); desenharTotais();
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
        el('div', { class: 'campo mt' }, [el('label', { text: 'Desconto (R$)' }), entradaDesconto]),
        totalArea,
        el('label', { class: 'pq negrito mt', text: 'Forma de pagamento', style: { display: 'block', marginBottom: '7px' } }),
        gradePag,
        el('div', { class: 'campo mt' }, [el('label', { text: 'Observação' }), observacao]),
        el('div', { class: 'campo' }, [el('label', { text: 'Motivo da alteração' }), motivo])
      ]),
      acoes: [{
        rotulo: 'Salvar alteração', class: 'btn-primario', acao: async (fechar) => {
          if (!itens.length) { erro('A venda precisa ter ao menos um item'); return; }
          if (!motivo.value.trim()) { erro('Informe o motivo da alteração'); return; }
          try {
            await alterarVenda(venda.id, {
              itens, desconto, pagamento, observacao: observacao.value.trim(),
              descontoQuantidade: Number(itens.reduce((a, i) => a + ((i.precoTabela || i.preco) - i.preco) * i.qtd, 0).toFixed(2))
            }, motivo.value.trim());
            sucesso('Venda alterada');
            fechar(); desenhar();
          } catch (e) { erro(e.message); }
        }
      }]
    });

    desenharItens(); desenharPagamento(); desenharTotais();
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
