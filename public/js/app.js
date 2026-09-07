/* ============================================================
   Loja das Argamassas — ERP
   Shell da aplicacao: sessao, menu, roteamento e estado global.
   ============================================================ */
import { api } from './api.js';
import { $, el, limpar, erro, sucesso, modal, toast, dataHora } from './ui.js';

export const estado = {
  usuario: null,
  lojas: [],
  lojaSelecionada: '',   // '' = todas as lojas permitidas
  config: null,
  produtos: [],          // cache do PDV
  naoLidas: 0
};

export const ehMaster = () => estado.usuario?.role === 'master';
export const lojasOperacionais = () => estado.lojas.filter(l => l.kind === 'loja');
export const fabricas = () => estado.lojas.filter(l => l.kind === 'fabrica');

/** Loja usada por padrao em lancamentos (PDV, despesas, caixa). */
export function lojaAtual() {
  if (estado.lojaSelecionada) {
    const l = estado.lojas.find(x => String(x.id) === String(estado.lojaSelecionada));
    if (l && l.kind === 'loja') return l;
  }
  if (!ehMaster()) return estado.lojas[0] || null;
  return lojasOperacionais()[0] || null;
}

/* ---------------- Menu ---------------- */
const MENU = [
  { grupo: 'Operação' },
  { rota: 'inicio',       rotulo: 'Início',        icone: '🏠' },
  { rota: 'pdv',          rotulo: 'PDV — Vender',  icone: '🧾' },
  { rota: 'vendas',       rotulo: 'Vendas',        icone: '📄' },
  { rota: 'clientes',     rotulo: 'Clientes',      icone: '👥' },
  { grupo: 'Estoque' },
  { rota: 'estoque',      rotulo: 'Estoque',       icone: '📦' },
  { rota: 'producao',     rotulo: 'Fábrica',       icone: '🏭', master: true },
  { rota: 'produtos',     rotulo: 'Produtos',      icone: '🏷️', master: true },
  { grupo: 'Financeiro' },
  { rota: 'caixa',        rotulo: 'Caixa',         icone: '💵' },
  { rota: 'despesas',     rotulo: 'Despesas',      icone: '📉' },
  { grupo: 'Inteligência' },
  { rota: 'estatisticas', rotulo: 'Estatísticas',  icone: '📊' },
  { rota: 'mapa',         rotulo: 'Mapa de vendas', icone: '🗺️' },
  { rota: 'ia',           rotulo: 'Relatório IA',  icone: '🤖' },
  { grupo: 'Relacionamento' },
  { rota: 'whatsapp',     rotulo: 'WhatsApp',      icone: '💬' },
  { rota: 'catalogo',     rotulo: 'Catálogo',      icone: '🛒' },
  { grupo: 'Sistema' },
  { rota: 'config',       rotulo: 'Configurações', icone: '⚙️', master: true }
];

const VIEWS = {
  inicio:       () => import('./views/inicio.js'),
  pdv:          () => import('./views/pdv.js'),
  vendas:       () => import('./views/vendas.js'),
  clientes:     () => import('./views/clientes.js'),
  estoque:      () => import('./views/estoque.js'),
  producao:     () => import('./views/producao.js'),
  produtos:     () => import('./views/produtos.js'),
  caixa:        () => import('./views/caixa.js'),
  despesas:     () => import('./views/despesas.js'),
  estatisticas: () => import('./views/estatisticas.js'),
  mapa:         () => import('./views/mapa.js'),
  ia:           () => import('./views/ia.js'),
  whatsapp:     () => import('./views/whatsapp.js'),
  catalogo:     () => import('./views/catalogo.js'),
  config:       () => import('./views/config.js')
};

function montarMenu() {
  const nav = limpar($('#nav'));
  for (const item of MENU) {
    if (item.grupo) { nav.appendChild(el('div', { class: 'nav-grupo', text: item.grupo })); continue; }
    if (item.master && !ehMaster()) continue;
    nav.appendChild(el('a', { href: `#/${item.rota}`, dataset: { rota: item.rota } }, [
      el('span', { class: 'ico', text: item.icone }),
      el('span', { text: item.rotulo }),
      item.rota === 'inicio' ? el('span', { class: 'selo', id: 'selo-alertas', hidden: true }) : null
    ]));
  }
  marcarAtivo(rotaAtual());
}

