/* ============================================================
   Impressão do comprovante em impressora térmica Bluetooth.

   O WebView não fala Bluetooth, então quem imprime é o lado Android
   (PonteImpressora). Aqui montamos o texto do cupom já formatado na
   largura do papel — 32 colunas para bobina de 58mm, 48 para 80mm.
   ============================================================ */
import { config, definirConfig } from './db.js';

const ponte = () => window.AndroidImpressora;

export const impressoraDisponivel = () => {
  const p = ponte();
  if (!p) return false;
  try { return p.disponivel(); } catch { return false; }
};

/** Impressoras já pareadas no Android. Parear é feito nas configurações do celular. */
export function listarImpressoras() {
  const p = ponte();
  if (!p) return [];
  try { return JSON.parse(p.listar() || '[]'); } catch { return []; }
}

export const impressoraEscolhida = () => config('impressora', null);
export const escolherImpressora = (dispositivo) => definirConfig('impressora', dispositivo);

/* ---------------- Formatação do cupom ---------------- */

const repetir = (c, n) => c.repeat(Math.max(0, n));

/**
 * Troca travessão, aspas curvas e reticências por equivalentes ASCII.
 * Nenhuma tabela de impressora térmica tem esses caracteres: sem isso o
 * cupom sai com "?" no meio e a conta de largura das linhas erra.
 */
const asciiSeguro = (texto) => String(texto ?? '')
  .replace(/[\u2012-\u2015\u2212]/g, '-')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/\u2026/g, '...')
  .replace(/\u00a0/g, ' ');
const centro = (texto, largura) => {
  const t = asciiSeguro(texto).slice(0, largura);
  return repetir(' ', Math.floor((largura - t.length) / 2)) + t;
};
/** Texto à esquerda e valor à direita, preenchendo o meio com espaço. */
const doisLados = (esquerda, direita, largura) => {
  const e = asciiSeguro(esquerda), d = asciiSeguro(direita);
  const espaco = largura - e.length - d.length;
  return espaco >= 1 ? e + repetir(' ', espaco) + d : (e.slice(0, largura - d.length - 1) + ' ' + d);
};
/** Quebra o nome do produto em várias linhas sem cortar palavra no meio. */
function quebrar(texto, largura) {
  const palavras = asciiSeguro(texto).split(/\s+/);
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    if (!atual) atual = p;
    else if ((atual + ' ' + p).length <= largura) atual += ' ' + p;
    else { linhas.push(atual); atual = p; }
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [''];
}

const reais = (v) => Number(v || 0).toFixed(2).replace('.', ',');
const qtdTexto = (q) => (Number(q) % 1 === 0 ? String(Number(q)) : Number(q).toFixed(2).replace('.', ','));

const NOMES_PAGAMENTO = {
  dinheiro: 'DINHEIRO', pix: 'PIX', debito: 'CARTAO DE DEBITO',
  credito: 'CARTAO DE CREDITO', boleto: 'BOLETO', prazo: 'A PRAZO'
};

/**
 * Monta o texto do cupom. Devolve string pronta para a impressora.
 * `venda` é o registro salvo no banco; `loja` vem da configuração.
 */
