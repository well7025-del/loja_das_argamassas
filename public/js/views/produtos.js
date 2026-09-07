/* Cadastro de produtos — custo e preco de venda so o usuario master altera. */
import { api } from '../api.js';
import { ehMaster } from '../app.js';
import { el, limpar, dinheiro, numero, percentual, erro, sucesso, modal, vazio, confirmar, lerImagemReduzida } from '../ui.js';

export async function render(raiz) {
  if (!ehMaster()) {
    raiz.appendChild(el('div', { class: 'aviso aviso-amarelo' },
      'Apenas o usuário master cadastra produtos e define custo e preço de venda.'));
    return;
  }

  const { categorias } = await api.get('/api/categorias');
  const corpo = el('div');
  const entradaBusca = el('input', { type: 'search', placeholder: 'Nome ou código do produto…' });
  const seletorCategoria = el('select', { onchange: carregar }, [
    el('option', { value: '', text: 'Todas as categorias' }),
    ...categorias.map(c => el('option', { value: c.id, text: c.name }))
  ]);
  let debounce;
  entradaBusca.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(carregar, 280); });

  raiz.append(
    el('div', { class: 'filtros' }, [
      el('div', { class: 'campo', style: { flex: '2' } }, [el('label', { text: 'Buscar' }), entradaBusca]),
      el('div', { class: 'campo' }, [el('label', { text: 'Categoria' }), seletorCategoria]),
      el('button', { class: 'btn btn-vazio', onclick: novaCategoria }, '+ Categoria'),
      el('button', { class: 'btn btn-acao', onclick: () => formulario() }, '+ Novo produto')
    ]),
    corpo
  );

  async function carregar() {
    limpar(corpo).appendChild(el('div', { class: 'vazio', text: 'Carregando…' }));
    const { produtos } = await api.get('/api/produtos', { q: entradaBusca.value, category_id: seletorCategoria.value || undefined, ativos: '0' });
    limpar(corpo);
    if (!produtos.length) { corpo.appendChild(vazio('Nenhum produto cadastrado', '🏷️')); return; }

    const margemMedia = produtos.filter(p => p.sale_price > 0).reduce((a, p, _, arr) => a + p.margem / arr.length, 0);
    corpo.appendChild(el('div', { class: 'grid g3 mb' }, [
      el('div', { class: 'kpi' }, [el('div', { class: 'rot', text: 'Produtos' }), el('div', { class: 'val', text: numero(produtos.length) })]),
      el('div', { class: 'kpi verde' }, [el('div', { class: 'rot', text: 'Margem média' }), el('div', { class: 'val', text: percentual(margemMedia) })]),
      el('div', { class: 'kpi amarelo' }, [el('div', { class: 'rot', text: 'No catálogo online' }), el('div', { class: 'val', text: numero(produtos.filter(p => p.in_catalog && p.active).length) })])
    ]));

    corpo.appendChild(el('div', { class: 'card' }, el('div', { class: 'tabela-wrap' }, el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Produto' }), el('th', { text: 'Categoria' }),
        el('th', { class: 'num', text: 'Custo' }), el('th', { class: 'num', text: 'Venda' }),
        el('th', { class: 'num', text: 'Margem' }), el('th', { class: 'num', text: 'Estoque' }),
        el('th', { class: 'num', text: 'Mínimo' }), el('th', { text: 'Status' }), el('th', { text: '' })
      ])),
      el('tbody', {}, produtos.map(p => el('tr', {}, [
        el('td', {}, [el('div', { class: 'negrito', text: p.name }), el('div', { class: 'pequeno texto-mudo', text: p.sku || '' })]),
        el('td', { class: 'pequeno', text: p.category_name || '—' }),
        el('td', { class: 'num pequeno', text: dinheiro(p.cost_price) }),
        el('td', { class: 'num negrito', text: dinheiro(p.sale_price) }),
        el('td', { class: 'num' }, el('span', {
          class: `tag ${p.margem >= 35 ? 'tag-verde' : p.margem >= 20 ? 'tag-amarelo' : 'tag-vermelho'}`, text: percentual(p.margem)
        })),
        el('td', { class: 'num', text: `${numero(p.estoque)} ${p.unit}` }),
        el('td', { class: 'num pequeno', text: numero(p.min_stock) }),
        el('td', {}, [
          p.active ? el('span', { class: 'tag tag-verde', text: 'Ativo' }) : el('span', { class: 'tag tag-cinza', text: 'Inativo' }),
          p.in_catalog ? el('span', { class: 'tag tag-azul', style: { marginLeft: '4px' }, text: 'Catálogo' }) : null
        ]),
        el('td', { class: 'num' }, el('button', { class: 'btn btn-sm btn-vazio', onclick: () => formulario(p) }, 'Editar'))
      ])))
    ]))));
  }

  function novaCategoria() {
    const nome = el('input', { type: 'text', placeholder: 'Ex.: Ferramentas' });
    modal({
      titulo: 'Nova categoria',
      corpo: el('div', { class: 'campo' }, [el('label', { text: 'Nome da categoria' }), nome]),
      acoes: [{ rotulo: 'Salvar', class: 'btn-primario', acao: async (fechar) => {
        if (!nome.value.trim()) { erro('Informe o nome'); return; }
        try { await api.post('/api/categorias', { name: nome.value }); sucesso('Categoria criada'); fechar(); location.reload(); }
        catch (e) { erro(e.message); }
      } }]
    });
  }

  function formulario(produto = null) {
    const campos = {
      name: el('input', { type: 'text', value: produto?.name || '' }),
      sku: el('input', { type: 'text', value: produto?.sku || '', placeholder: 'Código interno' }),
      unit: el('input', { type: 'text', value: produto?.unit || 'UN', maxlength: '6' }),
      cost_price: el('input', { type: 'number', step: '0.01', min: '0', value: produto?.cost_price ?? 0 }),
      sale_price: el('input', { type: 'number', step: '0.01', min: '0', value: produto?.sale_price ?? 0 }),
      min_stock: el('input', { type: 'number', step: '1', min: '0', value: produto?.min_stock ?? 0 }),
      description: el('textarea', { placeholder: 'Descrição usada no catálogo online' })
    };
    campos.description.value = produto?.description || '';
    const categoria = el('select', {}, [
      el('option', { value: '', text: 'Sem categoria' }),
      ...categorias.map(c => el('option', { value: c.id, selected: produto?.category_id === c.id, text: c.name }))
    ]);
    const noCatalogo = el('input', { type: 'checkbox', checked: produto ? !!produto.in_catalog : true });
    const ativo = el('input', { type: 'checkbox', checked: produto ? !!produto.active : true });
    const margemInfo = el('div', { class: 'aviso aviso-azul' });
    let imagem = produto?.image_url || null;
    const previa = el('img', { class: 'upload-previa', hidden: !imagem, src: imagem || '' });
    const arquivo = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    arquivo.addEventListener('change', async () => {
      if (!arquivo.files[0]) return;
      try { imagem = await lerImagemReduzida(arquivo.files[0], 900, 0.8); previa.src = imagem; previa.hidden = false; }
      catch (e) { erro(e.message); }
    });

    function atualizarMargem() {
      const custo = Number(campos.cost_price.value) || 0;
      const venda = Number(campos.sale_price.value) || 0;
      const lucro = venda - custo;
      const margem = venda ? lucro / venda * 100 : 0;
      const markup = custo ? lucro / custo * 100 : 0;
      margemInfo.textContent = `Lucro por unidade: ${dinheiro(lucro)} · Margem: ${percentual(margem)} · Markup sobre o custo: ${percentual(markup)}`;
    }
    campos.cost_price.addEventListener('input', atualizarMargem);
    campos.sale_price.addEventListener('input', atualizarMargem);
    atualizarMargem();

    modal({
      titulo: produto ? 'Editar produto' : 'Novo produto', largo: true,
      corpo: el('div', {}, [
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo', style: { flex: '3' } }, [el('label', { text: 'Nome *' }), campos.name]),
          el('div', { class: 'campo' }, [el('label', { text: 'Código (SKU)' }), campos.sku]),
          el('div', { class: 'campo', style: { flex: '.5' } }, [el('label', { text: 'Unidade' }), campos.unit])
        ]),
        el('div', { class: 'linha' }, [
          el('div', { class: 'campo' }, [el('label', {}, ['Custo (R$) ', el('span', { class: 'dica', text: '— só master' })]), campos.cost_price]),
          el('div', { class: 'campo' }, [el('label', {}, ['Preço de venda (R$) ', el('span', { class: 'dica', text: '— só master' })]), campos.sale_price]),
          el('div', { class: 'campo' }, [el('label', { text: 'Estoque mínimo' }), campos.min_stock])
        ]),
        margemInfo,
        el('div', { class: 'campo', style: { marginTop: '13px' } }, [el('label', { text: 'Categoria' }), categoria]),
        el('div', { class: 'campo' }, [el('label', { text: 'Descrição' }), campos.description]),
        el('div', { class: 'campo' }, [
          el('label', { text: 'Foto do produto (catálogo)' }),
          el('div', { class: 'upload-area', onclick: () => arquivo.click() }, '🖼️ Escolher imagem'),
          arquivo, previa
        ]),
        el('label', { class: 'check mb' }, [noCatalogo, el('span', { text: 'Exibir no catálogo online' })]),
        el('label', { class: 'check' }, [ativo, el('span', { text: 'Produto ativo (disponível para venda)' })])
      ]),
      acoes: [
        produto ? { rotulo: 'Excluir', class: 'btn-perigo', acao: async (fechar) => {
          if (!await confirmar(`Excluir "${produto.name}"? Se ele já foi vendido, será apenas desativado.`, { perigo: true })) return;
          try { await api.del(`/api/produtos/${produto.id}`); sucesso('Produto removido'); fechar(); carregar(); }
          catch (e) { erro(e.message); }
        } } : null,
        { rotulo: 'Salvar', class: 'btn-primario', acao: async (fechar) => {
          if (!campos.name.value.trim()) { erro('Informe o nome do produto'); return; }
          const dados = {
            ...Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v.value])),
            category_id: categoria.value || null, in_catalog: noCatalogo.checked, active: ativo.checked,
            image_data: imagem && imagem.startsWith('data:') ? imagem : undefined,
            image_url: imagem && !imagem.startsWith('data:') ? imagem : undefined
          };
          try {
            if (produto) await api.put(`/api/produtos/${produto.id}`, dados);
            else await api.post('/api/produtos', dados);
            sucesso(produto ? 'Produto atualizado' : 'Produto cadastrado');
            fechar(); carregar();
          } catch (e) { erro(e.message); }
        } }
      ].filter(Boolean)
    });
  }

  carregar();
}
