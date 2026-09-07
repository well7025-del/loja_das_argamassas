/* ============================================================
   Comandos de voz (Web Speech API)
   Usado no PDV para lancar produtos e no cadastro rapido de clientes.
   ============================================================ */

const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;

export const vozDisponivel = () => Boolean(Reconhecimento);

/**
 * Cria um reconhecedor de fala em pt-BR.
 * onTexto(textoFinal, ehParcial) é chamado a cada resultado.
 */
export function criarReconhecedor({ onTexto, onEstado, onErro, continuo = true } = {}) {
  if (!Reconhecimento) return null;
  const r = new Reconhecimento();
  r.lang = 'pt-BR';
  r.continuous = continuo;
  r.interimResults = true;
  r.maxAlternatives = 1;
  let ativo = false;

  r.onstart = () => { ativo = true; onEstado?.('ouvindo'); };
  r.onend = () => { ativo = false; onEstado?.('parado'); };
  r.onerror = (e) => {
    ativo = false;
    const msgs = {
      'no-speech': 'Não ouvi nada. Tente novamente.',
      'not-allowed': 'Permissão de microfone negada. Libere o microfone nas configurações do navegador.',
      'service-not-allowed': 'O navegador bloqueou o reconhecimento de voz.',
      'audio-capture': 'Microfone não encontrado.',
      'network': 'Sem conexão para o reconhecimento de voz.'
    };
    onErro?.(msgs[e.error] || `Erro no reconhecimento de voz (${e.error})`);
    onEstado?.('parado');
  };
  r.onresult = (evento) => {
    for (let i = evento.resultIndex; i < evento.results.length; i++) {
      const res = evento.results[i];
      onTexto?.(res[0].transcript.trim(), !res.isFinal);
    }
  };

  return {
    iniciar() { if (!ativo) { try { r.start(); } catch {} } },
    parar() { try { r.stop(); } catch {} },
    alternar() { ativo ? this.parar() : this.iniciar(); },
    get ativo() { return ativo; }
  };
}

/* ---------------- Interpretacao ---------------- */
export const normalizar = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const NUMEROS = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, meia: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14,
  quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30,
  quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100,
  duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, mil: 1000
};

/** Converte "vinte e cinco" ou "25" em numero. Devolve null se nao houver numero. */
export function extrairNumero(tokens) {
  let total = null, parcial = 0;
  for (const t of tokens) {
    if (/^\d+$/.test(t)) { total = (total || 0) + Number(t); continue; }
    if (t === 'e') continue;
    if (t in NUMEROS) { parcial += NUMEROS[t]; total = (total || 0); }
    else if (parcial) break;
  }
  const soma = (total || 0) + parcial;
  return soma > 0 ? soma : null;
}

/** Trata "ac 1", "ac um", "a c dois" como "ac i", "ac ii" (padrao das argamassas colantes). */
function normalizarAC(texto) {
  return texto
    .replace(/\ba\s*c\b/g, 'ac')
    .replace(/\bac\s*(3|tres|iii)\b/g, 'ac iii')
    .replace(/\bac\s*(2|dois|duas|ii)\b/g, 'ac ii')
    .replace(/\bac\s*(1|um|uma|i)\b/g, 'ac i');
}

/**
 * Casa um trecho falado com a lista de produtos.
 * Pontua por token encontrado, com peso maior para tokens longos e para o inicio do nome.
 */
export function encontrarProduto(trecho, produtos) {
  const alvo = normalizarAC(normalizar(trecho));
  if (!alvo) return null;
  const tokensAlvo = alvo.split(' ').filter(t => t.length > 1 || /\d/.test(t));
  if (!tokensAlvo.length) return null;

  let melhor = null, melhorNota = 0;
  for (const p of produtos) {
    const nome = normalizarAC(normalizar(`${p.name} ${p.sku || ''}`));
    let nota = 0;
    for (const t of tokensAlvo) {
      if (nome.includes(t)) nota += t.length >= 4 ? 3 : 2;
      else if (t.length >= 5 && nome.split(' ').some(n => n.startsWith(t.slice(0, 4)))) nota += 1;
    }
    if (nome.startsWith(tokensAlvo[0])) nota += 2;
    nota = nota / Math.max(1, tokensAlvo.length);
    if (nota > melhorNota) { melhorNota = nota; melhor = p; }
  }
  return melhorNota >= 1.5 ? { produto: melhor, confianca: Math.min(1, melhorNota / 3) } : null;
}

