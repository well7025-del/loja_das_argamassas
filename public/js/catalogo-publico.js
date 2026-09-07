/* Catalogo publico — pagina aberta, sem login, para o vendedor compartilhar. */
import { api } from './api.js';
import { el, $, limpar, dinheiro, numero, vazio, escapar } from './ui.js';

const params = new URLSearchParams(location.search);
let lojaCodigo = (params.get('loja') || '').toUpperCase();
let categoriaAtiva = '';
let dados = null;

async function carregar() {
  const conteudo = limpar($('#cat-conteudo'));
  conteudo.appendChild(el('div', { class: 'vazio', text: 'Carregando catálogo…' }));
  try {
    dados = await api.get('/api/catalogo', { loja: lojaCodigo || undefined, q: $('#cat-busca').value || undefined });
  } catch (e) {
    limpar(conteudo).appendChild(el('div', { class: 'aviso aviso-vermelho', text: e.message }));
    return;
  }
  desenharCabecalho();
  desenharCategorias();
  desenharProdutos();
}

function desenharCabecalho() {
  const e = dados.empresa || {};
  $('#cat-nome').firstChild.textContent = e.nome || 'Loja das Argamassas';
  $('#cat-slogan').textContent = e.slogan || '';
  $('#cat-loja').textContent = dados.loja
    ? `📍 ${dados.loja.name} — ${[dados.loja.address, dados.loja.city, dados.loja.uf].filter(Boolean).join(', ')}${dados.loja.phone ? ' · ' + dados.loja.phone : ''}`
    : `📍 ${e.endereco || 'Recife e Caruaru — PE'}${e.telefone ? ' · ' + e.telefone : ''}`;

  const seletor = limpar($('#cat-loja-sel'));
  seletor.appendChild(el('option', { value: '', text: 'Todas as lojas' }));
  for (const l of dados.lojas) {
    seletor.appendChild(el('option', { value: l.code, selected: l.code === lojaCodigo, text: l.name }));
  }
  seletor.onchange = () => {
    lojaCodigo = seletor.value;
    const url = new URL(location.href);
    if (lojaCodigo) url.searchParams.set('loja', lojaCodigo); else url.searchParams.delete('loja');
    history.replaceState(null, '', url);
    carregar();
  };

  const numeroWhats = (dados.loja?.phone || e.whatsapp || '').replace(/\D/g, '');
  const alvo = numeroWhats.length >= 12 ? numeroWhats : (numeroWhats.length >= 10 ? '55' + numeroWhats : '');
  $('#cat-whats').onclick = () => {
    const texto = `Olá! Vi o catálogo da ${e.nome || 'Loja das Argamassas'} e gostaria de fazer um orçamento.`;
    window.open(alvo ? `https://wa.me/${alvo}?text=${encodeURIComponent(texto)}` : `https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  };

  $('#cat-rodape').innerHTML =
    `<b>${escapar(e.nome || 'Loja das Argamassas')}</b> — ${escapar(e.endereco || '')} ${e.telefone ? '· ' + escapar(e.telefone) : ''}`;
}

function desenharCategorias() {
  const barra = limpar($('#cat-categorias'));
  const todas = ['', ...dados.categorias];
  for (const c of todas) {
    barra.appendChild(el('button', {
      class: `chip ${categoriaAtiva === c ? 'ativo' : ''}`, type: 'button',
      onclick: () => { categoriaAtiva = c; desenharCategorias(); desenharProdutos(); }
    }, c || 'Todos os produtos'));
  }
}

function desenharProdutos() {
  const conteudo = limpar($('#cat-conteudo'));
  const lista = dados.produtos.filter(p => !categoriaAtiva || (p.categoria || 'Outros') === categoriaAtiva);
  if (!lista.length) { conteudo.appendChild(vazio('Nenhum produto encontrado com esse filtro', '🔍')); return; }

  const porCategoria = new Map();
  for (const p of lista) {
    const c = p.categoria || 'Outros';
    if (!porCategoria.has(c)) porCategoria.set(c, []);
    porCategoria.get(c).push(p);
  }

  for (const [categoria, produtos] of porCategoria) {
    conteudo.appendChild(el('h3', { class: 'mb', style: { marginTop: '22px' }, text: categoria }));
    conteudo.appendChild(el('div', { class: 'cat-grade mb' }, produtos.map(p => el('div', { class: 'cat-item' }, [
      el('div', { class: 'foto' }, p.image_url ? el('img', { src: p.image_url, alt: p.name, loading: 'lazy' }) : el('span', { text: '🧱' })),
      el('div', { class: 'corpo' }, [
        el('div', { class: 'negrito', text: p.name }),
        p.description ? el('div', { class: 'pequeno texto-mudo', text: p.description }) : null,
        dados.loja
          ? el('span', { class: `tag ${p.disponivel ? 'tag-verde' : 'tag-cinza'}`, style: { alignSelf: 'flex-start' },
                         text: p.disponivel ? `Disponível (${numero(p.estoque)} ${p.unit})` : 'Sob encomenda' })
          : null,
        el('div', { class: 'preco', text: dinheiro(p.sale_price) }),
        el('div', { class: 'pequeno texto-mudo', text: `por ${p.unit}` })
      ])
    ]))));
  }
}

let debounce;
$('#cat-busca').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(carregar, 300); });
carregar();
