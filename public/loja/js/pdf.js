/* ============================================================
   Gerador de PDF.

   Escrito à mão, sem biblioteca: o aplicativo precisa gerar o comprovante e os
   relatórios offline, dentro do celular, e carregar uma biblioteca de CDN
   quebraria isso. Produz PDF 1.4 com texto de verdade (selecionável e
   pesquisável), usando Helvetica — que todo leitor já tem, sem embutir fonte.
   ============================================================ */

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 42;

/* ---------------- Largura dos caracteres (Helvetica, em /1000) ---------------- */

const LARGURAS_BASE =
  '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 ' +
  '278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 ' +
  '611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 ' +
  '556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584';

const LARGURAS_NEGRITO =
  '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 ' +
  '333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 ' +
  '611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 ' +
  '611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584';

const tabela = (texto) => texto.split(' ').map(Number);
const MEDIDAS = { normal: tabela(LARGURAS_BASE), negrito: tabela(LARGURAS_NEGRITO) };

/** Acentuados herdam a largura da letra base — diferença imperceptível no papel. */
const SEM_ACENTO = {
  'á':'a','à':'a','ã':'a','â':'a','ä':'a','é':'e','ê':'e','è':'e','ë':'e','í':'i','ì':'i','î':'i','ï':'i',
  'ó':'o','ô':'o','õ':'o','ò':'o','ö':'o','ú':'u','ù':'u','û':'u','ü':'u','ç':'c','ñ':'n',
  'Á':'A','À':'A','Ã':'A','Â':'A','Ä':'A','É':'E','Ê':'E','È':'E','Ë':'E','Í':'I','Ì':'I','Î':'I','Ï':'I',
  'Ó':'O','Ô':'O','Õ':'O','Ò':'O','Ö':'O','Ú':'U','Ù':'U','Û':'U','Ü':'U','Ç':'C','Ñ':'N'
};

function larguraTexto(texto, tamanho, negrito) {
  const medidas = negrito ? MEDIDAS.negrito : MEDIDAS.normal;
  let total = 0;
  for (const c of String(texto)) {
    const base = SEM_ACENTO[c] || c;
    const codigo = base.charCodeAt(0);
    total += (codigo >= 32 && codigo <= 126) ? medidas[codigo - 32] : 556;
  }
  return total * tamanho / 1000;
}

/* ---------------- Codificação ---------------- */

/** Caracteres fora do Latin-1 que o WinAnsi coloca em outras posições. */
const WINANSI = { '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136,
  '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149,
  '–': 150, '—': 151, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'Ÿ': 159 };

/** Texto -> bytes WinAnsi, já escapado para caber numa string de PDF. */
function stringPdf(texto) {
  const bytes = [];
  for (const c of String(texto ?? '')) {
    let codigo = WINANSI[c] ?? c.charCodeAt(0);
    if (codigo > 255) codigo = 63;                 // '?' para o que não existe na tabela
    if (codigo === 40 || codigo === 41 || codigo === 92) bytes.push(92);   // ( ) \ precisam de escape
    bytes.push(codigo);
  }
  return bytes;
}

/* ---------------- Construtor ---------------- */

export function criarPdf({ titulo = 'Documento', autor = 'Loja das Argamassas', paisagem = false } = {}) {
  const largura = paisagem ? A4.altura : A4.largura;
  const altura = paisagem ? A4.largura : A4.altura;

  const paginas = [];
  let atual = [];
  let y = altura - MARGEM;

  const comandos = {
    /** Escreve texto. `x` aceita 'centro', 'direita' ou um número em pontos. */
    texto(conteudo, { x = null, tamanho = 10, negrito = false, cor = null, alinhamento = 'esquerda', yFixo = null } = {}) {
      const linha = String(conteudo ?? '');
      const posY = yFixo ?? y;
      // `x` é a borda de referência: à esquerda é onde o texto começa; à direita,
      // onde ele termina. Sem x, cada alinhamento usa a margem correspondente.
      let posX;
      if (alinhamento === 'direita') posX = (x ?? (largura - MARGEM)) - larguraTexto(linha, tamanho, negrito);
      else if (alinhamento === 'centro') {
        const centro = x ?? largura / 2;
        posX = centro - larguraTexto(linha, tamanho, negrito) / 2;
      } else posX = x ?? MARGEM;

      const pedaco = [];
      if (cor) pedaco.push(`${cor[0]} ${cor[1]} ${cor[2]} rg`);
      pedaco.push('BT', `/${negrito ? 'FB' : 'FN'} ${tamanho} Tf`, `${posX.toFixed(2)} ${posY.toFixed(2)} Td`);
      pedaco.push({ texto: linha });
      pedaco.push('ET');
      if (cor) pedaco.push('0 0 0 rg');
      atual.push(...pedaco);
      return comandos;
    },

    /** Move o cursor vertical. */
    pular(pontos = 14) { y -= pontos; return comandos; },
    posicao() { return y; },
    irPara(novoY) { y = novoY; return comandos; },
    limiteInferior() { return MARGEM + 30; },

    linha({ de = MARGEM, ate = largura - MARGEM, espessura = 0.6, cor = [0.78, 0.83, 0.88] } = {}) {
      atual.push(`${cor[0]} ${cor[1]} ${cor[2]} RG`, `${espessura} w`,
                 `${de} ${y.toFixed(2)} m`, `${ate} ${y.toFixed(2)} l`, 'S', '0 0 0 RG');
      return comandos;
    },

    retangulo({ de = MARGEM, ate = largura - MARGEM, alturaCaixa = 16, cor = [0.95, 0.97, 0.99], deslocamento = -4 } = {}) {
      atual.push(`${cor[0]} ${cor[1]} ${cor[2]} rg`,
                 `${de} ${(y + deslocamento).toFixed(2)} ${(ate - de).toFixed(2)} ${alturaCaixa} re`, 'f', '0 0 0 rg');
      return comandos;
    },

    /** Quebra o texto na largura disponível e escreve linha a linha. */
    paragrafo(conteudo, { tamanho = 10, negrito = false, larguraMax = largura - MARGEM * 2, entrelinha = 13, x = null } = {}) {
      const palavras = String(conteudo ?? '').split(/\s+/);
      let linha = '';
      for (const palavra of palavras) {
        const teste = linha ? linha + ' ' + palavra : palavra;
        if (larguraTexto(teste, tamanho, negrito) > larguraMax && linha) {
          comandos.texto(linha, { tamanho, negrito, x }); comandos.pular(entrelinha);
          linha = palavra;
        } else linha = teste;
      }
      if (linha) { comandos.texto(linha, { tamanho, negrito, x }); comandos.pular(entrelinha); }
      return comandos;
    },

    novaPagina() {
      paginas.push(atual);
      atual = [];
      y = altura - MARGEM;
      return comandos;
    },

    /** Abre página nova se não couber mais `espaco` pontos. */
    garantirEspaco(espaco = 40, aoAbrir = null) {
      if (y - espaco < comandos.limiteInferior()) { comandos.novaPagina(); aoAbrir?.(comandos); }
      return comandos;
    },

    largura, altura, margem: MARGEM,
    larguraUtil: largura - MARGEM * 2,
    medir: (t, tam, neg) => larguraTexto(t, tam, neg),

    finalizar() {
      paginas.push(atual);
      return montar(paginas, { largura, altura, titulo, autor });
    }
  };

  return comandos;
}

