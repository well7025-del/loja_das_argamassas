/* Venda rápida: toque nos produtos, confira o pedido e finalize. */
import { listar, obter, salvar, registrarVenda, config } from '../db.js';
import { estado, recalcularPendencias } from '../app.js';
import {
  el, limpar, dinheiro, numero, erro, sucesso, painel, vazio, campoFoto,
  abrirWhatsApp, numeroWhatsApp, telefoneBR, copiar, dataHora, atrasar, $, anexar } from '../ui.js';
import { vozDisponivel, criarReconhecedor, interpretarComandoPDV, interpretarCliente } from '../voice.js';

const PAGAMENTOS = [
  { id: 'dinheiro', rotulo: '💵 Dinheiro' }, { id: 'pix', rotulo: '⚡ PIX' },
  { id: 'debito', rotulo: '💳 Débito' }, { id: 'credito', rotulo: '💳 Crédito' },
  { id: 'prazo', rotulo: '📅 A prazo' }, { id: 'boleto', rotulo: '🧾 Boleto' }
];

export async function render(raiz) {
  let produtos = (await listar('produtos')).filter(p => p.ativo !== false)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  if (!produtos.length) {
    raiz.appendChild(el('div', { class: 'aviso aviso-amarelo' },
      'Nenhum produto cadastrado ainda. Vá em Estoque e cadastre os produtos da loja.'));
    raiz.appendChild(el('a', { class: 'btn btn-acao btn-bloco', href: '#/estoque' }, 'Ir para o Estoque'));
    return;
  }

  const carrinho = new Map();     // produtoId -> { produto, qtd }
  let cliente = null;
  let pagamento = 'dinheiro';
  let desconto = 0;
  let categoria = '';
  let busca = '';
  let reconhecedor = null;
  const categorias = [...new Set(produtos.map(p => p.categoria).filter(Boolean))].sort();

  /* ---------------- elementos ---------------- */
  const grade = el('div', { class: 'produtos' });
  const chips = el('div', { class: 'chips' });
  const entradaBusca = el('input', { type: 'search', placeholder: 'Buscar produto…', autocomplete: 'off' });
  const btnVoz = el('button', { class: 'btn btn-voz', type: 'button', style: { minWidth: '78px' } }, '🎤 Voz');
  const statusVoz = el('div', { class: 'voz-status' });
  const resumoBarra = el('div', { class: 'resumo' });
  const barra = el('div', { class: 'barra-pedido' }, [
    resumoBarra,
    el('button', { class: 'btn btn-acao', type: 'button', onclick: abrirPedido }, 'Ver pedido')
  ]);

  entradaBusca.addEventListener('input', atrasar(() => { busca = entradaBusca.value; desenharProdutos(); }, 200));

  /* ---------------- produtos ---------------- */
  function desenharChips() {
    limpar(chips);
    for (const c of ['', ...categorias]) {
      chips.appendChild(el('button', {
        class: `chip ${categoria === c ? 'ativo' : ''}`, type: 'button',
        onclick: () => { categoria = c; desenharChips(); desenharProdutos(); }
      }, c || 'Todos'));
    }
  }

  function desenharProdutos() {
    limpar(grade);
    const termo = busca.trim().toLowerCase();
    const lista = produtos.filter(p =>
      (!categoria || p.categoria === categoria) && (!termo || p.nome.toLowerCase().includes(termo)));
    if (!lista.length) { grade.appendChild(vazio('Nenhum produto encontrado', '🔍')); return; }

    for (const p of lista) {
      const noCarrinho = carrinho.get(p.id)?.qtd || 0;
      const disponivel = p.estoque - noCarrinho;
      grade.appendChild(el('div', { class: 'produto-envolto' }, [
        el('button', {
          class: `produto ${disponivel <= 0 ? 'sem' : ''}`, type: 'button',
          onclick: () => adicionar(p, 1)
        }, [
          el('div', { class: 'nome', text: p.nome }),
          el('div', { class: 'est', text: disponivel > 0 ? `${numero(disponivel)} ${p.unidade}` : 'Sem estoque' }),
          el('div', { class: 'preco', text: dinheiro(p.preco) })
        ]),
        noCarrinho ? el('span', { class: 'marca-carrinho', text: numero(noCarrinho) }) : null
      ]));
    }
  }

  /* ---------------- carrinho ---------------- */
  function adicionar(produto, qtd) {
    const item = carrinho.get(produto.id) || { produto, qtd: 0 };
    const novo = item.qtd + qtd;
    if (novo > produto.estoque) {
      erro(`Só há ${numero(produto.estoque)} ${produto.unidade} de ${produto.nome}`);
      return false;
    }
    if (novo <= 0) carrinho.delete(produto.id);
    else { item.qtd = novo; carrinho.set(produto.id, item); }
    atualizar();
    return true;
  }

  function definirQtd(produtoId, qtd) {
    const item = carrinho.get(produtoId);
    if (!item) return;
    if (qtd <= 0) carrinho.delete(produtoId);
    else if (qtd > item.produto.estoque) { erro(`Máximo: ${numero(item.produto.estoque)} ${item.produto.unidade}`); return; }
    else item.qtd = qtd;
    atualizar();
  }

  const totais = () => {
    const subtotal = [...carrinho.values()].reduce((a, i) => a + i.produto.preco * i.qtd, 0);
    const desc = Math.min(subtotal, Math.max(0, desconto));
    return { subtotal, desconto: desc, total: subtotal - desc, itens: [...carrinho.values()].reduce((a, i) => a + i.qtd, 0) };
  };

  let redesenharPedido = null;
  function atualizar() {
    const t = totais();
    barra.classList.toggle('visivel', carrinho.size > 0);
    limpar(resumoBarra).append(
      el('div', { class: 'valor', text: dinheiro(t.total) }),
      el('small', { text: `${numero(t.itens)} item(ns)${cliente ? ' · ' + cliente.nome.split(' ')[0] : ''}` })
    );
    desenharProdutos();
    redesenharPedido?.();
  }

  /* ---------------- painel do pedido ---------------- */
  function abrirPedido() {
    const itens = el('div', { class: 'lista' });
    const areaCliente = el('div');
    const gradePag = el('div', { class: 'pagamentos' });
    const entradaDesconto = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: String(desconto) });
    const observacao = el('input', { type: 'text', placeholder: 'Observação (opcional)' });
    const foto = campoFoto({ rotulo: 'Comprovante de pagamento (opcional)' });
    const totalArea = el('div');

    entradaDesconto.addEventListener('input', () => { desconto = Number(entradaDesconto.value) || 0; desenhar(); });

    function desenharCliente() {
      limpar(areaCliente);
      if (cliente) {
        areaCliente.append(el('div', { class: 'flex', style: { justifyContent: 'space-between' } }, [
          el('div', {}, [
            el('div', { class: 'negrito', text: cliente.nome }),
            el('div', { class: 'pq mudo', text: telefoneBR(cliente.telefone) || 'sem telefone' })
          ]),
          el('button', { class: 'btn btn-vazio btn-sm', onclick: () => { cliente = null; desenharCliente(); atualizar(); } }, 'Trocar')
        ]));
      } else {
        areaCliente.append(el('div', { class: 'flex' }, [
          el('button', { class: 'btn btn-vazio', style: { flex: '1' }, onclick: escolherCliente }, '🔎 Cliente'),
          el('button', { class: 'btn btn-acao', onclick: () => novoCliente() }, '+ Novo')
        ]));
      }
    }

    function desenharPagamento() {
      limpar(gradePag);
      for (const p of PAGAMENTOS) {
        gradePag.appendChild(el('button', {
          class: `pag ${pagamento === p.id ? 'ativo' : ''}`, type: 'button',
          onclick: () => { pagamento = p.id; desenharPagamento(); }
        }, p.rotulo));
      }
    }

    function desenhar() {
      limpar(itens);
      if (!carrinho.size) {
        itens.appendChild(vazio('Pedido vazio', '🛒'));
      } else {
        for (const item of carrinho.values()) {
          const entrada = el('input', {
            type: 'number', inputmode: 'decimal', min: '0', value: String(item.qtd),
            onchange: (e) => definirQtd(item.produto.id, Number(e.target.value))
          });
          itens.appendChild(el('div', { class: 'item' }, [
            el('div', { class: 'info' }, [
              el('div', { class: 'titulo', text: item.produto.nome }),
              el('div', { class: 'sub', text: `${dinheiro(item.produto.preco)} × ${item.qtd} = ${dinheiro(item.produto.preco * item.qtd)}` })
            ]),
            el('div', { class: 'qtd' }, [
              el('button', { type: 'button', onclick: () => adicionar(item.produto, -1) }, '−'),
              entrada,
              el('button', { type: 'button', onclick: () => adicionar(item.produto, 1) }, '+')
            ])
          ]));
        }
      }
      const t = totais();
      limpar(totalArea).append(
        el('div', { class: 'total-linha' }, [el('span', { text: 'Subtotal' }), el('span', { text: dinheiro(t.subtotal) })]),
        el('div', { class: 'total-linha grande' }, [el('span', { text: 'Total' }), el('span', { text: dinheiro(t.total) })])
      );
    }

    const p = painel({
      titulo: 'Pedido',
      corpo: el('div', {}, [
        itens,
        el('div', { class: 'cartao mt' }, el('div', { class: 'cartao-corpo' }, [
          el('label', { class: 'pq negrito', text: 'Cliente', style: { display: 'block', marginBottom: '7px' } }),
          areaCliente
        ])),
        el('div', { class: 'campo mt' }, [el('label', { text: 'Desconto (R$)' }), entradaDesconto]),
        totalArea,
        el('label', { class: 'pq negrito mt', text: 'Forma de pagamento', style: { display: 'block', marginBottom: '7px' } }),
        gradePag,
        el('div', { class: 'campo mt' }, [observacao]),
        foto.elemento
      ]),
      acoes: [
        { rotulo: 'Continuar vendendo', acao: (f) => f() },
        { rotulo: 'Finalizar', class: 'btn-ok', acao: (f) => finalizar(f, observacao.value, foto.valor()) }
      ],
      aoFechar: () => { redesenharPedido = null; }
    });

    redesenharPedido = () => { desenhar(); desenharCliente(); };
    desenhar(); desenharCliente(); desenharPagamento();
    return p;
  }

  /* ---------------- cliente ---------------- */
  async function escolherCliente() {
    const clientes = (await listar('clientes')).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const lista = el('div', { class: 'lista rolagem' });
    const entrada = el('input', { type: 'search', placeholder: 'Nome ou telefone…' });

    function desenhar() {
      const termo = entrada.value.trim().toLowerCase();
      const filtrados = clientes.filter(c =>
        !termo || c.nome.toLowerCase().includes(termo) || String(c.telefone || '').includes(termo));
      limpar(lista);
      if (!filtrados.length) { lista.appendChild(vazio('Nenhum cliente', '👤')); return; }
      for (const c of filtrados.slice(0, 60)) {
        lista.appendChild(el('button', {
          class: 'item', onclick: () => { cliente = c; fechar(); atualizar(); }
        }, [
          el('div', { class: 'info' }, [
            el('div', { class: 'titulo', text: c.nome }),
            el('div', { class: 'sub', text: telefoneBR(c.telefone) || c.cidade || '—' })
          ])
        ]));
      }
    }
    entrada.addEventListener('input', atrasar(desenhar, 150));

    const { fechar } = painel({
      titulo: 'Escolher cliente',
      corpo: el('div', {}, [entrada, el('div', { style: { height: '10px' } }), lista]),
      acoes: [{ rotulo: '+ Cadastrar novo', class: 'btn-acao', acao: (f) => { f(); novoCliente(); } }]
    });
    desenhar();
  }

  function novoCliente() {
    const nome = el('input', { type: 'text', placeholder: 'Nome do cliente' });
    const telefone = el('input', { type: 'tel', placeholder: '(81) 90000-0000' });
    const cidade = el('input', { type: 'text', placeholder: 'Cidade / bairro' });
    const statusFala = el('div', { class: 'voz-status' });
    const btnFala = el('button', { class: 'btn btn-voz btn-bloco', type: 'button' }, '🎤 Ditar os dados');
    let rec = null;

    btnFala.onclick = () => {
      if (!vozDisponivel()) { erro('Este navegador não reconhece voz. Use o Chrome.'); return; }
      if (rec?.ativo) { rec.parar(); return; }
      rec = criarReconhecedor({
        continuo: false,
        onEstado: (s) => {
          btnFala.classList.toggle('ouvindo', s === 'ouvindo');
          btnFala.textContent = s === 'ouvindo' ? '⏹ Parar' : '🎤 Ditar os dados';
          if (s === 'ouvindo') statusFala.textContent = 'Ex.: "nome Maria Souza telefone 81 98888 7777"';
        },
        onErro: (m) => { statusFala.textContent = m; },
        onTexto: (texto, parcial) => {
          statusFala.textContent = `“${texto}”`;
          if (parcial) return;
          const d = interpretarCliente(texto);
          if (d.name) nome.value = d.name;
          if (d.phone) telefone.value = d.phone;
          statusFala.textContent = 'Preenchido. Confira antes de salvar.';
        }
      });
      rec.iniciar();
    };

    painel({
      titulo: 'Novo cliente',
      corpo: el('div', {}, [
        btnFala, statusFala,
        el('div', { class: 'campo mt' }, [el('label', { text: 'Nome *' }), nome]),
        el('div', { class: 'campo' }, [el('label', { text: 'WhatsApp' }), telefone]),
        el('div', { class: 'campo' }, [el('label', { text: 'Cidade / bairro' }), cidade])
      ]),
      acoes: [{
        rotulo: 'Salvar', class: 'btn-primario', acao: async (fechar) => {
          if (!nome.value.trim()) { erro('Informe o nome'); return; }
          rec?.parar();
          const registro = {
            nome: nome.value.trim(), telefone: telefone.value.trim(),
            cidade: cidade.value.trim(), criadoEm: new Date().toISOString()
          };
          registro.id = await salvar('clientes', registro);
          cliente = registro;
          sucesso('Cliente cadastrado');
          fechar(); atualizar();
        }
      }],
      aoFechar: () => rec?.parar()
    });
  }

  /* ---------------- voz no PDV ---------------- */
  btnVoz.onclick = () => {
    if (!vozDisponivel()) { erro('Este navegador não reconhece voz. Use o Google Chrome.'); return; }
    if (reconhecedor?.ativo) { reconhecedor.parar(); return; }
    reconhecedor = criarReconhecedor({
      onEstado: (s) => {
        btnVoz.classList.toggle('ouvindo', s === 'ouvindo');
        btnVoz.textContent = s === 'ouvindo' ? '⏹ Parar' : '🎤 Voz';
        if (s === 'ouvindo') statusVoz.textContent = 'Diga por exemplo "10 argamassa AC 3" ou "finalizar".';
        else if (statusVoz.textContent.startsWith('Diga')) statusVoz.textContent = '';
      },
      onErro: (m) => { statusVoz.textContent = m; },
      onTexto: (texto, parcial) => {
        if (parcial) { statusVoz.textContent = `“${texto}”…`; return; }
        // o interpretador espera produtos com os campos do sistema principal
        const paraVoz = produtos.map(p => ({ ...p, name: p.nome, sku: '' }));
        const cmd = interpretarComandoPDV(texto, paraVoz);
        if (cmd.acao === 'adicionar') {
          if (adicionar(produtos.find(p => p.id === cmd.produto.id), cmd.qtd)) {
            statusVoz.textContent = `✅ ${cmd.qtd} × ${cmd.produto.nome}`;
          }
        } else if (cmd.acao === 'remover') {
          definirQtd(cmd.produto.id, 0);
          statusVoz.textContent = `🗑️ ${cmd.produto.nome} removido`;
        } else if (cmd.acao === 'desconto') {
          desconto = cmd.valor; atualizar();
          statusVoz.textContent = `Desconto de ${dinheiro(cmd.valor)}`;
        } else if (cmd.acao === 'limpar') {
          carrinho.clear(); atualizar();
          statusVoz.textContent = 'Pedido limpo';
        } else if (cmd.acao === 'finalizar') {
          reconhecedor.parar();
          if (carrinho.size) abrirPedido();
        } else {
          statusVoz.textContent = `Não entendi “${texto}”.`;
        }
      }
    });
    reconhecedor.iniciar();
  };

  /* ---------------- finalização ---------------- */
  async function proximoCodigo() {
    const n = (await config('contadorVendas', 0)) + 1;
    const { definirConfig } = await import('../db.js');
    await definirConfig('contadorVendas', n);
    return `CAR-${String(n).padStart(5, '0')}`;
  }

  async function finalizar(fecharPainel, observacao, comprovante) {
    if (!carrinho.size) { erro('Adicione produtos ao pedido'); return; }
    const t = totais();
    try {
      const venda = {
        codigo: await proximoCodigo(),
        data: new Date().toISOString(),
        clienteId: cliente?.id || null,
        clienteNome: cliente?.nome || null,
        clienteTelefone: cliente?.telefone || null,
        itens: [...carrinho.values()].map(i => ({
          produtoId: i.produto.id, nome: i.produto.nome, unidade: i.produto.unidade,
          qtd: i.qtd, preco: i.produto.preco, custo: i.produto.custo || 0,
          total: Number((i.produto.preco * i.qtd).toFixed(2))
        })),
        subtotal: Number(t.subtotal.toFixed(2)),
        desconto: Number(t.desconto.toFixed(2)),
        total: Number(t.total.toFixed(2)),
        pagamento, observacao: observacao || '',
        cancelada: false
      };
      venda.custo = Number(venda.itens.reduce((a, i) => a + i.custo * i.qtd, 0).toFixed(2));
      venda.lucro = Number((venda.total - venda.custo).toFixed(2));
      venda.temComprovante = Boolean(comprovante);

      await registrarVenda(venda, comprovante);

      carrinho.clear();
      cliente = null; desconto = 0; pagamento = 'dinheiro';
      produtos = (await listar('produtos')).filter(p => p.ativo !== false)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      atualizar();
      fecharPainel();
      recalcularPendencias();
      mostrarRecibo(venda, comprovante);
    } catch (e) {
      erro(e.message);
    }
  }

  function textoRecibo(venda) {
    const loja = estado.loja || {};
    return [
      `*${loja.nome || 'Loja das Argamassas — Caruaru'}*`,
      loja.telefone || null, '',
      `*Comprovante de venda ${venda.codigo}*`,
      `Data: ${dataHora(venda.data)}`,
      venda.clienteNome ? `Cliente: ${venda.clienteNome}` : null, '',
      ...venda.itens.map(i => `• ${numero(i.qtd)}x ${i.nome} — ${dinheiro(i.total)}`), '',
      venda.desconto > 0 ? `Subtotal: ${dinheiro(venda.subtotal)}` : null,
      venda.desconto > 0 ? `Desconto: -${dinheiro(venda.desconto)}` : null,
      `*Total: ${dinheiro(venda.total)}*`,
      `Pagamento: ${venda.pagamento.toUpperCase()}`,
      venda.observacao ? `Obs.: ${venda.observacao}` : null, '',
      'Obrigado pela preferência!'
    ].filter(l => l !== null).join('\n');
  }

  function mostrarRecibo(venda, comprovante) {
    const texto = textoRecibo(venda);
    const numeroZap = numeroWhatsApp(venda.clienteTelefone);
    painel({
      titulo: `Venda ${venda.codigo}`,
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-verde' },
          `✅ ${dinheiro(venda.total)} — ${venda.pagamento.toUpperCase()}${comprovante ? ' · comprovante anexado' : ''}`),
        el('pre', {
          style: { whiteSpace: 'pre-wrap', font: 'inherit', fontSize: '13.5px', background: 'var(--cinza-100)', padding: '13px', borderRadius: '11px', margin: '0' },
          text: texto
        }),
        !numeroZap ? el('div', { class: 'aviso aviso-amarelo mt' },
          'Sem WhatsApp cadastrado — ao enviar, você escolhe o contato no próprio aplicativo.') : null
      ]),
      acoes: [
        { rotulo: '📋 Copiar', acao: () => copiar(texto) },
        { rotulo: '💬 WhatsApp', class: 'btn-ok', acao: () => abrirWhatsApp(numeroZap, texto) }
      ]
    });
  }

  /* ---------------- montagem ---------------- */
anexar(raiz, 
    el('div', { class: 'busca-linha' }, [entradaBusca, btnVoz]),
    statusVoz,
    categorias.length > 1 ? chips : null,
    grade
  );
  document.body.appendChild(barra);

  desenharChips(); atualizar();

  return { destruir: () => { reconhecedor?.parar(); barra.remove(); } };
}
