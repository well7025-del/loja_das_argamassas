/* Catalogo online: links prontos para o vendedor compartilhar com o cliente. */
import { api } from '../api.js';
import { estado } from '../app.js';
import { el, limpar, dinheiro, numero, copiar, abrirWhatsApp, vazio } from '../ui.js';

export async function render(raiz) {
  const { empresa, lojas } = await api.get('/api/catalogo/lojas');
  const base = location.origin;
  const corpo = el('div');

  raiz.append(
    el('div', { class: 'aviso aviso-azul mb' },
      'O catálogo é público: qualquer pessoa com o link vê os produtos e os preços de venda (o custo nunca aparece). Compartilhe com seus clientes por WhatsApp, Instagram ou onde preferir.'),
    el('div', { class: 'grid g2 mb' }, [
      cartaoLink({ titulo: '🌐 Catálogo geral', descricao: 'Todos os produtos, sem indicar disponibilidade por loja.', url: `${base}/catalogo` }),
      ...lojas.map(l => cartaoLink({
        titulo: `🏬 Catálogo da ${l.name}`,
        descricao: `Mostra o que está disponível em ${l.city || l.name} agora.`,
        url: `${base}/catalogo?loja=${l.code}`
      }))
    ]),
    corpo
  );

  function cartaoLink({ titulo, descricao, url }) {
    const mensagem = `Confira o catálogo da ${empresa?.nome || 'Loja das Argamassas'} 👇\n${url}`;
    return el('div', { class: 'card' }, [
      el('div', { class: 'card-cab' }, [el('h3', { text: titulo })]),
      el('div', { class: 'card-corpo' }, [
        el('p', { class: 'pequeno texto-mudo', style: { marginTop: '0' }, text: descricao }),
        el('input', { type: 'text', value: url, readonly: true, onclick: (e) => e.target.select() }),
        el('div', { class: 'flex quebra mt' }, [
          el('button', { class: 'btn btn-ok', onclick: () => abrirWhatsApp(null, mensagem) }, '💬 Compartilhar no WhatsApp'),
          el('button', { class: 'btn btn-vazio', onclick: () => copiar(url) }, '📋 Copiar link'),
          el('a', { class: 'btn btn-vazio', href: url, target: '_blank' }, '👁️ Abrir')
        ])
      ])
    ]);
  }

  const { produtos } = await api.get('/api/produtos');
  const noCatalogo = produtos.filter(p => p.in_catalog && p.active);
  limpar(corpo).appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'card-cab' }, [
      el('h3', { text: 'Produtos publicados no catálogo' }),
      el('div', { class: 'espaco' }),
      el('span', { class: 'tag tag-verde', text: `${noCatalogo.length} de ${produtos.length}` }),
      estado.usuario.role === 'master' ? el('a', { class: 'btn btn-sm btn-vazio', href: '#/produtos' }, 'Gerenciar produtos') : null
    ].filter(Boolean)),
    noCatalogo.length
      ? el('div', { class: 'tabela-wrap rolagem' }, el('table', {}, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: 'Produto' }), el('th', { text: 'Categoria' }),
            el('th', { class: 'num', text: 'Preço' }), el('th', { class: 'num', text: 'Estoque' })
          ])),
          el('tbody', {}, noCatalogo.map(p => el('tr', {}, [
            el('td', { class: 'negrito', text: p.name }),
            el('td', { class: 'pequeno texto-mudo', text: p.category_name || '—' }),
            el('td', { class: 'num negrito', text: dinheiro(p.sale_price) }),
            el('td', { class: 'num', text: `${numero(p.estoque)} ${p.unit}` })
          ])))
        ]))
      : vazio('Nenhum produto marcado para o catálogo', '🛒')
  ]));
}