export function montarCupom(venda, loja = {}, largura = 32) {
  const traco = repetir('-', largura);
  const linhas = [];

  linhas.push(centro((loja.nome || 'LOJA DAS ARGAMASSAS').toUpperCase(), largura));
  if (loja.telefone) linhas.push(centro(loja.telefone, largura));
  linhas.push(traco);
  linhas.push(centro('CUPOM NAO FISCAL', largura));
  linhas.push('');
  linhas.push(doisLados('Venda:', venda.codigo, largura));
  linhas.push(doisLados('Data:', new Date(venda.data).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
  }), largura));
  if (venda.clienteNome) {
    for (const l of quebrar(`Cliente: ${venda.clienteNome}`, largura)) linhas.push(l);
  }
  linhas.push(traco);

  for (const item of venda.itens) {
    for (const l of quebrar(item.nome, largura)) linhas.push(l);
    const calculo = `  ${qtdTexto(item.qtd)} x ${reais(item.preco)}`;
    linhas.push(doisLados(calculo, reais(item.total), largura));
  }

  linhas.push(traco);
  if (venda.desconto > 0) {
    linhas.push(doisLados('Subtotal', reais(venda.subtotal), largura));
    linhas.push(doisLados('Desconto', '-' + reais(venda.desconto), largura));
  }
  linhas.push(doisLados('TOTAL', 'R$ ' + reais(venda.total), largura));
  linhas.push(doisLados('Pagamento', NOMES_PAGAMENTO[venda.pagamento] || venda.pagamento.toUpperCase(), largura));
  if (venda.observacao) {
    linhas.push('');
    for (const l of quebrar('Obs: ' + venda.observacao, largura)) linhas.push(l);
  }

  linhas.push(traco);
  linhas.push(centro('Obrigado pela preferencia!', largura));
  if (loja.telefone) linhas.push(centro('Pedidos pelo WhatsApp', largura));
  linhas.push('');

  return linhas.join('\n');
}

/* ---------------- Envio ---------------- */

// A impressão roda fora da thread do JavaScript (conectar leva segundos),
// então o Android devolve o resultado por callback. Cada envio tem um id.
const pendentes = new Map();
window.__impressoraAndroid = {
  resultado: (id, ok, mensagem) => {
    const espera = pendentes.get(id);
    if (!espera) return;
    pendentes.delete(id);
    clearTimeout(espera.relogio);
    ok ? espera.resolver(mensagem) : espera.rejeitar(new Error(mensagem));
  }
};

function enviar(endereco, texto, semAcentos) {
  const p = ponte();
  if (!p) return Promise.reject(new Error('A impressão só funciona no aplicativo instalado no celular.'));
  if (!endereco) return Promise.reject(new Error('Nenhuma impressora escolhida. Vá em Ajustes › Impressora.'));

  return new Promise((resolver, rejeitar) => {
    const id = `imp${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const relogio = setTimeout(() => {
      pendentes.delete(id);
      rejeitar(new Error('A impressora não respondeu. Confira se está ligada e pareada.'));
    }, 30000);
    pendentes.set(id, { resolver, rejeitar, relogio });
    try {
      p.imprimir(id, endereco, texto, Boolean(semAcentos));
    } catch (e) {
      pendentes.delete(id); clearTimeout(relogio);
      rejeitar(new Error('Não consegui acionar a impressora.'));
    }
  });
}

/** Imprime o cupom de uma venda já registrada. */
export async function imprimirCupom(venda) {
  const dispositivo = await impressoraEscolhida();
  const loja = await config('loja', {});
  const largura = Number(await config('impressoraColunas', 32)) || 32;
  const semAcentos = (await config('impressoraSemAcentos', true)) !== false;
  return enviar(dispositivo?.endereco, montarCupom(venda, loja, largura), semAcentos);
}

/** Página de teste, para conferir papel, largura e acentos. */
export async function imprimirTeste(endereco) {
  const largura = Number(await config('impressoraColunas', 32)) || 32;
  const semAcentos = (await config('impressoraSemAcentos', true)) !== false;
  const loja = await config('loja', {});
  const texto = [
    centro((loja.nome || 'LOJA DAS ARGAMASSAS').toUpperCase(), largura),
    repetir('-', largura),
    centro('TESTE DE IMPRESSAO', largura),
    '',
    doisLados('Largura do papel', `${largura} colunas`, largura),
    doisLados('Acentuação', semAcentos ? 'removida' : 'mantida', largura),
    'Acentuação: ação, José, coração',
    repetir('-', largura),
    doisLados('Argamassa AC-III 20kg', '', largura),
    doisLados('  10 x 31,50', '315,00', largura),
    doisLados('TOTAL', 'R$ 315,00', largura),
    '', centro('Se leu tudo, esta pronto!', largura), ''
  ].join('\n');
  return enviar(endereco, texto, semAcentos);
}