const marcarAtivo = (rota) => {
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('ativo', a.dataset.rota === rota));
  const item = MENU.find(m => m.rota === rota);
  if (item) $('#titulo-pagina').textContent = item.rotulo;
};

const rotaAtual = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'inicio');

/* ---------------- Seletor de loja ---------------- */
function montarSeletorLoja() {
  const sel = $('#seletor-loja');
  limpar(sel);
  if (ehMaster() && estado.lojas.length > 1) {
    sel.hidden = false;
    sel.appendChild(el('option', { value: '', text: '🏢 Todas as unidades' }));
    for (const l of estado.lojas) {
      sel.appendChild(el('option', { value: l.id, text: `${l.kind === 'fabrica' ? '🏭' : '🏬'} ${l.name}` }));
    }
    sel.value = estado.lojaSelecionada;
    sel.onchange = () => {
      estado.lojaSelecionada = sel.value;
      localStorage.setItem('erp_loja', sel.value);
      navegar(rotaAtual(), true);
    };
  } else {
    sel.hidden = true;
  }
}

/* ---------------- Roteamento ---------------- */
let viewAtiva = null;

export async function navegar(rota = rotaAtual(), forcar = false) {
  const item = MENU.find(m => m.rota === rota);
  if (!item || (item.master && !ehMaster()) || !VIEWS[rota]) {
    if (rota !== 'inicio') { location.hash = '#/inicio'; return; }
  }
  marcarAtivo(rota);
  $('#sidebar').classList.remove('aberta');
  const alvo = limpar($('#pagina'));
  alvo.appendChild(el('div', { class: 'vazio', text: 'Carregando…' }));

  try {
    viewAtiva?.destruir?.();
    const mod = await VIEWS[rota]();
    limpar(alvo);
    viewAtiva = await mod.render(alvo) || null;
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    limpar(alvo).appendChild(el('div', { class: 'aviso aviso-vermelho', text: `Não foi possível abrir esta tela: ${e.message}` }));
  }
}

/* ---------------- Notificacoes ---------------- */
export async function atualizarNotificacoes() {
  try {
    const { notificacoes, nao_lidas } = await api.get('/api/notificacoes');
    estado.naoLidas = nao_lidas;
    const badge = $('#badge-notif');
    badge.hidden = !nao_lidas;
    badge.textContent = nao_lidas > 99 ? '99+' : nao_lidas;
    const selo = $('#selo-alertas');
    if (selo) { selo.hidden = !nao_lidas; selo.textContent = nao_lidas; }
    return notificacoes;
  } catch { return []; }
}

async function abrirNotificacoes() {
  const notificacoes = await atualizarNotificacoes();
  const lista = notificacoes.length
    ? el('div', { class: 'rolagem' }, notificacoes.map(n => el('div', {
        class: 'insight ' + (n.kind === 'estoque_minimo' ? 'alerta' : n.kind === 'caixa_alto' ? 'oportunidade' : 'destaque'),
        style: n.read_at ? { opacity: '.55' } : {}
      }, [
        el('div', { class: 'marca-tipo' }),
        el('div', { style: { flex: '1' } }, [
          el('h4', { text: n.title }),
          el('p', { text: n.body || '' }),
          el('div', { class: 'pequeno texto-mudo', text: `${n.store_name || 'Geral'} · ${dataHora(n.created_at)}` })
        ])
      ])))
    : el('div', { class: 'vazio', text: 'Nenhuma notificação por enquanto.' });

  modal({
    titulo: 'Notificações', largo: true, corpo: lista,
    acoes: [
      { rotulo: 'Marcar todas como lidas', class: 'btn-vazio', acao: async (f) => { await api.post('/api/notificacoes/ler'); await atualizarNotificacoes(); f(); } },
      { rotulo: 'Fechar', class: 'btn-primario', acao: (f) => f() }
    ]
  });
}