const PALAVRAS_IGNORADAS = new Set(['adicionar', 'adiciona', 'acrescentar', 'coloca', 'colocar', 'poe', 'por',
  'bota', 'botar', 'quero', 'vender', 'venda', 'lancar', 'lanca', 'de', 'do', 'da', 'dos', 'das', 'sacos',
  'saco', 'unidades', 'unidade', 'pacotes', 'pacote', 'caixas', 'caixa', 'e', 'com', 'mais', 'um', 'uma']);

/**
 * Interpreta um comando de PDV.
 * Exemplos: "10 argamassa ac 3", "adicionar cinco rejunte branco",
 *           "finalizar venda", "limpar pedido", "remover cimento".
 */
export function interpretarComandoPDV(texto, produtos) {
  const t = normalizar(texto);
  if (!t) return { acao: 'nada' };

  if (/\b(finalizar|fechar|concluir)\b/.test(t)) return { acao: 'finalizar' };
  if (/\b(limpar|cancelar|zerar|apagar tudo)\b/.test(t)) return { acao: 'limpar' };

  const desconto = t.match(/\bdesconto (?:de )?([\d,\.]+)/);
  if (desconto) return { acao: 'desconto', valor: Number(desconto[1].replace(/\./g, '').replace(',', '.')) };

  if (/\b(remover|tirar|excluir)\b/.test(t)) {
    const resto = t.replace(/\b(remover|tirar|excluir)\b/, '').trim();
    const achado = encontrarProduto(resto, produtos);
    return achado ? { acao: 'remover', produto: achado.produto } : { acao: 'desconhecido', texto };
  }

  const tokens = t.split(' ');
  const qtd = extrairNumero(tokens.slice(0, 4)) || 1;
  const trecho = tokens.filter(x => !PALAVRAS_IGNORADAS.has(x) && !/^\d+$/.test(x) && !(x in NUMEROS)).join(' ');
  const achado = encontrarProduto(trecho || t, produtos);
  if (achado) return { acao: 'adicionar', produto: achado.produto, qtd, confianca: achado.confianca };
  return { acao: 'desconhecido', texto };
}

/**
 * Interpreta o cadastro falado de um cliente.
 * Exemplo: "nome Joao da Silva telefone 81 9 8888 7777 cep 51020 000"
 */
export function interpretarCliente(texto) {
  const bruto = String(texto || '').trim();
  const t = normalizar(bruto);
  const saida = {};

  const cep = t.match(/cep\s+([\d\s]{8,12})/) || bruto.match(/(\d{5})[-\s]?(\d{3})\b/);
  if (cep) {
    const digitos = (cep[0] || '').replace(/\D/g, '').slice(-8);
    if (digitos.length === 8) saida.cep = `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
  }

  const tel = t.match(/(?:telefone|celular|whatsapp|zap|fone)\s+([\d\s]{8,20})/);
  if (tel) {
    const digitos = tel[1].replace(/\D/g, '');
    if (digitos.length >= 10) saida.phone = digitos.slice(0, 11);
  } else {
    const solto = bruto.replace(/\D/g, '');
    if (!saida.cep && solto.length >= 10 && solto.length <= 11) saida.phone = solto;
  }

  const nome = bruto.match(/nome\s+(.+?)(?=\s+(?:telefone|celular|whatsapp|zap|fone|cep|endereco|numero)\b|$)/i);
  if (nome) {
    saida.name = nome[1].trim().replace(/\s+/g, ' ')
      .split(' ').map(p => p.length > 2 ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p.toLowerCase()).join(' ');
  } else if (!/\d/.test(bruto) && bruto.length > 2) {
    saida.name = bruto.split(' ').map(p => p.length > 2 ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p.toLowerCase()).join(' ');
  }

  const num = t.match(/numero\s+(\d+)/);
  if (num) saida.number = num[1];

  return saida;
}
