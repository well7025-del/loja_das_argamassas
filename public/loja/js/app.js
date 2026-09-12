/* ============================================================
   Loja das Argamassas — Caruaru
   Aplicativo de celular. Os dados ficam no próprio aparelho (IndexedDB),
   funciona sem internet e o backup vai para o Google Drive.
   ============================================================ */
import { $, el, limpar, erro, aviso, painel, dinheiro } from './ui.js';
import { config, definirConfig, listar, salvar } from './db.js';
import { backupAutomatico, statusBackup } from './backup.js';

export const estado = { loja: null, pendencias: [] };

/* ---------------- Rotas ---------------- */
const ROTAS = {
  inicio:    { titulo: 'Início',        carregar: () => import('./views/inicio.js') },
  pdv:       { titulo: 'Nova venda',    carregar: () => import('./views/pdv.js') },
  estoque:   { titulo: 'Estoque',       carregar: () => import('./views/estoque.js') },
  contas:    { titulo: 'Contas',        carregar: () => import('./views/contas.js') },
  mais:      { titulo: 'Mais',          carregar: () => import('./views/mais.js') },
  vendas:    { titulo: 'Vendas',        carregar: () => import('./views/vendas.js') },
  clientes:  { titulo: 'Clientes',      carregar: () => import('./views/clientes.js') },
  despesas:  { titulo: 'Despesas',      carregar: () => import('./views/despesas.js') },
  relatorio: { titulo: 'Resultado',     carregar: () => import('./views/relatorio.js') },
  ajustes:   { titulo: 'Ajustes',       carregar: () => import('./views/ajustes.js') }
};
const ABAS = ['inicio', 'pdv', 'estoque', 'contas', 'mais'];
const rotaAtual = () => location.hash.replace(/^#\/?/, '').split('?')[0] || 'inicio';

let viewAtiva = null;

export async function navegar(rota = rotaAtual()) {
  const destino = ROTAS[rota] ? rota : 'inicio';
  $('#titulo').textContent = ROTAS[destino].titulo;
  document.querySelectorAll('.rodape a').forEach(a =>
    a.classList.toggle('ativo', a.dataset.rota === destino ||
      (a.dataset.rota === 'mais' && !ABAS.includes(destino))));

  const tela = limpar($('#tela'));
  tela.appendChild(el('div', { class: 'vazio', text: 'Carregando…' }));
  try {
    viewAtiva?.destruir?.();
    const mod = await ROTAS[destino].carregar();
    limpar(tela);
    viewAtiva = await mod.render(tela) || null;
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    limpar(tela).appendChild(el('div', { class: 'aviso aviso-vermelho', text: `Não consegui abrir esta tela: ${e.message}` }));
  }
}

export const voltarPara = (rota) => { location.hash = `#/${rota}`; };

/* ---------------- Avisos da loja ---------------- */
export async function recalcularPendencias() {
  const pendencias = [];

  const produtos = await listar('produtos');
  const baixos = produtos.filter(p => p.ativo !== false && p.estoqueMin > 0 && p.estoque <= p.estoqueMin);
  if (baixos.length) {
    pendencias.push({
      tipo: 'estoque',
      titulo: `${baixos.length} produto(s) no estoque mínimo`,
      texto: baixos.slice(0, 4).map(p => `${p.nome}: ${p.estoque} ${p.unidade}`).join(' · '),
      rota: 'estoque'
    });
  }

  const backup = await statusBackup();
  if (backup.atrasado) {
    pendencias.push({
      tipo: 'backup',
      titulo: backup.ultimo ? `Backup atrasado (${backup.diasDesde} dia(s))` : 'Você ainda não fez backup',
      texto: 'Salve uma cópia no Google Drive para não perder nada se o celular quebrar.',
      rota: 'ajustes'
    });
  }

  estado.pendencias = pendencias;
  const selo = $('#conta-avisos');
  selo.hidden = !pendencias.length;
  selo.textContent = pendencias.length ? ` ${pendencias.length}` : '';
  return pendencias;
}

function abrirAvisos() {
  const lista = estado.pendencias.length
    ? el('div', {}, estado.pendencias.map(p => el('button', {
        class: 'item', style: { borderRadius: '12px', marginBottom: '8px', border: '1px solid var(--cinza-200)' },
        onclick: () => { location.hash = `#/${p.rota}`; document.querySelector('.fundo-painel')?.remove(); }
      }, [
        el('div', { class: 'info' }, [
          el('div', { class: 'titulo', text: p.titulo }),
          el('div', { class: 'sub', text: p.texto })
        ]),
        el('span', { class: 'mudo', text: '›' })
      ])))
    : el('div', { class: 'aviso aviso-verde', text: '✅ Tudo em ordem: estoque abastecido e backup em dia.' });
  painel({ titulo: 'Avisos', corpo: lista });
}

/* ---------------- Trava por senha ---------------- */
const digerir = async (texto) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`argamassas:${texto}`));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
};
export const guardarSenha = async (senha) => definirConfig('senhaApp', senha ? await digerir(senha) : null);

