/* ============================================================
   Estoque e cadastro de produtos.

   Além do saldo, guarda o que a auditoria precisa: custo médio real,
   histórico de preço, ajustes extraordinários com documento de autorização,
   comissão e faixas de desconto por quantidade.
   ============================================================ */
import {
  listar, salvar, remover, entradaEstoque, saldos, ajustarEstoque, alterarPreco,
  documentosDe, MOTIVOS_AJUSTE, config
} from '../db.js';
import { recalcularPendencias } from '../app.js';
import {
  el, limpar, dinheiro, numero, percentual, erro, sucesso, painel, vazio,
  confirmar, atrasar, dataHora, anexar, campoFoto, lerFoto, abrirWhatsApp
} from '../ui.js';
import { pdfTabela, entregarPdf, nomeArquivoSeguro, dinheiroPdf } from '../documentos.js';

export async function render(raiz) {
  const corpo = el('div');
  let somenteAlerta = false;
  const busca = el('input', { type: 'search', placeholder: 'Buscar produto…' });
  busca.addEventListener('input', atrasar(desenhar, 200));

  const btnAlerta = el('button', { class: 'btn btn-vazio', onclick: () => {
    somenteAlerta = !somenteAlerta;
    btnAlerta.classList.toggle('btn-perigo', somenteAlerta);
    desenhar();
  } }, '⚠️ Repor');

  anexar(raiz,
    el('div', { class: 'busca-linha' }, [busca, btnAlerta]),
    el('div', { class: 'grade3 mb' }, [
      el('button', { class: 'btn btn-acao btn-sm', onclick: () => formulario() }, '+ Produto'),
      el('a', { class: 'btn btn-vazio btn-sm', href: '#/inventario' }, '📋 Inventário'),
      el('button', { class: 'btn btn-vazio btn-sm', onclick: compartilharCatalogo }, '📤 Catálogo')
    ]),
    corpo
  );

  async function desenhar() {
    const produtos = (await listar('produtos')).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const termo = busca.value.trim().toLowerCase();
    const lista = produtos.filter(p =>
      (!termo || p.nome.toLowerCase().includes(termo)) &&
      (!somenteAlerta || (p.estoqueMin > 0 && p.estoque <= p.estoqueMin)));

    limpar(corpo);
    const valorCusto = produtos.reduce((a, p) => a + p.estoque * (p.custo || 0), 0);
    anexar(corpo, el('div', { class: 'grade2 mb' }, [
      el('div', { class: 'kpi' }, [
        el('div', { class: 'rot', text: 'Produtos' }), el('div', { class: 'val', text: numero(produtos.length) })
      ]),
      el('div', { class: 'kpi amarelo' }, [
        el('div', { class: 'rot', text: 'Valor em estoque' }), el('div', { class: 'val', text: dinheiro(valorCusto) }),
        el('div', { class: 'det', text: 'pelo custo médio' })
      ])
    ]));

    if (!lista.length) { anexar(corpo, vazio(somenteAlerta ? 'Nada para repor 🎉' : 'Nenhum produto', '📦')); return; }

    anexar(corpo, el('div', { class: 'cartao' }, el('div', { class: 'lista' }, lista.map(p =>
      el('button', { class: 'item', onclick: () => abrir(p) }, [
        p.foto
          ? el('img', { src: p.foto, style: { width: '42px', height: '42px', borderRadius: '9px', objectFit: 'cover', flex: '0 0 auto' } })
          : el('span', { style: { fontSize: '22px', width: '42px', textAlign: 'center' }, text: '🧱' }),
        el('div', { class: 'info' }, [
          el('div', { class: 'titulo', text: p.nome }),
          el('div', { class: 'sub', text: [
            dinheiro(p.preco),
            p.estoqueMin ? `mín. ${numero(p.estoqueMin)}` : null,
            p.comissao ? `comissão ${p.comissaoTipo === 'valor' ? dinheiro(p.comissao) : percentual(p.comissao)}` : null
          ].filter(Boolean).join(' · ') })
        ]),
        el('span', {
          class: `etiqueta ${p.estoque <= 0 ? 'et-vermelha' : (p.estoqueMin > 0 && p.estoque <= p.estoqueMin) ? 'et-amarela' : 'et-verde'}`,
          text: `${numero(p.estoque)} ${p.unidade}`
        })
      ])
    ))));
  }

  /* ---------------- Painel do produto ---------------- */
  async function abrir(produto) {
    const margem = produto.preco > 0 ? (produto.preco - (produto.custo || 0)) / produto.preco * 100 : 0;
    const docs = await documentosDe('ajuste', produto.id).catch(() => []);

    painel({
      titulo: produto.nome,
      corpo: el('div', {}, [
        produto.foto ? el('img', { src: produto.foto, class: 'previa', style: { maxHeight: '160px' } }) : null,
        el('div', { class: 'grade2 mb mt' }, [
          el('div', { class: 'kpi' }, [el('div', { class: 'rot', text: 'Em estoque' }), el('div', { class: 'val', text: `${numero(produto.estoque)} ${produto.unidade}` })]),
          el('div', { class: 'kpi verde' }, [el('div', { class: 'rot', text: 'Preço de venda' }), el('div', { class: 'val', text: dinheiro(produto.preco) })])
        ]),
        el('div', { class: 'aviso aviso-azul' },
          `Custo médio ${dinheiro(produto.custo || 0)} · lucro ${dinheiro(produto.preco - (produto.custo || 0))} por ${produto.unidade} · margem ${percentual(margem)}`),
        produto.comissao
          ? el('div', { class: 'aviso aviso-verde' },
              `Comissão: ${produto.comissaoTipo === 'valor' ? dinheiro(produto.comissao) + ' por ' + produto.unidade : percentual(produto.comissao) + ' sobre a venda'}`)
          : null,
        (produto.descontos || []).length
          ? el('div', { class: 'aviso aviso-amarelo' },
              'Desconto por quantidade: ' + produto.descontos
                .slice().sort((a, b) => a.qtd - b.qtd)
                .map(d => `${percentual(d.percentual)} acima de ${numero(d.qtd)}`).join(' · '))
          : null,

        el('div', { class: 'grade2 mt mb' }, [
          el('button', { class: 'btn btn-ok', onclick: () => { document.querySelector('.fundo-painel')?.remove(); movimentar(produto); } }, '+ Entrada'),
          el('button', { class: 'btn btn-vazio', onclick: () => { document.querySelector('.fundo-painel')?.remove(); ajusteExtraordinario(produto); } }, '⚖️ Ajuste')
        ]),

        produto.historicoPreco?.length
          ? el('div', { class: 'mb' }, [
              el('div', { class: 'pq negrito mb', text: 'Mudanças de preço' }),
              el('div', { class: 'lista' }, [...produto.historicoPreco].reverse().slice(0, 6).map(h =>
                el('div', { class: 'item' }, [
                  el('div', { class: 'info' }, [
                    el('div', { class: 'titulo', text: `${dinheiro(h.de)} → ${dinheiro(h.para)}` }),
                    el('div', { class: 'sub', text: [dataHora(h.data), h.responsavel, h.motivo].filter(Boolean).join(' · ') })
                  ])
                ])))
            ])
          : null,

        produto.movimentos?.length
          ? el('div', {}, [
              el('div', { class: 'pq negrito mb', text: 'Últimas entradas e saídas' }),
              el('div', { class: 'lista rolagem' }, [...produto.movimentos].reverse().slice(0, 20).map(m =>
                el('div', { class: 'item' }, [
                  el('div', { class: 'info' }, [
                    el('div', { class: 'titulo', style: { color: m.qtd >= 0 ? 'var(--verde-700)' : 'var(--vermelho-600)' },
                                text: `${m.qtd > 0 ? '+' : ''}${numero(m.qtd)} ${produto.unidade}` }),
                    el('div', { class: 'sub', text: [
                      dataHora(m.data),
                      m.custoUnitario != null ? `custo ${dinheiro(m.custoUnitario)}` : null,
                      m.fornecedor, m.obs
                    ].filter(Boolean).join(' · ') })
                  ]),
                  el('span', { class: 'pq mudo', text: `saldo ${numero(m.saldo)}` })
                ])))
            ])
          : null
      ]),
      acoes: [
        { rotulo: 'Editar', acao: (f) => { f(); formulario(produto); } },
        { rotulo: '💲 Preço', class: 'btn-primario', acao: (f) => { f(); mudarPreco(produto); } }
      ]
    });
  }

  /* ---------------- Entrada com custo real ---------------- */
  async function movimentar(produto) {
    const contas = await saldos();
    const qtd = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: '1' });
    const custo = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: produto.custo || 0 });
    const fornecedor = el('input', { type: 'text', placeholder: 'Nome do fornecedor (opcional)' });
    const obs = el('input', { type: 'text', placeholder: 'Nota fiscal, observação…' });
    const pagar = el('input', { type: 'checkbox' });
    const conta = el('select', { disabled: true }, contas.map(c =>
      el('option', { value: c.id, text: `${c.nome} — ${dinheiro(c.saldo)}` })));
    const previsao = el('div', { class: 'aviso aviso-azul' });

    function recalcular() {
      conta.disabled = !pagar.checked;
      const q = Number(qtd.value) || 0;
      const cu = Number(custo.value) || 0;
      const saldoAtual = Math.max(0, produto.estoque);
      const medio = q > 0 ? (saldoAtual * (produto.custo || 0) + q * cu) / (saldoAtual + q) : (produto.custo || 0);
      const margem = produto.preco > 0 ? (produto.preco - medio) / produto.preco * 100 : 0;
      previsao.textContent = `Custo médio passa de ${dinheiro(produto.custo || 0)} para ${dinheiro(medio)} · ` +
        `margem em ${dinheiro(produto.preco)} fica ${percentual(margem)}` +
        (pagar.checked ? ` · pagamento de ${dinheiro(q * cu)}` : '');
    }
    [qtd, custo].forEach(c => c.addEventListener('input', recalcular));
    pagar.addEventListener('change', recalcular);

    painel({
      titulo: `Entrada — ${produto.nome}`,
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-azul', text:
          `Agora há ${numero(produto.estoque)} ${produto.unidade}, com custo médio de ${dinheiro(produto.custo || 0)}.` }),
        el('div', { class: 'campo' }, [el('label', { text: `Quantidade que chegou (${produto.unidade})` }), qtd]),
        el('div', { class: 'campo' }, [
          el('label', {}, ['Custo unitário da nota (R$) ', el('span', { class: 'dica', text: '— o que você pagou agora' })]),
          custo
        ]),
        el('div', { class: 'campo' }, [el('label', { text: 'Fornecedor' }), fornecedor]),
        el('label', { class: 'check' }, [pagar, el('span', { text: 'Lançar o pagamento numa conta' })]),
        el('div', { class: 'campo' }, [conta]),
        el('div', { class: 'campo' }, [el('label', { text: 'Observação' }), obs]),
        previsao
      ]),
      acoes: [{
        rotulo: 'Confirmar entrada', class: 'btn-primario', acao: async (fechar) => {
          const q = Number(qtd.value);
          if (!q || q <= 0) { erro('Informe a quantidade'); return; }
          try {
            const r = await entradaEstoque(produto.id, q, {
              custoUnitario: Number(custo.value) || 0,
              fornecedor: fornecedor.value.trim(), observacao: obs.value.trim(),
              contaId: pagar.checked ? Number(conta.value) : null
            });
            sucesso(`Saldo ${numero(r.saldo)} ${produto.unidade} · custo médio ${dinheiro(r.custoMedio)}`);
            fechar(); desenhar(); recalcularPendencias();
          } catch (e) { erro(e.message); }
        }
      }]
    });
    recalcular();
  }

  /* ---------------- Ajuste extraordinário ---------------- */
  function ajusteExtraordinario(produto) {
    const motivo = el('select', {}, MOTIVOS_AJUSTE.map(m => el('option', { value: m.id, text: m.rotulo })));
    const modo = el('select', {}, [
      el('option', { value: 'diferenca', text: 'Informar a quantidade tirada ou acrescentada' }),
      el('option', { value: 'saldo', text: 'Informar o saldo correto (contagem)' })
    ]);
    const qtd = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: '1' });
    const responsavel = el('input', { type: 'text', placeholder: 'Quem autorizou' });
    const obs = el('input', { type: 'text', placeholder: 'Descreva o que aconteceu' });
    const doc = campoFoto({ rotulo: 'Documento que autoriza (foto)' });
    const previsao = el('div', { class: 'aviso aviso-amarelo' });
    const exigencia = el('div', { class: 'pq mudo' });

    function recalcular() {
      const m = MOTIVOS_AJUSTE.find(x => x.id === motivo.value);
      const q = Number(qtd.value) || 0;
      const novo = modo.value === 'saldo' ? q : produto.estoque + (m.sinal || 1) * q;
      const diferenca = novo - produto.estoque;
      previsao.textContent = `Estoque vai de ${numero(produto.estoque)} para ${numero(novo)} ${produto.unidade} ` +
        `(${diferenca >= 0 ? '+' : ''}${numero(diferenca)}) · impacto no custo ${dinheiro(diferenca * (produto.custo || 0))}`;
      exigencia.textContent = m.exigeDoc
        ? '⚠️ Este motivo pede o documento de autorização anexado.'
        : 'O documento é opcional neste motivo, mas ajuda na auditoria.';
    }
    [motivo, modo, qtd].forEach(c => { c.addEventListener('input', recalcular); c.addEventListener('change', recalcular); });

    painel({
      titulo: `Ajuste — ${produto.nome}`,
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-azul' },
          'Ajuste extraordinário é registrado à parte, com motivo, responsável e documento — é isso que a auditoria confere.'),
        el('div', { class: 'campo' }, [el('label', { text: 'Motivo' }), motivo]),
        el('div', { class: 'campo' }, [el('label', { text: 'Como informar' }), modo]),
        el('div', { class: 'campo' }, [el('label', { text: `Quantidade (${produto.unidade})` }), qtd]),
        previsao, exigencia,
        el('div', { class: 'campo mt' }, [el('label', { text: 'Responsável pela autorização' }), responsavel]),
        el('div', { class: 'campo' }, [el('label', { text: 'Observação' }), obs]),
        doc.elemento
      ]),
      acoes: [{
        rotulo: 'Registrar ajuste', class: 'btn-perigo', acao: async (fechar) => {
          const m = MOTIVOS_AJUSTE.find(x => x.id === motivo.value);
          const q = Number(qtd.value);
          if (!q && modo.value !== 'saldo') { erro('Informe a quantidade'); return; }
          if (m.exigeDoc && !doc.valor() && !await confirmar(
            'Este motivo pede documento de autorização e nenhum foi anexado. Registrar mesmo assim?', { perigo: true })) return;
          try {
            const r = await ajustarEstoque({
              produtoId: produto.id, motivo: motivo.value,
              quantidade: (m.sinal || 1) * q,
              novoSaldo: modo.value === 'saldo' ? q : null,
              observacao: obs.value.trim(), responsavel: responsavel.value.trim(),
              documento: doc.valor()
            });
            sucesso(`Estoque ajustado: ${numero(r.antes)} → ${numero(r.depois)} ${produto.unidade}`);
            fechar(); desenhar(); recalcularPendencias();
          } catch (e) { erro(e.message); }
        }
      }]
    });
    recalcular();
  }

  /* ---------------- Mudança de preço com autorização ---------------- */
  function mudarPreco(produto) {
    const preco = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: produto.preco });
    const motivo = el('input', { type: 'text', placeholder: 'Ex.: reajuste do fornecedor' });
    const responsavel = el('input', { type: 'text', placeholder: 'Quem autorizou' });
    const doc = campoFoto({ rotulo: 'Documento que autoriza (foto)' });
    const previsao = el('div', { class: 'aviso aviso-azul' });

    function recalcular() {
      const p = Number(preco.value) || 0;
      const margem = p > 0 ? (p - (produto.custo || 0)) / p * 100 : 0;
      previsao.textContent = `De ${dinheiro(produto.preco)} para ${dinheiro(p)} · ` +
        `margem sobre o custo de ${dinheiro(produto.custo || 0)} fica ${percentual(margem)}`;
    }
    preco.addEventListener('input', recalcular);

    painel({
      titulo: `Preço — ${produto.nome}`,
      corpo: el('div', {}, [
        el('div', { class: 'campo' }, [el('label', { text: 'Novo preço de venda (R$)' }), preco]),
        previsao,
        el('div', { class: 'campo mt' }, [el('label', { text: 'Motivo' }), motivo]),
        el('div', { class: 'campo' }, [el('label', { text: 'Responsável' }), responsavel]),
        doc.elemento,
        el('div', { class: 'aviso aviso-amarelo' },
          'A mudança fica registrada com data, responsável e documento no relatório de auditoria.')
      ]),
      acoes: [{
        rotulo: 'Alterar preço', class: 'btn-primario', acao: async (fechar) => {
          const p = Number(preco.value);
          if (!(p > 0)) { erro('Informe o novo preço'); return; }
          if (!doc.valor() && !await confirmar('Alterar o preço sem anexar o documento de autorização?', { perigo: true })) return;
          try {
            const r = await alterarPreco({
              produtoId: produto.id, novoPreco: p,
              motivo: motivo.value.trim(), responsavel: responsavel.value.trim(), documento: doc.valor()
            });
            sucesso(`Preço: ${dinheiro(r.anterior)} → ${dinheiro(r.novo)}`);
            fechar(); desenhar();
          } catch (e) { erro(e.message); }
        }
      }]
    });
    recalcular();
  }

  /* ---------------- Cadastro ---------------- */
  function formulario(produto = null) {
    const campos = {
      nome: el('input', { type: 'text', value: produto?.nome || '' }),
      categoria: el('input', { type: 'text', value: produto?.categoria || '', placeholder: 'Ex.: Argamassas' }),
      unidade: el('input', { type: 'text', value: produto?.unidade || 'UN', maxlength: '6' }),
      custo: el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: produto?.custo ?? 0 }),
      preco: el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: produto?.preco ?? 0 }),
      estoqueMin: el('input', { type: 'number', inputmode: 'decimal', step: '1', min: '0', value: produto?.estoqueMin ?? 0 }),
      estoque: el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: produto?.estoque ?? 0 }),
      comissao: el('input', { type: 'number', inputmode: 'decimal', step: '0.01', min: '0', value: produto?.comissao ?? 0 })
    };
    const comissaoTipo = el('select', {}, [
      el('option', { value: 'percentual', selected: produto?.comissaoTipo !== 'valor', text: '% sobre a venda' }),
      el('option', { value: 'valor', selected: produto?.comissaoTipo === 'valor', text: 'R$ por unidade' })
    ]);
    const info = el('div', { class: 'aviso aviso-azul' });
    const atualizarInfo = () => {
      const custo = Number(campos.custo.value) || 0, preco = Number(campos.preco.value) || 0;
      const lucro = preco - custo;
      info.textContent = `Lucro por unidade: ${dinheiro(lucro)} · margem ${percentual(preco ? lucro / preco * 100 : 0)}`;
    };
    [campos.custo, campos.preco].forEach(c => c.addEventListener('input', atualizarInfo));
    atualizarInfo();

    /* faixas de desconto por quantidade */
    const faixas = (produto?.descontos || []).map(d => ({ ...d }));
    const listaFaixas = el('div');
    function desenharFaixas() {
      limpar(listaFaixas);
      if (!faixas.length) anexar(listaFaixas, el('div', { class: 'pq mudo', text: 'Sem desconto por quantidade.' }));
      faixas.forEach((f, i) => {
        const qtd = el('input', { type: 'number', inputmode: 'decimal', min: '1', value: f.qtd, style: { maxWidth: '90px' },
          oninput: (e) => { f.qtd = Number(e.target.value) || 0; } });
        const pct = el('input', { type: 'number', inputmode: 'decimal', min: '0', max: '90', step: '0.5', value: f.percentual, style: { maxWidth: '80px' },
          oninput: (e) => { f.percentual = Number(e.target.value) || 0; } });
        anexar(listaFaixas, el('div', { class: 'flex', style: { marginBottom: '8px' } }, [
          el('span', { class: 'pq', text: 'acima de' }), qtd,
          el('span', { class: 'pq', text: 'un →' }), pct, el('span', { class: 'pq', text: '%' }),
          el('button', { class: 'btn btn-sm btn-vazio', type: 'button', onclick: () => { faixas.splice(i, 1); desenharFaixas(); } }, '✕')
        ]));
      });
    }
    desenharFaixas();

    /* foto */
    let foto = produto?.foto || null;
    const previa = el('img', { class: 'previa', hidden: !foto, src: foto || '' });
    const entradaFoto = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    entradaFoto.addEventListener('change', async () => {
      if (!entradaFoto.files[0]) return;
      try { foto = await lerFoto(entradaFoto.files[0], 700, 0.7); previa.src = foto; previa.hidden = false; }
      catch (e) { erro(e.message); }
    });

    painel({
      titulo: produto ? 'Editar produto' : 'Novo produto',
      corpo: el('div', {}, [
        el('div', { class: 'campo' }, [el('label', { text: 'Nome *' }), campos.nome]),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Categoria' }), campos.categoria]),
          el('div', { class: 'campo', style: { flex: '.5' } }, [el('label', { text: 'Unidade' }), campos.unidade])
        ]),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Custo (R$)' }), campos.custo]),
          el('div', { class: 'campo' }, [el('label', { text: 'Venda (R$)' }), campos.preco])
        ]),
        info,
        el('div', { class: 'linha mt' }, [
          el('div', { class: 'campo' }, [el('label', { text: 'Estoque atual' }), campos.estoque]),
          el('div', { class: 'campo' }, [el('label', { text: 'Estoque mínimo' }), campos.estoqueMin])
        ]),

        el('div', { class: 'campo' }, [
          el('label', { text: 'Foto do produto' }),
          el('div', { class: 'upload', onclick: () => entradaFoto.click() }, '🖼️ Escolher foto'),
          entradaFoto, previa
        ]),

        el('label', { class: 'pq negrito', text: 'Comissão do vendedor', style: { display: 'block', marginBottom: '6px' } }),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [campos.comissao]),
          el('div', { class: 'campo' }, [comissaoTipo])
        ]),

        el('label', { class: 'pq negrito', text: 'Desconto por quantidade', style: { display: 'block', margin: '10px 0 6px' } }),
        el('div', { class: 'pq mudo mb', text: 'Ex.: acima de 50 unidades, 5%. O PDV aplica sozinho a maior faixa que couber.' }),
        listaFaixas,
        el('button', { class: 'btn btn-vazio btn-sm', type: 'button',
          onclick: () => { faixas.push({ qtd: 50, percentual: 5 }); desenharFaixas(); } }, '+ Faixa de desconto')
      ]),
      acoes: [
        produto ? { rotulo: 'Excluir', class: 'btn-perigo', acao: async (fechar) => {
          if (!await confirmar(`Excluir "${produto.nome}"? As vendas já feitas continuam no histórico.`, { perigo: true })) return;
          await remover('produtos', produto.id);
          sucesso('Produto excluído'); fechar(); desenhar();
        } } : null,
        { rotulo: 'Salvar', class: 'btn-primario', acao: async (fechar) => {
          if (!campos.nome.value.trim()) { erro('Informe o nome'); return; }
          const validas = faixas.filter(f => f.qtd > 0 && f.percentual > 0);
          await salvar('produtos', {
            ...(produto || { ativo: true, movimentos: [] }),
            nome: campos.nome.value.trim(),
            categoria: campos.categoria.value.trim(),
            unidade: campos.unidade.value.trim().toUpperCase() || 'UN',
            custo: Number(campos.custo.value) || 0,
            preco: Number(campos.preco.value) || 0,
            estoqueMin: Number(campos.estoqueMin.value) || 0,
            estoque: Number(campos.estoque.value) || 0,
            comissao: Number(campos.comissao.value) || 0,
            comissaoTipo: comissaoTipo.value,
            descontos: validas.sort((a, b) => a.qtd - b.qtd),
            foto
          });
          sucesso(produto ? 'Produto atualizado' : 'Produto cadastrado');
          fechar(); desenhar(); recalcularPendencias();
        } }
      ].filter(Boolean)
    });
  }

  /* ---------------- Catálogo para o cliente ---------------- */
  async function compartilharCatalogo() {
    const produtos = (await listar('produtos'))
      .filter(p => p.ativo !== false && p.preco > 0)
      .sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '') || a.nome.localeCompare(b.nome, 'pt-BR'));
    if (!produtos.length) { erro('Nenhum produto com preço para o catálogo'); return; }
    const loja = await config('loja', {});

    const comoTexto = () => {
      const linhas = [`*${loja.nome || 'Loja das Argamassas'}*`, '_Tabela de preços_', ''];
      let categoria = null;
      for (const p of produtos) {
        if ((p.categoria || 'Outros') !== categoria) {
          categoria = p.categoria || 'Outros';
          linhas.push('', `*${categoria.toUpperCase()}*`);
        }
        linhas.push(`• ${p.nome} — ${dinheiro(p.preco)}`);
      }
      if (loja.endereco) linhas.push('', `📍 ${loja.endereco}`);
      if (loja.whatsapp || loja.telefone) linhas.push(`📱 ${loja.whatsapp || loja.telefone}`);
      linhas.push('', '_Preços sujeitos a alteração._');
      return linhas.join('\n');
    };

    painel({
      titulo: 'Compartilhar catálogo',
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-azul' },
          `${produtos.length} produtos com preço. Envie a lista como texto no WhatsApp ou como PDF, que fica mais apresentável.`),
        el('pre', { class: 'pq', style: { whiteSpace: 'pre-wrap', background: 'var(--cinza-100)', padding: '12px', borderRadius: '10px', maxHeight: '220px', overflow: 'auto', margin: 0 }, text: comoTexto() })
      ]),
      acoes: [
        { rotulo: '💬 Texto', class: 'btn-ok', acao: () => abrirWhatsApp(null, comoTexto()) },
        { rotulo: '📄 PDF', class: 'btn-primario', acao: async () => {
          try {
            const bytes = pdfTabela({
              titulo: 'TABELA DE PREÇOS',
              subtitulo: new Date().toLocaleDateString('pt-BR'),
              loja,
              colunas: [
                { titulo: 'Produto', campo: 'nome', peso: 5 },
                { titulo: 'Unidade', campo: 'unidade', peso: 1.2, alinhamento: 'direita' },
                { titulo: 'Preço', campo: 'preco', peso: 1.5, alinhamento: 'direita' }
              ],
              linhas: agruparPorCategoria(produtos),
              observacao: 'Preços sujeitos a alteração sem aviso prévio. Consulte a loja para condições de pagamento e entrega.'
            });
            sucesso(await entregarPdf(bytes, `catalogo-${nomeArquivoSeguro(loja.nome || 'loja')}.pdf`));
          } catch (e) { erro(e.message); }
        } }
      ]
    });
  }

  function agruparPorCategoria(produtos) {
    const linhas = [];
    let categoria = null;
    for (const p of produtos) {
      const c = p.categoria || 'Outros';
      if (c !== categoria) { categoria = c; linhas.push({ separador: c.toUpperCase() }); }
      linhas.push({ nome: p.nome, unidade: p.unidade, preco: dinheiroPdf(p.preco) });
    }
    return linhas;
  }

  desenhar();
}