/* ---------------- Montagem do arquivo ---------------- */

function montar(paginas, { largura, altura, titulo, autor }) {
  const bytes = [];
  const escrever = (texto) => { for (const c of texto) bytes.push(c.charCodeAt(0) & 0xff); };
  const posicoes = [];

  escrever('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const objetos = [];
  const idCatalogo = 1, idPaginas = 2, idFonteN = 3, idFonteB = 4, idInfo = 5;
  const idPrimeiraPagina = 6;
  const idsPagina = paginas.map((_, i) => idPrimeiraPagina + i * 2);
  const idsConteudo = paginas.map((_, i) => idPrimeiraPagina + i * 2 + 1);

  objetos[idCatalogo] = `<< /Type /Catalog /Pages ${idPaginas} 0 R >>`;
  objetos[idPaginas] = `<< /Type /Pages /Kids [${idsPagina.map(i => `${i} 0 R`).join(' ')}] /Count ${paginas.length} >>`;
  objetos[idFonteN] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objetos[idFonteB] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objetos[idInfo] = `<< /Title (${titulo.replace(/[()\\]/g, '')}) /Producer (${autor.replace(/[()\\]/g, '')}) >>`;

  const fluxos = [];
  paginas.forEach((comandos, i) => {
    objetos[idsPagina[i]] = `<< /Type /Page /Parent ${idPaginas} 0 R /MediaBox [0 0 ${largura.toFixed(2)} ${altura.toFixed(2)}] ` +
      `/Resources << /Font << /FN ${idFonteN} 0 R /FB ${idFonteB} 0 R >> >> /Contents ${idsConteudo[i]} 0 R >>`;
    // o conteúdo é montado em bytes porque as strings já vêm em WinAnsi
    const corpo = [];
    for (const parte of comandos) {
      if (typeof parte === 'string') { for (const c of parte) corpo.push(c.charCodeAt(0) & 0xff); corpo.push(10); }
      else { corpo.push(40); corpo.push(...stringPdf(parte.texto)); corpo.push(41, 32, 84, 106, 10); }  // (texto) Tj
    }
    fluxos[idsConteudo[i]] = corpo;
  });

  const total = Math.max(idCatalogo, idPaginas, idFonteN, idFonteB, idInfo, ...idsPagina, ...idsConteudo);
  for (let id = 1; id <= total; id++) {
    posicoes[id] = bytes.length;
    if (fluxos[id]) {
      escrever(`${id} 0 obj\n<< /Length ${fluxos[id].length} >>\nstream\n`);
      bytes.push(...fluxos[id]);
      escrever('\nendstream\nendobj\n');
    } else {
      escrever(`${id} 0 obj\n${objetos[id] || '<< >>'}\nendobj\n`);
    }
  }

  const inicioTabela = bytes.length;
  escrever(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= total; id++) escrever(`${String(posicoes[id]).padStart(10, '0')} 00000 n \n`);
  escrever(`trailer\n<< /Size ${total + 1} /Root ${idCatalogo} 0 R /Info ${idInfo} 0 R >>\nstartxref\n${inicioTabela}\n%%EOF\n`);

  return new Uint8Array(bytes);
}

/* ---------------- Utilidades ---------------- */

export const pdfParaBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' });

export function pdfParaBase64(bytes) {
  let binario = '';
  const passo = 8192;
  for (let i = 0; i < bytes.length; i += passo) {
    binario += String.fromCharCode(...bytes.subarray(i, i + passo));
  }
  return btoa(binario);
}
