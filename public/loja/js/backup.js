/* ============================================================
   Backup dos dados do aplicativo.

   Dois caminhos, propositalmente:
   1. Arquivo — gera o backup e abre o menu de compartilhamento do Android
      (onde o Google Drive aparece) ou baixa o arquivo. Não exige configuração.
   2. Google Drive automático — envia direto para uma pasta no Drive da loja.
      Exige que o dono cadastre uma vez o "ID do cliente" do Google (ver ajuda).
   ============================================================ */
import { exportarTudo, importarTudo, config, definirConfig } from './db.js';

export const PASTA_DRIVE = 'Backups - Loja das Argamassas';
const ESCOPO = 'https://www.googleapis.com/auth/drive.file';
const MANTER_NO_DRIVE = 12;

/* ---------------- Arquivo ---------------- */

const carimbo = () => new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h');

export async function gerarBackup({ incluirFotos = true } = {}) {
  const conteudo = await exportarTudo({ incluirFotos });
  const texto = JSON.stringify(conteudo);
  return {
    nome: `backup-loja-caruaru-${carimbo()}.json`,
    blob: new Blob([texto], { type: 'application/json' }),
    tamanho: texto.length,
    registros: Object.values(conteudo.dados).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0)
  };
}

/** Abre o menu de compartilhamento do celular (Google Drive, e-mail, WhatsApp...). */
export async function compartilharArquivo({ nome, blob }) {
  const arquivo = new File([blob], nome, { type: 'application/json' });
  if (navigator.canShare?.({ files: [arquivo] })) {
    await navigator.share({ files: [arquivo], title: 'Backup da Loja das Argamassas' });
    return 'compartilhado';
  }
  baixarArquivo({ nome, blob });
  return 'baixado';
}

export function baixarArquivo({ nome, blob }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function lerArquivo(arquivo) {
  const texto = await arquivo.text();
  let conteudo;
  try { conteudo = JSON.parse(texto); } catch { throw new Error('Este arquivo não é um backup válido'); }
  if (!conteudo?.dados) throw new Error('Este arquivo não é um backup deste aplicativo');
  return conteudo;
}

export const restaurar = (conteudo, modo) => importarTudo(conteudo, modo);

/* ---------------- Google Drive ---------------- */

let clienteToken = null;
let token = null;          // { valor, expiraEm }

export const driveConfigurado = async () => Boolean(await config('googleClientId'));

function carregarBiblioteca() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existente = document.querySelector('script[data-gis]');
    if (existente) { existente.addEventListener('load', resolve); existente.addEventListener('error', reject); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true; s.dataset.gis = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Não foi possível falar com o Google. Verifique a conexão.'));
    document.head.appendChild(s);
  });
}

/**
 * Obtém a autorização do Google. Com `interativo = false` tenta renovar em
 * silêncio — é o que permite o backup automático não incomodar o vendedor.
 */
export async function autorizarDrive({ interativo = true } = {}) {
  if (token && token.expiraEm > Date.now() + 60000) return token.valor;

  const clientId = await config('googleClientId');
  if (!clientId) throw new Error('Google Drive ainda não configurado. Abra Ajustes › Backup.');
  await carregarBiblioteca();

  return new Promise((resolve, reject) => {
    clienteToken = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: ESCOPO,
      callback: (resposta) => {
        if (resposta.error) { reject(new Error(descreverErro(resposta.error))); return; }
        token = { valor: resposta.access_token, expiraEm: Date.now() + (resposta.expires_in || 3600) * 1000 };
        resolve(token.valor);
      },
      error_callback: (e) => reject(new Error(descreverErro(e?.type || 'popup_failed')))
    });
    clienteToken.requestAccessToken({ prompt: interativo ? 'consent' : '' });
  });
}

function descreverErro(codigo) {
  const mapa = {
    popup_closed: 'Você fechou a janela do Google antes de autorizar.',
    popup_failed_to_open: 'O navegador bloqueou a janela do Google. Libere os pop-ups para este site.',
    access_denied: 'A autorização foi negada na tela do Google.',
    popup_failed: 'Não foi possível abrir a janela de autorização do Google.'
  };
  return mapa[codigo] || `O Google recusou a autorização (${codigo}).`;
}