/* ---------------- Perfil ---------------- */
function abrirPerfil() {
  const u = estado.usuario;
  const nome = el('input', { type: 'text', value: u.name });
  const telefone = el('input', { type: 'tel', value: u.phone || '', placeholder: '(81) 90000-0000' });
  const notif = el('input', { type: 'checkbox', checked: !!u.notify_low_stock });
  const atual = el('input', { type: 'password', autocomplete: 'current-password' });
  const nova = el('input', { type: 'password', autocomplete: 'new-password' });

  modal({
    titulo: 'Minha conta',
    corpo: el('div', {}, [
      el('div', { class: 'aviso aviso-azul mb', html:
        `<div><b>${u.name}</b><br>${u.email}<br>Perfil: <b>${u.role === 'master' ? 'Master (todas as lojas)' : u.role}</b>${u.store_name ? ` · ${u.store_name}` : ''}</div>` }),
      el('div', { class: 'campo' }, [el('label', { text: 'Nome' }), nome]),
      el('div', { class: 'campo' }, [el('label', { text: 'Telefone' }), telefone]),
      el('label', { class: 'check mb' }, [notif, el('span', { text: 'Receber avisos de estoque mínimo' })]),
      el('hr', { style: { border: 'none', borderTop: '1px solid var(--cinza-200)', margin: '16px 0' } }),
      el('h4', { text: 'Trocar senha', style: { marginBottom: '10px' } }),
      el('div', { class: 'campo' }, [el('label', { text: 'Senha atual' }), atual]),
      el('div', { class: 'campo' }, [el('label', { text: 'Nova senha (mínimo 6 caracteres)' }), nova])
    ]),
    acoes: [
      { rotulo: 'Sair do sistema', class: 'btn-perigo', acao: async () => { await api.post('/api/auth/logout'); location.reload(); } },
      { rotulo: 'Salvar', class: 'btn-primario', acao: async (fechar) => {
          try {
            await api.put('/api/perfil', { name: nome.value, phone: telefone.value, notify_low_stock: notif.checked });
            if (nova.value) await api.post('/api/auth/change-password', { atual: atual.value, nova: nova.value });
            sucesso('Dados atualizados');
            await carregarSessao();
            fechar();
          } catch (e) { erro(e.message); }
        } }
    ]
  });
}

/* ---------------- Sessao ---------------- */
async function carregarSessao() {
  const { user, stores } = await api.get('/api/auth/me');
  estado.usuario = user;
  estado.lojas = stores;
  const salva = localStorage.getItem('erp_loja') || '';
  estado.lojaSelecionada = stores.some(s => String(s.id) === salva) ? salva : '';
  $('#perfil-loja').textContent = user.role === 'master' ? 'Acesso master' : (user.store_name || 'Loja');
  try { estado.config = await api.get('/api/config'); } catch { estado.config = null; }
}

async function entrarNaApp() {
  $('#tela-login').hidden = true;
  $('#app').hidden = false;
  montarMenu();
  montarSeletorLoja();
  await navegar(rotaAtual());
  atualizarNotificacoes();
  setInterval(atualizarNotificacoes, 120000);
}

function mostrarLogin() {
  $('#app').hidden = true;
  $('#tela-login').hidden = false;
  $('#login-email').focus();
}

/* ---------------- Inicializacao ---------------- */
$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-entrar'), aviso = $('#login-erro');
  btn.disabled = true; btn.textContent = 'Entrando…'; aviso.hidden = true;
  try {
    await api.post('/api/auth/login', { email: $('#login-email').value.trim(), password: $('#login-senha').value });
    await carregarSessao();
    await entrarNaApp();
  } catch (err) {
    aviso.textContent = err.message; aviso.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
});

$('#btn-menu').addEventListener('click', () => $('#sidebar').classList.toggle('aberta'));
$('#btn-perfil').addEventListener('click', abrirPerfil);
$('#btn-notificacoes').addEventListener('click', abrirNotificacoes);
window.addEventListener('hashchange', () => navegar());
document.addEventListener('sessao-expirada', () => { toast('Sessão expirada. Faça login novamente.', 'erro'); setTimeout(() => location.reload(), 1200); });

(async function iniciar() {
  try {
    await carregarSessao();
    await entrarNaApp();
  } catch {
    mostrarLogin();
  }
})();