function pedirSenha(hash) {
  return new Promise((resolve) => {
    const entrada = el('input', {
      type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '12',
      placeholder: '••••', style: { fontSize: '24px', textAlign: 'center', letterSpacing: '.3em' }
    });
    const recado = el('div', { class: 'pq', style: { color: 'var(--vermelho-600)', minHeight: '18px' } });
    const conferir = async () => {
      if (await digerir(entrada.value) === hash) { fundo.remove(); resolve(); }
      else { recado.textContent = 'Senha incorreta'; entrada.value = ''; entrada.focus(); }
    };
    const fundo = el('div', { class: 'fundo-painel', style: { alignItems: 'center', justifyContent: 'center', padding: '20px' } }, [
      el('div', { class: 'painel', style: { maxWidth: '340px', borderRadius: '18px' } }, [
        el('div', { class: 'painel-corpo', style: { textAlign: 'center' } }, [
          el('div', { class: 'marca-icone', style: { margin: '0 auto 14px', width: '52px', height: '52px', fontSize: '20px' } }, 'LA'),
          el('h3', { text: 'Loja Caruaru', style: { marginBottom: '4px' } }),
          el('p', { class: 'pq mudo', text: 'Digite a senha para abrir o aplicativo.' }),
          entrada, recado,
          el('button', { class: 'btn btn-primario btn-bloco mt', onclick: conferir }, 'Entrar')
        ])
      ])
    ]);
    entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') conferir(); });
    document.body.appendChild(fundo);
    setTimeout(() => entrada.focus(), 100);
  });
}

/* ---------------- Primeira abertura ---------------- */
const PRODUTOS_INICIAIS = [
  ['Argamassa Colante AC-I 20kg', 'SC', 12.40, 19.90, 60, 'Argamassas'],
  ['Argamassa Colante AC-II 20kg', 'SC', 15.80, 24.90, 60, 'Argamassas'],
  ['Argamassa Colante AC-III 20kg', 'SC', 22.50, 34.90, 40, 'Argamassas'],
  ['Argamassa para Porcelanato 20kg', 'SC', 24.90, 38.90, 40, 'Argamassas'],
  ['Argamassa de Assentamento 20kg', 'SC', 10.20, 16.90, 50, 'Argamassas'],
  ['Argamassa de Reboco 20kg', 'SC', 9.80, 15.90, 50, 'Argamassas'],
  ['Argamassa Contrapiso 20kg', 'SC', 11.60, 18.50, 40, 'Argamassas'],
  ['Rejunte Acrílico Branco 1kg', 'UN', 3.90, 7.50, 80, 'Rejuntes'],
  ['Rejunte Acrílico Cinza 1kg', 'UN', 3.90, 7.50, 80, 'Rejuntes'],
  ['Rejunte Flexível 5kg', 'UN', 17.40, 27.90, 30, 'Rejuntes'],
  ['Cimento CP-II 50kg', 'SC', 33.50, 42.90, 40, 'Cimento e Cal'],
  ['Cal Hidratada 20kg', 'SC', 9.30, 14.90, 40, 'Cimento e Cal'],
  ['Gesso Cola 40kg', 'SC', 18.00, 28.90, 25, 'Gesso e Massas'],
  ['Massa Corrida 25kg', 'BD', 42.00, 64.90, 20, 'Gesso e Massas'],
  ['Impermeabilizante Manta Líquida 18L', 'BD', 98.00, 149.90, 12, 'Impermeabilizantes'],
  ['Aditivo Impermeabilizante 3,6L', 'UN', 21.50, 34.90, 20, 'Impermeabilizantes'],
  ['Desempenadeira Dentada 8mm', 'UN', 11.00, 21.90, 15, 'Acessórios'],
  ['Espaçador Cruzeta 2mm (pct 100)', 'UN', 4.20, 9.90, 30, 'Acessórios']
];