async function chamarDrive(url, opcoes = {}) {
  const acesso = await autorizarDrive({ interativo: false }).catch(() => autorizarDrive({ interativo: true }));
  const r = await fetch(url, {
    ...opcoes,
    headers: { Authorization: `Bearer ${acesso}`, ...(opcoes.headers || {}) }
  });
  if (r.status === 401) { token = null; throw new Error('A autorização do Google expirou. Toque novamente.'); }
  if (!r.ok) throw new Error(`O Google Drive recusou a operação (${r.status}). Tente de novo.`);
  return r;
}

/** Localiza (ou cria) a pasta de backups dentro do Drive da loja. */
async function pastaBackup() {
  const guardada = await config('googleFolderId');
  if (guardada) {
    const ok = await chamarDrive(`https://www.googleapis.com/drive/v3/files/${guardada}?fields=id,trashed`)
      .then(r => r.json()).then(f => f.id && !f.trashed).catch(() => false);
    if (ok) return guardada;
  }
  const consulta = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${PASTA_DRIVE}' and trashed=false`);
  const achada = await chamarDrive(`https://www.googleapis.com/drive/v3/files?q=${consulta}&fields=files(id)`)
    .then(r => r.json());
  let id = achada.files?.[0]?.id;
  if (!id) {
    const nova = await chamarDrive('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: PASTA_DRIVE, mimeType: 'application/vnd.google-apps.folder' })
    }).then(r => r.json());
    id = nova.id;
  }
  await definirConfig('googleFolderId', id);
  return id;
}

/** Envia o backup para o Google Drive e apaga os mais antigos. */
export async function enviarParaDrive({ nome, blob }) {
  const pasta = await pastaBackup();
  const limite = '-----argamassas' + Date.now();
  const metadados = JSON.stringify({ name: nome, parents: [pasta], mimeType: 'application/json' });
  const corpo = new Blob([
    `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadados}\r\n`,
    `--${limite}\r\nContent-Type: application/json\r\n\r\n`, blob, `\r\n--${limite}--\r\n`
  ]);

  const enviado = await chamarDrive(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,createdTime',
    { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${limite}` }, body: corpo }
  ).then(r => r.json());

  await limparAntigos(pasta);
  await definirConfig('ultimoBackup', { em: new Date().toISOString(), destino: 'drive', arquivo: enviado.name });
  return enviado;
}

async function limparAntigos(pasta) {
  const lista = await listarBackupsDrive(pasta);
  for (const arquivo of lista.slice(MANTER_NO_DRIVE)) {
    await chamarDrive(`https://www.googleapis.com/drive/v3/files/${arquivo.id}`, { method: 'DELETE' }).catch(() => {});
  }
}

export async function listarBackupsDrive(pasta = null) {
  const id = pasta || await pastaBackup();
  const consulta = encodeURIComponent(`'${id}' in parents and trashed=false`);
  const r = await chamarDrive(
    `https://www.googleapis.com/drive/v3/files?q=${consulta}&orderBy=createdTime desc&fields=files(id,name,size,createdTime)`
  ).then(r => r.json());
  return r.files || [];
}

export async function baixarDoDrive(fileId) {
  const r = await chamarDrive(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  const conteudo = await r.json();
  if (!conteudo?.dados) throw new Error('O arquivo do Drive não é um backup deste aplicativo');
  return conteudo;
}

/* ---------------- Rotina automática ---------------- */

export async function statusBackup() {
  const ultimo = await config('ultimoBackup');
  const intervalo = await config('intervaloBackup', 1);
  const diasDesde = ultimo ? Math.floor((Date.now() - new Date(ultimo.em)) / 864e5) : null;
  return {
    ultimo, intervalo, diasDesde,
    atrasado: intervalo > 0 && (diasDesde === null || diasDesde >= intervalo),
    driveAtivo: await driveConfigurado()
  };
}

/**
 * Executa o backup automático quando está na hora. Só envia sozinho se o Drive
 * estiver configurado; caso contrário devolve 'pendente' para o app avisar na tela.
 */
export async function backupAutomatico() {
  const status = await statusBackup();
  if (!status.atrasado) return { feito: false, motivo: 'em dia' };
  if (!status.driveAtivo) return { feito: false, motivo: 'pendente' };
  try {
    const arquivo = await gerarBackup({ incluirFotos: await config('backupComFotos', true) });
    await enviarParaDrive(arquivo);
    return { feito: true, arquivo: arquivo.nome };
  } catch (e) {
    return { feito: false, motivo: 'erro', erro: e.message };
  }
}

export async function registrarBackupLocal(nome) {
  await definirConfig('ultimoBackup', { em: new Date().toISOString(), destino: 'arquivo', arquivo: nome });
}
