/* ============================================================
   PDV — lancamento de vendas em poucos cliques
   Inclui: selecao/cadastro de cliente, comando de voz, comprovante
   de pagamento e compartilhamento do recibo no WhatsApp.
   ============================================================ */
import { api } from '../api.js';
import { estado, ehMaster, lojaAtual, lojasOperacionais, atualizarNotificacoes } from '../app.js';
import {
  el, $, limpar, dinheiro, numero, erro, sucesso, modal, campoUpload,
  abrirWhatsApp, copiar, telefoneBR, vazio
} from '../ui.js';
import { vozDisponivel, criarReconhecedor, interpretarComandoPDV, interpretarCliente } from '../voice.js';

const PAGAMENTOS = [
  { id: 'dinheiro', rotulo: '💵 Dinheiro' }, { id: 'pix', rotulo: '⚡ PIX' },
  { id: 'debito', rotulo: '💳 Débito' }, { id: 'credito', rotulo: '💳 Crédito' },
  { id: 'boleto', rotulo: '🧾 Boleto' }, { id: 'prazo', rotulo: '📅 A prazo' }
];

export async function render(raiz) {
  const loja = lojaAtual();
  if (!loja) {
    raiz.appendChild(el('div', { class: 'aviso aviso-amarelo' },
      'Nenhuma loja disponível para venda. Cadastre uma loja em Configurações.'));
    return;
  }

  const carrinho = new Map();      // product_id -> { produto, qtd }
  let clienteSelecionado = null;
  let pagamento = 'dinheiro';
  let lojaVenda = loja.id;
  let reconhecedor = null;

  /* ---------- dados ---------- */
  const [{ produtos }, { categorias }] = await Promise.all([
    api.get('/api/produtos', { store_id: lojaVenda }),
    api.get('/api/categorias')
  ]);
  estado.produtos = produtos;
  let categoriaAtiva = '';
  let busca = '';

  /* ---------- elementos ---------- */
  const grade = el('div', { class: 'produtos-grade' });
  const entradaBusca = el('input', {
    type: 'search', placeholder: 'Buscar produto por nome ou código…', autocomplete: 'off',
    oninput: (e) => { busca = e.target.value; desenharProdutos(); }
  });
  const btnVoz = el('button', { class: 'btn btn-voz', type: 'button', title: 'Lançar por voz' }, '🎤 Voz');
  const statusVoz = el('div', { class: 'voz-status' });
  const chips = el('div', { class: 'pdv-categorias' });

  const listaCarrinho = el('div', { class: 'carrinho-itens' });
  const resumo = el('div', { class: 'card-corpo' });
  const areaCliente = el('div', { class: 'card-corpo' });
  const gradePagamento = el('div', { class: 'pag-grade' });
  const entradaDesconto = el('input', { type: 'number', min: '0', step: '0.01', value: '0', oninput: desenharResumo });
  const upload = campoUpload({ rotulo: 'Comprovante de pagamento (opcional)' });
  const observacao = el('input', { type: 'text', placeholder: 'Observação da venda (opcional)' });
  const btnFinalizar = el('button', { class: 'btn btn-ok btn-lg btn-bloco', onclick: finalizar }, 'Finalizar venda');

  // barra fixa no celular com o total do pedido
  const barraResumo = el('div', { class: 'resumo' });
  const barra = el('div', { class: 'pdv-barra' }, [
    barraResumo,
    el('button', { class: 'btn btn-acao', type: 'button',
      onclick: () => cartaoPedido.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 'Ver pedido'),
    el('button', { class: 'btn btn-ok', type: 'button', onclick: finalizar }, 'Finalizar')
  ]);

  /* ---------- produtos ---------- */
  function desenharChips() {
    limpar(chips);
    const todas = [{ id: '', name: 'Todos' }, ...categorias];
    for (const c of todas) {
      chips.appendChild(el('button', {
        class: `chip ${String(categoriaAtiva) === String(c.id) ? 'ativo' : ''}`, type: 'button',
        onclick: () => { categoriaAtiva = c.id; desenharChips(); desenharProdutos(); }
      }, c.name));
    }
  }

  function produtosFiltrados() {
    const b = busca.trim().toLowerCase();
    return produtos.filter(p =>
      (!categoriaAtiva || String(p.category_id) === String(categoriaAtiva)) &&
      (!b || p.name.toLowerCase().includes(b) || (p.sku || '').toLowerCase().includes(b))
    );
  }

  function desenharProdutos() {
    limpar(grade);
    const lista = produtosFiltrados();
    if (!lista.length) { grade.appendChild(vazio('Nenhum produto encontrado', '🔍')); return; }
    for (const p of lista) {
      const noCarrinho = carrinho.get(p.id)?.qtd || 0;
      const disponivel = p.estoque - noCarrinho;
      grade.appendChild(el('button', {
        class: `produto-btn ${disponivel <= 0 ? 'sem-estoque' : ''}`, type: 'button',
        onclick: () => adicionar(p, 1)
      }, [
        el('div', { class: 'nome', text: p.name }),
        el('div', { class: 'est', text: disponivel > 0 ? `${numero(disponivel, 0)} ${p.unit} em estoque` : 'Sem estoque' }),
        el('div', { class: 'preco', text: dinheiro(p.sale_price) })
      ]));
    }
  }

  /* ---------- carrinho ---------- */
  function adicionar(produto, qtd = 1) {
    const item = carrinho.get(produto.id) || { produto, qtd: 0 };
    const novo = item.qtd + qtd;
    if (novo > produto.estoque) { erro(`Estoque insuficiente: só há ${numero(produto.estoque, 0)} ${produto.unit} de ${produto.name}`); return false; }
    if (novo <= 0) carrinho.delete(produto.id);
    else { item.qtd = novo; carrinho.set(produto.id, item); }
    desenharCarrinho(); desenharProdutos();
    return true;
  }

  function definirQtd(produtoId, qtd) {
    const item = carrinho.get(produtoId);
    if (!item) return;
    if (qtd <= 0) carrinho.delete(produtoId);
    else if (qtd > item.produto.estoque) { erro(`Máximo disponível: ${numero(item.produto.estoque, 0)} ${item.produto.unit}`); return; }
    else item.qtd = qtd;
    desenharCarrinho(); desenharProdutos();
  }

  function totais() {
    const subtotal = [...carrinho.values()].reduce((a, i) => a + i.produto.sale_price * i.qtd, 0);
    const desconto = Math.min(subtotal, Math.max(0, Number(entradaDesconto.value) || 0));
    return { subtotal, desconto, total: subtotal - desconto, itens: [...carrinho.values()].reduce((a, i) => a + i.qtd, 0) };
  }

  function desenharCarrinho() {
    limpar(listaCarrinho);
    if (!carrinho.size) {
      listaCarrinho.appendChild(el('div', { class: 'vazio', style: { padding: '26px 14px' } },
        [el('span', { class: 'icone', text: '🛒' }), el('div', { text: 'Clique nos produtos para montar o pedido' })]));
    } else {
      for (const item of carrinho.values()) {
        const entradaQtd = el('input', {
          type: 'number', min: '0', step: '1', value: item.qtd,
          onchange: (e) => definirQtd(item.produto.id, Number(e.target.value))
        });
        listaCarrinho.appendChild(el('div', { class: 'item-carrinho' }, [
          el('div', { class: 'info' }, [
            el('div', { class: 'nome', text: item.produto.name }),
            el('div', { class: 'sub', text: `${dinheiro(item.produto.sale_price)} × ${item.qtd} ${item.produto.unit} = ${dinheiro(item.produto.sale_price * item.qtd)}` })
          ]),
          el('div', { class: 'qtd-ctrl' }, [
            el('button', { type: 'button', onclick: () => adicionar(item.produto, -1), 'aria-label': 'Diminuir' }, '−'),
            entradaQtd,
            el('button', { type: 'button', onclick: () => adicionar(item.produto, 1), 'aria-label': 'Aumentar' }, '+')
          ]),
          el('button', { class: 'btn btn-icone btn-sm', type: 'button', title: 'Remover', onclick: () => definirQtd(item.produto.id, 0) }, '✕')
        ]));
      }
    }
    desenharResumo();
  }

  function desenharResumo() {
    const t = totais();
    limpar(resumo).append(
      el('div', { class: 'total-linha' }, [el('span', { text: `${numero(t.itens, 0)} item(ns)` }), el('span', { text: dinheiro(t.subtotal) })]),
      el('div', { class: 'campo', style: { marginTop: '10px' } }, [
        el('label', { text: 'Desconto (R$)' }), entradaDesconto
      ]),
      el('div', { class: 'total-linha grande' }, [el('span', { text: 'Total' }), el('span', { text: dinheiro(t.total) })])
    );
    btnFinalizar.disabled = !carrinho.size;

    barra.classList.toggle('visivel', carrinho.size > 0);
    limpar(barraResumo).append(
      el('div', { class: 'valor', text: dinheiro(t.total) }),
      el('small', { text: `${numero(t.itens, 0)} item(ns)${clienteSelecionado ? ' · ' + clienteSelecionado.name.split(' ')[0] : ''}` })
    );
  }

  /* ---------- cliente ---------- */
  function desenharCliente() {
    limpar(areaCliente);
    if (clienteSelecionado) {
      areaCliente.append(
        el('div', { class: 'flex quebra', style: { justifyContent: 'space-between' } }, [
          el('div', {}, [
            el('div', { class: 'negrito', text: clienteSelecionado.name }),
            el('div', { class: 'pequeno texto-mudo', text: [telefoneBR(clienteSelecionado.phone), clienteSelecionado.city].filter(Boolean).join(' · ') || 'Sem contato cadastrado' })
          ]),
          el('button', { class: 'btn btn-vazio btn-sm', type: 'button', onclick: () => { clienteSelecionado = null; desenharCliente(); } }, 'Trocar')
        ])
      );
    } else {
      areaCliente.append(
        el('div', { class: 'flex', style: { gap: '8px' } }, [
          el('button', { class: 'btn btn-vazio btn-bloco', type: 'button', onclick: abrirBuscaCliente }, '🔎 Selecionar cliente'),
          el('button', { class: 'btn btn-acao', type: 'button', onclick: () => abrirNovoCliente() }, '+ Novo')
        ]),
        el('div', { class: 'pequeno texto-mudo', style: { marginTop: '6px' } },
          'Venda sem cliente é permitida, mas o cliente cadastrado alimenta o mapa, o ranking e as campanhas de WhatsApp.')
      );
    }
  }

  async function abrirBuscaCliente() {
    const entrada = el('input', { type: 'search', placeholder: 'Nome, telefone ou cidade…', autocomplete: 'off' });
    const lista = el('div', { class: 'rolagem', style: { marginTop: '12px' } });
    const { fechar } = modal({
      titulo: 'Selecionar cliente',
      corpo: el('div', {}, [entrada, lista]),
      acoes: [{ rotulo: 'Cadastrar novo cliente', class: 'btn-acao', acao: (f) => { f(); abrirNovoCliente(); } }]
    });

    async function buscar() {
      limpar(lista).appendChild(el('div', { class: 'vazio', text: 'Buscando…' }));
      const { clientes } = await api.get('/api/clientes', { q: entrada.value, store_id: lojaVenda });
      limpar(lista);
      if (!clientes.length) { lista.appendChild(vazio('Nenhum cliente encontrado', '👤')); return; }
      for (const c of clientes.slice(0, 40)) {
        lista.appendChild(el('button', {
          class: 'produto-btn', type: 'button', style: { minHeight: 'auto', width: '100%', marginBottom: '6px' },
          onclick: () => { clienteSelecionado = c; desenharCliente(); fechar(); }
        }, [
          el('div', { class: 'nome', text: c.name }),
          el('div', { class: 'est', text: [telefoneBR(c.phone), c.city, c.compras ? `${c.compras} compra(s)` : null].filter(Boolean).join(' · ') })
        ]));
      }
    }
    let debounce;
    entrada.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(buscar, 250); });
    buscar();
  }

  function abrirNovoCliente(preenchido = {}) {
    const nome = el('input', { type: 'text', value: preenchido.name || '', placeholder: 'Nome do cliente' });
    const telefone = el('input', { type: 'tel', value: preenchido.phone || '', placeholder: '(81) 90000-0000' });
    const cep = el('input', { type: 'text', value: preenchido.cep || '', placeholder: '00000-000', maxlength: '9' });
    const numeroEnd = el('input', { type: 'text', value: preenchido.number || '', placeholder: 'Nº' });
    const endereco = el('div', { class: 'pequeno texto-mudo' });
    const statusFala = el('div', { class: 'voz-status' });

    cep.addEventListener('blur', async () => {
      const d = cep.value.replace(/\D/g, '');
      if (d.length !== 8) return;
      endereco.textContent = 'Consultando CEP…';
      try {
        const { endereco: e } = await api.get(`/api/cep/${d}`);
        endereco.textContent = [e.street, e.district, e.city, e.uf].filter(Boolean).join(', ') +
          (e.precision === 'aproximada' ? ' (localização aproximada)' : '');
      } catch { endereco.textContent = 'CEP não localizado — o cliente será salvo mesmo assim.'; }
    });

    const btnFala = el('button', { class: 'btn btn-voz btn-bloco', type: 'button' }, '🎤 Ditar dados do cliente');
    let rec = null;
    btnFala.onclick = () => {
      if (!vozDisponivel()) { erro('Este navegador não suporta comando de voz. Use o Chrome ou o Edge.'); return; }
      if (rec?.ativo) { rec.parar(); return; }
      rec = criarReconhecedor({
        continuo: false,
        onEstado: (s) => {
          btnFala.classList.toggle('ouvindo', s === 'ouvindo');
          btnFala.textContent = s === 'ouvindo' ? '⏹ Parar de ouvir' : '🎤 Ditar dados do cliente';
          if (s === 'ouvindo') statusFala.textContent = 'Fale: "nome João da Silva telefone 81 98888 7777 cep 51020 000"';
        },
        onErro: (m) => { statusFala.textContent = m; },
        onTexto: (texto, parcial) => {
          statusFala.textContent = `“${texto}”`;
          if (parcial) return;
          const dados = interpretarCliente(texto);
          if (dados.name) nome.value = dados.name;
          if (dados.phone) telefone.value = dados.phone;
          if (dados.cep) { cep.value = dados.cep; cep.dispatchEvent(new Event('blur')); }
          if (dados.number) numeroEnd.value = dados.number;
          statusFala.textContent = 'Dados preenchidos. Confira antes de salvar.';
        }
      });
      rec.iniciar();
    };

    modal({
      titulo: 'Novo cliente',
      corpo: el('div', {}, [
        btnFala, statusFala,
        el('div', { class: 'campo', style: { marginTop: '12px' } }, [el('label', { text: 'Nome *' }), nome]),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'WhatsApp / Telefone' }), telefone]),
          el('div', { class: 'campo' }, [el('label', { text: 'CEP' }), cep])
        ]),
        el('div', { class: 'campo' }, [el('label', { text: 'Número' }), numeroEnd]),
        endereco
      ]),
      acoes: [{
        rotulo: 'Salvar e selecionar', class: 'btn-primario', acao: async (fechar) => {
          if (!nome.value.trim()) { erro('Informe o nome do cliente'); return; }
          try {
            rec?.parar();
            const r = await api.post('/api/clientes', {
              name: nome.value, phone: telefone.value, cep: cep.value,
              number: numeroEnd.value, store_id: lojaVenda
            });
            const { cliente } = await api.get(`/api/clientes/${r.id}`);
            clienteSelecionado = cliente;
            desenharCliente();
            sucesso('Cliente cadastrado');
            fechar();
          } catch (e) { erro(e.message); }
        }
      }]
    });
  }

  /* ---------- pagamento ---------- */
  function desenharPagamento() {
    limpar(gradePagamento);
    for (const p of PAGAMENTOS) {
      gradePagamento.appendChild(el('button', {
        class: `pag-btn ${pagamento === p.id ? 'ativo' : ''}`, type: 'button',
        onclick: () => { pagamento = p.id; desenharPagamento(); }
      }, p.rotulo));
    }
  }

  /* ---------- voz no PDV ---------- */
  function alternarVoz() {
    if (!vozDisponivel()) {
      erro('Comando de voz não disponível neste navegador. Use o Google Chrome ou o Microsoft Edge.');
      return;
    }
    if (reconhecedor?.ativo) { reconhecedor.parar(); return; }
    reconhecedor = criarReconhecedor({
      onEstado: (s) => {
        btnVoz.classList.toggle('ouvindo', s === 'ouvindo');
        btnVoz.textContent = s === 'ouvindo' ? '⏹ Parar' : '🎤 Voz';
        if (s === 'ouvindo') statusVoz.textContent = 'Ouvindo… diga por exemplo "10 argamassa AC 3" ou "finalizar venda".';
        else if (statusVoz.textContent.startsWith('Ouvindo')) statusVoz.textContent = '';
      },
      onErro: (m) => { statusVoz.textContent = m; },
      onTexto: (texto, parcial) => {
        if (parcial) { statusVoz.textContent = `“${texto}”…`; return; }
        const cmd = interpretarComandoPDV(texto, produtos);
        if (cmd.acao === 'adicionar') {
          if (adicionar(cmd.produto, cmd.qtd)) statusVoz.textContent = `✅ ${cmd.qtd} × ${cmd.produto.name}`;
        } else if (cmd.acao === 'remover') {
          definirQtd(cmd.produto.id, 0);
          statusVoz.textContent = `🗑️ ${cmd.produto.name} removido`;
        } else if (cmd.acao === 'desconto') {
          entradaDesconto.value = cmd.valor; desenharResumo();
          statusVoz.textContent = `Desconto de ${dinheiro(cmd.valor)} aplicado`;
        } else if (cmd.acao === 'limpar') {
          carrinho.clear(); desenharCarrinho(); desenharProdutos();
          statusVoz.textContent = 'Pedido limpo';
        } else if (cmd.acao === 'finalizar') {
          reconhecedor.parar();
          finalizar();
        } else {
          statusVoz.textContent = `Não entendi “${texto}”. Tente: "5 rejunte branco".`;
        }
      }
    });
    reconhecedor.iniciar();
  }
  btnVoz.onclick = alternarVoz;

  /* ---------- finalizacao ---------- */
  async function finalizar() {
    if (!carrinho.size) { erro('Adicione produtos ao pedido'); return; }
    const t = totais();
    btnFinalizar.disabled = true; btnFinalizar.textContent = 'Registrando…';
    try {
      const resposta = await api.post('/api/vendas', {
        store_id: lojaVenda,
        customer_id: clienteSelecionado?.id || null,
        payment_method: pagamento,
        discount: t.desconto,
        note: observacao.value,
        proof_data: upload.valor(),
        itens: [...carrinho.values()].map(i => ({ product_id: i.produto.id, qty: i.qtd }))
      });
      carrinho.clear();
      entradaDesconto.value = '0';
      observacao.value = '';
      upload.limpar();
      clienteSelecionado = null;
      desenharCliente(); desenharCarrinho();
      const { produtos: atualizados } = await api.get('/api/produtos', { store_id: lojaVenda });
      produtos.splice(0, produtos.length, ...atualizados);
      desenharProdutos();
      atualizarNotificacoes();
      mostrarRecibo(resposta);
    } catch (e) {
      erro(e.message);
    } finally {
      btnFinalizar.disabled = false; btnFinalizar.textContent = 'Finalizar venda';
    }
  }

  function mostrarRecibo({ venda, recibo, whatsapp }) {
    modal({
      titulo: `Venda ${venda.code} registrada`,
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-verde mb' }, `✅ ${dinheiro(venda.total)} — ${venda.payment_method.toUpperCase()}${venda.proof_path ? ' · comprovante anexado' : ''}`),
        el('pre', { style: { whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '13.5px', background: 'var(--cinza-100)', padding: '14px', borderRadius: '10px', margin: '0' }, text: recibo }),
        venda.proof_path ? el('img', { src: venda.proof_path, class: 'upload-previa' }) : null,
        !whatsapp ? el('div', { class: 'aviso aviso-amarelo mt' },
          'Este cliente não tem WhatsApp cadastrado — ao compartilhar você escolhe o contato no próprio aplicativo.') : null
      ]),
      largo: true,
      acoes: [
        { rotulo: '📋 Copiar', acao: () => copiar(recibo) },
        { rotulo: '💬 Enviar no WhatsApp', class: 'btn-ok', acao: () => abrirWhatsApp(whatsapp, recibo) },
        { rotulo: 'Nova venda', class: 'btn-primario', acao: (f) => f() }
      ]
    });
  }

  /* ---------- montagem ---------- */
  const seletorLoja = ehMaster() && lojasOperacionais().length > 1
    ? el('select', {
        onchange: async (e) => {
          lojaVenda = Number(e.target.value);
          carrinho.clear();
          const { produtos: novos } = await api.get('/api/produtos', { store_id: lojaVenda });
          produtos.splice(0, produtos.length, ...novos);
          desenharProdutos(); desenharCarrinho();
        }
      }, lojasOperacionais().map(l => el('option', { value: l.id, selected: l.id === lojaVenda, text: l.name })))
    : null;

  const cartaoPedido = el('div', { class: 'card' }, [
    el('div', { class: 'card-cab' }, [el('h3', { text: 'Pedido' })]),
    listaCarrinho,
    resumo,
    el('div', { class: 'card-corpo', style: { borderTop: '1px solid var(--cinza-200)' } }, [
      el('label', { class: 'pequeno negrito', text: 'Forma de pagamento', style: { display: 'block', marginBottom: '7px' } }),
      gradePagamento,
      el('div', { class: 'campo', style: { marginTop: '12px' } }, [observacao]),
      upload.elemento,
      btnFinalizar
    ])
  ]);

  raiz.appendChild(el('div', { class: 'pdv' }, [
    /* coluna de produtos */
    el('div', {}, [
      el('div', { class: 'pdv-busca' }, [entradaBusca, btnVoz]),
      statusVoz,
      chips,
      grade
    ]),
    /* coluna do pedido */
    el('div', { class: 'carrinho' }, [
      el('div', { class: 'card mb' }, [
        el('div', { class: 'card-cab' }, [
          el('h3', { text: 'Cliente' }),
          el('div', { class: 'espaco' }),
          seletorLoja
        ]),
        areaCliente
      ]),
      cartaoPedido
    ])
  ]));
  raiz.appendChild(barra);

  desenharChips(); desenharProdutos(); desenharCarrinho(); desenharCliente(); desenharPagamento();
  entradaBusca.focus();

  return { destruir: () => { reconhecedor?.parar(); barra.remove(); } };
}