export async function carregarProdutosIniciais() {
  for (const [nome, unidade, custo, preco, estoqueMin, categoria] of PRODUTOS_INICIAIS) {
    await salvar('produtos', { nome, unidade, custo, preco, estoqueMin, categoria, estoque: 0, ativo: true });
  }
  return PRODUTOS_INICIAIS.length;
}

function boasVindas() {
  return new Promise((resolve) => {
    const nome = el('input', { type: 'text', value: 'Loja das Argamassas — Caruaru' });
    const telefone = el('input', { type: 'tel', placeholder: '(81) 90000-0000' });
    const comLista = el('input', { type: 'checkbox', checked: true });

    painel({
      titulo: 'Bem-vindo!',
      corpo: el('div', {}, [
        el('div', { class: 'aviso aviso-azul' },
          'Este aplicativo guarda tudo no próprio celular e funciona sem internet. Vamos configurar em 30 segundos.'),
        el('div', { class: 'campo' }, [el('label', { text: 'Nome que aparece no comprovante' }), nome]),
        el('div', { class: 'campo' }, [el('label', { text: 'WhatsApp da loja' }), telefone]),
        el('label', { class: 'check' }, [comLista, el('span', { text: 'Já cadastrar a lista de produtos da loja (você ajusta preços depois)' })]),
        el('div', { class: 'aviso aviso-amarelo mt' },
          '⚠️ Configure o backup logo no primeiro dia, em Mais › Ajustes. Sem backup, perder o celular é perder os dados.')
      ]),
      acoes: [{
        rotulo: 'Começar', class: 'btn-primario', acao: async (fechar) => {
          await definirConfig('loja', { nome: nome.value.trim() || 'Loja Caruaru', telefone: telefone.value.trim() });
          await definirConfig('intervaloBackup', 1);
          if (comLista.checked) await carregarProdutosIniciais();
          await definirConfig('configurado', true);
          fechar(); resolve();
        }
      }]
    });
  });
}

/* ---------------- Início ---------------- */
async function iniciar() {
  // No navegador o service worker é o que faz o app abrir sem internet.
  // Dentro do APK os arquivos já são locais: registrar só criaria cache velho
  // depois de uma atualização do aplicativo.
  if ('serviceWorker' in navigator) {
    if (window.AndroidApp?.dentroDoApp?.()) {
      navigator.serviceWorker.getRegistrations()
        .then(lista => lista.forEach(r => r.unregister()))
        .catch(() => {});
    } else {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  const senha = await config('senhaApp');
  if (senha) await pedirSenha(senha);

  if (!(await config('configurado'))) await boasVindas();
  estado.loja = await config('loja', { nome: 'Loja Caruaru', telefone: '' });

  await navegar();
  await recalcularPendencias();

  // Backup automático assim que houver internet, sem travar a abertura do app
  setTimeout(async () => {
    // o backup no próprio aparelho não depende de conexão; o envio ao Drive sim
    if (!navigator.onLine && !window.AndroidApp?.dentroDoApp?.()) return;
    const r = await backupAutomatico();
    if (r.feito) {
      aviso(r.destino === 'drive' ? 'Backup enviado para o Google Drive' : 'Backup salvo no aparelho', 'ok');
      recalcularPendencias();
    } else if (r.motivo === 'erro') {
      console.warn('Backup automático:', r.erro);
    }
  }, 2500);
}

window.addEventListener('hashchange', () => navegar());
$('#btn-sino').addEventListener('click', abrirAvisos);
window.addEventListener('online', () => backupAutomatico().then(r => {
  if (r.feito) { aviso('Backup enviado para o Google Drive', 'ok'); recalcularPendencias(); }
}));

iniciar().catch(e => {
  console.error(e);
  limpar($('#tela')).appendChild(el('div', { class: 'aviso aviso-vermelho', text: `Não consegui iniciar o aplicativo: ${e.message}` }));
});
